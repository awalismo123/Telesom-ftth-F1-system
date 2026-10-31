/**
 * Boot configuration for the Supabase connection — and the reason a field
 * technician must never see `{"message":"Invalid API key"}`.
 *
 * A deployment can be pointed at Supabase with two environment variables:
 *
 *   VITE_SUPABASE_URL       https://<ref>.supabase.co
 *   VITE_SUPABASE_ANON_KEY  a legacy anon JWT or a sb_publishable_… key
 *
 * Environment values are pasted by humans, so they arrive with quotes, a
 * trailing newline, a zero-width space, or a `Bearer ` prefix. Every one of
 * those turns into "Invalid API key" at the gateway. This module sanitises the
 * value before it is ever used, and rejects anything that cannot be a key so
 * the built-in, known-good configuration can take over.
 *
 * Nothing here touches `import.meta.env` — that happens in `supabase.ts`, so
 * this file stays pure and unit-testable.
 */

export type KeyShape = 'jwt' | 'publishable' | 'invalid';

/** Why an environment value was not used. Never contains the secret itself. */
export type ConfigNote = 'env-key-blank' | 'env-key-malformed' | 'env-key-rejected' | 'env-url-invalid';

export interface SupabaseConfig {
  url: string;
  anonKey: string;
  /** where the API key came from — the URL source only matters for diagnostics */
  source: 'env' | 'builtin';
  notes: ConfigNote[];
}

export interface RawEnv {
  url?: string | null;
  anonKey?: string | null;
}

const ZERO_WIDTH = /[\u200B-\u200D\u2060\uFEFF\u00A0]/g;

/**
 * Make a pasted secret safe to use as a header value.
 *
 * - trims surrounding whitespace (a trailing newline is the classic Vercel paste)
 * - removes a wrapping pair of single or double quotes
 * - strips a `Bearer ` prefix copied from an API example
 * - drops zero-width / non-breaking characters
 */
export function sanitizeSecret(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  let value = raw.replace(ZERO_WIDTH, '').trim();
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      value = value.slice(1, -1).trim();
    }
  }
  value = value.replace(/^bearer\s+/i, '').trim();
  return value;
}

/** Trim, drop a trailing slash and reject anything that is not an http(s) URL. */
export function sanitizeUrl(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const value = sanitizeSecret(raw).replace(/\/+$/, '');
  if (!/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(value)) return '';
  return value;
}

/**
 * Supabase issues two shapes today:
 *   legacy  eyJhbGciOi…  (three base64url segments)
 *   new     sb_publishable_<random>
 * Both are accepted; anything else is treated as junk rather than sent to the
 * gateway to be rejected in English.
 */
export function keyShape(key: string): KeyShape {
  if (!key) return 'invalid';
  if (/^sb_publishable_[A-Za-z0-9_-]{8,}$/.test(key)) return 'publishable';
  if (/^eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) return 'jwt';
  return 'invalid';
}

/** `eyJhbGciOi…9nfNA` → keeps enough to compare two keys by eye, never the whole key. */
export function maskSecret(key: string): string {
  if (!key) return '(empty)';
  if (key.length <= 14) return `${key.slice(0, 4)}…`;
  return `${key.slice(0, 10)}…${key.slice(-4)}`;
}

/** The `pjrzncnhhlfaxuvlcdse` part of a Supabase URL, used in diagnostics. */
export function projectRef(url: string): string {
  const match = /^https?:\/\/([a-z0-9-]+)\.supabase\.co/i.exec(url);
  return match ? match[1] : '';
}

/**
 * Pick the connection to use.
 *
 * Precedence is deliberate: a *valid* environment override wins (so a future
 * project can be pointed at without a redeploy of this file), but a blank or
 * malformed value never wins — it falls back to the built-in project and
 * records why, so the diagnostics card can explain what happened.
 */
export function resolveSupabaseConfig(
  env: RawEnv,
  builtin: { url: string; anonKey: string },
): SupabaseConfig {
  const notes: ConfigNote[] = [];

  const envUrl = sanitizeUrl(env.url);
  if (env.url && !envUrl) notes.push('env-url-invalid');
  const url = envUrl || builtin.url;

  const envKeyRaw = sanitizeSecret(env.anonKey);
  let anonKey = builtin.anonKey;
  let source: SupabaseConfig['source'] = 'builtin';

  if (env.anonKey != null && String(env.anonKey).length > 0 && !envKeyRaw) {
    notes.push('env-key-blank');
  } else if (envKeyRaw) {
    if (keyShape(envKeyRaw) === 'invalid') {
      notes.push('env-key-malformed');
    } else {
      anonKey = envKeyRaw;
      source = 'env';
    }
  }

  return { url, anonKey, source, notes };
}
