import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_MAX_AGE_MS,
  cacheKeys,
  cacheSize,
  invalidateCache,
  readCache,
  writeCache,
} from '../src/lib/cache';

/**
 * The cache exists so a tab switch is instant, and it must never invent data:
 * an expired entry is treated as absent, and a mutation can drop a whole
 * family of keys at once.
 */

test.beforeEach(() => invalidateCache());

test('a written payload comes back', () => {
  writeCache('directory:g1', { boxes: [1, 2, 3] });
  assert.deepEqual(readCache('directory:g1'), { boxes: [1, 2, 3] });
  assert.equal(cacheSize(), 1);
});

test('an unknown key is null, not an empty object', () => {
  assert.equal(readCache('nope'), null);
});

test('an expired entry is dropped, not served', () => {
  writeCache('analytics:g1:7', { total: 5 });
  // a negative age means "already stale", whatever the clock says
  assert.equal(readCache('analytics:g1:7', -1), null);
  assert.equal(cacheSize(), 0, 'the stale entry should be removed on read');
});

test('the default age is minutes, not seconds', () => {
  assert.ok(DEFAULT_MAX_AGE_MS >= 60_000);
});

test('invalidate can target one key or a prefix', () => {
  writeCache('directory:g1', 'a');
  writeCache('directory:g2', 'b');
  writeCache('analytics:g1:7', 'c');

  invalidateCache('directory:g1');
  assert.equal(readCache('directory:g1'), null);
  assert.equal(readCache('directory:g2'), 'b');

  invalidateCache('directory:');
  assert.equal(readCache('directory:g2'), null);
  assert.equal(readCache('analytics:g1:7'), 'c');

  invalidateCache();
  assert.equal(cacheSize(), 0);
});

test('cache keys include the group and window, so groups never mix', () => {
  assert.equal(cacheKeys.directory('g1'), 'directory:g1');
  assert.equal(cacheKeys.analytics('g1', 7), 'analytics:g1:7');
  assert.notEqual(cacheKeys.analytics('g1', 7), cacheKeys.analytics('g1', 30));
  assert.notEqual(cacheKeys.directory('g1'), cacheKeys.directory('g2'));
});
