import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildCustomerUpdate,
  buildCustomerUpdatePair,
  dayForCustomer,
  expectedDay,
} from '../src/lib/customerUpdate';
import { whatsappLink } from '../src/lib/dispatch';

/**
 * This is the only text in the app that a **customer** reads, and it is written
 * by a technician standing in a doorway. The tests below are mostly about what
 * the message must NOT contain: a clock time, a promise the department cannot
 * keep, or a claim that something was sent when nothing was.
 */

const TODAY = '2026-11-18';

const task = (overrides: Record<string, unknown> = {}) => ({
  line_number: 'LN00123',
  customer_name: 'Cabdi Xasan',
  scheduled_date: TODAY,
  ...overrides,
});

const build = (kind: 'en_route' | 'planned', lang: 'en' | 'so', overrides = {}) =>
  buildCustomerUpdate(task(overrides), { kind, lang, today: TODAY, groupCode: 'F1' });

/* -------------------------------------------------------------------------- */
/* The day                                                                     */
/* -------------------------------------------------------------------------- */

test('a day is written day-first, with its weekday', () => {
  // Both languages read 03/04 ambiguously; day-first with the weekday removes
  // the doubt, and the weekday is what someone actually remembers.
  const en = dayForCustomer('2026-11-18', 'en');
  assert.match(en, /Wed/);
  assert.match(en, /18\/11\/2026/);

  const so = dayForCustomer('2026-11-18', 'so');
  assert.match(so, /Arbaco/);
  assert.match(so, /18\/11\/2026/);
});

test('an unreadable day is left out rather than invented', () => {
  // Printing "planned for —" is nonsense and printing today's date is a false
  // promise. The message drops the day clause and says less.
  assert.equal(dayForCustomer('not-a-day', 'en'), '');

  for (const lang of ['en', 'so'] as const) {
    const text = build('planned', lang, { scheduled_date: 'not-a-day' });
    assert.doesNotMatch(text, /—\s*[.\n]/, `${lang} printed a dash as a date`);
    assert.doesNotMatch(text, /planned for\s*\./, `${lang} left a dangling "planned for."`);
    assert.match(text, lang === 'so' ? /Waqti sax ah ma sheegi karno/ : /cannot give an exact time/);
  }
});

test('an "on my way" message means today, whatever the job was planned for', () => {
  // The technician is travelling now. The planned day is history at this point.
  assert.equal(expectedDay(task({ scheduled_date: '2026-12-01' }), 'en_route', TODAY), TODAY);
});

test('a planned message uses the job day, and today when it has none', () => {
  assert.equal(expectedDay(task({ scheduled_date: '2026-12-01' }), 'planned', TODAY), '2026-12-01');
  assert.equal(expectedDay(task({ scheduled_date: null }), 'planned', TODAY), TODAY);
});

/* -------------------------------------------------------------------------- */
/* What the message must contain                                               */
/* -------------------------------------------------------------------------- */

test('both kinds name the line and the day, in both languages', () => {
  for (const kind of ['en_route', 'planned'] as const) {
    for (const lang of ['en', 'so'] as const) {
      const text = build(kind, lang);
      assert.match(text, /LN00123/, `${kind}/${lang} lost the line number`);
      assert.match(text, /18\/11\/2026/, `${kind}/${lang} lost the day`);
      assert.match(text, /Cabdi Xasan/, `${kind}/${lang} lost the customer's name`);
    }
  }
});

test('the day is named as "today" when it is today', () => {
  // "planned for today" is what makes a customer stay at home. A bare date does
  // not carry the same urgency.
  assert.match(build('planned', 'en'), /today \(Wed 18\/11\/2026\)/);
  assert.match(build('planned', 'so'), /maanta \(Arbaco 18\/11\/2026\)/);
});

test('a future day is a date, not "today"', () => {
  const future = { scheduled_date: '2026-11-26' };
  assert.doesNotMatch(build('planned', 'en', future), /today/);
  assert.match(build('planned', 'en', future), /Thu 26\/11\/2026/);
});

test('a message with no customer name still reads properly', () => {
  // Customer names arrive from an OCR'd sheet and are sometimes blank. "Hello ,"
  // would look like a machine wrote it — even more than it already does.
  for (const lang of ['en', 'so'] as const) {
    const text = build('planned', lang, { customer_name: '' });
    // The bare greeting is correct here: "Hello," on its own reads fine, and
    // "Hello ," or "Hello undefined" does not.
    assert.doesNotMatch(text, /,\s*,/);
    assert.doesNotMatch(text, /undefined|null/);
    assert.match(text, lang === 'so' ? /^Salaam,/ : /^Hello,/);
  }
});

test('the sign-off carries the group code, and survives without one', () => {
  assert.match(build('planned', 'en'), /Telesom Group F1/);
  assert.match(build('planned', 'so'), /Telesom Kooxda F1/);

  const noCode = buildCustomerUpdate(task(), {
    kind: 'planned',
    lang: 'en',
    today: TODAY,
    groupCode: null,
  });
  assert.match(noCode, /— Telesom/);
  assert.doesNotMatch(noCode, /Group\s*$/m);
});

/* -------------------------------------------------------------------------- */
/* What the message must NEVER contain                                         */
/* -------------------------------------------------------------------------- */

test('no clock time ever reaches a customer', () => {
  // The single most important assertion in this file. A window of "2 to 4" that
  // is missed is a broken promise; "we cannot give an exact time" is honest.
  const kinds = ['en_route', 'planned'] as const;
  const days = [TODAY, '2026-11-26', '2026-12-01'];

  for (const kind of kinds) {
    for (const lang of ['en', 'so'] as const) {
      for (const day of days) {
        const text = build(kind, lang, { scheduled_date: day });
        assert.doesNotMatch(
          text,
          /\b\d{1,2}:\d{2}\b/,
          `${kind}/${lang} contains a clock time:\n${text}`,
        );
        // "between 9 and 11", "9am", "14:00–16:00"
        assert.doesNotMatch(text, /\b\d{1,2}\s*(am|pm|AM|PM)\b/, `${kind}/${lang} names an hour`);
        assert.doesNotMatch(text, /\b\d{1,2}(am|pm)?\s*(-|–|to)\s*\d{1,2}/i, `${kind}/${lang} names a window`);
      }
    }
  }
});

test('the planned message says plainly that no exact time is promised', () => {
  assert.match(build('planned', 'en'), /cannot give an exact time/i);
  assert.match(build('planned', 'so'), /Waqti sax ah ma sheegi karno/i);
});

test('the two languages say the same things', () => {
  // A customer reading Somali must not get a weaker or stronger claim than one
  // reading English.
  const en = build('planned', 'en');
  const so = build('planned', 'so');

  for (const token of ['LN00123', '18/11/2026']) {
    assert.ok(en.includes(token) && so.includes(token), `${token} missing from one language`);
  }
  assert.notEqual(en, so, 'the Somali message is the English one');
});

/* -------------------------------------------------------------------------- */
/* Nothing is sent                                                             */
/* -------------------------------------------------------------------------- */

test('building a message has no way to send it', () => {
  // The module must remain a pure text builder. If a fetch, an rpc or a
  // wa.me URL ever appears in it, something is transmitting from a place that
  // is supposed to only produce words.
  const source = readFileSync(
    fileURLToPath(new URL('../src/lib/customerUpdate.ts', import.meta.url)),
    'utf8',
  );

  assert.doesNotMatch(source, /fetch\(/, 'customerUpdate must not call fetch');
  assert.doesNotMatch(source, /\.rpc\(/, 'customerUpdate must not call the database');
  assert.doesNotMatch(source, /wa\.me/, 'the link belongs to the caller, not the message text');
  assert.doesNotMatch(source, /navigator\.(share|clipboard)/, 'sending is a UI decision');
});

test('the pair helper returns both languages of the same job', () => {
  const pair = buildCustomerUpdatePair(task(), { kind: 'planned', today: TODAY, groupCode: 'F1' });
  assert.match(pair.en, /planned for/);
  assert.match(pair.so, /loo qorsheeyay/);
  assert.ok(pair.en.includes('LN00123') && pair.so.includes('LN00123'));
});

/* -------------------------------------------------------------------------- */
/* Blank input must not produce a broken sentence                              */
/* -------------------------------------------------------------------------- */

test('a job with no line number degrades to a dash, not "undefined"', () => {
  for (const lang of ['en', 'so'] as const) {
    const text = build('en_route', lang, { line_number: '' });
    assert.doesNotMatch(text, /undefined|null|NaN/);
  }
});

test('every message ends with a sign-off and no trailing whitespace', () => {
  for (const kind of ['en_route', 'planned'] as const) {
    for (const lang of ['en', 'so'] as const) {
      const text = build(kind, lang);
      assert.match(text, /— Telesom/);
      assert.equal(text, text.trim());
      assert.doesNotMatch(text, /\n{3,}/);
    }
  }
});

/* -------------------------------------------------------------------------- */
/* The link: a picker, never a recipient                                       */
/* -------------------------------------------------------------------------- */

test('a WhatsApp link carries the text and no phone number', () => {
  // `wa.me/<number>/?text=` would send to that number directly — and would mean
  // the customer's phone number travelling in a URL. `wa.me/?text=` opens
  // WhatsApp's own picker, so the contact is chosen on the phone and this app
  // never learns which one.
  const link = whatsappLink(build('planned', 'en'));

  assert.match(link, /^https:\/\/wa\.me\/\?text=/, 'the link must have no path segment before ?text=');
  assert.doesNotMatch(link, /wa\.me\/\+?\d/, 'a recipient number is in the link');
  assert.doesNotMatch(link, /wa\.me\/\d/);
});

test('the link decodes back to exactly the message', () => {
  // Encoding mistakes are invisible until a customer receives `%20` and a
  // broken line break.
  for (const lang of ['en', 'so'] as const) {
    const text = build('planned', lang);
    const link = whatsappLink(text);
    const encoded = link.slice('https://wa.me/?text='.length);
    assert.equal(decodeURIComponent(encoded), text);
  }
});

test('a message with an ampersand or hash survives the link', () => {
  // Line numbers from OCR are usually clean, but customer names from a sheet
  // are not. `&` in a query string would truncate the message silently.
  const text = build('planned', 'en', { customer_name: 'Cali & Sons #2' });
  const link = whatsappLink(text);
  const encoded = link.slice('https://wa.me/?text='.length);
  assert.equal(decodeURIComponent(encoded), text);
  assert.doesNotMatch(encoded, /&/, 'an unescaped ampersand would truncate the text');
});

/* -------------------------------------------------------------------------- */
/* The database records; it does not send                                      */
/* -------------------------------------------------------------------------- */

test('migration 025 records a journey without sending anything', () => {
  // The whole safety property of this feature: a server-side function may write
  // a timestamp, and must not talk to an outside service. Net extensions are
  // the only way out of Postgres, and this schema has none.
  const sql = readFileSync(
    fileURLToPath(new URL('../supabase/migrations/025_customer_updates.sql', import.meta.url)),
    'utf8',
  );

  assert.doesNotMatch(sql, /http|pg_net|extension .*net/i, 'a migration must not call out to a network');
  assert.match(sql, /en_route_at = now\(\)/, 'the stamp is written locally');
  assert.match(sql, /already_marked/, 'a second press must be answerable without moving the clock');
});

test('the stamp is cleared when the job changes hands', () => {
  // Otherwise a reassigned job claims someone has been driving to it since
  // 09:41 — which is a false statement about a real person.
  const sql = readFileSync(
    fileURLToPath(new URL('../supabase/migrations/025_customer_updates.sql', import.meta.url)),
    'utf8',
  );

  assert.match(sql, /NEW\.assigned_user_id IS DISTINCT FROM OLD\.assigned_user_id/);
  assert.match(sql, /NEW\.assigned_crew_id IS DISTINCT FROM OLD\.assigned_crew_id/);
  assert.match(sql, /NEW\.en_route_at := NULL/);
});

test('the stamp has no default, so no job claims a journey it never had', () => {
  const sql = readFileSync(
    fileURLToPath(new URL('../supabase/migrations/025_customer_updates.sql', import.meta.url)),
    'utf8',
  );
  const addColumn = sql.slice(sql.indexOf('ADD COLUMN IF NOT EXISTS en_route_at'));
  const statement = addColumn.slice(0, addColumn.indexOf(';'));

  assert.doesNotMatch(statement, /DEFAULT/i, 'a default of now() would put every job "on the way"');
  assert.doesNotMatch(statement, /NOT NULL/i);
});
