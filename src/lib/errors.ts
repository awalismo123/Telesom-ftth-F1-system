/**
 * One place that turns whatever came out of Postgres, the network or a bug
 * into a sentence a technician can understand — in Somali or English.
 *
 * Raw database text ("P0001: ... CONTEXT: PL/pgSQL function ...") must never
 * reach the screen: it is unreadable and it leaks the schema.
 */

export type ErrorKind =
  | 'auth'
  | 'forbidden'
  | 'notfound'
  | 'conflict'
  | 'validation'
  | 'network'
  | 'unknown';

export interface AppErrorInfo {
  kind: ErrorKind;
  /** short, calm, user-facing */
  message: string;
  /** the original, for the "copy details" affordance only */
  detail: string;
}

type Lang = 'so' | 'en';

interface Rule {
  match: RegExp;
  kind: ErrorKind;
  en: string;
  so: string;
}

/** Ordered: first match wins. Keep in sync with the RAISE messages in SQL. */
const RULES: Rule[] = [
  {
    match: /invalid username\/phone or pin/i,
    kind: 'auth',
    en: 'Wrong username, phone or PIN.',
    so: 'Magaca, telefoonka ama PIN-ka waa khalad.',
  },
  {
    match: /invalid or expired session|session token required|jwt expired|invalid claim/i,
    kind: 'auth',
    en: 'Your session ended. Please sign in again.',
    so: 'Fadhigaagu wuu dhacay. Fadlan mar kale gal.',
  },
  {
    match: /this job is not assigned to you/i,
    kind: 'forbidden',
    en: 'This job is not assigned to you.',
    so: 'Shaqadan laguma qoondeynin adiga.',
  },
  {
    match: /not assigned to you|only supervisors can|only a supervisor can/i,
    kind: 'forbidden',
    en: 'You do not have permission for this action.',
    so: 'Ma haysato fasax ku filan ficilkan.',
  },
  {
    match: /you can only read your own group|belongs to another group/i,
    kind: 'forbidden',
    en: 'That record belongs to another group.',
    so: 'Diiwaankaas wuxuu ka tirsan yahay koox kale.',
  },
  {
    match: /already completed/i,
    kind: 'conflict',
    en: 'This job was already completed.',
    so: 'Shaqadan hore ayaa loo dhammeeyay.',
  },
  {
    match: /already running|another job is running/i,
    kind: 'conflict',
    en: 'Another job is already running.',
    so: 'Shaqo kale ayaa horey u socota.',
  },
  {
    match: /optical dbm reading is required/i,
    kind: 'validation',
    en: 'An optical dBm reading is required.',
    so: 'Cabbirka dBm waa qasab.',
  },
  {
    match: /outside the measurable range/i,
    kind: 'validation',
    en: 'That dBm reading is outside the measurable range (0 … −40).',
    so: 'Cabbirkaas dBm wuu ka baxsan yahay xadka la cabbiri karo (0 … −40).',
  },
  {
    match: /is outside 1…|outside 1\.\./i,
    kind: 'validation',
    en: 'That port number does not exist on this box.',
    so: 'Port-kaas kama jiro sanduuqan.',
  },
  {
    match: /cablebox not found/i,
    kind: 'notfound',
    en: 'That cablebox was not found.',
    so: 'Sanduuqaas lama helin.',
  },
  {
    match: /job not found/i,
    kind: 'notfound',
    en: 'That job was not found.',
    so: 'Shaqadaas lama helin.',
  },
  {
    match: /failed to fetch|networkerror|load failed|network request failed|err_internet|offline/i,
    kind: 'network',
    en: 'No connection. Check your signal and try again.',
    so: 'Xiriir ma jiro. Hubi signal-ka oo isku day mar kale.',
  },
  {
    match: /timeout|timed out|aborted/i,
    kind: 'network',
    en: 'The server took too long. Try again.',
    so: 'Server-ku aad buu u gaabiyay. Isku day mar kale.',
  },
  {
    match: /duplicate key|already exists|unique constraint/i,
    kind: 'conflict',
    en: 'That already exists.',
    so: 'Waxaas hore ayaa u jiray.',
  },
  {
    match: /violates .*constraint|null value in column/i,
    kind: 'validation',
    en: 'Some required information is missing.',
    so: 'Macluumaad qasab ah ayaa maqan.',
  },
];

/** Strip Supabase/Postgres noise so a fallback message is still readable. */
export function stripDbNoise(raw: string): string {
  return raw
    .replace(/\bERROR:\s*[0-9A-Z]{5}:\s*/i, '')
    .replace(/\s*CONTEXT:[\s\S]*$/i, '')
    .replace(/\s*HINT:[\s\S]*$/i, '')
    .replace(/\s*DETAIL:[\s\S]*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function classifyError(raw: string): ErrorKind {
  for (const rule of RULES) {
    if (rule.match.test(raw)) return rule.kind;
  }
  return 'unknown';
}

export function toErrorMessage(raw: string | null | undefined, lang: Lang = 'en'): string {
  if (!raw) {
    return lang === 'so' ? 'Wax baa qaldan. Isku day mar kale.' : 'Something went wrong. Please try again.';
  }
  const clean = stripDbNoise(raw);
  for (const rule of RULES) {
    if (rule.match.test(clean)) return lang === 'so' ? rule.so : rule.en;
  }
  // Unknown but already human-written by our own SQL: show it as-is.
  return clean;
}

export function toAppError(error: unknown, lang: Lang = 'en'): AppErrorInfo {
  const detail =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : JSON.stringify(error ?? {});

  return {
    kind: classifyError(detail),
    message: toErrorMessage(detail, lang),
    detail,
  };
}

/** True when the failure means "the token is no longer usable". */
export function isAuthFailure(error: unknown): boolean {
  const detail =
    error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return classifyError(detail) === 'auth';
}

export function isOfflineFailure(error: unknown): boolean {
  const detail =
    error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return classifyError(detail) === 'network';
}
