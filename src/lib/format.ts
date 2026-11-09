/**
 * Dates, numbers and plurals — decided once, in one place.
 *
 * The app used to render a database date as `2026-10-31`, an `Intl` date in
 * whatever locale the phone happened to have, and counts as
 * `${n} ${so ? 'shaqo' : 'jobs'}` — so a single job read "1 jobs", and the same
 * screen could show two different date formats on two phones.
 *
 * Everything here is deterministic on purpose. `Intl` output depends on the ICU
 * build of the browser, which means a test written here would not describe what
 * a technician's phone shows. A fixed calendar and fixed month names are the
 * honest choice for a system used in one country.
 *
 * Somalia writes dates **day/month/year**, so that is the default.
 */

export type Lang = 'so' | 'en';

/* -------------------------------------------------------------------------- */
/* Months and weekdays                                                         */
/* -------------------------------------------------------------------------- */

const MONTHS_SO = [
  'Jannaayo',
  'Febraayo',
  'Maarso',
  'Abriil',
  'Maajo',
  'Juun',
  'Luulyo',
  'Agoosto',
  'Sebtembar',
  'Oktoobar',
  'Nofembar',
  'Desembar',
];

const MONTHS_EN = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const WEEKDAYS_SO = ['Axad', 'Isniin', 'Talaado', 'Arbaco', 'Khamiis', 'Jimce', 'Sabti'];
const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const pad = (value: number) => String(value).padStart(2, '0');

/**
 * Parse the three shapes this app actually stores: a `YYYY-MM-DD` date, a full
 * ISO timestamp, and a timestamp without a zone.
 *
 * A bare `2026-10-31` must not be run through `new Date()` in a negative-offset
 * timezone — it would be read as UTC midnight and displayed as the 30th.
 */
export function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;

  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    return new Date(Number(year), Number(month) - 1, Number(day));
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** `31/10/2026` in both languages — the format people here read. */
export function formatDate(value: string | null | undefined, fallback = '—'): string {
  const date = parseDate(value);
  if (!date) return fallback;
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

/** `31 Okt 2026` — for a heading or a message where the month helps. */
export function formatDateLong(value: string | null | undefined, lang: Lang, fallback = '—'): string {
  const date = parseDate(value);
  if (!date) return fallback;
  const month = lang === 'so' ? MONTHS_SO[date.getMonth()] : MONTHS_EN[date.getMonth()];
  return `${date.getDate()} ${month} ${date.getFullYear()}`;
}

/** `31 Okt 2026, 14:05` — a moment, not just a day. */
export function formatDateTime(value: string | null | undefined, lang: Lang, fallback = '—'): string {
  const date = parseDate(value);
  if (!date) return fallback;
  return `${formatDateLong(value, lang)} · ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `14:05` — the clock alone. */
export function formatTime(value: string | null | undefined, fallback = '—'): string {
  const date = parseDate(value);
  if (!date) return fallback;
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `Sabti 31/10/2026` — for the daily header where the weekday is the anchor. */
export function formatDateWithWeekday(value: string | null | undefined, lang: Lang, fallback = '—'): string {
  const date = parseDate(value);
  if (!date) return fallback;
  const names = lang === 'so' ? WEEKDAYS_SO : WEEKDAYS_EN;
  return `${names[date.getDay()]} ${formatDate(value, fallback)}`;
}

/** Today as `YYYY-MM-DD` in **local** time. `toISOString()` would roll the date
 *  over at 21:00 in Hargeisa and file a night job under tomorrow. */
export function todayKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Whole days from today to `value`; negative means in the past. */
export function daysFromToday(value: string | null | undefined, now: Date = new Date()): number | null {
  const date = parseDate(value);
  if (!date) return null;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return Math.round((startOfDay - startOfToday) / 86_400_000);
}

/* -------------------------------------------------------------------------- */
/* Numbers                                                                     */
/* -------------------------------------------------------------------------- */

/** `1 234` no — `1,234.5`. No locale surprises, no lakh grouping. */
export function formatNumber(value: number | string | null | undefined, decimals = 0, fallback = '—'): string {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;

  const fixed = Math.abs(parsed).toFixed(decimals);
  const [whole, fraction] = fixed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const sign = parsed < 0 ? '-' : '';
  return fraction ? `${sign}${grouped}.${fraction}` : `${sign}${grouped}`;
}

/** Optical readings are always shown to one decimal, with an explicit unit. */
export function formatDbm(value: number | string | null | undefined, fallback = '—'): string {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return `${formatNumber(parsed, 1)} dBm`;
}

/** `1h 05m`, `42m`, `30s` — durations, not time-of-day. */
export function formatDuration(seconds: number | null | undefined, fallback = '—'): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return fallback;
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);

  if (hours > 0) return `${hours}h ${pad(minutes)}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${total}s`;
}

/* -------------------------------------------------------------------------- */
/* Plurals                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Just enough plural rules for two languages.
 *
 * English has one/other. Somali does not need it after a numeral (see
 * COUNT_WORDS), but the plural machinery stays honest for both: the forms are
 * data, so a language that *does* change can say so without touching a screen.
 */
export interface PluralForms {
  one: string;
  other: string;
}

export function pluralise(count: number, forms: PluralForms, lang: Lang, includeCount = true): string {
  const form = count === 1 ? forms.one : forms.other;
  return includeCount ? `${formatNumber(count)} ${form}` : form;
}

/**
 * The count words the app actually needs.
 *
 * **Somali uses the singular after a numeral** — "laba shaqo", "saddex jid",
 * never "laba shaqooyin". So the Somali `other` form is deliberately the same
 * word as `one`; only English changes. This is why the two forms exist as data:
 * the rule differs per language, and hardcoding `${n} shaqo` in twenty places
 * meant nobody could change their mind later.
 */
export const COUNT_WORDS = {
  jobs: { en: { one: 'job', other: 'jobs' }, so: { one: 'shaqo', other: 'shaqo' } },
  routes: { en: { one: 'route', other: 'routes' }, so: { one: 'jid', other: 'jid' } },
  teams: { en: { one: 'team', other: 'teams' }, so: { one: 'koox', other: 'koox' } },
  ports: { en: { one: 'port', other: 'ports' }, so: { one: 'port', other: 'port' } },
  days: { en: { one: 'day', other: 'days' }, so: { one: 'maalin', other: 'maalmood' } },
  incidents: { en: { one: 'incident', other: 'incidents' }, so: { one: 'dhacdo', other: 'dhacdo' } },
  technicians: {
    en: { one: 'technician', other: 'technicians' },
    so: { one: 'farsamayaqaan', other: 'farsamayaqaan' },
  },
  boxes: { en: { one: 'cablebox', other: 'cableboxes' }, so: { one: 'sanduuq', other: 'sanduuq' } },
  customers: { en: { one: 'customer', other: 'customers' }, so: { one: 'macmiil', other: 'macmiil' } },
  results: { en: { one: 'result', other: 'results' }, so: { one: 'natiijo', other: 'natiijo' } },
  minutes: { en: { one: 'minute', other: 'minutes' }, so: { one: 'daqiiqo', other: 'daqiiqo' } },
} as const satisfies Record<string, Record<Lang, PluralForms>>;

export type CountWord = keyof typeof COUNT_WORDS;

/** `3 shaqooyin` / `3 jobs` / `1 job` — the only way a count should be printed. */
export function countLabel(count: number, word: CountWord, lang: Lang): string {
  return pluralise(count, COUNT_WORDS[word][lang], lang);
}
