# Perfection Programme — Audit & Step-by-Step Plan

> Status: **planning** · Branch `arena/a3c58180-telesom-ftth-f1-system` · Base `42b39b2` (all 5 phases merged)
> Rule: every batch ships independently, is verified (`tsc -b`, `npm run build`, tests, live DB where relevant) and lands as its own PR.

---

## 1. Audit — what the app is today

| Metric | Value |
| :--- | :--- |
| Source files / lines | 46 files · 13,457 lines |
| Largest files | `TeamAndCrewManager` 906 · `IngestWizard` 822 · `ExecutionSheet` 795 · `DispatchBoard` 602 · `Analytics` 576 |
| Database | 13 tables, 28 RPCs, 6 migrations |
| Tests | 79 hand-run assertions in `scripts/tmp/*` (not in CI, not committed) |
| Lint / format / CI | none |
| Code splitting | none — one bundle |
| PWA / offline | none |
| Error boundary / toasts | none |

### Findings by severity

**🔴 Blocking for production use**

1. **PIN brute-force is possible.** `authenticate_pin` has no attempt counter, delay or lockout. A 4-digit PIN plus the public anon key means the whole group can be opened in minutes from a script. (The anon key is inside the JS bundle by definition — that is normal; the missing guard is not.)
2. **All customer data is world-readable.** Policies are `FOR SELECT USING (true)` on `tasks`, `users`, `cablebox_logs`, `task_work_logs`, `dispatch_log`. Anyone with the anon key can read every customer name, phone number and address without logging in.
3. **Demo credentials on the login screen** (`handleQuickFillAndSignIn`) ship in the production build.
4. **No error boundary.** One thrown render — a malformed RPC payload, a null field — blanks the whole app with a white screen and the technician loses the route mid-shift.

**🟠 Undermines "professional"**

5. **Session never visibly expires.** Tokens last 14 days and expiry mid-shift surfaces as a raw Postgres message (`Invalid or expired session`) inside whatever form the technician is using, silently losing their typed notes.
6. **No toast/feedback layer.** Successes are silent; failures are inline red text in whichever component happened to call the RPC.
7. **i18n is partial and drifting.** 234 keys defined, 109 used; large screens (Team, Ingest, Login, Header) still hold English strings inline. `<html lang>` never changes; dates/numbers are unformatted.
8. **Viewport blocks pinch-zoom** (`maximum-scale=1.0, user-scalable=no`) — an accessibility failure, and iOS still zooms on <16px inputs anyway.

**🟡 Responsive & performance**

9. **No responsive tier above mobile.** Supervisor shell is a single 7xl column at every width; the technician shell is locked to `max-w-md` even on a tablet that could show two columns.
10. **Single 500 kB+ bundle; Tesseract loaded eagerly.** The OCR engine (WASM + worker, the heaviest thing in the app) is imported in the main chunk, so every technician on a 3G phone downloads it before they can see a job list.
11. **No code splitting, no lazy tabs, no virtualization.** Every tab's code loads for everyone.
12. **Polling instead of realtime.** Live strip polls every 30 s, route every 60 s, even though Supabase Realtime is already enabled.

**🟢 Feature gaps (each one is a "this isn't finished" moment)**

13. No way to **create or edit a cablebox** — the register only shows what the seed migrations inserted.
14. No **manual task** — a job that arrives by phone call cannot be entered.
15. No **reassign a single job / cancel / reopen** for the supervisor.
16. No **global search** across line, customer, phone or box.
17. No **audit view** — `dispatch_log` and `task_work_logs` are written but never shown.
18. **Offline not handled at all** — the field problem the app exists to solve.
19. No **app icon, favicon, manifest or install prompt**; the app looks unfinished in a phone's home screen.
20. **No CI** — regressions are caught only when someone opens the deployed app.

---

## 2. The plan — six batches, in this order

Each batch is a working, deployable PR. Order is deliberate: safety first, then security, then the visible polish, then speed, then new capability.

### Batch A — Foundation & safety net *(1 session)* — ✅ **shipped**
- `ErrorBoundary` per shell + a global one with "reload" and "report" affordances.
- **Toast system** (`sonner`-style, hand-rolled to stay dependency-free): every RPC success/failure speaks, in Somali or English.
- **Global offline banner** + connection-aware retry; `navigator.onLine` plus a real request probe.
- **Session-expiry handling**: any RPC returning an auth error drops to the login screen with a clear message, and the typed payload is preserved in `localStorage` until re-login.
- Remove the demo quick-fill accounts from production builds (kept behind `import.meta.env.DEV`).
- **Vitest + Testing Library** wired, `scripts/tmp` assertions promoted to real tests, `npm test`.
- **GitHub Action**: typecheck → test → build on every PR.
- Acceptance: no white screens; every action gives feedback; CI blocks a broken build.

**Shipped & verified (31/10/2026)**

| Check | Result |
| :--- | :--- |
| `tsc -b` | clean |
| `npm test` | **29/29** — errors, timers, dBm, ordering, CSV, reports, plus a real `renderToString` mount of the app shell, the login screen and the toast live region |
| `npm run build` | clean |
| Live DB write path | temp job 998101: start → block (clock banked) → resume → complete at −20.40 dBm; job and its logs deleted afterwards, `tasks` back to 8 real + 36 demo |
| Live DB read path | `box_directory` 2 boxes · `ops_analytics` 36 completed / 36 demo flagged · `report_jobs` 36 rows · `technician_route` 4 jobs for Crew A |
| Toast coverage | start, resume, block, complete, dispatch assign, return-to-pool, auto-plan, port change, import commit, import undo, demo seed/clear, CSV export, WhatsApp copy, PIN change |
| Error text | 30 catch sites now go through `describeError`, so no raw `ERROR: P0001 … CONTEXT: PL/pgSQL` can reach a screen |

**Residual items, honestly noted**

1. **GitHub Actions does not execute on this account** (a one-step `echo` workflow fails in 2 s with no steps run). `.github/workflows/ci.yml` is correct and will start working once Actions is enabled/billed; until then `npm run verify` is the gate and Vercel still builds every push.
2. **The demo account list is hidden in production but its strings remain in the bundle.** The render is gated by `DEV_BUILD` (false in prod) so no user ever sees it; full removal belongs with Batch B's credential hygiene.
3. `dispatchService` / `importer` still throw the raw Postgres message; every screen that displays it maps it through `describeError`, so the wording is clean, but those two modules should adopt `rpc()` when Batch B touches them.

### Batch B — Security & data integrity *(1–2 sessions)* — ⏸ **parked by owner**
- **PIN throttling**: `login_attempts` table, 5 failures → 15-minute lock per user *and* per IP-ish fingerprint, `Retry-After` surfaced in the UI, supervisor can unlock.
- **RPC-only data access**: replace the 14 direct `.from()` reads with token-checked RPCs, then **drop** the `USING (true)` policies on `tasks`, `users`, `cablebox_logs`, `task_work_logs`, `dispatch_log` so the anon key can read nothing on its own.
- **Session hygiene**: 30-day rolling expiry, revoke on PIN change, "sign out of all devices".
- **Input validation** shared between form and database (phone, line, dBm, port, box code).
- **Audit screen** (supervisor): dispatch history + per-job work log timeline with filters.
- Acceptance: a stolen anon key yields zero rows; five wrong PINs lock the account; every write is attributable.

### Batch C — Design system, responsive & accessibility *(2 sessions)*
- **Tokens + UI kit**: `Button`, `Card`, `Sheet` (focus-trap, drag-to-dismiss, safe-area), `Input`, `Select`, `Badge`, `EmptyState`, `Skeleton`, `Tabs`, `Stat`. Replace ~40 ad-hoc copies.
- **Responsive tiers**: phone (360–430) → tablet (768) → desktop (≥1024 with a supervisor sidebar and two-column route on tablets).
- Fix viewport zoom, add `apple-touch-icon`, favicon set, `manifest.webmanifest`, theme colours, `<html lang>` switching, print stylesheet for the dispatch plan.
- Accessibility pass: focus rings, 44 px targets, `aria-*` on every icon-only control, reduced-motion, contrast ≥ 4.5:1.
- Acceptance: usable at 360 px with one thumb; keyboard-navigable; Lighthouse a11y ≥ 95.

### Batch D — Performance *(1 session)*
- **Lazy-load Tesseract** — the OCR engine only downloads when the supervisor opens the picture wizard.
- Route/tab level `React.lazy` + skeletons; `manualChunks` for react / supabase / ocr.
- **Supabase Realtime** replacing polling: `live_status` on the dispatch board, assignment pushes on the technician route.
- Debounced search, memoised selectors, list windowing where lists can grow (jobs, incidents).
- Cache directory/analytics payloads with stale-while-revalidate so tab switches are instant.
- Acceptance: first load < 200 kB gzipped, TTI < 2 s on 3G, no poll loops when the tab is hidden.

### Batch E — Feature completeness *(2–3 sessions)*
- **Cablebox create/edit** (code, area, ports, OLT path, notes) with duplicate detection.
- **Manual task**: phone-in job, with customer, line, box, port, urgency, and full audit.
- **Job actions**: reassign, return to pool, cancel with reason, reopen a completed job.
- **Global search (⌘K / long-press)**: line, customer, phone, box → jump to job or box.
- **Notifications**: technician sees new assignments and blockers cleared; supervisor sees jobs blocked and running long.
- ~~**Offline queue + PWA**~~ — declined for now; the app stays online-only with a clear offline banner and local draft protection.
- Acceptance: everything the department does by phone call is possible in the app, and nobody ever loses typed work to a dead connection.

### Batch F — Language, copy & documentation *(1 session)*
- Full i18n sweep: zero hardcoded strings, plural rules, localised dates/numbers, unused keys removed.
- Consistent product voice, first-run hints, better empty states.
- Docs: `README` rewrite with screenshots-friendly structure, runbook (rotate PINs, add a group, restore data), known limits, architecture refresh.

---

## 3. Decisions (answered 31/10/2026)

| # | Question | Answer |
| :--- | :--- | :--- |
| 1 | Harden security fully? | **Deferred by the owner.** Batch B is parked, not cancelled — the risk is documented below and can be picked up at any time. |
| 2 | Offline queue + PWA? | **Not now.** The app stays online-only; Batch E drops the queue and keeps the *installable app* pieces (icons, manifest polish) that cost nothing. |
| 3 | Build order | **As written**: A → B → C → D → E → F. |
| 4 | Visual direction | **Keep the emerald/slate identity, refine it.** |

### Parked risk (Batch B)

Until Batch B runs, these remain true and should be treated as an accepted, documented risk:

* `authenticate_pin` has no attempt limit — a 4-digit PIN can be guessed by a script.
* `tasks`, `users`, `cablebox_logs`, `task_work_logs`, `dispatch_log` are readable by anyone holding the public anon key (which ships in the app bundle).

Neither is exploitable by a casual user of the app, but both matter the moment the system holds real customer data beyond the pilot group.

---

## 4. Definition of "perfect" for this app

- A technician can work a full shift on a mid-range Android phone with intermittent signal, never losing typed data, and never sees a raw database error.
- A supervisor can plan a day, dispatch it, watch it happen and report it, in Somali, without touching a spreadsheet.
- Nobody can read customer data without a valid PIN, and nobody can guess one.
- Every screen works at 360 px and at 1440 px, in both languages, with a keyboard and with a thumb.
- The build is small, split, and guarded by CI.

---

## 5. Interlude — production defect fix (31/10/2026, before Batch C)

Two defects were reported against the live Batch A build. Both were reproduced,
traced to their cause, and fixed in one PR; Batch C continues afterwards.

### 5.1 "Invalid API key" on the login screen

**Root cause.** The app preferred `import.meta.env.VITE_SUPABASE_ANON_KEY` over
its built-in key. A deployment-time value that had been pasted with a trailing
newline or surrounding quotes is a *valid* string but not a valid key, so
PostgREST answered `{"message":"Invalid API key"}` — in English, on the screen a
technician was using to sign in. The built-in key itself was verified byte-for-
byte against the project's live `anon` key.

**Fix.**

| Piece | Behaviour now |
| :--- | :--- |
| `src/lib/config.ts` (new, pure) | Trims, unquotes and de-`Bearer`s every pasted value, drops zero-width characters, validates URL shape, and accepts either a legacy `eyJ…` JWT or an `sb_publishable_…` key. A blank or malformed value is ignored rather than used. |
| `src/lib/supabase.ts` | Reads the environment through Vite's static replacement (the previous dynamic access could miss it), builds the client through a proxy so it can be rebuilt, and exposes `probeSupabase()`. |
| Boot probe | Asks `GET /rest/v1/` — the one endpoint that checks the key without touching a table or an RLS policy. If an *environment* key is rejected by 401/403, the app rebuilds on the built-in key and carries on; if that also fails it shows the configuration card. An unreachable server is treated as a network problem, never as a broken build. |
| `src/components/ui/ConfigErrorScreen.tsx` | Bilingual, states "this is not a PIN error", shows the project, the masked key, its source and the probe status, gives the Vercel fix steps, a retry button and copyable diagnostics. The key itself is never rendered. |
| `src/lib/errors.ts` | New `config` error kind with a rule for `Invalid API key`, `No API key found`, `JWT signature verification failed`, etc. Raw gateway text can no longer reach a screen, and it is never mistaken for an expired session (which would have caused a sign-out loop). |

### 5.2 A technician login opened the supervisor screens

**Root cause.** Sessions were never partitioned. One `localStorage` key held a
bare token, `verify_session` was trusted blindly, and `refreshSession()` had no
guard against a stale restore landing after a fresh sign-in. On a shared field
phone — or with two tabs open — the last login won, and the previous person's
role decided which shell opened. The header identity chip was `hidden md:flex`,
so on a phone there was no visible sign of *who* was signed in.

**Fix.**

* `src/lib/session.ts` (new, pure): the saved record now carries `token`,
  `userId`, `role`, `username` and `savedAt`. A record without an owner can
  never be restored, and the pre-v2 key is deleted on boot rather than migrated.
* The restored session is accepted only when `verify_session` confirms the same
  user **and** the same role (`diffSession`). A mismatch revokes the token
  server-side, clears the record and returns to the login screen with a notice.
* Every sign-in / sign-out / expiry bumps a generation counter. An in-flight
  restore compares it before touching state, so it can no longer overwrite a
  newer login.
* A login always revokes the previous token first and clears local state first;
  a sign-out clears locally before the network call.
* A `storage` event from another tab that belongs to a different person signs
  this tab out instead of silently switching who the app thinks it is.
* The header now has a phone row that always shows initials, full name and role,
  next to Change PIN and Sign out (`md` and up keeps the single-row layout).
* `App.tsx` opens the shell from `portal`, derived from the session's own role.

### 5.3 Two server defects found while investigating

Migration `007_session_and_health_fixes.sql` (applied and verified live):

1. `complete_task` wrote the wrong box health: its `CASE` compared
   `last_optical_dbm` — the field the same statement was about to overwrite — so
   the reading from the job that had just finished was ignored. A brand-new box
   measured at `-31 dBm` stayed `healthy`. The function now calls
   `recompute_box_state`, the single definition used by the registry.
2. `authenticate_pin` selected the user with `LIMIT 1` and **no `ORDER BY`**, so
   an identifier that matched more than one row returned whichever row Postgres
   read first. It now prefers an exact username, then exact phone digits, then
   the last-7-digit fallback, with a deterministic tie-break.

### 5.4 Verification

| Check | Result |
| :--- | :--- |
| `tsc -b` | clean |
| `npm test` | **56 / 56** (was 29; +27 for config, session ownership and the probe table) |
| `npm run build` | passes; bundle contains the sanitised env path and the built-in fallback |
| Live `authenticate_pin` | `cabdi` → technician, `634100101` → cabdi, `supervisor` → supervisor |
| Live `complete_task` (+007) | brand-new box, first reading `-31.0 dBm` → `warning` (previously stayed `healthy`); FAT48 logged `-31.50` |
| Cleanup | probe task/box/logs/sessions removed; **8 real + 36 demo tasks**, 2 boxes, 0 leftovers |

**Still for the owner:** if `VITE_SUPABASE_ANON_KEY` is set in Vercel, correct or
delete it and redeploy. `src/lib/config.ts` now recovers from a bad value, but
the deployment should not carry one.

### 5.5 Correction (31/10/2026, same day) — the health check was the false alarm

The first build of the configuration card blocked a **working** deployment:
it reported `health: bad-key`, `status 401`, `key source: built-in default`.

**Cause.** `probeSupabase()` asked the PostgREST root document (`GET /rest/v1/`)
whether the key was accepted. Supabase restricts that document to `service_role`
and answers a perfectly valid anon key with:

```json
{"message":"Invalid API key","hint":"Only the `service_role` API key can be used for this endpoint."}
```

The probe read a 401 plus the words "Invalid API key" and declared the project
broken. Proven directly against the live project:

| Request | Result |
| :--- | :--- |
| `GET /rest/v1/` + valid anon key | `401 {"message":"Invalid API key", "hint":"Only the service_role API key…"}` |
| `GET /rest/v1/groups?select=code` + the same key | `200 [{"code":"F1"},{"code":"F2"}]` |

**Fix.**

* The probe now performs the same ordinary read the app performs on mount
  (`groups?select=code&limit=1`) — an endpoint the anon key is entitled to.
* Classification is by **body**, not status: only the gateway's real key errors
  (`Invalid API key`, `No API key found`, `JWT signature…`) count as a bad key.
  A 401/403 for authorisation, a 400 from an RPC, or a 5xx outage all mean "the
  key reached PostgREST" and never replace the app.
* The card gained **Continue anyway**: no check may ever trap a working
  deployment behind a screen.
* Regression tests: 401 + `permission denied`, 403 + RLS, 400 + PGRST error and
  502 must all report healthy; only the key-error bodies may block.

Lesson recorded for the remaining batches: a synthetic health probe may only
assert what the app itself is entitled to do, and it must never be the sole
authority on whether the app works.

---

## 6. Batch C — design system, responsive & accessibility (first half, 31/10/2026)

### What shipped

| Area | Change |
| :--- | :--- |
| **UI kit** (`src/components/ui/`) | `Button` (6 variants, 5 sizes; `md`/`icon` are 44 px), `Card` + `CardHeader`, `Badge` (6 tones, dot, solid), `Input` / `Select` / `Textarea` with label→control→hint/error wiring, `EmptyState`, `Skeleton` / `SkeletonCard` / `SkeletonList`, `Tabs`, `Stat`, `Sheet`. |
| **Tabs** | Real ARIA tabs: `role="tablist"`, `aria-selected`, `aria-controls`, roving tabindex, Arrow/Home/End navigation, two shapes (`pills` for modules, `bar` for tablet navigation). |
| **Sheet** | Modal dialog with focus trap, focus restore, Escape, backdrop close, body scroll lock, safe-area padding, and a drag-to-dismiss handle on touch. |
| **Supervisor shell** | ≥1024 px gets a real sticky sidebar (brand, modules, group); below that the pill strip stays, because a thumb should not have to cross a wide screen. KPIs are now `Stat` cards; the open-tasks card jumps to dispatch. |
| **Technician shell** | No longer locked to `max-w-md`. Tablets get a two-column layout — route in the main column, crew context and the running pill in a sticky rail — with segmented tabs at the top instead of a bar under the thumb. Phones keep the bottom bar, now safe-area aware with ≥44 px targets and `aria-current`. |
| **Install identity** | Generated PNG icon set from a dependency-free writer (`scripts/generate-icons.mjs`): 192, 512, maskable 512, Apple 180, plus a refreshed `favicon.svg`, a real `manifest.webmanifest`, and the links/theme colours in `index.html`. |
| **Print** | `@page` margins, navigation/controls hidden, `break-inside: avoid` blocks, `.print-keep` for the rare control that must survive, and no printed link URLs. |
| **Accessibility** | Labels bound by id, `aria-invalid` + `role="alert"` on field errors, `aria-busy` on async buttons, decorative icons `aria-hidden`, `aria-current` on navigation, focus-visible ring retained, reduced-motion honoured. |
| **Tests** | **71 / 71** (was 59): the kit's a11y contract (roles, aria, 44 px default size, label wiring) and an asset-integrity test that fails if the manifest points at a missing or wrong-size icon. |

### Deliberately left for the second half of Batch C

* The kit is adopted in the **shells, login and navigation**; the feature screens
  (`DispatchBoard`, `IngestWizard`, `BoxRegistry`, `Analytics`,
  `TeamAndCrewManager`) still carry their own card/button/empty-state copies.
  Replacing those is mechanical but touches ~30 files and should be done with the
  same feature-by-feature review the earlier phases used.
* Lighthouse ≥ 95 needs a real browser run (no headless browser in this
  environment); the structural work that score depends on — labels, roles, target
  sizes, contrast tokens, reduced motion — is in place.
* A contrast sweep of the remaining amber-on-white and emerald-on-emerald-tint
  pairs in feature screens.

Recorded once, applies to every later batch: **derived UI is a bug**. Anything a
screen renders twice (a status colour, a button size, a dialog shell) belongs in
the kit, not in the screen.

---

## 7. Batch C — second half: feature screens on the kit + contrast sweep (31/10/2026)

### New in the kit

| Component | Why |
| :--- | :--- |
| `Alert` | Five tones (info / success / warning / note / danger) replacing **22 hand-rolled banners** across six files; `danger`/`warning` are `role="alert"`, the rest `role="status"`, and it carries an optional action and a named dismiss button. |
| `Input.leadingIcon` | Search fields stop hand-positioning an icon behind an `<input>`. |

### Screens migrated

* **`BoxRegistry`** — header, refresh, search, filters (now `Tabs`, with counts), alerts, a six-card skeleton instead of a spinner, an empty state that explains *why* it is empty and offers **Clear filters**, and health/chronic/live chips as `Badge`.
* **`DispatchBoard`** — hero actions and the sticky assign bar are `Button`s (busy spinner handled by the component), the pool search is `Input`, the urgent/all filter is `Tabs`, both empty states are `EmptyState` with a next step, the error banner is an `Alert`, the loading state is a skeleton that matches the board's shape, and **the assign-to modal is now `Sheet`** (focus trap, Escape, scroll lock, swipe-to-dismiss).
* **`ClusterPlanSheet`** — rebuilt on `Sheet` with a sticky footer; the empty plan is an `EmptyState`.
* **`Analytics`** — alerts, demo-data actions and the two export buttons on the kit; a KPI + chart skeleton replaces the centred spinner.
* **`IngestWizard`, `ExtractionReview`, `RouteView`** — banners are `Alert`s (the ingest conflict screen now has a titled info alert).

### Contrast and legibility sweep

| Before | After | Why |
| :--- | :--- | :--- |
| `text-slate-400` ×87 | `text-slate-500` | 2.8:1 → **4.76:1** on white (AA for normal text) |
| `text-slate-300` (controls, glyphs) | `text-slate-500` / `text-slate-200` on dark | 1.9:1 was invisible for a control |
| `text-[9px]` ×23 | `text-[10px]` | legibility floor on a 360 px screen |
| `text-emerald-500/70`, `…-300/60` on the dark screen | `text-emerald-300/80`, `…-200` | small text on deep emerald |

### Accessibility fixes found by the new lint

Four icon-only close buttons (`BoxSheet`, `ClusterPlanSheet`, `DispatchMessageSheet`, `ExecutionSheet`) had no accessible name — a screen reader read them as "button". All now carry `aria-label`/`title` and `aria-hidden` icons.

### The design lint

`tests/design.test.ts` fails the build gate on:

* any `text-slate-300` / `text-slate-400` in `src/components`;
* any font size below 10 px;
* an icon-only `<button>` without `aria-label`/`title`.

It found the four unnamed close buttons the moment it was written, which is the argument for keeping it.

### Verification

`tsc -b` clean · **78 / 78 tests** (was 71) · production build OK · every migrated module serves 200.

### Still outstanding in Batch C (recorded, not hidden)

* `DispatchMessageSheet` (the WhatsApp/Telegram composer) and `BoxSheet` /
  `ExecutionSheet` keep their own modal chrome. They are candidates for `Sheet`
  next time the dispatch composer is touched — the composer has a bespoke
  preview pane that deserves its own review rather than a mechanical swap.
* Lighthouse ≥ 95 needs a browser run; this environment has no headless browser.

---

## 8. Batch D — performance (31/10/2026)

### The number that started it

| Before | After | Budget |
| :--- | :--- | :--- |
| **208.6 kB gzip** in one chunk, downloaded before the login screen | **172.3 kB gzip** across six cached chunks | < 200 kB |

The app chunk itself went from **208.6 kB to 27.4 kB gzip** — the other 145 kB is
React, Supabase and the icon set, which now live in their own long-lived chunks
that a deploy does not invalidate.

### What changed

| Area | Change |
| :--- | :--- |
| **Bundle shape** (`vite.config.ts`) | `manualChunks` separates `react`, `supabase`, `icons`, `vendor`; `chunkSizeWarningLimit` lowered to 400 kB so an unsplit screen warns instead of hiding. |
| **Lazy screens** | Every supervisor module (`DispatchBoard`, `IngestWizard`, `Analytics`, `TeamAndCrewManager`, `BoxRegistry`) and both technician screens (`RouteView`, registry) are `React.lazy`. `LazyPanel` wraps them in `Suspense` with a fallback that repeats the shape of the coming screen (`board`, `wizard`, `rows`, `cards`), so nothing jumps. |
| **Prefetch on intent** | `src/lib/preload.ts` maps each module to its loader. Hovering, focusing or touching a tab downloads its chunk before the tap lands, so the fallback is rarely seen. The technician's route is warmed as soon as they sign in. |
| **Realtime instead of polling** | `src/lib/realtime.ts`: `useTableChanges()` subscribes to `postgres_changes` on `tasks` (already in the `supabase_realtime` publication), **debounced** so a 8-job dispatch is one refetch. Wired into the dispatch board, the live strip, the technician route and the running pill. |
| **No hidden-tab work** | `useVisibleInterval()` replaces every bare `setInterval`: the fallback poll (now 3 minutes instead of 30–60 s) only runs while the tab is visible, and `useNow` stops ticking when the tab is hidden. |
| **Instant tab switches** | `src/lib/cache.ts` — stale-while-revalidate keyed by group and window, seeded into `useState` so the registry and analytics paint from the last payload and revalidate behind it. Mutations (`set_port_status`, seed/clear demo) invalidate the affected families. |
| **Debounced search** | The dispatch pool filters on a 200 ms-debounced query; the input itself still echoes every keystroke. |

### The budget is now enforced

`scripts/check-bundle.mjs` reads the built `dist/index.html`, sums the gzip size
of every asset a first visit loads, and **fails the build over 200 kB**. It is
part of `npm run verify`, so the acceptance criterion cannot silently regress.

`tests/performance.test.ts` pins the structure that keeps it fast: the OCR
engine only reached through dynamic import, shells using `React.lazy`, no bare
`setInterval` in the live screens, and the vendor split present in the config.

### Verification

| Check | Result |
| :--- | :--- |
| `tsc -b` | clean |
| `npm test` | **90 / 90** (was 78) |
| `npm run build` | 4.5 s |
| `npm run bundle:check` | **172.3 kB / 200 kB** ✓ |
| Dev server | every lazy module transforms and serves 200 |

### What this batch did *not* prove

* **Live Realtime delivery was not observed.** The sandbox has no outbound HTTP
  or WebSocket to Supabase (`ECONNRESET`), so the subscription is verified
  structurally — `tasks` is in the publication, its SELECT policy is `true` for
  the anon role, and the hook is wired — but a real technician's phone is the
  first place an end-to-end push will be seen. The 3-minute visible-tab fallback
  exists precisely so a broken socket degrades to slow-but-correct.
* **TTI on 3G was not measured**; there is no headless browser here. The
  payload that determines it is now inside budget and split.
* **List windowing was not needed yet.** The pools and routes are tens of rows;
  the debounce and memoised selectors are the cheap wins. Revisit when a group
  carries hundreds of open jobs.

### New risk recorded (Batch B is still parked)

Realtime now streams `tasks` rows to any client subscribed with the public anon
key. That is the *same data* the REST API already exposes under `USING (true)`,
but it is a second delivery path and should be part of the Batch B hardening
decision — ideally the policy becomes group-scoped and the realtime filter
follows it.

---

## §8.1 Batch D hotfix — the dispatch tab crashed on open

**Reported:** opening *Dispatch & clustering* in production showed the crash
card instead of the board, with:

```
cannot add `postgres_changes` callbacks for
realtime:changes:tasks:group_id=eq.218e78f7-4d18-4839-a061-5a03e6d3946e
after `subscribe()`.
```

### Root cause

`supabase.channel(topic)` **de-duplicates by topic** — in
`@supabase/realtime-js` it looks the topic up in `getChannels()` and returns the
existing channel object:

```js
channel(topic, params = { config: {} }) {
  const realtimeTopic = `realtime:${topic}`;
  const exists = this.getChannels().find((c) => c.topic === realtimeTopic);
  if (!exists) { /* create */ } else { return exists; }
}
```

Batch D named channels after their table and filter,
`changes:tasks:group_id=eq.<uuid>`. `DispatchBoard` and `LiveStrip` sit on the
same screen and watch the same table with the same group filter, so the second
hook received the **already-subscribed** channel and its `.on('postgres_changes')`
threw (`RealtimeChannel.on` refuses to add callbacks after `subscribe()`). The
throw happened inside `useEffect`, so React replaced the screen with the error
boundary. The technician shell had the identical collision in `RouteView` and
`RunningPill`.

It was also worse than a visible crash: `supabase.removeChannel()` on the shared
channel would have let whichever hook unmounted first **silently kill the
other's stream**.

Reproduced with the real library, no network required (channel de-duplication
happens before any socket opens):

```
same object for same topic: true
first subscribe: ok
second .on() threw: cannot add `postgres_changes` callbacks for
  realtime:changes:tasks:group_id=eq.218e78f7 after `subscribe()`.
unique-topic subscribe: ok
```

### Fix

* **A unique topic per subscription** — `tableChannelTopic(table, filter)` appends
  a module counter (`f1:tasks:group_id=218e78f7…:3`). Channels multiplex over one
  socket, so the extra topic costs nothing, and an isolated channel cannot be
  torn down by a neighbour.
* **`subscribeTableChanges()` never throws.** If the client rejects the
  subscription, the helper logs once and returns `null`; the screen keeps its
  3-minute visible-tab fallback poll. A live feed is an optimisation, never a
  single point of failure for a technician standing in front of a screen.
* **Containment.** `LazyPanel` now wraps every on-demand screen in its own
  compact `ErrorBoundary`, so a failure replaces *that panel* (with retry) instead
  of the whole supervisor shell and its navigation.

### Proof

`tests/realtime.test.ts` (7 tests) drives a fake client that is a **verbatim copy
of the library's contract** — same-topic de-duplication and the `on()`-after-
`subscribe()` throw — and first asserts that the fake *does* reproduce the crash,
so the regression test cannot pass vacuously. It then pins: unique topics, both
dispatch hooks subscribing, callback-before-subscribe ordering, one unsubscribe
leaving its neighbour streaming, and a throwing client returning `null`.

`tests/ui.test.tsx` adds the containment guard (a crashed panel renders the
labelled bilingual fallback; `LazyPanel` keeps its own boundary).

**Gate:** `tsc` clean · **99 / 99** tests · build 4.0 s · **172.5 kB / 200 kB**.

### Lesson recorded

Anything that subscribes must be named **per subscriber**, not per logical
stream, because the library treats the topic as the identity of the channel.
Any future realtime work (Batch E notifications, live technician presence) uses
`useTableChanges` / `subscribeTableChanges` — never `supabase.channel()` directly.

---

## §9 Batch E — the work that used to happen on a phone call

Batch E was scoped as "everything the department does by phone call is possible
in the app". Five features, one data-model change, one migration pair.

### 9.1 A cancelled job is a real state, not a deleted row

`tasks.status` gained **`cancelled`**, with `cancelled_at`, `cancelled_by` and a
required `cancel_reason`. A cancelled job also carries `source` (`sheet` |
`manual`), `created_by`, `intake_notes`, `reopened_count` and `last_reopened_at`.

Two deliberate decisions:

* **Deleting was never an option.** A cancelled job must still explain itself
  months later: who cancelled it, when, and why. Analytics exclude it by asking
  for `status = 'completed'` explicitly, so the efficiency numbers do not move.
* **`cancelled` is final in the database, not in the UI.** `assign_tasks`,
  `start_task`, `complete_task` and `unassign_tasks` all guard against
  `completed` but knew nothing about `cancelled` — a stale phone could have
  restarted cancelled work. Rather than redefine four functions (and every
  future one), a `BEFORE UPDATE` trigger refuses any move out of `cancelled`
  unless the caller is `reopen_task`, which sets a transaction-local flag:

  ```sql
  IF OLD.status = 'cancelled' AND NEW.status <> 'cancelled'
     AND current_setting('f1.allow_reopen', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'This job was cancelled. Reopen it before working on it again.';
  ```

**The consequence nobody would notice until it bit them:** the app used
`.neq('status', 'completed')` to mean "open work" in two places. With a third
terminal state that silently pulls cancelled jobs back into the dispatch pool and
the overview KPI. Both now ask for `OPEN_TASK_STATUSES` explicitly, and the
importer was fixed too — a line whose previous job was *cancelled* must be able
to import as fresh work instead of being swallowed as "already open". All three
are pinned by tests.

### 9.2 Registering a box (`upsert_cablebox`)

Register or edit a box — code, area, OLT path, port count, location notes — from
the field. Duplicate detection is the point:

* the code is normalised exactly like the importer (`fat 48` → `FAT 48`), so the
  form and the sheet agree about identity;
* creating a code that already exists returns `{ ok: false, reason: 'duplicate',
  box }` instead of a unique-constraint error, and the screen offers *open the
  existing box* rather than creating a twin;
* **a code owned by another group is a different answer.** Box codes are
  department-unique, so offering "open it" would land the person on a 403; the
  sheet says so and asks for a different code;
* **shrinking a box is refused while any port above the new count is occupied,
  damaged or reserved** — otherwise a customer's line silently disappears.

Every create and edit writes a `note` row into `cablebox_logs`, so a box's
history includes who changed its details.

### 9.3 The phone call (`create_manual_task`)

Line, customer, phone, area, box, port, type, urgency, what the caller said, and
an optional immediate assignment — one form, one transaction, one audit trail
(`imported` + `assigned` work-log rows, `source = 'manual'`, `created_by`).

The importer's duplicate rule carries over: if the line already has an open job,
the RPC returns it and the supervisor must confirm before a second one is
created. A port that does not exist on the box is rejected with the box's real
port count rather than silently stored.

### 9.4 Corrections (`cancel_task`, `reopen_task`)

* **Cancel** requires a reason (≥3 characters). If the job was running, the
  elapsed time is folded into `accumulated_seconds` before the clock stops, so
  time already spent on site is not erased.
* **Reopen** works from `completed` or `cancelled`, keeps the technician or crew,
  resets the timer for the new visit, and writes the previous reading, previous
  duration and reason into the work log. `reopened_count` makes a job that keeps
  coming back visible.
* Both are reachable from the dispatch board's per-job menu — including for jobs
  that are no longer on the board, because the sheet fetches the job by id.

### 9.5 Global search (`global_search`)

One query across line numbers, customer names, phone numbers (digits are
normalised, so `063 470` finds `063470…`), cablebox codes and areas — with the
database ranking an exact line number first, then a prefix, then a phone match.
A single character is refused: it matches half the group.

Reachable from a visible **Search** button (phone and desktop), `⌘K`/`Ctrl-K`,
and `/` when not already typing. **Deviation from the plan:** the plan said
"⌘K / long-press". A long-press is invisible and undiscoverable in a tool that
technicians learn in five minutes; a 44 px button in the header is not. The
keyboard shortcuts are kept for the desk.

Picking a result is a real navigation: `NavigationProvider` carries a named
destination plus the object, the shells consume it, and the screen that owns the
job or box opens it. If a technician searches a job that is not on their route,
they are told so instead of tapping a button that does nothing.

### 9.6 Notifications (derived, never stored)

A bell in the header, with two different definitions of "needs you":

* **Technician** — work assigned after they last looked, and blockers that
  cleared (`task_work_logs.action = 'resumed'` after the same moment). A job
  that was resumed and blocked again is **not** reported as cleared; that is a
  test, because the first version got it wrong.
* **Supervisor** — jobs currently blocked, and jobs running longer than two
  hours.

There is no notifications table. Everything is derived from the jobs the app
already has, so it cannot drift out of sync with reality, and there is nothing
to clean up. "Seen" is per device and per person in `localStorage`.

One subtlety worth recording: the badge baseline and the list baseline are two
different clocks. Opening the bell marks items seen (the badge clears) but
freezes the list against the *previous* baseline, so the list does not empty
itself in front of the person who just opened it.

### 9.7 Verification

The database was exercised live, inside a transaction that was rolled back:

| Probe | Result |
| :--- | :--- |
| create box `zz test box` | `ok: true`, stored as `ZZ TEST BOX` |
| create the same code again | `ok: false, reason: 'duplicate'` + the existing box |
| edit 8 → 12 ports | `ok: true, reason: 'updated'` |
| shrink to 8 with port 11 occupied | refused: "1 port(s) above that are in use" |
| phone-in job with box + port 3 + technician | created, `status: assigned`, urgent |
| same line again | `ok: false, reason: 'duplicate'` |
| same line, confirmed | created |
| port 24 on a 12-port box | refused: "has only 12 ports" |
| cancel with a blank reason | refused |
| cancel with a reason | `status: cancelled`, duration folded |
| direct `UPDATE … status='assigned'` on it | refused by the trigger |
| `assign_tasks` on it | refused by the trigger |
| reopen | `status: assigned`, `reopened_count: 1` |
| search `999001` / `634700000` / `zz test` | found, ranked 0 / 2 / box |
| search `9` | empty (too short) |
| technician route after cancelling | cancelled job absent |

Then, in the repo:

| Check | Result |
| :--- | :--- |
| `tsc -b` | clean |
| `npm test` | **121 / 121** (was 101) |
| `npm run build` | 6.3 s |
| `npm run bundle:check` | **180.2 kB / 200 kB** |
| Dev server | all 14 new/changed modules transform and serve 200 |

New tests: `tests/ops.test.ts` (20) covers box validation and normalisation,
phone-in validation and payload shape, cancel-reason wording, notification
construction for both roles, search thresholds, and structural guards for the
three "cancelled leaks back into open work" paths.
`tests/design.test.ts` caught three 9 px labels in the new header UI, which were
fixed rather than exempted.

### 9.8 What this batch deliberately did not do

* **Offline queue** — still declined by the user. The app remains online-only
  with the offline banner and draft protection from Batch A.
* **Bulk box import from a spreadsheet** — registering from the field is the
  need; a CSV of boxes is a different feature with a different duplicate story.
* **A notifications table / push** — derived notifications are enough for a group
  of five to ten people, and cannot go stale.
* **Windowing long lists** — still unnecessary; the pools are tens of rows.

### 9.9 New risk recorded

`global_search` returns any job in the group to any signed-in user of that group,
because that is what the existing `tasks` SELECT policy already allows. A
technician searching a line they do not own will see the customer name and
phone. This is the same exposure Batch B was parked for, now with a more
convenient door; the fix remains the same (group- and role-scoped RLS plus a
search policy), and it is recorded here rather than silently shipped.
