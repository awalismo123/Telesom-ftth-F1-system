import test from 'node:test';
import assert from 'node:assert/strict';
import {
  keyShape,
  maskSecret,
  projectRef,
  resolveSupabaseConfig,
  sanitizeSecret,
  sanitizeUrl,
} from '../src/lib/config';

const JWT =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFicmMiLCJyb2xlIjoiYW5vbiJ9.signaturepart';
const PUBLISHABLE = 'sb_publishable_hltdiNIgEWFruZmTyOzgtQ_r8H_cd0c';
const BUILTIN = { url: 'https://builtin.supabase.co', anonKey: JWT };

test('pasted secrets are cleaned before they become headers', () => {
  assert.equal(sanitizeSecret('  abc123  '), 'abc123');
  assert.equal(sanitizeSecret('abc123\n'), 'abc123');
  assert.equal(sanitizeSecret('"abc123"'), 'abc123');
  assert.equal(sanitizeSecret("'abc123'"), 'abc123');
  assert.equal(sanitizeSecret('Bearer abc123'), 'abc123');
  assert.equal(sanitizeSecret('\u200Babc123\uFEFF'), 'abc123');
  assert.equal(sanitizeSecret(undefined), '');
  assert.equal(sanitizeSecret(42), '');
});

test('both Supabase key formats are recognised, junk is not', () => {
  assert.equal(keyShape(JWT), 'jwt');
  assert.equal(keyShape(PUBLISHABLE), 'publishable');
  assert.equal(keyShape('service_role-secret'), 'invalid');
  assert.equal(keyShape('sb_publishable_'), 'invalid');
  assert.equal(keyShape(''), 'invalid');
});

test('URLs are validated and lose their trailing slash', () => {
  assert.equal(sanitizeUrl('https://abc.supabase.co/'), 'https://abc.supabase.co');
  assert.equal(sanitizeUrl(' https://abc.supabase.co '), 'https://abc.supabase.co');
  assert.equal(sanitizeUrl('abc.supabase.co'), '');
  assert.equal(sanitizeUrl('javascript:alert(1)'), '');
});

test('a clean environment key is used as-is', () => {
  const config = resolveSupabaseConfig({ url: 'https://env.supabase.co', anonKey: PUBLISHABLE }, BUILTIN);
  assert.equal(config.url, 'https://env.supabase.co');
  assert.equal(config.anonKey, PUBLISHABLE);
  assert.equal(config.source, 'env');
  assert.deepEqual(config.notes, []);
});

test('the classic Vercel paste — quotes or a trailing newline — still works', () => {
  // This is the shape that produced "Invalid API key" in production.
  const quoted = resolveSupabaseConfig({ anonKey: `"${PUBLISHABLE}"` }, BUILTIN);
  assert.equal(quoted.anonKey, PUBLISHABLE);
  assert.equal(quoted.source, 'env');

  const newline = resolveSupabaseConfig({ anonKey: `${JWT}\n` }, BUILTIN);
  assert.equal(newline.anonKey, JWT);
  assert.equal(newline.source, 'env');

  const bearer = resolveSupabaseConfig({ anonKey: `Bearer ${PUBLISHABLE}` }, BUILTIN);
  assert.equal(bearer.anonKey, PUBLISHABLE);
});

test('a malformed environment key falls back instead of breaking the app', () => {
  const config = resolveSupabaseConfig({ anonKey: 'not-a-key' }, BUILTIN);
  assert.equal(config.anonKey, BUILTIN.anonKey);
  assert.equal(config.source, 'builtin');
  assert.ok(config.notes.includes('env-key-malformed'));
});

test('blank environment values count as absent', () => {
  const config = resolveSupabaseConfig({ anonKey: '   ', url: '' }, BUILTIN);
  assert.equal(config.anonKey, BUILTIN.anonKey);
  assert.equal(config.url, BUILTIN.url);
  assert.equal(config.source, 'builtin');
});

test('an invalid environment URL falls back and is reported', () => {
  const config = resolveSupabaseConfig({ url: 'supabase://nope', anonKey: PUBLISHABLE }, BUILTIN);
  assert.equal(config.url, BUILTIN.url);
  assert.ok(config.notes.includes('env-url-invalid'));
  assert.equal(config.anonKey, PUBLISHABLE);
});

test('diagnostics never print the whole key', () => {
  const masked = maskSecret(JWT);
  assert.ok(!masked.includes(JWT));
  assert.ok(masked.startsWith('eyJhbGciOi') && masked.endsWith('part'));

  const publishableMasked = maskSecret(PUBLISHABLE);
  assert.ok(!publishableMasked.includes(PUBLISHABLE));
  assert.ok(publishableMasked.endsWith('cd0c'));
});

test('the project ref is readable from a Supabase URL', () => {
  assert.equal(projectRef('https://pjrzncnhhlfaxuvlcdse.supabase.co'), 'pjrzncnhhlfaxuvlcdse');
  assert.equal(projectRef('https://example.com'), '');
});
