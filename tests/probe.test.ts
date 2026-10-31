import test from 'node:test';
import assert from 'node:assert/strict';
import { probeSupabase, resetProbeCache, describeConnection, getConfigNotes } from '../src/lib/supabase';

/**
 * The boot probe decides whether the person sees the app or the configuration
 * card. These cases pin the decision table without touching the network — and
 * one of them is a regression test for a real incident: Supabase answers 401
 * with `{"message":"Invalid API key"}` for endpoints an anon key may not read,
 * which is *not* a bad key.
 */

const realFetch = globalThis.fetch;

function stubFetch(handler: (url: string) => Promise<Response> | Response) {
  globalThis.fetch = ((input: RequestInfo | URL) =>
    Promise.resolve(handler(String(input)))) as typeof fetch;
}

test.afterEach(() => {
  globalThis.fetch = realFetch;
  resetProbeCache();
});

test('an accepted key reports healthy', async () => {
  stubFetch(() => new Response('[{"code":"F1"}]', { status: 200 }));
  resetProbeCache();
  const result = await probeSupabase({ force: true });
  assert.equal(result.health, 'ok');
  assert.equal(result.status, 200);
  assert.equal(result.recovered, false);
});

test('the probe reads a real table, never the service_role-only root document', async () => {
  const seen: string[] = [];
  globalThis.fetch = ((input: RequestInfo | URL) => {
    seen.push(String(input));
    return Promise.resolve(new Response('[]', { status: 200 }));
  }) as typeof fetch;

  resetProbeCache();
  await probeSupabase({ force: true });

  assert.equal(seen.length, 1);
  assert.match(seen[0], /\/rest\/v1\/groups\?select=code&limit=1$/);
  assert.doesNotMatch(seen[0], /\/rest\/v1\/$/);
});

test('a genuine key rejection is reported as bad-key', async () => {
  stubFetch(() => new Response('{"message":"Invalid API key"}', { status: 401 }));
  resetProbeCache();
  const result = await probeSupabase({ force: true });
  assert.equal(result.health, 'bad-key');
  assert.equal(result.status, 401);
});

test('401 for an authorisation reason is NOT a broken key', async () => {
  // A key that authenticated but may not read the table (RLS, missing grant,
  // or a service_role-only endpoint) must never replace the app.
  stubFetch(() => new Response('{"message":"permission denied for table groups"}', { status: 401 }));
  resetProbeCache();
  const result = await probeSupabase({ force: true });
  assert.equal(result.health, 'ok');
  assert.match(result.detail, /key accepted/i);
});

test('a 403 from RLS proves the key reached PostgREST', async () => {
  stubFetch(() => new Response('{"message":"new row violates row-level security policy"}', { status: 403 }));
  resetProbeCache();
  assert.equal((await probeSupabase({ force: true })).health, 'ok');
});

test('an unreachable gateway is a network problem, not a broken build', async () => {
  stubFetch(() => {
    throw new TypeError('Failed to fetch');
  });
  resetProbeCache();
  const result = await probeSupabase({ force: true });
  assert.equal(result.health, 'unreachable');
});

test('a 5xx never blocks a technician', async () => {
  stubFetch(() => new Response('bad gateway', { status: 502 }));
  resetProbeCache();
  assert.equal((await probeSupabase({ force: true })).health, 'ok');
});

test('the key travels in a header, not the URL', async () => {
  let headers: Record<string, string> = {};
  let url = '';
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    url = String(input);
    headers = (init?.headers ?? {}) as Record<string, string>;
    return Promise.resolve(new Response('[]', { status: 200 }));
  }) as typeof fetch;

  resetProbeCache();
  await probeSupabase({ force: true });

  assert.ok(headers.apikey, 'apikey header is required by PostgREST');
  assert.match(headers.Authorization, /^Bearer /);
  assert.doesNotMatch(url, /apikey=/);
});

test('the cached result is reused until forced', async () => {
  let calls = 0;
  globalThis.fetch = (() => {
    calls += 1;
    return Promise.resolve(new Response('[]', { status: 200 }));
  }) as typeof fetch;

  resetProbeCache();
  await probeSupabase();
  await probeSupabase();
  assert.equal(calls, 1);

  await probeSupabase({ force: true });
  assert.equal(calls, 2);
});

test('diagnostics describe the connection without revealing the key', () => {
  const description = describeConnection();
  assert.match(description.url, /^https:\/\//);
  assert.ok(description.project.length > 0);
  assert.ok(description.key.includes('…'), 'key must be masked');
  assert.ok(description.keySource.length > 0);
  assert.ok(Array.isArray(getConfigNotes()));
});
