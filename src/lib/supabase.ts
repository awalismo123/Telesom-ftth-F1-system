import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  classifyProbeResponse,
  keyShape,
  maskSecret,
  projectRef,
  resolveSupabaseConfig,
  type ConfigNote,
  type SupabaseConfig,
} from './config';

/**
 * The one place the app learns where its database is.
 *
 * Two things matter here:
 *
 * 1. **The environment can never brick the app.** A blank, quoted, newline-
 *    padded or truncated `VITE_SUPABASE_ANON_KEY` used to be sent straight to
 *    PostgREST, which answered `{"message":"Invalid API key"}` and left the
 *    technician signing a PIN into a broken screen. Values are now sanitised and
 *    shape-checked, and a malformed one falls back to the built-in project.
 *
 * 2. **A bad key is detected before it reaches a person.** `probeSupabase()`
 *    asks the gateway whether it accepts the key; if the environment key is
 *    rejected but the built-in one works, the client is rebuilt on the fly and
 *    the app carries on. If neither works, the shell shows a configuration
 *    card instead of a raw English error.
 */

const BUILTIN = {
  url: 'https://pjrzncnhhlfaxuvlcdse.supabase.co',
  anonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBqcnpuY25oaGxmYXh1dmxjZHNlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMyMDAwNjksImV4cCI6MjEwODc3NjA2OX0.oPP4UNDdVEzZbRNyTsjNAX3cVc2EzOwIi8LS2y8nfNA',
} as const;

/**
 * `import.meta.env` only exists under Vite. Vite replaces the whole object at
 * build time (including every `VITE_` variable), so property access still works
 * in the bundle; the try/catch keeps the module importable by the test runner.
 */
function readEnv(): { url?: string; anonKey?: string } {
  try {
    const env = (import.meta as unknown as { env?: Record<string, unknown> }).env;
    if (!env) return {};
    return {
      url: typeof env.VITE_SUPABASE_URL === 'string' ? env.VITE_SUPABASE_URL : undefined,
      anonKey: typeof env.VITE_SUPABASE_ANON_KEY === 'string' ? env.VITE_SUPABASE_ANON_KEY : undefined,
    };
  } catch {
    return {};
  }
}

function buildClient(config: SupabaseConfig): SupabaseClient {
  return createClient(config.url, config.anonKey, {
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  });
}

let config: SupabaseConfig = resolveSupabaseConfig(readEnv(), BUILTIN);
let client: SupabaseClient = buildClient(config);

/**
 * Every module imports `supabase` once and calls methods on it at request
 * time, so a proxy lets us swap the underlying client after a key is rejected
 * without any of those imports going stale.
 */
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, property) {
    const value = Reflect.get(client, property) as unknown;
    return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(client) : value;
  },
  has(_target, property) {
    return Reflect.has(client, property);
  },
});

export function getSupabaseConfig(): SupabaseConfig {
  return config;
}

export function getConfigNotes(): ConfigNote[] {
  return [...config.notes];
}

/** Diagnostics for the error card — never the raw secret. */
export function describeConnection(): { url: string; project: string; key: string; keySource: string } {
  return {
    url: config.url,
    project: projectRef(config.url) || 'unknown',
    key: `${keyShape(config.anonKey)} · ${maskSecret(config.anonKey)}`,
    keySource: config.source === 'env' ? 'environment variable' : 'built-in default',
  };
}

export type SupabaseHealth = 'ok' | 'bad-key' | 'unreachable';

export interface SupabaseProbe {
  health: SupabaseHealth;
  /** true when an environment key was rejected and the built-in key took over */
  recovered: boolean;
  status: number;
  detail: string;
}

interface Attempt {
  status: number;
  body: string;
  networkError: boolean;
}

/**
 * One cheap, ordinary read — the same one the app makes on mount.
 *
 * Do NOT probe the PostgREST root document (`/rest/v1/`): Supabase restricts it
 * to `service_role` and answers a perfectly valid anon key with
 * `401 {"message":"Invalid API key","hint":"Only the service_role API key can
 * be used for this endpoint"}`. Probing it declared a healthy project broken.
 */
async function ping(url: string, key: string, timeoutMs: number): Promise<Attempt> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${url}/rest/v1/groups?select=code&limit=1`, {
      method: 'GET',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
      cache: 'no-store',
    });

    let body = '';
    try {
      body = (await response.text()).slice(0, 400);
    } catch {
      body = '';
    }

    return { status: response.status, body, networkError: false };
  } catch {
    return { status: 0, body: '', networkError: true };
  } finally {
    clearTimeout(timer);
  }
}

let cachedProbe: SupabaseProbe | null = null;
let probeInFlight: Promise<SupabaseProbe> | null = null;

/**
 * Check the connection once per page load.
 *
 * The expensive failure mode is silent: a rejected key makes every screen say
 * "Invalid API key". This runs before the first RPC and repairs what it can.
 */
export function probeSupabase(options: { force?: boolean; timeoutMs?: number } = {}): Promise<SupabaseProbe> {
  if (!options.force && cachedProbe && cachedProbe.health !== 'unreachable') {
    return Promise.resolve(cachedProbe);
  }
  if (probeInFlight) return probeInFlight;

  const timeoutMs = options.timeoutMs ?? 6000;

  const run = (async (): Promise<SupabaseProbe> => {
    const first = await ping(config.url, config.anonKey, timeoutMs);
    let result: SupabaseProbe;

    if (first.networkError) {
      result = { health: 'unreachable', recovered: false, status: 0, detail: 'network' };
    } else if (classifyProbeResponse(first.status, first.body) === 'bad-key') {
      if (config.source === 'env') {
        // The deployment's env key is not accepted. Try the built-in project
        // before giving up: a wrong env var must not take the field app down.
        config = {
          url: config.url,
          anonKey: BUILTIN.anonKey,
          source: 'builtin',
          notes: [...config.notes, 'env-key-rejected'],
        };
        client = buildClient(config);
        const second = await ping(config.url, config.anonKey, timeoutMs);
        if (!second.networkError && classifyProbeResponse(second.status, second.body) === 'ok') {
          result = { health: 'ok', recovered: true, status: second.status, detail: 'recovered' };
        } else {
          result = {
            health: second.networkError ? 'unreachable' : 'bad-key',
            recovered: false,
            status: second.status,
            detail: `rejected (${first.status} env, ${second.status} built-in)`,
          };
        }
      } else {
        result = { health: 'bad-key', recovered: false, status: first.status, detail: `rejected (${first.status})` };
      }
    } else {
      // Any authenticated answer (200, an RLS 403, an RPC 400) proves the key
      // reached PostgREST. Only a key rejection replaces the app.
      result = {
        health: 'ok',
        recovered: false,
        status: first.status,
        detail: first.status >= 200 && first.status < 300 ? 'ok' : `key accepted (${first.status})`,
      };
    }

    cachedProbe = result;
    return result;
  })();

  probeInFlight = run;
  run
    .then(
      () => undefined,
      () => undefined,
    )
    .then(() => {
      if (probeInFlight === run) probeInFlight = null;
    });

  return run;
}

/** Test seam: forget the cached probe (used by the retry button). */
export function resetProbeCache(): void {
  cachedProbe = null;
  probeInFlight = null;
}
