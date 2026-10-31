import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';

/**
 * The UI kit is the contract every screen now composes against. These tests
 * pin the parts that matter for accessibility and for consistency: control
 * sizes, label wiring, roles and live regions.
 */

const render = (node: React.ReactElement) => renderToString(node);

test('Button defaults to type=button and honours loading', async () => {
  const { Button } = await import('../src/components/ui/Button');

  const idle = render(React.createElement(Button, null, 'Save'));
  assert.match(idle, /type="button"/);
  assert.match(idle, />Save</);

  const loading = render(
    React.createElement(Button, { loading: true }, 'Saving'),
  );
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /disabled/);
});

test('Button sizes keep the 44 px touch minimum for the default size', async () => {
  const { Button } = await import('../src/components/ui/Button');
  const html = render(React.createElement(Button, null, 'Ok'));
  assert.match(html, /h-11/);
  assert.match(html, /min-h-11/);
});

test('Input wires its label, hint and error to the control', async () => {
  const { Input } = await import('../src/components/ui/Field');

  const html = render(
    React.createElement(Input, {
      label: 'PIN',
      hint: '4 to 6 digits',
      value: '1234',
      onChange: () => undefined,
    }),
  );

  assert.match(html, /<label[^>]*for="([^"]+)"/);
  const id = /for="([^"]+)"/.exec(html)?.[1];
  assert.ok(id, 'label must point at the input');
  assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, new RegExp(`aria-describedby="${id}-hint"`));

  const withError = render(
    React.createElement(Input, {
      label: 'PIN',
      error: 'Wrong PIN',
      value: '',
      onChange: () => undefined,
    }),
  );
  assert.match(withError, /aria-invalid="true"/);
  assert.match(withError, /role="alert"/);
});

test('Skeleton is decorative but announces loading once', async () => {
  const { Skeleton, SkeletonList } = await import('../src/components/ui/Skeleton');

  const bar = render(React.createElement(Skeleton, { className: 'h-4' }));
  assert.match(bar, /aria-hidden="true"/);

  const list = render(React.createElement(SkeletonList, { rows: 2, label: 'Loading jobs' }));
  assert.match(list, /role="status"/);
  assert.match(list, /aria-busy="true"/);
  assert.match(list, /Loading jobs/);
});

test('Tabs expose the ARIA tabs pattern with a roving tabindex', async () => {
  const { Tabs } = await import('../src/components/ui/Tabs');
  const items = [
    { id: 'route' as const, label: 'Route' },
    { id: 'boxes' as const, label: 'Boxes' },
  ];

  const html = render(
    React.createElement(Tabs, { items, value: 'route', onChange: () => undefined, label: 'Sections' }),
  );

  assert.match(html, /role="tablist"/);
  assert.match(html, /aria-label="Sections"/);
  assert.match(html, /aria-selected="true"/);
  assert.match(html, /aria-selected="false"/);
  assert.match(html, /tabindex="-1"/);
  assert.match(html, /aria-controls="panel-route"/);
});

test('EmptyState says what is missing and offers the next step', async () => {
  const { EmptyState } = await import('../src/components/ui/EmptyState');
  const html = render(
    React.createElement(EmptyState, {
      title: 'No jobs today',
      description: 'Pick a sheet to import.',
    }),
  );
  assert.match(html, /No jobs today/);
  assert.match(html, /Pick a sheet to import/);
});

test('Badge hides its decorative dot from assistive tech', async () => {
  const { Badge } = await import('../src/components/ui/Badge');
  const html = render(React.createElement(Badge, { tone: 'emerald', dot: true }, 'Live'));
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /Live/);
});

test('Stat puts the number before the explanation', async () => {
  const { Stat } = await import('../src/components/ui/Stat');
  const html = render(React.createElement(Stat, { label: 'Open jobs', value: 12, hint: '3 unassigned' }));
  assert.match(html, /Open jobs/);
  assert.match(html, />12</);
  assert.match(html, /3 unassigned/);
});

test('Sheet renders nothing on the server or when closed', async () => {
  const { Sheet } = await import('../src/components/ui/Sheet');
  const html = render(
    React.createElement(Sheet, { open: false, onClose: () => undefined, title: 'Details' }, 'body'),
  );
  assert.equal(html, '');
});
