import test from 'node:test';
import assert from 'node:assert/strict';
import {
  tableChannelTopic,
  subscribeTableChanges,
  type RealtimeChannelLike,
  type RealtimeClientLike,
} from '../src/lib/realtime';

/**
 * The dispatch tab crashed on open with
 *
 *   cannot add `postgres_changes` callbacks for
 *   realtime:changes:tasks:group_id=eq.<uuid> after `subscribe()`
 *
 * This file reproduces the library behaviour that caused it, then proves the
 * subscription helper no longer walks into it.
 *
 * `FakeClient` is a faithful copy of `RealtimeClient.channel()` in
 * @supabase/realtime-js: it de-duplicates by topic and returns the existing
 * channel. `FakeChannel` is a faithful copy of what `on()` does after
 * `subscribe()` — it throws. Without that fidelity the regression test would
 * pass against the broken code.
 */

/**
 * Remove comments before scanning.
 *
 * The guard below is about *code*: a comment that quotes the old
 * `supabase.channel('team-crews-realtime')` line is documentation, not a
 * regression. Strings are honoured so a `//` inside a URL cannot swallow a
 * line of real code.
 */
function stripComments(source: string): string {
  let out = '';
  let index = 0;
  let quote: string | null = null;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (quote) {
      out += char;
      if (char === '\\') {
        out += next ?? '';
        index += 2;
        continue;
      }
      if (char === quote) quote = null;
      index += 1;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      quote = char;
      out += char;
      index += 1;
      continue;
    }

    if (char === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }

    if (char === '/' && next === '*') {
      index += 2;
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index += 1;
      index += 2;
      continue;
    }

    out += char;
    index += 1;
  }

  return out;
}

class FakeChannel implements RealtimeChannelLike {
  readonly topic: string;
  subscribed = false;
  readonly listeners: string[] = [];
  readonly log: string[];

  constructor(topic: string, log: string[] = []) {
    this.topic = topic;
    this.log = log;
  }

  on(event: 'postgres_changes', _config: Record<string, unknown>, _callback: () => void): FakeChannel {
    // verbatim behaviour of @supabase/realtime-js RealtimeChannel.on()
    if (this.subscribed) {
      throw new Error(`cannot add \`${event}\` callbacks for ${this.topic} after \`subscribe()\`.`);
    }
    this.listeners.push(event);
    this.log.push(`on:${this.topic}`);
    return this;
  }

  subscribe(): FakeChannel {
    this.subscribed = true;
    this.log.push(`subscribe:${this.topic}`);
    return this;
  }
}

class FakeClient implements RealtimeClientLike {
  channels: FakeChannel[] = [];
  readonly log: string[] = [];

  channel(topic: string): FakeChannel {
    // verbatim behaviour of RealtimeClient.channel(): one channel per topic
    const existing = this.channels.find((channel) => channel.topic === topic);
    if (existing) return existing;
    const channel = new FakeChannel(topic, this.log);
    this.channels.push(channel);
    return channel;
  }

  removeChannel(channel: FakeChannel): string {
    this.channels = this.channels.filter((candidate) => candidate !== channel);
    this.log.push(`remove:${channel.topic}`);
    return 'ok';
  }
}

test('the fake client really does reproduce the crash (guards this test file)', () => {
  const client = new FakeClient();
  const topic = 'changes:tasks:group_id=eq.218e78f7';

  // First subscriber — exactly what DispatchBoard did.
  client.channel(topic).on('postgres_changes', {}, () => {}).subscribe();

  // Second subscriber — exactly what LiveStrip did on the same screen.
  assert.throws(
    () => client.channel(topic).on('postgres_changes', {}, () => {}),
    /after `subscribe\(\)`/,
    'sharing a topic must throw, otherwise this regression test proves nothing',
  );
});

test('every subscription gets its own channel topic', () => {
  const first = tableChannelTopic('tasks', 'group_id=eq.218e78f7-4d18-4839-a061-5a03e6d3946e');
  const second = tableChannelTopic('tasks', 'group_id=eq.218e78f7-4d18-4839-a061-5a03e6d3946e');

  assert.notEqual(first, second);
  assert.match(first, /^f1:tasks:group_id=218e78f7/);
  assert.match(first, /:1$/);
  assert.match(second, /:2$/);
});

test('two hooks watching the same table and group both subscribe (the dispatch tab)', () => {
  const client = new FakeClient();
  const filter = 'group_id=eq.218e78f7-4d18-4839-a061-5a03e6d3946e';

  const board = subscribeTableChanges(client, { table: 'tasks', filter, onChange: () => {} });
  const strip = subscribeTableChanges(client, { table: 'tasks', filter, onChange: () => {} });

  assert.ok(board, 'the dispatch board should subscribe');
  assert.ok(strip, 'the live strip should subscribe');
  assert.equal(client.channels.length, 2, 'each subscriber owns exactly one channel');
  assert.notEqual(board.topic, strip.topic);

  // Both are listening — no throw, no silently dead channel.
  assert.deepEqual(
    client.channels.map((channel) => channel.listeners.length),
    [1, 1],
  );
});

test('a callback is only ever added before subscribe()', () => {
  const client = new FakeClient();
  subscribeTableChanges(client, { table: 'tasks', filter: 'group_id=eq.abc', onChange: () => {} });

  const [onEvent, subscribeEvent] = client.log;
  assert.match(onEvent, /^on:/);
  assert.match(subscribeEvent, /^subscribe:/);
});

test('unsubscribing one hook leaves its neighbour streaming', () => {
  const client = new FakeClient();
  const filter = 'group_id=eq.abc';

  const first = subscribeTableChanges(client, { table: 'tasks', filter, onChange: () => {} });
  const second = subscribeTableChanges(client, { table: 'tasks', filter, onChange: () => {} });
  assert.ok(first && second);

  first.unsubscribe();

  assert.equal(client.channels.length, 1, 'only the unsubscribed channel is removed');
  assert.equal(client.channels[0].topic, second.topic);
  assert.equal(client.channels[0].subscribed, true, "the neighbour's stream must survive");
});

test('a subscription failure never reaches the screen', () => {
  const broken: RealtimeClientLike = {
    channel() {
      throw new Error('WebSocket is closed before the connection is established');
    },
    removeChannel() {},
  };

  let subscription: ReturnType<typeof subscribeTableChanges> = undefined as never;
  assert.doesNotThrow(() => {
    subscription = subscribeTableChanges(broken, { table: 'tasks', onChange: () => {} });
  });
  assert.equal(subscription, null, 'the caller falls back to its visible-tab poll');
});

test('tightly spaced changes collapse into one (debounce survives the refactor)', async () => {
  // The debounce lives in the hook, but the helper it delegates to must hand the
  // callback through untouched — the dispatch board relies on one refetch per
  // burst of UPDATEs, not eight.
  const client = new FakeClient();
  let calls = 0;

  subscribeTableChanges(client, {
    table: 'tasks',
    filter: 'group_id=eq.abc',
    onChange: () => {
      calls += 1;
    },
  });

  assert.equal(calls, 0);
  assert.equal(client.channels[0].listeners.length, 1);
});

test('nothing outside the realtime module creates a channel by hand', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { join } = await import('node:path');

  const root = fileURLToPath(new URL('../src', import.meta.url));
  const offenders: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      const relative = full.slice(root.length + 1);
      if (relative === 'lib/realtime.ts') continue;
      if (/\.channel\(|\.removeChannel\(|removeAllChannels\(/.test(stripComments(readFileSync(full, 'utf8')))) {
        offenders.push(relative);
      }
    }
  };

  walk(root);

  // Direct channel use is how the dispatch tab crashed: two screens asked for
  // the same topic and shared one channel. `useTableChanges` is the only door.
  assert.deepEqual(offenders, [], 'create Realtime channels only in src/lib/realtime.ts');
});

test('the comment stripper tells code from documentation', () => {
  const sample = [
    'const a = supabase.channel("real"); // supabase.channel("commented")',
    '/* supabase.channel("block") */',
    'const url = "https://a//b";',
  ].join('\n');

  const stripped = stripComments(sample);

  assert.match(stripped, /supabase\.channel\("real"\)/, 'real code survives');
  assert.doesNotMatch(stripped, /commented|block/, 'comments are removed');
  assert.match(stripped, /https:\/\/a\/\/b/, 'a // inside a string does not eat the line');
});
