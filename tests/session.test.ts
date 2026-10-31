import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SESSION_AGE_MS,
  createStoredSession,
  diffSession,
  initials,
  parseStoredSession,
  portalForRole,
  serializeSession,
} from '../src/lib/session';

const TOKEN = '6f2b7c1e-1f2a-4f6b-9a1d-2c3d4e5f6a7b';
const USER = '218e78f7-4d18-4839-a061-5a03e6d3946e';
const OTHER_USER = '5482a319-1111-4222-8333-444455556666';

const record = (overrides: Record<string, unknown> = {}) =>
  serializeSession({
    token: TOKEN,
    userId: USER,
    role: 'technician',
    username: 'cabdi',
    savedAt: 1_700_000_000_000,
    ...overrides,
  } as never);

test('a saved session round-trips', () => {
  const parsed = parseStoredSession(record());
  assert.ok(parsed);
  assert.equal(parsed.token, TOKEN);
  assert.equal(parsed.userId, USER);
  assert.equal(parsed.role, 'technician');
  assert.equal(parsed.username, 'cabdi');
});

test('nothing unowned is ever restored', () => {
  // Legacy builds stored a bare token with no owner — never adopted.
  assert.equal(parseStoredSession(TOKEN), null);
  assert.equal(parseStoredSession(record({ userId: undefined })), null);
  assert.equal(parseStoredSession(record({ token: 'not-a-uuid' })), null);
  assert.equal(parseStoredSession(record({ role: 'admin' })), null);
  assert.equal(parseStoredSession('{not json'), null);
  assert.equal(parseStoredSession(''), null);
  assert.equal(parseStoredSession(null), null);
});

test('a record without a timestamp is kept but treated as old', () => {
  const parsed = parseStoredSession(record({ savedAt: undefined }));
  assert.ok(parsed);
  assert.equal(parsed.savedAt, 0);
});

test('the server must confirm the same person and the same role', () => {
  const stored = createStoredSession({
    token: TOKEN,
    userId: USER,
    role: 'technician',
    username: 'cabdi',
    savedAt: 1_700_000_000_000,
  });
  const now = 1_700_000_100_000;

  assert.equal(
    diffSession(stored, { user: { id: USER, role: 'technician', is_active: true } }, now),
    'none',
  );

  // The exact production failure: a token saved for the supervisor restored on
  // a phone where a technician just typed their PIN.
  assert.equal(
    diffSession(stored, { user: { id: OTHER_USER, role: 'supervisor', is_active: true } }, now),
    'different-user',
  );

  assert.equal(diffSession(stored, { user: { id: USER, role: 'supervisor', is_active: true } }, now), 'role-changed');
  assert.equal(diffSession(stored, { user: { id: USER, role: 'technician', is_active: false } }, now), 'inactive');
  assert.equal(diffSession(stored, { user: { id: USER, role: 'technician' } }, now + MAX_SESSION_AGE_MS + 1), 'expired');
  assert.equal(diffSession(stored, null, now), 'unknown-user');
  assert.equal(diffSession(stored, { user: null }, now), 'unknown-user');
});

test('the portal always follows the role', () => {
  assert.equal(portalForRole('supervisor'), 'supervisor');
  assert.equal(portalForRole('technician'), 'technician');
  assert.equal(portalForRole(null), 'technician');
  assert.equal(portalForRole('something-else'), 'technician');
});

test('initials survive odd names', () => {
  assert.equal(initials('Cabdiraxmaan Xasan'), 'CX');
  assert.equal(initials('supervisor'), 'S');
  assert.equal(initials('  '), '?');
});
