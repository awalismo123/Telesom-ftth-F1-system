import test from 'node:test';
import assert from 'node:assert/strict';
import { probeSupabase, resetProbeCache, describeConnection, getConfigNotes } from '../src/lib/supabase';

/**
 * The boot probe decides whether the person sees the app or the configuration
 * card. These cases pin the decision table without touching the network.
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
  stubFetch(() => new Response('{}', { status: 200 }));
  resetProbeCache();
  const result = await probeSupabase({ force: true });
  assert.equal(result.health, 'ok');
  assert.equal(result.status, 200);
  assert.equal(result.recovered, false);
});

test('a rejected key is reported as bad-key, never as an auth failure', async () => {
  stubFetch(() => new Response('{"message":"Invalid API key"}', { status: 401 }));
  resetProbeCache();
  const result = await probeSupabase({ force: true });
  assert.equal(result.health, 'bad-key');
  assert.equal(result.status, 401);
});

test('a forbidden key is also a configuration problem', async () => {
  stubFetch(() => new Response('forbidden', { status: 403 }));
  resetProbeCache();
  const result = await probeSupabase({ force: true });
  assert.equal(result.health, 'bad-key');
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
  const result = await probeSupabase({ force: true });
  assert.equal(result.health, 'unreachable');
});

test('only the health endpoint is asked, and the key travels in a header', async () => {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string> });
    return Promise.resolve(new Response('{}', { status: 200 }));
  }) as typeof fetch;

  resetProbeCache();
  await probeSupabase({ force: true });

  assert.equal(seen.length, 1);
  assert.match(seen[0].url, /\/rest\/v1\/$/);
  assert.ok(seen[0].headers.apikey, 'apikey header is required by PostgREST');
  assert.match(seen[0].headers.Authorization, /^Bearer /);
});

test('the cached result is reused until forced', async () => {
  let calls = 0;
  globalThis.fetch = (() => {
    calls += 1;
    return Promise.resolve(new Response('{}', { status: 200 }));
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
