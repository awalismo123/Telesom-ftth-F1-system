import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyError,
  isAuthFailure,
  isOfflineFailure,
  stripDbNoise,
  toErrorMessage,
} from '../src/lib/errors';

test('classifies the messages our SQL actually raises', () => {
  assert.equal(classifyError('Invalid username/phone or PIN'), 'auth');
  assert.equal(classifyError('Invalid or expired session'), 'auth');
  assert.equal(classifyError('This job is not assigned to you'), 'forbidden');
  assert.equal(classifyError('Only supervisors can dispatch work'), 'forbidden');
  assert.equal(classifyError('This job is already completed'), 'conflict');
  assert.equal(classifyError('An optical dBm reading is required to complete a job'), 'validation');
  assert.equal(classifyError('dBm reading 4 is outside the measurable range (-40 … 0)'), 'validation');
  assert.equal(classifyError('Port 12 is outside 1…8'), 'validation');
  assert.equal(classifyError('Failed to fetch'), 'network');
  assert.equal(classifyError('Request timeout after 20000ms'), 'network');
  assert.equal(classifyError('something entirely unexpected'), 'unknown');
});

test('strips Postgres noise before it reaches a screen', () => {
  const raw = 'ERROR: P0001: This job is not assigned to you\nCONTEXT: PL/pgSQL function start_task(uuid) line 16 at RAISE';
  assert.equal(stripDbNoise(raw), 'This job is not assigned to you');
  assert.ok(!stripDbNoise(raw).includes('CONTEXT'));
});

test('speaks Somali and English', () => {
  const raw = 'An optical dBm reading is required to complete a job';
  assert.equal(toErrorMessage(raw, 'en'), 'An optical dBm reading is required.');
  assert.equal(toErrorMessage(raw, 'so'), 'Cabbirka dBm waa qasab.');
});

test('never shows a raw stack to a technician', () => {
  const message = toErrorMessage('ERROR: 23505: duplicate key value violates unique constraint "users_username_key"', 'en');
  assert.ok(!message.includes('23505'));
  assert.equal(message, 'That already exists.');
});

test('falls back to a calm sentence for the unknown', () => {
  assert.match(toErrorMessage(null, 'en'), /Something went wrong/i);
  assert.match(toErrorMessage('', 'so'), /Isku day/i);
});

test('auth and offline detection', () => {
  assert.equal(isAuthFailure(new Error('Invalid or expired session')), true);
  assert.equal(isAuthFailure(new Error('An optical dBm reading is required')), false);
  assert.equal(isOfflineFailure(new Error('Failed to fetch')), true);
  assert.equal(isOfflineFailure(new Error('Port 9 is outside 1…8')), false);
});

test('a rejected project key is a configuration problem, not a bad PIN', () => {
  // The exact body PostgREST returns when the anon key is wrong.
  const raw = '{"message":"Invalid API key"}';
  assert.equal(classifyError(raw), 'config');
  assert.equal(classifyError('Invalid API key'), 'config');
  assert.equal(classifyError('No API key found in request'), 'config');
  assert.equal(classifyError('JWT signature verification failed'), 'config');

  // It must never be mistaken for an expired session: that would sign the
  // person out in a loop instead of telling them the app is misconfigured.
  assert.equal(isAuthFailure(new Error('Invalid API key')), false);
  assert.equal(isOfflineFailure(new Error('Invalid API key')), false);

  const message = toErrorMessage(raw, 'en');
  assert.ok(!/invalid api key/i.test(message), 'raw gateway text must not reach the screen');
  assert.match(message, /set up correctly/i);
  assert.match(toErrorMessage(raw, 'so'), /looma habayn/i);
});

test('a rejected key never leaks into a technician-facing sentence', () => {
  const message = toErrorMessage('ERROR: P0001: Invalid API key', 'so');
  assert.ok(!message.includes('ERROR'));
  assert.ok(!/api key/i.test(message));
});

test('PIN changes speak both languages', () => {
  assert.equal(toErrorMessage('Current PIN is incorrect', 'en'), 'Your current PIN is incorrect.');
  assert.equal(toErrorMessage('PIN must be 4 to 6 digits', 'so'), 'PIN-ku waa in uu noqdaa 4 ilaa 6 lambar.');
});
