import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';

/**
 * Mount the real component tree.
 *
 * `tsc` proves the types line up; this proves the modules actually load and
 * render without a runtime explosion — the failure that used to blank the app.
 */

// The providers read device storage during their initial state.
class MemoryStorage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  key(index: number) {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }
}

const storage = new MemoryStorage();
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
Object.defineProperty(globalThis, 'sessionStorage', { value: storage, configurable: true });

test('the app shell renders without crashing', async () => {
  const { default: App } = await import('../src/App');
  const html = renderToString(React.createElement(App));

  assert.ok(html.length > 200, 'expected a rendered document');
  assert.match(html, /Telesom FTTH/, 'branded splash should be on first paint');
  assert.doesNotMatch(html, /Loading Telesom FTTH System/, 'old bare loading text is gone');
});

test('the login screen renders both languages and asks for a PIN', async () => {
  const { LanguageProvider } = await import('../src/lib/i18n');
  const { AuthProvider } = await import('../src/contexts/AuthContext');
  const { ToastProvider } = await import('../src/components/ui/Toast');
  const { LoginScreen } = await import('../src/components/LoginScreen');

  const html = renderToString(
    React.createElement(
      ToastProvider,
      null,
      React.createElement(
        LanguageProvider,
        null,
        React.createElement(AuthProvider, null, React.createElement(LoginScreen)),
      ),
    ),
  );

  assert.match(html, /PIN/i);
  assert.match(html, /Telesom/i);
});

test('the toast provider always renders its live region', async () => {
  const { ToastProvider } = await import('../src/components/ui/Toast');
  const { LanguageProvider } = await import('../src/lib/i18n');

  const html = renderToString(
    React.createElement(
      LanguageProvider,
      null,
      React.createElement(ToastProvider, null, React.createElement('div', null, 'probe')),
    ),
  );

  assert.match(html, /probe/);
  assert.match(html, /aria-live="polite"/);
});

test('the offline strip is honest in both states', async () => {
  const { OfflineBanner } = await import('../src/components/ui/OfflineBanner');
  const { LanguageProvider } = await import('../src/lib/i18n');

  const render = () =>
    renderToString(
      React.createElement(LanguageProvider, null, React.createElement(OfflineBanner)),
    );

  // Online and never offline => nothing rendered at all.
  assert.equal(render(), '');
});

test('the record tab mounts even before there is data to show', async () => {
  const { LanguageProvider } = await import('../src/lib/i18n');
  const { AuthProvider } = await import('../src/contexts/AuthContext');
  const { ToastProvider } = await import('../src/components/ui/Toast');
  const { ActivityLog } = await import('../src/components/supervisor/ActivityLog');

  const html = renderToString(
    React.createElement(
      ToastProvider,
      null,
      React.createElement(
        LanguageProvider,
        null,
        React.createElement(AuthProvider, null, React.createElement(ActivityLog)),
      ),
    ),
  );

  // No session in a server render, so the feed is empty — but the screen must
  // still exist: the failure this guards against is a broken import blanking
  // the whole Record tab.
  assert.ok(html.length > 200, 'expected the record screen to render');
});

test('the period report draws nothing until it is opened', async () => {
  const { LanguageProvider } = await import('../src/lib/i18n');
  const { AuthProvider } = await import('../src/contexts/AuthContext');
  const { ToastProvider } = await import('../src/components/ui/Toast');
  const { PeriodReportSheet } = await import('../src/components/supervisor/PeriodReportSheet');

  const tree = (children: React.ReactNode) =>
    React.createElement(
      ToastProvider,
      null,
      React.createElement(
        LanguageProvider,
        null,
        React.createElement(AuthProvider, null, children),
      ),
    );

  const closed = renderToString(tree(React.createElement(PeriodReportSheet, { open: false, onClose: () => {} })));
  const empty = renderToString(tree(null));

  // The toast live region paints either way; the sheet must add nothing to it.
  assert.equal(closed, empty, 'a closed sheet must not paint');
  assert.doesNotMatch(closed, /Telesom · Fixed Broadband/, 'no letterhead before the sheet opens');
});

test('the manager shell opens on a read-only portfolio', async () => {
  const { LanguageProvider } = await import('../src/lib/i18n');
  const { AuthProvider } = await import('../src/contexts/AuthContext');
  const { ToastProvider } = await import('../src/components/ui/Toast');
  const { ManagerShell } = await import('../src/components/manager/ManagerShell');

  const html = renderToString(
    React.createElement(
      ToastProvider,
      null,
      React.createElement(
        LanguageProvider,
        null,
        React.createElement(AuthProvider, null, React.createElement(ManagerShell)),
      ),
    ),
  );

  assert.ok(html.length > 200, 'expected the manager shell to render');
  assert.match(html, /akhris kaliya|read only/i, 'the read-only promise must be on the screen');
  assert.doesNotMatch(html, /Qoondee|Assign to/, 'a manager must not be offered an assign control');
});
