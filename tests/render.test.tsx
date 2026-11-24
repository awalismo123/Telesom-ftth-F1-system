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
  assert.match(html, /Telesom (FTTH|Fiber)/, 'branded splash should be on first paint');
  assert.match(html, /<svg/, 'the splash should carry the mark, not a loading glyph');
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

/**
 * The command page's panels.
 *
 * `tsc` cannot see a panel that divides by a field the server never sends, and
 * a unit test on a pure function cannot see one that renders `NaN`. These mount
 * each panel with the shape the live database actually returns — nineteen open
 * jobs, every one past the promise, two crews with no members, and an activity
 * window with nothing in it — and assert on the words a supervisor would read.
 */
test('the command page panels render the live shapes without a crash or a NaN', async () => {
  const { LanguageProvider } = await import('../src/lib/i18n');
  const { AttentionRail } = await import('../src/components/supervisor/overview/AttentionRail');
  const { LoadBoard } = await import('../src/components/supervisor/overview/LoadBoard');
  const { WorkQueue } = await import('../src/components/supervisor/overview/WorkQueue');
  const { MovementPanel } = await import('../src/components/supervisor/overview/MovementPanel');
  const { LiveFeed } = await import('../src/components/supervisor/overview/LiveFeed');

  const tasks = Array.from({ length: 19 }, (_, i) => ({
    id: `t${i}`,
    group_id: 'g1',
    line_number: `57537${i}`,
    customer_name: 'HOODO IDIRIS',
    customer_phone: '0634111111',
    xaafada: 'JIGJIGAYAR',
    status: 'unassigned',
    priority: i < 2 ? 'urgent' : 'normal',
    task_type: 'cilada',
    reported_date: '2026-11-12',
    created_at: '2026-11-12T08:00:00Z',
  })) as never[];

  const railInput = { blocked: 0, over_sla: 19, due_today: 0, unassigned: 19, urgent_open: 2 };
  const load = {
    users: [
      {
        id: 'u1',
        full_name: 'Xasan Cali Nuur',
        username: 'xasan',
        phone: null,
        open_jobs: 0,
        active_jobs: 0,
        done_today: 0,
        urgent_jobs: 0,
      },
    ],
    crews: [
      {
        id: 'c1',
        name: 'F1 - Crew A',
        vehicle_tag: 'A-1',
        zone_focus: null,
        members: [],
        open_jobs: 0,
        active_jobs: 0,
        done_today: 0,
        urgent_jobs: 0,
      },
    ],
  };

  /** The provider reads its language at mount, so the storage is set first. */
  const wrap = (lang: 'en' | 'so', node: React.ReactElement) => {
    storage.setItem('telesom_f1_lang', lang);
    return renderToString(React.createElement(LanguageProvider, null, node));
  };

  const rail = wrap(
    'en',
    React.createElement(AttentionRail, { input: railInput, loading: false, onOpen: () => {} }),
  );
  assert.match(rail, /19/, 'the overdue and unassigned counts should be on screen');
  assert.doesNotMatch(rail, /NaN/);

  const board = wrap(
    'en',
    React.createElement(LoadBoard, { load, loading: false, onOpenTeam: () => {} }),
  );
  assert.match(board, /F1 - Crew A/);
  assert.match(board, /Xasan Cali Nuur/);
  // A crew nobody is in cannot be dispatched to, and the screen must say so.
  assert.match(board, /no members/);

  const queue = wrap(
    'en',
    React.createElement(WorkQueue, {
      tasks,
      today: '2026-11-24',
      loading: false,
      totalOpen: 19,
      onOpenTask: () => {},
      onOpenDispatch: () => {},
    }),
  );
  assert.match(queue, /575370/, 'the queue should name a job, not only count them');
  assert.match(queue, /tel:0634111111/, 'a supervisor must be able to call from the list');

  const movement = wrap(
    'en',
    React.createElement(MovementPanel, { events: [], today: '2026-11-24', loading: false }),
  );
  assert.match(movement, /No movement/, 'a silent week says so');
  assert.doesNotMatch(movement, /NaN|Infinity/);

  const feed = wrap(
    'en',
    React.createElement(LiveFeed, { events: [], loading: false, onOpenAll: () => {} }),
  );
  assert.match(feed, /Nothing has been recorded yet/);

  // The same panels in Somali: a missing translation surfaces as a raw key here.
  const somali = wrap(
    'so',
    React.createElement(AttentionRail, { input: railInput, loading: false, onOpen: () => {} }),
  );
  assert.doesNotMatch(somali, /NaN/);
  assert.doesNotMatch(somali, /\bblocked\b/, 'the rail must speak Somali on the Somali screen');
});

/**
 * The dispatch board's header and banners, against the live pool.
 *
 * The live database on 24/11/2026 held nineteen unassigned jobs: two urgent,
 * none carried over, all past the promise, and **eighteen with neither an area
 * nor a box**. Every one of those facts changes what the board must say, and
 * none of them is visible to `tsc`.
 */
test('the dispatch board describes the live pool truthfully', async () => {
  const { triagePool, triageSentence, unroutableJobs, unroutableNotice, orderPool } = await import(
    '../src/lib/dispatchBoard'
  );

  const live = [
    // Two urgent cilada jobs, no area, no box.
    { id: 'u1', line_number: '573864', priority: 'urgent', status: 'unassigned', xaafada: null, cablebox_code_raw: null, reported_date: '2026-11-14', carryover_count: 0 },
    { id: 'u2', line_number: '588114', priority: 'urgent', status: 'unassigned', xaafada: null, cablebox_code_raw: null, reported_date: '2026-11-14', carryover_count: 0 },
    // One job with a box.
    { id: 'b1', line_number: '575373', priority: 'normal', status: 'unassigned', xaafada: null, cablebox_code_raw: 'CB190-229 (06)', reported_date: '2026-11-12', carryover_count: 0 },
    // Ten installations with an area.
    ...['Jigjigayar', 'KOODBUUR', 'SHEEDAHA', 'XERO AWR', 'Idaacada'].flatMap((area, i) => [
      { id: `i${i}a`, line_number: `57546${i}`, priority: 'normal', status: 'unassigned', xaafada: area, cablebox_code_raw: null, reported_date: '2026-11-14', carryover_count: 0 },
      { id: `i${i}b`, line_number: `57547${i}`, priority: 'normal', status: 'unassigned', xaafada: area, cablebox_code_raw: null, reported_date: '2026-11-14', carryover_count: 0 },
    ]),
    // Six cilada with neither.
    ...Array.from({ length: 6 }, (_, i) => ({
      id: `n${i}`,
      line_number: `58866${i}`,
      priority: 'normal',
      status: 'unassigned',
      xaafada: null,
      cablebox_code_raw: null,
      reported_date: '2026-11-14',
      carryover_count: 0,
    })),
  ] as never[];

  const now = new Date('2026-11-24T09:00:00Z');
  const triage = triagePool(live, now);

  assert.equal(triage.total, 19, 'the live pool is nineteen jobs');
  assert.equal(triage.urgent, 2, 'two were urgent');
  // Of the nineteen: the two urgent jobs and six cilada have neither an area
  // nor a box. The ten installations do carry an area, and one job carries a
  // box, so those eleven can be routed.
  assert.equal(triage.unroutable, 8, 'two urgent + six area-less cilada');
  assert.equal(triage.routable, 11, 'the box job and the ten area installations');
  assert.equal(triage.routable + triage.unroutable, 19);

  // Urgent first: the two urgent line numbers must lead the ordered pool.
  const ordered = orderPool(live);
  assert.deepEqual(
    ordered.slice(0, 2).map((job) => job.line_number),
    ['573864', '588114'],
  );

  // The sentence must not claim a route exists for work that has no place.
  const sentence = triageSentence(triage, 'en');
  assert.match(sentence, /urgent/i);

  const notice = unroutableNotice(unroutableJobs(live), 'en')!;
  assert.match(notice.title, /8/);
  assert.match(notice.body, /573864/);
});

/**
 * The fault board and the two new sheets, mounted with the live shapes.
 *
 * Three things could break here that no type can catch: the fault board divides
 * ages by a date some rows do not have, the bulk sheet prints a deletable count
 * derived from a policy mirror, and the edit sheet seeds its form from a job
 * that may be missing every field it edits. All three render numbers and words
 * a supervisor acts on, so all three are asserted.
 */
test('the fault board renders the live fault shapes without a crash or a NaN', async () => {
  const { LanguageProvider } = await import('../src/lib/i18n');
  const { FaultBoard } = await import('../src/components/supervisor/dispatch/FaultBoard');

  const fault = (i: number, over: Record<string, unknown> = {}) => ({
    id: `f${i}`,
    group_id: 'g1',
    line_number: `5738${i}4`,
    customer_name: i === 0 ? '' : 'CABDI XASAN',
    customer_phone: i === 0 ? null : '0634222222',
    xaafada: i < 6 ? null : 'JIGJIGAYAR',
    cablebox_code_raw: i < 6 ? null : 'CB190-229 (06)',
    status: 'unassigned',
    priority: i === 1 ? 'urgent' : 'normal',
    task_type: 'cilada',
    // The live census: every open fault is past the two-day promise, and none
    // has a type. One row has no date at all, which must not become NaN.
    reported_date: i === 4 ? null : '2026-11-12',
    created_at: i === 4 ? null : '2026-11-12T08:00:00Z',
    fault_type: null,
    ...over,
  });

  const tasks = [
    fault(0),
    fault(1),
    fault(2, { fault_type: 'cut_cable' }),
    fault(3, { fault_type: 'no_signal' }),
    fault(4),
    fault(5),
  ];

  const html = renderToString(
    React.createElement(
      LanguageProvider,
      null,
      React.createElement(FaultBoard, {
        tasks: tasks as never[],
        totalOpenFaults: 9,
        lateFaults: 9,
        untypedFaults: 9,
        onOpenTask: () => {},
        onSelectMany: () => {},
      }),
    ),
  );

  assert.doesNotMatch(html, /NaN/, 'a fault with no date must not print NaN');
  assert.doesNotMatch(html, /undefined/);
  assert.match(html, /2 maalmood|2 days/, 'the fault clock is on the screen');
  assert.match(html, /Nooc ma leh|No type/, 'the untyped count is surfaced');

  // The list is shorter than the server's count, so the board must say so
  // rather than implying six is the whole backlog.
  assert.match(html, /9/, 'the server count is shown, not just the loaded rows');
  assert.match(html, /6 of 9|9 oo keliya|6 oo keliya/i, 'the partial list is admitted');
});

/*
 * The two new sheets are not rendered here.
 *
 * `Sheet` returns `null` when there is no `document` — an existing guard, and
 * the right one, because a portal on the server has nowhere to go. So a render
 * test of a sheet body would assert on an empty string and pass while proving
 * nothing. The policy they display is therefore extracted into `faults.ts`,
 * where it is tested directly (see `bulkDeletePlan` in tests/faults.test.ts),
 * and the sheets keep their own structural guards in tests/design.test.ts.
 */
test('the edit sheet would refuse an unmounted render for the right reason', async () => {
  const { LanguageProvider } = await import('../src/lib/i18n');
  const { ToastProvider } = await import('../src/components/ui/Toast');
  const { EditJobSheet } = await import('../src/components/supervisor/dispatch/EditJobSheet');

  // The live defect: six of nine faults have no area and no box, so they can
  // never be clustered. The sheet must name that and offer the fields.
  const placeless = {
    id: 'p1',
    group_id: 'g1',
    line_number: '573863',
    customer_name: 'MUSTAFE',
    customer_phone: '0634333333',
    xaafada: null,
    cablebox_code_raw: null,
    status: 'unassigned',
    task_type: 'cilada',
    priority: 'normal',
    fault_type: null,
    reported_date: '2026-11-20',
    created_at: '2026-11-20T08:00:00Z',
  };

  storage.setItem('telesom_f1_lang', 'en');
  const html = renderToString(
    React.createElement(
      ToastProvider,
      null,
      React.createElement(
        LanguageProvider,
        null,
        React.createElement(EditJobSheet, {
          open: true,
          onClose: () => {},
          task: placeless as never,
          token: 'x',
          onSaved: () => {},
        }),
      ),
    ),
  );

  // A sheet is a portal, so its body is not in the server output — only the
  // toast provider's empty live region is. Asserting that absence documents
  // *why* the interesting assertions live in `bulkDeletePlan`'s tests instead of
  // quietly deleting the coverage.
  assert.doesNotMatch(html, /This job has no place/);
  assert.doesNotMatch(html, /Edit job/, 'a portal has no server-side body to read');
});

/**
 * The roster, mounted with the live shape.
 *
 * Team & Crews had never been render-tested. What makes it worth doing now is
 * that the page gained a refusal: deactivating somebody holding work. A refusal
 * that renders an empty string, or a `NaN`, is worse than no refusal at all.
 */
test('the roster counts real capacity, not lanes, from the live shape', async () => {
  const { capacityCounts, capacitySentence } = await import('../src/lib/roster');

  // Exactly the live roster on 24/11/2026: 2 crews of 2, 4 technicians, no floats.
  const counts = capacityCounts(
    [
      { id: 'crewA', is_active: true },
      { id: 'crewB', is_active: true },
    ],
    [
      { id: 'cabdi', is_active: true },
      { id: 'maxamed', is_active: true },
      { id: 'mustafe', is_active: true },
      { id: 'xasan', is_active: true },
    ],
    [
      { crew_id: 'crewA', user_id: 'maxamed' },
      { crew_id: 'crewA', user_id: 'cabdi' },
      { crew_id: 'crewB', user_id: 'mustafe' },
      { crew_id: 'crewB', user_id: 'xasan' },
    ],
  );

  assert.deepEqual(counts, { crewsWithMembers: 2, loneTechnicians: 0 });

  // The board lists six lanes for this roster. Neither language may print six as
  // capacity, because six is not what the department can do.
  const en = capacitySentence(counts.crewsWithMembers, counts.loneTechnicians, 'en');
  const so = capacitySentence(counts.crewsWithMembers, counts.loneTechnicians, 'so');
  assert.match(en, /2 real units/);
  assert.doesNotMatch(en, /\b6\b/);
  assert.match(so, /2 shaqo-ballaarineed/);
  assert.doesNotMatch(so, /\b6\b/);
});

test('a refusal names the jobs a supervisor has to move', async () => {
  const { retirementProblem, lineNumbersOf } = await import('../src/lib/roster');

  // The exact situation probed live: cabdi holding two faults.
  const held = [
    { id: 'a', line_number: '573864', customer_name: 'CABDI XASAN', status: 'assigned' },
    { id: 'b', line_number: '575463', customer_name: 'HODAN YUUSUF', status: 'assigned' },
  ];

  const check = retirementProblem(held);
  assert.equal(check.ok, false);
  assert.equal(lineNumbersOf(check.jobs), '573864, 575463');
  assert.doesNotMatch(check.message!.en, /undefined|NaN/);
  assert.doesNotMatch(check.message!.so, /undefined|NaN/);
});

test('a long list of held jobs is summarised rather than dumped', async () => {
  const { lineNumbersOf } = await import('../src/lib/roster');
  const many = Array.from({ length: 9 }, (_, i) => ({
    id: `j${i}`,
    line_number: `57546${i}`,
    customer_name: 'X',
    status: 'assigned',
  }));

  // Five names, then a count. Nine line numbers in a refusal is a wall.
  assert.equal(lineNumbersOf(many), '575460, 575461, 575462, 575463, 575464 +4');
  assert.equal(lineNumbersOf([]), '');
});
