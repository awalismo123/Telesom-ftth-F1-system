/**
 * What we tell the customer.
 *
 * Two moments matter to a person waiting at home: knowing a technician is
 * **coming today**, and knowing which **day** that is. Nothing else in this app
 * speaks to the customer, and this file is the only place the wording lives.
 *
 * ## Rules this file exists to enforce
 *
 * 1. **No clock times.** A department that promises "between 2 and 4" and
 *    arrives at 6 has broken a promise it did not need to make. The message is
 *    day-granular and says so out loud — "we cannot give an exact time" is
 *    friendlier than a missed window. `tests/customerUpdate.test.ts` fails the
 *    build if a time ever reaches the text.
 * 2. **Nothing is sent from here.** This module returns *text*. Turning it into
 *    a message is a person pressing a button, and pressing send in WhatsApp is
 *    another separate act. There is no code path in this file that transmits.
 * 3. **Both languages carry the same facts.** Not a translation of the same
 *    words — the same claim, the same absence of a promise.
 * 4. **Three ways out, one message.** A customer with WhatsApp, one with only
 *    SMS, and one with neither all need to hear the same thing. The text is the
 *    same for all three; only the way it leaves the phone changes, so the
 *    wording is built here and the link builders live beside it, in
 *    `contact.ts`. Nearly every Telesom customer has a phone number; a good
 *    number of them have no smartphone at all, which is why relying on WhatsApp
 *    alone was leaving people waiting with no word.
 */

import { formatDateWithWeekday } from './format';

export type CustomerUpdateKind =
  /** A technician is travelling to the customer now. */
  | 'en_route'
  /** The job is planned for a day. */
  | 'planned'
  /** The work is finished. */
  | 'completed'
  /** We came and could not finish, and will come back. */
  | 'delayed';

export type CustomerUpdateLang = 'en' | 'so';

/** The parts of a task the message needs. Deliberately narrow: everything here
 *  appears in the text, so a wider type would invite leaking more. */
export interface CustomerUpdateTask {
  line_number: string;
  customer_name?: string | null;
  scheduled_date?: string | null;
  xaafada?: string | null;
  cablebox_code_raw?: string | null;
}

export interface CustomerUpdateOptions {
  kind: CustomerUpdateKind;
  lang: CustomerUpdateLang;
  /** The sender's own calendar day, `YYYY-MM-DD`. */
  today: string;
  /** Appended to the sign-off, e.g. `F1`. Omitted from the text when absent. */
  groupCode?: string | null;
}

/** `2026-11-18` → `Wed 18/11/2026`. Delegates to the app's one date formatter so a
 *  customer never sees a different date format from the screen the supervisor
 *  is reading. Day first, because both languages read it that way. */
export function dayForCustomer(day: string, lang: CustomerUpdateLang): string {
  const text = formatDateWithWeekday(day, lang, '');
  // `''` rather than the '—' fallback the screens use: a dash is right in a
  // table cell and wrong in a sentence about when someone will knock on a door.
  return text;
}

/**
 * The day a customer should expect someone.
 *
 * For an "on my way" message that is **today** — the technician is travelling
 * now, whatever the job was originally planned for. For a planned update it is
 * the job's own day, falling back to today when the job carries none (the
 * column is NOT NULL, but a hand-built payload may omit it, and "we don't know"
 * must not become "no message").
 */
export function expectedDay(task: CustomerUpdateTask, kind: CustomerUpdateKind, today: string): string {
  // "On the way" and "done" both happen *now*; the planned day is history by
  // the time either is sent. Only `planned` and `delayed` talk about a day the
  // job belongs to, and `delayed` deliberately does not name a new one — we do
  // not know it yet, and inventing it is the broken promise this file exists to
  // avoid.
  if (kind === 'en_route' || kind === 'completed') return today;
  return task.scheduled_date || today;
}

/** `Hello Cabdi,` / `Salaam Cabdi,` — or the bare greeting when there is no name. */
function greeting(task: CustomerUpdateTask, lang: CustomerUpdateLang): string {
  const name = (task.customer_name ?? '').trim();
  if (!name) return lang === 'so' ? 'Salaam,' : 'Hello,';
  return lang === 'so' ? `Salaam ${name},` : `Hello ${name},`;
}

function signOff(groupCode: string | null | undefined, lang: CustomerUpdateLang): string {
  const code = (groupCode ?? '').trim();
  if (!code) return '— Telesom';
  return lang === 'so' ? `— Telesom Kooxda ${code}` : `— Telesom Group ${code}`;
}

/**
 * The message text.
 *
 * Plain enough to be read by someone who is not a technician, and specific
 * enough to be useful: the line number is what the customer recognises on their
 * own bill, and the day is what they need in order to be at home.
 */
export function buildCustomerUpdate(
  task: CustomerUpdateTask,
  opts: CustomerUpdateOptions,
): string {
  const { kind, lang, today, groupCode } = opts;
  const so = lang === 'so';
  const day = expectedDay(task, kind, today);
  const when = dayForCustomer(day, lang);
  const isToday = day === today;
  const line = (task.line_number ?? '').trim() || '—';

  // "today" reads as a fact; a bare date reads as a plan. The word matters
  // more than the date for someone deciding whether to stay in.
  const dayPhrase = isToday ? (so ? `maanta (${when})` : `today (${when})`) : when;

  // A day we could not read drops the day clause entirely. Inventing today
  // would be a false promise and printing a dash would be nonsense; saying less
  // is the only honest option left.
  const hasDay = when.length > 0;

  // Each kind says one thing and stops. A "done" message that also asks for a
  // review, or a delay message that also apologises three times, reads as a
  // machine. These are written to be readable by somebody who has had a long
  // day and does not want to parse a paragraph.
  let body: string;

  if (kind === 'en_route') {
    body = so
      ? `Farsamayaqaan Telesom ah ayaa hadda kuu soo socda line-ka ${line}${
          hasDay ? ` (${dayPhrase})` : ''
        }. Fadlan taleefankaaga ha dhawaan.`
      : `A Telesom technician is on the way to you now for line ${line}${
          hasDay ? ` (${dayPhrase})` : ''
        }. Please keep your phone nearby.`;
  } else if (kind === 'planned') {
    body = so
      ? `Shaqada line-kaaga ${line} waxaa loo qorsheeyay${
          hasDay ? ` ${dayPhrase}` : ''
        }. Farsamayaqaan ayaa kuu iman doona. Waqti sax ah ma sheegi karno, fadlan guriga joog.`
      : `Your line ${line} is planned${
          hasDay ? ` for ${dayPhrase}` : ''
        }. A technician will visit you. We cannot give an exact time, so please be at home.`;
  } else if (kind === 'completed') {
    // No day, no time, no invitation to call back. The work is finished; the
    // only useful thing left to say is which line and thank you.
    body = so
      ? `Ciladda line-kaaga ${line} waa la hagaajiyay. Mahadsanid samirkaaga.`
      : `The issue on your line ${line} has been resolved. Thank you for your patience.`;
  } else {
    // A delay admits three things in order: we came, it is not finished, we will
    // be back. It deliberately does not name the new day, because nobody knows
    // it yet — a date guessed here is the kind of promise this file forbids.
    body = so
      ? `Maanta waxaan isku daynay inaan kuu imaano line-ka ${line} laakiin shaqada ma dhamayn. Maalin kale ayaan dib u iman doonaa. Raali noqo.`
      : `We tried to visit you today for line ${line} but could not finish the work. We will come back another day. Sorry for the inconvenience.`;
  }

  return [greeting(task, lang), '', body, '', signOff(groupCode, lang)].join('\n');
}

/** Both languages, for the supervisor's preview toggle. */
export function buildCustomerUpdatePair(
  task: CustomerUpdateTask,
  opts: Omit<CustomerUpdateOptions, 'lang'>,
): Record<CustomerUpdateLang, string> {
  return {
    en: buildCustomerUpdate(task, { ...opts, lang: 'en' }),
    so: buildCustomerUpdate(task, { ...opts, lang: 'so' }),
  };
}
