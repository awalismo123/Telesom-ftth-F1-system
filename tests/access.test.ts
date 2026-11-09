import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/**
 * Batch B — the access-control contract.
 *
 * The hole this closes was not subtle: every operational table was
 * `SELECT USING (true)` for the `anon` role, and the anon key ships inside the
 * JavaScript bundle. One `curl` returned the customer list.
 *
 * These tests exist because the hole was created by an ordinary line of client
 * code — `supabase.from('tasks').select()` — and the next person who wants a
 * quick query will write it again unless something fails.
 */

const root = fileURLToPath(new URL('../src', import.meta.url));
const migrationPath = fileURLToPath(
  new URL('../supabase/migrations/011_batch_b_access_control.sql', import.meta.url),
);

const migration = readFileSync(migrationPath, 'utf8');

/**
 * Comments quote the old code and the old policies on purpose — the file ought
 * to explain what changed. Every assertion below is about *code*, so comments
 * are removed before the scan.
 */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/** SQL line comments too — the migration quotes the policy it deletes. */
const stripSqlComments = (source: string) =>
  source
    .split('\n')
    .map((line) => (line.trimStart().startsWith('--') ? '' : line))
    .join('\n');

const migrationCode = stripComments(stripSqlComments(migration));
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const repo = (path: string) => readFileSync(join(fileURLToPath(new URL('../', import.meta.url)), path), 'utf8');

const sourceFiles: string[] = [];
(function walk(dir: string) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(ts|tsx)$/.test(entry.name)) sourceFiles.push(full);
  }
})(root);

/**
 * Files that may still talk to PostgREST directly.
 *
 * `reads.ts` is the one place allowed to call read functions — and even it only
 * calls RPCs. Anything else in this list would need a reason written next to it.
 */
const ALLOWED_TO_CALL_SUPABASE = new Set([
  'lib/supabase.ts', // builds the client
  'lib/rpc.ts', // the RPC wrapper
  'lib/reads.ts', // the read functions
  'lib/importer.ts', // write RPCs
  'lib/opsService.ts', // write RPCs
  'lib/dispatchService.ts', // write RPCs
  'lib/executionService.ts', // write RPCs
  'lib/registryService.ts', // write RPCs
  'lib/realtime.ts', // the broadcast socket
  'contexts/AuthContext.tsx', // sign-in and sign-out
  'components/supervisor/TeamAndCrewManager.tsx', // team write RPCs
]);

test('no screen reads a table directly', () => {
  // `from('x')` is the shape that made the hole. A read must go through a
  // token-checked function; the database now returns nothing otherwise, so this
  // is also the difference between a working screen and a blank one.
  const offenders = sourceFiles
    .map((file) => file.slice(root.length + 1))
    .filter((relative) => /\.from\(['"]/.test(stripComments(read(relative))));

  assert.deepEqual(offenders, [], 'these files read a table directly:\n' + offenders.join('\n'));
});

test('only the read module and the write services may reach the database', () => {
  // The rule is about *using* the client, not importing a helper from the same
  // module — `ConfigGate` legitimately imports the connection probe.
  const offenders = sourceFiles
    .map((file) => file.slice(root.length + 1))
    .filter((relative) => {
      if (ALLOWED_TO_CALL_SUPABASE.has(relative)) return false;
      return /\bsupabase\s*\./.test(stripComments(read(relative)));
    });

  assert.deepEqual(
    offenders,
    [],
    'add these to ALLOWED_TO_CALL_SUPABASE with a reason, or use lib/reads.ts:\n' +
      offenders.join('\n'),
  );
});

test('every read function checks the session token before returning rows', () => {
  // The signature is the contract: first argument `p_token uuid`. A function
  // without it cannot know who is asking.
  const readFunctions = [
    'list_groups',
    'group_overview',
    'list_open_tasks',
    'get_task',
    'list_work_logs',
    'list_live_moves',
    'list_resumed_since',
    'list_import_batches',
    'my_team',
    'upload_sheet_image',
    'get_sheet_image',
  ];

  for (const name of readFunctions) {
    const signature = new RegExp(`FUNCTION public\\.${name}\\(\\s*p_token uuid`).test(migrationCode);
    assert.ok(signature, `${name} must take p_token as its first argument`);

    const body = migrationCode.slice(migrationCode.indexOf(`FUNCTION public.${name}(`));
    const upToEnd = body.slice(0, body.indexOf('$$;'));
    // Either it resolves the caller itself, or it delegates to a function that
    // already did (list_work_logs goes through get_task).
    assert.match(
      upToEnd,
      /get_session_user\(p_token\)|public\.(get_task|get_session_user)\(p_token/,
      `${name} must resolve the caller from the token`,
    );
  }
});

test('every group-scoped function refuses another group', () => {
  for (const name of [
    'group_overview',
    'list_open_tasks',
    'list_live_moves',
    'list_import_batches',
    'upload_sheet_image',
  ]) {
    const body = migrationCode.slice(migrationCode.indexOf(`FUNCTION public.${name}(`));
    const upToEnd = body.slice(0, body.indexOf('$$;'));
    assert.match(
      upToEnd,
      /u\.group_id = p_group_id[\s\S]*?RAISE EXCEPTION 'Not allowed for this group'/,
      `${name} must reject a group the caller does not belong to`,
    );
  }
});

test('the anonymous role can read no table at all', () => {
  const dropped = [
    'groups',
    'users',
    'crews',
    'crew_members',
    'cableboxes',
    'cablebox_logs',
    'import_batches',
    'tasks',
    'task_work_logs',
    'dispatch_log',
    'cablebox_ports',
  ];

  for (const table of dropped) {
    assert.match(
      migrationCode,
      new RegExp(`DROP POLICY IF EXISTS "Allow read ${table}" ON public\\.${table};`),
      `${table} keeps an open read policy`,
    );
  }

  // Nothing may re-create a policy that says "true" for everyone.
  assert.doesNotMatch(migrationCode, /FOR SELECT USING \(true\)/);
});

test('the sheet archive is private on both sides', () => {
  // The bucket used to be public, and the upload policy let anyone with the
  // published key write into it.
  assert.match(migration, /UPDATE storage\.buckets SET public = false WHERE id = 'sheet-images'/);
  assert.match(migration, /DROP POLICY IF EXISTS "sheet images read" ON storage\.objects/);
  assert.match(migration, /DROP POLICY IF EXISTS "sheet images upload" ON storage\.objects/);

  // New sheets go to a table with row-level security and no policies: only the
  // functions above can see them.
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.sheet_images/);
  assert.match(migration, /ALTER TABLE public\.sheet_images ENABLE ROW LEVEL SECURITY/);

  // Nothing in the client mints a public or signed URL any more.
  const client = sourceFiles.map((file) => stripComments(read(file.slice(root.length + 1)))).join('\n');
  assert.doesNotMatch(client, /getPublicUrl|createSignedUrl|storage\.from\(/);
});

test('a wrong PIN gets progressively more expensive', () => {
  assert.match(migrationCode, /c_max_attempts CONSTANT int := 5/);
  assert.match(migrationCode, /c_lock_minutes CONSTANT int := 15/);
  assert.match(migrationCode, /locked_until > now\(\)/);
  assert.match(migrationCode, /failed_attempts \+ 1 >= c_max_attempts/);

  // A short PIN is refused before the hash is even read.
  assert.match(migrationCode, /length\(v_trimmed_pin\) < 4 OR length\(v_trimmed_pin\) > 6/);
});

test('the lockout answers instead of raising, or it would never stick', () => {
  // Found by probing the live database: `RAISE EXCEPTION` aborts the request's
  // transaction, which rolled back the `failed_attempts` update it had just
  // written. The counter stayed at zero and the correct PIN kept working.
  const body = migrationCode.slice(
    migrationCode.indexOf('FUNCTION public.authenticate_pin('),
  );
  const fn = body.slice(0, body.indexOf('$$;'));

  assert.doesNotMatch(
    fn,
    /RAISE (EXCEPTION|WARNING)/i,
    'a raise here undoes the attempt counter — return { ok: false } instead',
  );
  assert.match(fn, /'reason', 'locked'/);
  assert.match(fn, /'reason', 'invalid'/);
  assert.match(fn, /'retry_after_minutes'/);

  // The client is allowed to know about it, and says something useful.
  assert.match(repo('src/contexts/AuthContext.tsx'), /result\?\.reason === 'locked'/);
  assert.match(repo('src/lib/errors.ts'), /Too many wrong PINs/);
});

test('an account on a department-issued PIN cannot reach the app', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS must_change_pin boolean NOT NULL DEFAULT false/);
  assert.match(migration, /'must_change_pin', u\.must_change_pin/);
  assert.match(migration, /UPDATE public\.users SET must_change_pin = false WHERE id = v_user\.id/);

  const app = read('App.tsx');
  assert.match(app, /if \(session\.user\.must_change_pin\) \{\s*return <ForcePinChange \/>;/);
});

test('a PIN set by a supervisor is treated as temporary', () => {
  // Creating an account or resetting its PIN hands the person a number the
  // supervisor also knows, so the app must ask them to replace it.
  const body = migrationCode.slice(
    migrationCode.indexOf('FUNCTION public.upsert_team_member('),
  );
  const fn = body.slice(0, body.indexOf('$$;'));

  assert.match(fn, /must_change_pin\)\s*\n\s*VALUES \([^\n]*true\)/, 'a new member starts flagged');
  assert.match(fn, /UPDATE public\.users SET must_change_pin = true WHERE id = v_target_id;/);
});

test('the realtime feed is not a second copy of the data', () => {
  // `postgres_changes` obeys row-level security; with the tables closed it
  // would deliver nothing, and if it did deliver it would be a bypass.
  assert.doesNotMatch(stripComments(read('lib/realtime.ts')), /postgres_changes/);
  assert.match(read('lib/realtime.ts'), /'broadcast'/);
});

test('the token is never written to the URL or a log', () => {
  for (const file of sourceFiles) {
    const relative = file.slice(root.length + 1);
    const source = stripComments(read(relative));
    assert.doesNotMatch(
      source,
      /console\.(log|info|debug)\([^)]*token/i,
      `${relative} logs a session token`,
    );
    assert.doesNotMatch(
      source,
      /[?&]token=/,
      `${relative} puts the session token in a URL`,
    );
  }
});
