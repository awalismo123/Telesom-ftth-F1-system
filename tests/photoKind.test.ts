import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BEFORE_WHY,
  PER_KIND_CAP,
  PHOTO_KINDS,
  afterLabel,
  asPhotoKind,
  beforeLabel,
  canTakeBefore,
  optionalNote,
  roomFor,
  whyNoBefore,
} from '../src/lib/photoKind';

/**
 * Two kinds, one rule each. The dangerous mistakes are (a) letting a before
 * photo overwrite the proof pointer, and (b) blocking a technician from closing
 * a job because they did not take one.
 */

/* -------------------------------------------------------------------------- */
/* The two kinds                                                              */
/* -------------------------------------------------------------------------- */

test('there are exactly two kinds', () => {
  assert.deepEqual([...PHOTO_KINDS], ['before', 'after']);
});

test('anything unknown reads as after', () => {
  // Existing photos predate the column and are proof. A missing or unexpected
  // value must never be read as "before".
  assert.equal(asPhotoKind(null), 'after');
  assert.equal(asPhotoKind(undefined), 'after');
  assert.equal(asPhotoKind(''), 'after');
  assert.equal(asPhotoKind('during'), 'after');
  assert.equal(asPhotoKind('before'), 'before');
});

test('a before photo cannot be taken on a finished or cancelled job', () => {
  // The "before" moment has passed; accepting one later would let the record be
  // arranged after the fact.
  assert.equal(canTakeBefore('assigned'), true);
  assert.equal(canTakeBefore('in_progress'), true);
  assert.equal(canTakeBefore('blocked'), true);
  assert.equal(canTakeBefore('completed'), false);
  assert.equal(canTakeBefore('cancelled'), false);
});

test('the reason a before photo is unavailable is explained, not just hidden', () => {
  assert.match(whyNoBefore('completed', 'en')!, /finished/);
  assert.match(whyNoBefore('cancelled', 'en')!, /cancelled/);
  assert.equal(whyNoBefore('assigned', 'en'), null);
});

/* -------------------------------------------------------------------------- */
/* The cap is per kind                                                        */
/* -------------------------------------------------------------------------- */

test('the cap is three of each kind', () => {
  assert.equal(PER_KIND_CAP, 3);
});

test('three befores leave room for an after', () => {
  // Otherwise a full before quota would block the proof, which is the whole
  // point of the photo feature.
  const photos = [{ kind: 'before' }, { kind: 'before' }, { kind: 'before' }];
  assert.equal(roomFor('before', photos), false);
  assert.equal(roomFor('after', photos), true);
});

test('a mix is counted by kind', () => {
  const photos = [{ kind: 'before' }, { kind: 'after' }, { kind: 'after' }];
  assert.equal(roomFor('before', photos), true);
  assert.equal(roomFor('after', photos), true);
});

test('a legacy photo with no kind counts as after', () => {
  const photos = [{ kind: 'after' }, { kind: 'after' }, { kind: '' }];
  assert.equal(roomFor('after', photos), false);
  assert.equal(roomFor('before', photos), true);
});

/* -------------------------------------------------------------------------- */
/* Optional means optional                                                    */
/* -------------------------------------------------------------------------- */

test('the note says the job can still be closed without a photo', () => {
  assert.match(optionalNote('en'), /never blocked/);
  assert.match(optionalNote('so'), /lama joojinayo/);
});

test('the copy does not make the before photo sound like a score', () => {
  // A photo that is used to rate a technician is a photo they will stage.
  assert.match(BEFORE_WHY.en, /not used to score anybody/);
  assert.doesNotMatch(BEFORE_WHY.en, /proof of your work/i);
});

test('the labels are translated', () => {
  assert.notEqual(beforeLabel('en'), beforeLabel('so'));
  assert.notEqual(afterLabel('en'), afterLabel('so'));
});

/* -------------------------------------------------------------------------- */
/* The database must agree                                                    */
/* -------------------------------------------------------------------------- */

const sql = readFileSync(
  fileURLToPath(new URL('../supabase/migrations/032_photo_kind.sql', import.meta.url)),
  'utf8',
);

test('existing photos become after with no backfill', () => {
  // A default plus NOT NULL means every existing row reads as after, which is
  // what it is. No UPDATE, no chance of mislabelling.
  assert.match(sql, /ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'after'/);
  assert.doesNotMatch(sql, /UPDATE public\.task_photos\s+SET\s+kind/);
});

test('the completed-job guard applies to after only', () => {
  assert.match(sql, /v_kind = 'after' AND v_task\.status <> 'completed'/);
  assert.match(sql, /v_kind = 'before' AND v_task\.status = 'cancelled'/);
});

test('a before photo never moves the proof pointer', () => {
  assert.match(sql, /IF v_kind = 'after' THEN\s*UPDATE public\.tasks SET proof_photo_id/);
});

test('the cap is counted per kind', () => {
  assert.match(sql, /WHERE task_id = v_task\.id AND kind = v_kind/);
});

test('the old four-argument call is kept as a wrapper', () => {
  // Two functions that could both match a four-argument call is exactly where
  // PostgreSQL has to guess; a wrapper removes the guess.
  assert.match(sql, /add_task_photo\(p_token, p_task_id, p_mime, p_base64, 'after'\)/);
});

test('the photo list reports which kind each photo is', () => {
  assert.match(sql, /p\.byte_size,\s*p\.created_at,\s*p\.kind/s);
});
