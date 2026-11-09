import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  MAX_PHOTO_BYTES,
  MAX_PHOTO_EDGE,
  base64Bytes,
  fitWithin,
  photoSizeLabel,
} from '../src/lib/photo';

/**
 * Batch H — photo proof.
 *
 * The maths that decides how big a photograph is when it reaches the database is
 * pure, so it is tested here. The rest of this file is the property the feature
 * cannot ship without: a proof photo is **private**, and only the worker or the
 * supervisor can attach one.
 */

/* -------------------------------------------------------------------------- */
/* Resizing                                                                    */
/* -------------------------------------------------------------------------- */

test('photo: a landscape shot is bounded by its long edge', () => {
  assert.deepEqual(fitWithin(4032, 3024), { width: 640, height: 480 });
});

test('photo: a portrait shot keeps its shape', () => {
  assert.deepEqual(fitWithin(3024, 4032), { width: 480, height: 640 });
});

test('photo: a picture that is already small is never enlarged', () => {
  assert.deepEqual(fitWithin(480, 360), { width: 480, height: 360 });
  assert.deepEqual(fitWithin(640, 640), { width: 640, height: 640 });
});

test('photo: the boundary is inclusive, and never zero', () => {
  assert.deepEqual(fitWithin(641, 640), { width: 640, height: 639 });
  assert.deepEqual(fitWithin(10_000, 1), { width: 640, height: 1 });
  assert.deepEqual(fitWithin(0, 0), { width: 1, height: 1 });
});

test('photo: a custom ceiling is respected', () => {
  assert.deepEqual(fitWithin(2000, 1000, 500), { width: 500, height: 250 });
  assert.equal(MAX_PHOTO_EDGE, 640);
});

/* -------------------------------------------------------------------------- */
/* Bytes and labels                                                            */
/* -------------------------------------------------------------------------- */

test('photo: base64 length tells the byte size without decoding', () => {
  assert.equal(base64Bytes('AAAA'), 3);
  assert.equal(base64Bytes('AAA='), 2);
  assert.equal(base64Bytes('AA=='), 1);
  assert.equal(base64Bytes('A'.repeat(400)), 300);
});

test('photo: the size is shown in units a technician reads', () => {
  assert.equal(photoSizeLabel(0), '—');
  assert.equal(photoSizeLabel(512), '512 B');
  assert.equal(photoSizeLabel(86_016), '84 kB');
  assert.equal(photoSizeLabel(1.5 * 1024 * 1024), '1.5 MB');
});

test('photo: the client ceiling mirrors the database backstop', () => {
  assert.equal(MAX_PHOTO_BYTES, 2 * 1024 * 1024);
});

/* -------------------------------------------------------------------------- */
/* The guarantees that live in SQL and in wiring                               */
/* -------------------------------------------------------------------------- */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

const migration = read('supabase/migrations/013_batch_h_photo_proof.sql');

test('photo: the table is private — no storage bucket, no anon policy', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.task_photos/);
  assert.match(migration, /ALTER TABLE public\.task_photos ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(migration, /CREATE POLICY[\s\S]*task_photos/i, 'a policy on task_photos would undo the whole design');
  assert.doesNotMatch(migration, /storage\.objects[\s\S]*task_photos/i);
  assert.match(migration, /image bytea NOT NULL/);
});

test('photo: every read and write is a token-first SECURITY DEFINER function', () => {
  for (const fn of ['add_task_photo', 'list_task_photos', 'get_task_photo']) {
    const body = migration.slice(migration.indexOf(`FUNCTION public.${fn}(`));
    assert.ok(body.length > 0, `${fn} is missing`);
    assert.match(body.slice(0, 400), /SECURITY DEFINER/, `${fn} must run as definer`);
    assert.match(body.slice(0, 400), /p_token uuid/, `${fn} must take the session token first`);
  }
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_task_photo\(uuid, uuid\) TO anon, authenticated/);
});

test('photo: only the worker or supervisor, only on a completed job, at most three', () => {
  assert.match(migration, /is_task_worker\(v_user, v_task\) IS NOT TRUE/);
  assert.match(migration, /v_task\.status <> 'completed'/);
  assert.match(migration, /v_existing >= 3/);
  assert.match(migration, /octet_length\(v_bytes\) > 2 \* 1024 \* 1024/);
  assert.match(migration, /UPDATE public\.tasks SET proof_photo_id = v_id/);
});

test('photo: the client compresses before uploading, and never after completing', () => {
  const sheet = read('src/components/technician/ExecutionSheet.tsx');

  assert.match(sheet, /preparePhoto\(/, 'the camera file must be resized on the phone');
  assert.match(sheet, /capture="environment"/, 'the camera should open directly on a phone');
  assert.match(sheet, /addTaskPhoto\(/, 'something must actually upload the photo');

  // The job is completed first; the photo is a second call. A failed upload must
  // never be reported as a failed job.
  const completeIndex = sheet.indexOf('await completeTask(');
  const photoIndex = sheet.indexOf('await sendPhoto(photo, result.task_id)');
  assert.ok(completeIndex > 0 && photoIndex > completeIndex, 'the photo is sent after the completion');

  // And the supervisor can see it.
  assert.match(read('src/components/supervisor/ActivityLog.tsx'), /PhotoViewer/);
  assert.match(read('src/components/supervisor/dispatch/JobActionsSheet.tsx'), /fetchTaskPhotos/);
});
