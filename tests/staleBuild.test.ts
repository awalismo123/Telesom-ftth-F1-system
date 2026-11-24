import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { APP_VERSION } from '../src/lib/version';

/**
 * The stale-build notice is a chain of four things, and it fails silently if any
 * one of them is missing: the meta tag must be emitted at build time, the hook
 * must look for that exact tag name, the component must be mounted, and the
 * version it compares against must be the same constant the tag carries.
 *
 * A notice that never fires looks exactly like a build that is always current,
 * which is why this is asserted rather than trusted.
 */

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

test('the build emits the version meta tag from the same constant', () => {
  const config = read('vite.config.ts');

  assert.match(config, /import \{ APP_VERSION \} from '\.\/src\/lib\/version'/, 'one version, not two');
  assert.match(config, /name="app-version"/, 'the tag the hook reads');
  assert.match(config, /content="\$\{APP_VERSION\}"/, 'and it carries the real version');
});

test('the hook looks for the tag the build writes', () => {
  const hook = read('src/lib/useStaleBuild.ts');

  // The regex and the meta tag name must agree character for character.
  assert.match(hook, /name="app-version"/, 'the hook must look for the emitted tag');
  assert.match(hook, /APP_VERSION/, 'and compare against the compiled constant');
  assert.match(hook, /cache: 'no-store'/, 'a cached index.html would always look current');
});

test('the notice is mounted, and it never reloads on its own', () => {
  const app = read('src/App.tsx');
  assert.match(app, /import \{ StaleBuildNotice \}/, 'unmounted is unbuilt');
  assert.match(app, /<StaleBuildNotice \/>/, 'and rendered');

  const component = read('src/components/ui/StaleBuildNotice.tsx');
  // A reload must be a button press. A technician mid-job cannot have the page
  // taken out from under them.
  const reloadCalls = component.match(/location\.reload/g) ?? [];
  assert.equal(reloadCalls.length, 0, 'the reload belongs in the hook, behind a click');
  assert.match(component, /onClick=\{stale\.reload\}/, 'the reload is offered, not taken');
});

test('the version on the sign-in screen is this build', () => {
  // The stamp is how "I did not see the changes" gets settled in one look.
  assert.match(APP_VERSION, /^\d+\.\d+\.\d+$/, 'a semver string');
  assert.ok(APP_VERSION >= '1.17.1', 'the sign-in screen must not claim an older build');
});
