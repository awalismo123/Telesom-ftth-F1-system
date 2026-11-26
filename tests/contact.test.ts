import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  CHANNEL_HINT,
  CHANNEL_LABEL,
  channelStates,
  contactNumber,
  smsLink,
  telLink,
} from '../src/lib/contact';
import { buildCustomerUpdate, buildCustomerUpdatePair } from '../src/lib/customerUpdate';

/**
 * Three channels, one message.
 *
 * The app used to offer WhatsApp and nothing else, which quietly decided that
 * every customer has a smartphone with data. They do not — and the customer this
 * feature exists for is the one sitting at home with an old phone, waiting for
 * somebody who may not come, with no way to find out.
 *
 * These tests hold the parts that are easy to get subtly wrong: the number
 * format in a link, the encoding of a multi-line message, and the fact that a
 * channel with no number is refused rather than offered and then failing.
 */

const TODAY = '2026-11-18';
const PHONE = '634418376';

const task = (overrides: Record<string, unknown> = {}) => ({
  line_number: 'LN00123',
  customer_name: 'Cabdi Xasan',
  scheduled_date: TODAY,
  ...overrides,
});

const message = (kind: 'en_route' | 'planned' | 'completed' | 'delayed', lang: 'en' | 'so') =>
  buildCustomerUpdate(task(), { kind, lang, today: TODAY, groupCode: 'F1' });

/* -------------------------------------------------------------------------- */
/* The number                                                                  */
/* -------------------------------------------------------------------------- */

test('contact: every shape the sheets produce becomes one international number', () => {
  // The daily sheet writes all of these, and the printed job sheet, the tel:
  // link and the SMS link must all agree about who is being called.
  for (const raw of ['634418376', '0634418376', '+252634418376', '252 63 441 8376', '0634 418 376']) {
    assert.equal(contactNumber(raw), '+252634418376', `${raw} was not normalised`);
  }
});

test('contact: a number that cannot be repaired yields nothing, not a guess', () => {
  // A short number is a landline or an OCR error. Sending an SMS to a guessed
  // number is worse than not offering the button.
  for (const raw of ['', null, undefined, '123', '63441']) {
    assert.equal(contactNumber(raw), '', `${raw} should not produce a number`);
  }
});

test('contact: a missing number disables every channel, with a reason', () => {
  const states = channelStates('');
  for (const channel of ['whatsapp', 'sms', 'call'] as const) {
    assert.equal(states[channel].unavailable, 'no_phone', `${channel} must be refused`);
  }

  const good = channelStates(PHONE);
  for (const channel of ['whatsapp', 'sms', 'call'] as const) {
    assert.equal(good[channel].unavailable, null, `${channel} must be usable`);
  }
});

/* -------------------------------------------------------------------------- */
/* The links                                                                   */
/* -------------------------------------------------------------------------- */

test('contact: the SMS link carries the number and the whole message', () => {
  const text = message('en_route', 'en');
  const link = smsLink(PHONE, text);

  assert.match(link, /^sms:\+252634418376\?body=/, 'the shape Android and iOS both parse');

  // The body must survive encoding: decode it and it is the same message, line
  // breaks included. A truncated SMS is a half-sent instruction.
  const body = decodeURIComponent(link.slice(link.indexOf('?body=') + 6));
  assert.equal(body, text);
  assert.match(body, /\n/, 'the message is multi-line and must stay so');
});

test('contact: the SMS link is refused when there is no number', () => {
  // An `sms:` with no recipient opens the messaging app on a blank compose
  // screen, which looks like it worked. It did not.
  assert.equal(smsLink('', 'hello'), '');
  assert.equal(smsLink(null, 'hello'), '');
});

test('contact: the call link dials the international number', () => {
  assert.equal(telLink(PHONE), 'tel:+252634418376');
  assert.equal(telLink(''), '');
});

test('contact: every channel is labelled in both languages', () => {
  for (const channel of ['whatsapp', 'sms', 'call'] as const) {
    assert.ok(CHANNEL_LABEL[channel].en.length > 1);
    assert.ok(CHANNEL_LABEL[channel].so.length > 1);
    assert.ok(CHANNEL_HINT[channel].en.length > 3);
    assert.ok(CHANNEL_HINT[channel].so.length > 3);
  }
});

test('contact: building a link cannot send anything', () => {
  // Same rule as the message builder: this module produces URLs. It must not
  // open them, and must not claim delivery it cannot observe.
  const source = readFileSync(
    fileURLToPath(new URL('../src/lib/contact.ts', import.meta.url)),
    'utf8',
  );

  assert.doesNotMatch(source, /window\.open/, 'opening a link is the component’s job');
  assert.doesNotMatch(source, /fetch\(/, 'no network');
  assert.doesNotMatch(source, /navigator\.(share|clipboard)/);
  assert.doesNotMatch(source, /delivered|receipt/i, 'we cannot report delivery');
});

/* -------------------------------------------------------------------------- */
/* The two new message kinds                                                   */
/* -------------------------------------------------------------------------- */

test('completed: says the line is fixed, in both languages, and names the line', () => {
  const en = message('completed', 'en');
  const so = message('completed', 'so');

  assert.match(en, /resolved/i);
  assert.match(en, /LN00123/);
  assert.match(so, /la hagaajiyay/);
  assert.match(so, /LN00123/);

  // Thanks, once. A message that thanks the customer twice reads as a template.
  assert.equal((en.match(/thank/gi) ?? []).length, 1);
});

test('delayed: admits we came, did not finish, and will return', () => {
  const en = message('delayed', 'en');
  const so = message('delayed', 'so');

  assert.match(en, /tried to visit/i);
  assert.match(en, /could not finish/i);
  assert.match(en, /come back/i);
  assert.match(so, /isku daynay/);
  assert.match(so, /ma dhamayn/);
  assert.match(so, /dib u iman/);
  assert.match(en, /LN00123/);
});

test('delayed: never invents the new day', () => {
  // "We will come back another day" is a fact. A date we do not know yet is the
  // exact broken promise this module was built to avoid.
  const en = message('delayed', 'en');
  assert.doesNotMatch(en, /\d{1,2}\/\d{1,2}\/\d{4}/, 'the delay message named a date');

  const so = message('delayed', 'so');
  assert.doesNotMatch(so, /\d{1,2}\/\d{1,2}\/\d{4}/);
});

test('no new kind smuggles in a clock time', () => {
  // The rule that predates all of this, re-checked against the new kinds.
  for (const kind of ['en_route', 'planned', 'completed', 'delayed'] as const) {
    for (const lang of ['en', 'so'] as const) {
      const text = message(kind, lang);
      assert.doesNotMatch(text, /\b\d{1,2}:\d{2}\b/, `${kind}/${lang} has a clock time`);
      assert.doesNotMatch(text, /\b\d{1,2}\s*(am|pm)\b/i, `${kind}/${lang} names an hour`);
    }
  }
});

test('every kind is written in both languages and they differ', () => {
  for (const kind of ['en_route', 'planned', 'completed', 'delayed'] as const) {
    const pair = buildCustomerUpdatePair(task(), { kind, today: TODAY, groupCode: 'F1' });
    assert.ok(pair.en.length > 20, `${kind} has no English text`);
    assert.ok(pair.so.length > 20, `${kind} has no Somali text`);
    assert.notEqual(pair.en, pair.so, `${kind}: the Somali text is the English one`);
    assert.match(pair.en, /LN00123/);
    assert.match(pair.so, /LN00123/);
  }
});

/* -------------------------------------------------------------------------- */
/* The panel                                                                   */
/* -------------------------------------------------------------------------- */

test('the panel offers all three channels and hides them with no number', () => {
  const panel = readFileSync(
    fileURLToPath(new URL('../src/components/ui/ContactCustomerPanel.tsx', import.meta.url)),
    'utf8',
  );

  // Three buttons, one per channel.
  assert.match(panel, /\[.wa.?tsapp., .sms., .call.\]|CHANNELS: ContactChannel\[\] = \['whatsapp', 'sms', 'call'\]/);
  // A dead button teaches a technician to stop looking, so it is refused with a
  // reason rather than offered.
  assert.match(panel, /states\[channel\]\.unavailable/);
  assert.match(panel, /No phone number on this job/);
  // The claim the whole design rests on.
  assert.match(panel, /Nothing is sent automatically/);
  assert.match(panel, /Waxba si toos ah looma diro/);
});

test('the technician gets the panel for all three moments', () => {
  const sheet = readFileSync(
    fileURLToPath(new URL('../src/components/technician/ExecutionSheet.tsx', import.meta.url)),
    'utf8',
  );

  // Set off, finished, and could not finish. Each is a moment the customer is
  // otherwise left guessing about.
  assert.match(sheet, /setContactKind\('en_route'\)/);
  assert.match(sheet, /setContactKind\('completed'\)/);
  assert.match(sheet, /setContactKind\('delayed'\)/);
  assert.match(sheet, /<ContactCustomerPanel/);
});

test('the supervisor gets the same panel and the line history', () => {
  const sheet = readFileSync(
    fileURLToPath(
      new URL('../src/components/supervisor/dispatch/JobActionsSheet.tsx', import.meta.url),
    ),
    'utf8',
  );

  assert.match(sheet, /<ContactCustomerPanel/);
  // The supervisor decides whether to send somebody; the line's history is the
  // evidence for that decision, and only the technician could see it before.
  assert.match(sheet, /<LineHistoryPanel/);
  // The WhatsApp-only button this replaced must not come back.
  assert.doesNotMatch(sheet, /openWhatsapp/);
});

test('the sheet marks the job on the way before offering the message', () => {
  const sheet = readFileSync(
    fileURLToPath(new URL('../src/components/technician/ExecutionSheet.tsx', import.meta.url)),
    'utf8',
  );

  // Record first, message second: a blocked popup must not lose the fact that
  // the technician set off, which is what dispatch and the SLA clock read.
  const enRoute = sheet.slice(sheet.indexOf('const doEnRoute'));
  const markAt = enRoute.indexOf('markEnRoute(');
  const offerAt = enRoute.indexOf("setContactKind('en_route')");
  assert.ok(markAt >= 0 && offerAt > markAt, 'the time must be recorded before the message is offered');
});
