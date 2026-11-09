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

---

## §10 Batch F — the app speaks both languages, and says what it means (31/10/2026)

Batch F was the last batch in the programme, and the least glamorous: no new
capability, no new screen. It fixes the class of defect that never shows up in a
demo — the button that says *"Close"* in the English build and *"Close"* in the
Somali one, the date that reads `10/31/2026` on a supervisor's phone because the
browser was in en-US, the count that says *"4 shaqooyin"* when Somali takes the
singular after a numeral.

None of those break the app. All of them make a field team trust it less. The
goal was that a Somali-speaking technician never meets a word they cannot read,
and a supervisor never meets a date they have to reinterpret.

### 10.1 What was actually wrong

An audit script over the real sources, not over the dictionary, found three
separate problems:

| Problem | Count before | Count after |
| :--- | ---: | ---: |
| Keys present in one language only | 0 | 0 (enforced by test) |
| Keys defined but never used | 17 | 0 |
| Single-language literals in screens | 41 | 13, all allowlisted with a reason |

The 41 were not decorative. They were `aria-label="Close"` on the sheet
dismiss, `title="Close"` on three different modals, `alt` text on extracted
sheet thumbnails, the `↑ ↓` keyboard hint in the header, `Backspace` under the
PIN keypad, ten strings in `TeamAndCrewManager` including the crew-activation
dialog, and the supervisor status line that read `SUPABASE LIVE • VERCEL READY`
— infrastructure vocabulary that means nothing to the person reading it, and
that was in English only.

Separately, dates, numbers, durations and plurals were hand-rolled in twelve
components. That produces four different date formats in one app and no single
place to fix them.

### 10.2 One dictionary, one formatter

`src/lib/i18n.tsx` is still the dictionary — 132 keys in each language, typed,
so a missing translation is a compile error rather than an `undefined` on
screen. Three things were added or tightened:

* `t(key, vars)` now interpolates `{placeholder}` values, so
  `t('assignedTechnicians', { names })` is one whole sentence in each language
  instead of concatenated fragments that only read correctly in English.
* `useLanguageSafe()` — a non-throwing variant for primitives (`Sheet`, `Toast`)
  that can be rendered by a test or a story outside the provider. Screens still
  use the throwing `useLanguage()`, because a screen that cannot find its
  language is a bug worth crashing on in development.
* Fourteen dead keys deleted. Three keys that *looked* dead
  (`dispatchPlanReasonZone`, `dispatchPlanReasonBox`, `dispatchPlanReasonBalance`)
  were kept and are load-bearing: they are reached through
  `REASON_KEY[row.reason]`, not through a literal `t('…')`. The lint now matches
  the key name anywhere in the source outside the dictionary, which is the only
  way to see them.

`src/lib/format.ts` is new and is now the only place a date, number, duration or
plural is decided:

| Function | Output |
| :--- | :--- |
| `formatDate('2026-10-31')` | `31/10/2026` — day first, always |
| `formatDateLong('2026-10-31', 'so')` | `31 Oktoobar 2026` |
| `formatDateTime(stamp, 'en')` | `31 Oct 2026 · 14:05` |
| `formatDateWithWeekday('2026-10-31', 'so')` | `Sabti 31/10/2026` |
| `todayKey()` | the **local** calendar day, never `toISOString().slice(0,10)` |
| `formatNumber(1234.5, 1)` | `1,234.5` |
| `formatDbm(-18.75)` | `-18.8 dBm` |
| `formatDuration(3900)` | `1h 05m` |
| `countLabel(4, 'jobs', 'so')` | `4 shaqo` |

The plural rule is the one worth writing down: **English has one and other;
Somali takes the singular after any numeral.** `1 shaqo`, `4 shaqo` — never
`shaqooyin`. Getting this wrong is the most visible way a translated app reads
as machine-translated, and it was wrong in the earlier hand-rolled counts.

`todayKey()` exists because of a real bug class, not a preference. A job started
at 22:30 in Hargeisa is already the next day in UTC; filing it under the UTC
date puts a technician's evening work on tomorrow's report.

### 10.3 The language contract is now a test

`tests/i18n.test.ts` (15 tests) walks the real `src` tree and asserts:

1. every key exists in both languages;
2. the same `{placeholder}` names appear in both languages;
3. no key is dead weight (name matched anywhere outside the dictionary);
4. no key is defined twice inside a block;
5. no screen ships copy in only one language — unless it is in
   `COPY_ALLOWLIST`, and every entry there carries a comment saying why.

The allowlist is deliberately short and boring: brand names (`Telesom FTTH`,
`TELESOM FBB`, `Group F1`), the two sheet categories as they are printed on the
sheets (`Galinta`, `Cilada`), and example values that are data rather than copy
(`FAT 48`, `F1 - Crew A`, `Gaadhi 01`). Anything else has to be translated.

This is the difference between "we did an i18n pass" and "the app cannot drift
back". A new hardcoded English string now fails `npm test` on the way in.

### 10.4 Being told once, where it matters

A first-run hint (`src/components/ui/FirstRunHint.tsx`) is a small card that
explains the one non-obvious thing on a screen, then never comes back:

| Screen | What it says, once |
| :--- | :--- |
| Dispatch board | how jobs get from the pool into a crew's route |
| Technician route | that the timer is the record of the visit, not a stopwatch |
| Box registry | that history is per box and per port for the whole group |

It is stored per user (`telesom_f1_hint_${userId}_${id}`), so a shared garage
handset does not show a supervisor's hint to a technician, and dismissal is
final rather than "for this session".

### 10.5 Documentation that answers the 3 a.m. questions

Three documents, written for the people who will actually be on the phone:

* **`docs/RUNBOOK.md`** — rotating PINs, adding a group (F2 and beyond),
  restoring data, what to do when a technician cannot sign in. Procedures, with
  the SQL and the exact screen names.
* **`docs/KNOWN_LIMITS.md`** — the honest list: online-only, OCR misreads,
  `global_search` exposure (Batch B), one Supabase project, browser-based OCR
  cost on a low-end phone.
* **`README.md`** — rewritten opening: what the app is, who uses it, the five
  modules, then a "read this next" route into the runbook and the architecture
  document, and a corrected project structure.
* **`docs/ARCHITECTURE_AND_PLAN.md` §5** — "architecture as built", replacing
  what was planned in Phase 1 with what actually exists after five phases and
  six batches.

### 10.6 Verification

| Check | Result |
| :--- | :--- |
| `tsc -b` | clean |
| `npm test` | **136 / 136** (was 121) |
| `npm run build` | 3.7 s |
| `npm run bundle:check` | **181.4 kB / 200 kB** gzip first load (+1.2 kB for hints and the format module) |
| Dev server | all changed modules transform and serve 200; `/` returns the app shell |

The bundle grew by 1.2 kB to buy a shared formatter and three hints — the only
place in the programme where a batch does not pay for itself in bytes, and worth
stating plainly rather than hiding.

### 10.7 Where this batch deviated from the plan

* **Empty states** — the plan called for "better empty states" everywhere. An
  audit found only three screens that render a real `EmptyState`, and both
  `RouteView` and `Analytics` already have adequate inline copy plus the demo
  banner. Nothing was rewritten for the sake of a checklist item. Recorded as a
  decision, not as work done.
* **Product voice** — no wholesale copy rewrite. The screens' existing wording
  is the field team's wording; the batch fixed contradictions and
  infrastructure language (the `SUPABASE LIVE` line) and left the rest alone.
* **No visual redesign** — per the user's decision, emerald/slate stays. This
  batch touched colour nowhere.

### 10.8 What is still open after the programme

* **Batch B (security hardening) stays parked** by the user's decision. The
  `global_search` exposure and the group-wide `tasks` SELECT policy are
  documented in `docs/KNOWN_LIMITS.md`, not fixed.
* **Offline** stays declined; the app is online-only with draft protection.
* **OCR accuracy** is bounded by the photos the group chat produces. Demo data
  is marked and one-tap removable, so a bad read is recoverable.

The programme is complete at F. Every batch the user approved is merged and
live; the only unbuilt work is the one they explicitly deferred.

### §10.9 Follow-up — what the live page caught that the test did not

Batch F was merged, deployed, and then I opened production and read it like a
user instead of reading it like a diff. Three strings on the login screen were
still English in the Somali build:

| Where | What | Why the lint missed it |
| :--- | :--- | :--- |
| PIN label row | `4–6 digits` | starts with a digit, so the "at least two words" rule did not match |
| Login footer | `Telesom Fixed Broadband Department • Group F1 Field System` | the sentence is on its own line, wrapped between tags on other lines |
| Dev-build card | `Dev build only · not shipped to production` | same multi-line reason (dev-only, but the same defect) |

The root cause was the lint working line by line, and only trusting sentences
that begin with a capital letter. Both are artefacts of convenience, not of the
rule the app actually has.

The lint now strips comments from the whole file and scans `>…<` across line
breaks, judging a candidate by its shape rather than its first character. It was
proved by mutation: putting the English footer back makes the suite fail with
the offending line named, and removing it makes the suite pass.

The same pass found a copy inconsistency that no test could catch: the PIN label
said **"4-Digit Security PIN"** while the hint beside it said **"4–6 digits"**.
The label is now `Security PIN` / `PIN-ka Sirta ah`, and the range lives in one
place, `pinHint`.

Files: `src/lib/i18n.tsx` (`pinHint`, `deptFooter`, `devBuildNote`),
`LoginScreen.tsx`, `ConfigErrorScreen.tsx`, `tests/i18n.test.ts`.
`BILINGUAL_BY_DESIGN` has exactly one entry — the crash card, which prints its
sentence in both languages on purpose — and states why.

### §10.10 Follow-up 2 — a claim the input contradicted

The same read of production turned up a factual mismatch in the copy, not just a
language one:

> **"4-Digit Security PIN"** beside an input that accepts **4 to 6**, and a hint
> that says `4–6`.

Eight strings repeated the claim — login subtitle, the change-PIN sheet, the
supervisor's reset form, the technician account sheet, in both languages. The
code has always allowed 4 to 6 (`min 4`, `maxLength 6`, and the error message
"A PIN must be 4 to 6 digits"), so the copy was simply wrong, and wrong in the
way that makes a person think their PIN was rejected for the wrong reason.

All eight now say **4–6**, and a ninth bug surfaced on the way: eight fallbacks
in `TechnicianShell` of the shape `t('changePinHint') || 'Use …4-digit PIN.'` —
dead code, because `t()` always returns a string, which is how one of the stale
strings survived the sweep. Those fallbacks are deleted, not updated: keeping a
second copy of copy is how the two drift apart.

A new test (`PIN copy agrees with what the inputs accept`) fails on any
`4-digit` / `4 Lambar` claim anywhere in `src` and asserts that `pinHint`
carries the range in both languages. 137 tests.

The Somali login placeholder also read `Username ama Lambarka Tel` — English
noun, Somali sentence. It now reads `Magaca isticmaalaha ama Lambarka Tel`,
matching the hint above it.

---

## §11 Batch B — the door was open, and now it is not (09/11/2026)

Batch B was parked by the user's decision ("skip for now") and un-parked when
`docs/PRODUCTION_READINESS.md` was written and the question became concrete:
*can this be shown to a manager?* It could not, because of one line of SQL
repeated eleven times.

### 11.1 What was wrong

```sql
CREATE POLICY "Allow read tasks" ON public.tasks FOR SELECT USING (true);
```

Eleven of those — `tasks`, `users`, `crews`, `crew_members`, `cableboxes`,
`cablebox_logs`, `cablebox_ports`, `import_batches`, `task_work_logs`,
`dispatch_log`, `groups` — for the `anon` role, whose key ships inside the
JavaScript bundle. One unauthenticated request returned the customer list:

```
GET /rest/v1/users?select=username,full_name,phone,role
→ [{"username":"xasan","full_name":"Xasan Cali Nuur","phone":"634100102"}, …]
```

The write path was already sound: every mutation is a `SECURITY DEFINER`
function that validates a session token. Only the reads were open — but the
reads are the customer data.

### 11.2 What was built (migration 011)

**Reads became functions.** Eleven of them, each taking `p_token` first, each
resolving the caller with `get_session_user`, each refusing a group the caller
does not belong to:

| Function | Replaced |
| :--- | :--- |
| `list_groups` | `select * from groups` |
| `group_overview` | 6 queries: members, crews, crew links, boxes, 3 counts |
| `list_open_tasks` | `select * from tasks where status in (…)` |
| `get_task` | `select * from tasks where id = …` |
| `list_work_logs` | `select * from task_work_logs where task_id = …` |
| `list_live_moves` | blocked/in-progress jobs for the bell |
| `list_resumed_since` | resumed work-log rows for the bell |
| `list_import_batches` | the ingest history strip |
| `my_team` | two reads in the technician's account sheet |
| `upload_sheet_image` / `get_sheet_image` | the public storage bucket |

Then every open policy was dropped. The same request now answers `[]`.

**`src/` contains no table read at all.** `tests/access.test.ts` (11 tests)
fails the build if `from('…')` appears in a source file, if a read function
loses its token check, if a group-scoped function stops refusing another group,
if an open policy comes back, or if the client grows a `getPublicUrl` again.

**Realtime had to change with it.** `postgres_changes` obeys row-level security:
with the policies gone the feed would go silently dead. A trigger now publishes
`{ table }` — a table name and nothing else — on a broadcast channel, and the
client refetches through a checked function. There is no second copy of the data
on the socket, and a test asserts the payload never grows one.

Two design changes fell out of that, both improvements:

* one shared channel per topic instead of one per screen (broadcast topics
  cannot be per-subscriber, and one socket subscription is cheaper on a phone);
* the fan-out is tested directly — a simulated signal reaches two subscribers,
  a signal for another table does not wake a screen, and the channel closes when
  the last subscriber leaves.

**Sheet photos left the public bucket.** They now live in `sheet_images`, a
table with row-level security and no policies, written and read only through the
two functions above. There is no URL for a customer sheet to be guessed.

**PINs became credentials.** Five wrong attempts lock an account for fifteen
minutes; the counter resets on success. A PIN created or reset by a supervisor
sets `must_change_pin`, and the shell shows `ForcePinChange` — one screen, no
skip — until the person chooses their own.

**Headers.** `vercel.json` now sets CSP, HSTS, `X-Frame-Options: DENY`,
`nosniff`, a referrer policy and a permissions policy. `npm audit --omit=dev`
reports **0 vulnerabilities**.

### 11.3 The bug the verification caught

The lockout was written, deployed, and **did not work**. Five wrong PINs
followed by the correct one still signed the person in.

Cause: the function raised an exception on a wrong PIN, and a raise aborts the
request's transaction — which rolled back the `failed_attempts` update it had
just written. The counter never moved past zero.

Found by probing the live database rather than by reading the diff:

```sql
-- inside a transaction, five wrong PINs then the correct one
attempt 1 … 5 → "Invalid username/phone or PIN"
attempt 6     → "ACCEPTED — correct PIN still works"     ← the lockout was a myth
```

The function now returns `{ ok: false, reason: 'locked' | 'invalid' }` instead of
raising, so the write commits. Re-probed:

```
attempt 1 … 4 → invalid
attempt 5     → locked (15m)
attempt 6     → locked (15m)      ← correct PIN refused, as it must be
```

A test now forbids `RAISE` in `authenticate_pin`, with the reason attached.

This is the whole argument for verification over declaration: the feature was
complete, reviewed, deployed, and did nothing.

### 11.4 Verification

| Check | Result |
| :--- | :--- |
| Anonymous read of `users` / `tasks` | `[]` — was 5 names and phone numbers |
| Anonymous read of any of the 11 tables | `[]` |
| Token → `get_session_user` → `list_open_tasks` | supervisor resolved, 5 open jobs, 5 members, counts correct |
| Bad token | `Invalid or expired session` |
| Wrong PIN ×5 then correct | locked (15m), correct PIN refused |
| `must_change_pin` flag in the auth payload | `true` when set, `false` after `change_own_pin` |
| Sheet image upload → read back | stored, 500 bytes in, 500 bytes out |
| `tsc -b` | clean |
| `npm test` | **151 / 151** (was 137) |
| `npm run build` | 3.8 s |
| `bundle:check` | **183.0 kB / 200 kB** |
| `npm audit --omit=dev` | 0 vulnerabilities |
| Dev server | every changed module serves 200 |

New tests: `tests/access.test.ts` (11) — no direct table reads, allowlisted
database access, token-first signatures, group refusal, no open policies,
private archive, lockout that answers instead of raising, forced PIN change,
signal-not-data realtime, and no token in a URL or a console line.

### 11.5 What this batch deliberately did not do

* **A manager role.** B is about the door, not about who sits behind it. A
  read-only manager view is Batch H.
* **Rate limiting by IP.** The lockout is per account, which is what protects a
  named person. A distributed guessing campaign across many usernames would
  still be cheap — the answer is 5–6 digit PINs plus a longer lockout, or
  Supabase Auth, and neither is worth doing before the pilot.
* **Moving to Supabase Auth.** The custom token system works, is tested, and
  replacing it would touch every screen. Re-read this decision when the system
  leaves one group.

### 11.6 New risk recorded

`authenticate_pin` now distinguishes `invalid` from `locked`. That tells an
attacker an account exists — which they could already infer from a successful
lockout, and which is worth the trade for a person who needs to know why they
cannot get in. Recorded rather than hidden.

## §12 Batch H — the record (part 1, 09/11/2026)

Every screen built so far answers *what is happening*. None of them answered
*what happened*: a job that was completed three weeks ago, who cancelled the
duplicate, which technician closed eleven jobs last month and at what signal. The
data was already in the database — `task_work_logs` has logged every
import / assign / start / block / resume / complete / reopen since Phase 1 — but
nobody could read it without a SQL console.

Batch H is the manager pack. This part is the record; photo proof on completion
and a read-only manager role follow.

### 12.1 Two questions, two screens

| Question | Screen | Shape |
| :--- | :--- | :--- |
| "Who did what, when?" | **Record** tab (supervisor) | Reverse-chronological feed, filter by window / action / person, search, CSV |
| "What did the group deliver between two dates?" | **Report** (from Analytics) | Printable one-pager for a head manager, CSV for the desk |

They read two new functions. Both are `SECURITY DEFINER`, both take `p_token`
first, both resolve the caller with `get_session_user`, and both prove the caller
belongs to `p_group_id` before returning a row — the same shape as every read
since Batch B, enforced by `tests/access.test.ts`.

### 12.2 What the database now returns

`group_activity(p_token, p_group_id, p_days, p_limit)` merges four sources into
one feed:

| Source | What it contributes |
| :--- | :--- |
| `task_work_logs` | imported, assigned, started, paused, blocked, resumed, completed, reopened — with duration, dBm, blocker reason and notes |
| `dispatch_log` | plan sent, with channel and job count |
| `tasks where cancelled_at is not null` | cancellations, with the reason |
| `tasks where source = 'manual'` | phone-in jobs, which never had a work-log row |

`p_limit` is capped at 500 and `p_days` at a year, because a screen that can be
asked for everything will eventually be asked for everything.

`period_report(p_token, p_group_id, p_from, p_to)` returns totals, per-technician
output, per-box faults, cancellation reasons and a day-by-day series. Two
decisions worth writing down:

* **`open_at_end` counts jobs that existed and were not closed by `p_to`** —
  not jobs that exist now. A report for last month must not change because of
  what happened this morning.
* **`waiting_over_sla` is measured at the end of the window**, with the same
  three-day rule the badge uses. The report and the board cannot disagree.
* A reversed range is refused by name. A range longer than 366 days is refused
  by name. Neither silently returns zero.

### 12.3 The numbers the probe produced

Both functions were created on the live project and then called inside a
rolled-back transaction against the real group:

```
group_activity(days=30, limit=300)
  → 50 events; newest: assigned · 2026-10-31 · actor "F1 Supervisor (Kormeeraha F1)"

period_report(from = 30 days ago, to = today)
  totals: created 44 · completed 34 · cancelled 0 · open_at_end 5
          waiting_over_sla 5 · avg 142 min · avg dBm −21.4
          dispatches 1 · repeat faults 0
  first technician: "Cabdiraxmaan Maxamed" — 3 jobs, 916 min
  daily: 7 points over a 7-day window
```

The point of running it against live data rather than a fixture: the SQL was
written in a sandbox that had no rows, and a function that returns `[]` is a
function that could be returning `[]` for the wrong reason.

### 12.4 What the supervisor sees

**Record** — a single feed, newest first, with the words a supervisor uses: *La
qoondeeyay* / *Assigned* is a blue chip, *La dhammeeyay* / *Completed* is green,
*La xayiray* / *Blocked* is amber, *La tirtiray* / *Cancelled* is red. The second
line carries the evidence — `−22.9 dBm · 1h 29m`, `Telegram · 7 jobs`, the
cancellation reason — and never repeats the label. Windows of 1 / 7 / 30 days,
action chips, an actor dropdown and a search box that looks at line number,
customer name, person, notes and reason (the five things a supervisor actually
remembers). Export is a CSV named with the window, in the language of the person
who pressed it.

**Aging** — every open job on the dispatch board now carries a small badge:
nothing until day two, amber *3 maalmood / 3 days* on the promise, rose after
it. It is computed from `reported_date` (what the sheet says, which is what the
customer counts from), falling back to `created_at` when the sheet has no date,
clamped at zero so a clock skew never produces a negative wait. Completed and
cancelled jobs leave the count, which is the part that makes the number worth
showing.

**Report** — opens from Analytics. Presets for today, last 7 days, this month and
last month; editable dates; letterhead with the group and the range; headline
tiles; a day-by-day bar row; technician and cablebox tables; cancellation
reasons. **Print / PDF** uses the browser's own print dialog, and the print
stylesheet hides the app entirely so the page that comes out is the report and
nothing else — no PDF library, no server, no dependency. **Download CSV** gives
the same numbers to the person who will put them in a deck.

### 12.5 Verification

| Check | Result |
| :--- | :--- |
| `group_activity` on live data | 50 events, newest 2026-10-31 |
| `period_report` on live data | 44 created / 34 completed / 5 open at end / 142 min avg |
| Reversed range | refused by name |
| Range > 366 days | refused by name |
| `tsc -b` | clean |
| `npm test` | **170 / 170** (was 151; +17 in `tests/activity.test.ts`, +2 render) |
| `npm run build` | 3.7 s |
| `bundle:check` | **189.2 kB / 200 kB** |
| Dev server | 200 on 5173 |

The new tests are rules, not snapshots: the promise is exactly three days; a
missing date is `fresh` rather than an accusation; a job is counted from
`reported_date`, not from when we read the sheet; a finished job drops out of
the late list; an unrecognised event kind renders as itself instead of vanishing;
a name with a comma and a quote survives the CSV; a search with spaces at both
ends is not a filter.

Two of them failed on the first run and both failures were worth having. One
caught a duplicated line number in my own fixture, which is exactly the mistake
the search box exists to tolerate. The other caught a CSV expectation that
assumed the note was the whole cell, when the detail line is `dBm · duration ·
note` — the test was wrong, the code was right, and the assertion now says what
it means.

### 12.6 What part 1 deliberately did not do

* **Photo proof on completion (H2).** The storage bucket and the read function
  exist since Batch B; the capture UI, the compression to a phone-sized JPEG and
  the thumbnail in the task card do not.
* **A read-only manager role (H3).** The `role` check still allows `supervisor`
  and `technician` only. Adding `manager` touches the role constraint,
  `portalForRole`, every supervisor RPC's authorisation and the shell's tab list —
  a batch of its own, not an afternoon's edit.
* **Editing the feed.** There is no delete and no amend, by design. A record that
  can be rewritten is not a record.

## §13 Batch H — proof (part 2, 09/11/2026)

The manager question from `PRODUCTION_READINESS.md` was *"prove the technician was
actually there"*. dBm and notes are what a technician types; a photograph of the
joint is what they had to stand in front of.

### 13.1 The three rules, and why each one exists

| Rule | Reason |
| :--- | :--- |
| A photo belongs to a **completed** job | A photo of unfinished work would let the camera imply completion, which is the one thing this app refuses to fake |
| Only the **worker or the supervisor** may attach one | Proof that anyone can add is not proof |
| Photos live in a **private table**, never a bucket | Batch B found sheet photos in a public bucket; the same bytes of a customer's wall get the same discipline |

`task_photos` has RLS enabled and **no policies at all** — the table is reachable
only through `add_task_photo`, `list_task_photos` and `get_task_photo`, each of
which takes `p_token` first and proves the caller's group. A fourth rule is a
backstop rather than a feature: at most **three photos per job**, **2 MB each**.

### 13.2 The photograph is not the completion

The completion and the photo are two calls, in that order:

```
complete_task(...)            → the job is closed, the timer stops, the dBm is stored
add_task_photo(...)           → the evidence, on a completed job
```

If the upload fails — no signal in a basement, the database at its limit — the job
is **still complete**, the technician sees *"Photo not uploaded — the job is still
complete"* with a retry button, and the already-compressed bytes are kept in
memory rather than asking them to photograph the joint again.

The image never leaves the phone at full size. `src/lib/photo.ts` resizes to
**640 px** on the long edge at **JPEG quality 0.6**, applying EXIF rotation first
(a portrait photo is not uploaded sideways). A typical 4 MB shot becomes 40–120 kB.

### 13.3 What the live probe proved

Applied to the live project, then exercised inside a rolled-back transaction
against the real group:

```
add_task_photo(supervisor, completed job, 300-byte JPEG)
  → {"id": …, "byte_size": 300}
  tasks.proof_photo_id → set
  list_task_photos     → [{mime: image/jpeg, byte_size: 300,
                           uploaded_by_name: "F1 Supervisor (Kormeeraha F1)",
                           uploaded_by_role: supervisor}]
  get_task_photo       → base64, 405 chars for 300 bytes
```

Each refusal was provoked rather than assumed:

| Attempt | Answer |
| :--- | :--- |
| Photo on an `assigned` job | `A proof photo belongs to a completed job` |
| A fourth photo | `This job already has three photos` |
| 3 MB payload | `The photo is larger than 2 MB` |
| `image/gif` | `Only JPEG and PNG photos can be stored` |
| Empty body | `The photo is empty` |
| A technician who does not work the job | `Only the technician on this job, or the supervisor, can attach a photo` |

That last line was not a designed test: the first probe picked the newest session
token in the table and happened to be *Cabdiraxmaan Maxamed's*. The refusal was
the correct answer, and it is now part of the record.

### 13.4 Two definitions in §12 that were wrong

Writing the report screen's description exposed two mistakes in the SQL from
part 1, both of which would have produced a report that **looked right**:

* `open_at_end` used *today's* status. A job completed this morning disappeared
  from last month's report. It now asks the historical question: did the job
  exist by the end of the range, and was it still open then?
* `waiting_over_sla` counted from `created_at`, while the aging badge counts from
  `reported_date` — the date the customer uses. Board and report would have
  disagreed by a day or more. They now measure the same thing.

The corrected function also returns `photos`, the number of proofs attached in
the period, because "we completed 34" is a weaker sentence than "we completed 34,
29 of them with a photograph".

### 13.5 Where a person sees it

* **Technician** — inside the completion form: *Take a photo* opens the camera
  directly (`capture="environment"`), shows a thumbnail with `640×480 · 84 kB`
  and a *Remove*. The job is completed, then the photo is sent.
* **After completion** — *Add a photo now*, for the technician who took the shot
  a minute too late; it uploads immediately to the finished job.
* **Record feed** — a green **Photo** chip on the completion row (never on the
  other events of the same job), opening the photograph full screen with who took
  it and when.
* **Job sheet** — a *Photo proof* section listing up to three, with sizes, each
  opening the viewer.
* **Period report** — one line under the tiles: *"29 photo proofs were attached to
  completed jobs."*

### 13.6 Verification

| Check | Result |
| :--- | :--- |
| Live upload / read / list | 300 bytes in, 300 bytes out, base64 405 chars |
| Refusals | 6 / 6 provoked and answered by name |
| `group_activity` carries `photo_id` | 8 events on a job with proof |
| `period_report` totals | `photos` present; `completed` 34 (30-day window), 33 (29-day) |
| `tsc -b` | clean |
| `npm test` | **182 / 182** (was 170; +12 in `tests/photo.test.ts`) |
| `bundle:check` | **190.6 kB / 200 kB** |
| Dev server | `PhotoViewer`, `photo.ts`, `ExecutionSheet` all serve 200 |

### 13.7 What is not verified, stated plainly

* **The camera path has not been exercised on a physical phone.** Resizing,
  EXIF rotation and `toDataURL` are browser APIs; the maths is unit-tested and the
  upload is proven against the live database, but the first real device test is
  still owed before the pilot. This is the one item in Batch H that a test cannot
  stand in for.
* **Nothing has been photographed in production yet.** The live probe wrote and
  rolled back; `task_photos` is empty.
* **Storage headroom is a decision, not a detail.** ~4 MB a day at 40 photographed
  jobs. On the Free plan (500 MB) that is roughly four months of proof. Recorded
  in `KNOWN_LIMITS` §7.
* **A read-only manager role (H3) is still not built at this point** — it lands as §14, immediately after this section.

## §14 Batch H — the manager (part 3, 09/11/2026)

The last question in `PRODUCTION_READINESS.md` §4 was *"can a manager see it
without changing anything?"* — and the one above it, *"show me F2 and F3 too"*.
They turned out to be the same feature: a third role.

### 14.1 A separate app, not a supervisor app with buttons hidden

A hidden button is a promise made by CSS. The manager gets:

* a **third role** (`manager`) in the `users` check constraint;
* **four read functions of their own** — `manager_portfolio`, `manager_activity`,
  `manager_report`, `manager_tasks` — each token-first and each refusing anyone
  whose role is not `manager`;
* a **separate shell** (`components/manager/`), lazily loaded, that imports no
  dispatch, execution, import or registry service;
* and, because a token and the anon key are all a determined person needs, a
  **database-level refusal** underneath all of it (§14.2).

The supervisor's functions were left untouched: they still refuse a non-member,
so a manager cannot reach them by calling one directly.

### 14.2 Read-only, enforced where it cannot be argued with

`get_session_user` now stamps the caller's role into a transaction-local setting
(`app.actor_role`), and a `BEFORE INSERT OR UPDATE OR DELETE` trigger on twelve
operational tables raises `A manager account is read-only` when it is `manager`:

```
tasks · task_work_logs · task_photos · dispatch_log · import_batches
cableboxes · cablebox_ports · cablebox_logs · sheet_images
crews · crew_members · groups
```

`users`, `user_credentials` and `user_sessions` are deliberately **not** guarded:
a manager must still be able to change their own PIN and sign out.

This matters because four functions a plain group member may legitimately call
(`set_port_status`, `upload_sheet_image`, `log_dispatch`, `ensure_cablebox`) check
membership rather than role. The first probe caught it: a manager session could
mark a port damaged. With the trigger, all four refuse — and so will the next
membership-only write anybody adds.

### 14.3 What the manager sees

* **Groups** — one card per group: code, name, staff, open, blocked, late and
  completed, a late-share bar, the last activity, and a *read-only* list of that
  group's open jobs behind a disclosure. Groups that have not launched say so
  instead of showing four zeroes as if they were failing.
* **Record** — the same feed the supervisor reads, across every group, with the
  group code on each row and in the CSV.
* **Report** — the same printable sheet, with an extra *By group* table and a
  per-group CSV export.

The headline tiles are computed **twice** — once by the database and once by
`summarisePortfolio` in the browser — and the screen shows a warning if the two
disagree. A manager is the last person who should be shown a number nobody
checked.

### 14.4 What the probes showed

| Probe | Result |
| :--- | :--- |
| Manager signs in (`maamule` / 1111) | token issued, role `manager`, payload correct |
| Supervisor calls the four manager functions | all four refused by name |
| Manager calls the four manager functions | all four allowed |
| Portfolio | **5 groups** (F1 live; F2/F3/F5/GA not launched), totals: 5 open, 5 late, 33 completed/30 d, 4 technicians |
| Manager report, 30 days | identical totals to the supervisor report for F1: 44 created, 34 completed, 5 open at end, 5 late |
| Manager `set_port_status` | `A manager account is read-only` |
| Manager `upload_sheet_image` | `A manager account is read-only` |
| Manager `log_dispatch` | `A manager account is read-only` |
| Supervisor `set_port_status` | still allowed (the revokes did not break the definer chain) |
| Manager `upsert_team_member` | `Only supervisors can manage team members` |
| Supervisor creating a `manager` | `A manager account is created by the administrator, not from a group screen` |

### 14.5 The two unauthenticated helpers this exposed

See §15 — found by listing every `public` function that does not take a token.

### 14.6 Not verified, stated plainly

* **The manager portal has not been clicked in a browser.** There is no browser
  in the build environment; the shell renders under `renderToString`, the modules
  compile and serve, and every function behind them was exercised against live
  data — but "it looks right" is still owed before a manager sees it.
* **Only F1 has data.** F2/F3/F5/GA exist and are marked not live; the
  cross-group screens show them as empty, which is the truth, but they have not
  been seen with real second-group traffic.
* **A manager cannot be created from the app**, only by SQL (`015` §2). That is
  the privilege-escalation guard; it is also an operational step in `RUNBOOK`.

## §15 Batch H — the security follow-up (09/11/2026)

Not planned. Found while listing functions that do not take a token, to prove the
manager role was complete.

| Function | Exposed to `anon` | What it did |
| :--- | :--- | :--- |
| `ensure_cablebox(p_group_id, code, xaafada, olt_path)` | yes | **created or renamed a cablebox in any group, with no session** |
| `ensure_box_ports(p_box_id)` | yes | wrote port rows for any box |
| `recompute_box_state(p_box_id)` | yes | recalculated and wrote a box's health |
| `build_auth_payload(p_user_id, p_token)` | yes | returned any user's name, phone, role and group; it never looked at the token |

All four are internal helpers — the browser calls none of them (`grep src/` finds
zero references) — so they are now `REVOKE`d from `PUBLIC`, `anon` and
`authenticated`, and reached only from the `SECURITY DEFINER` functions that
already check a token.

**The part worth recording** is how the first fix failed. `REVOKE … FROM anon`
reported success and changed nothing, because Postgres grants `EXECUTE` to
`PUBLIC` by default and Supabase's default privileges *also* grant it to `anon`
and `authenticated` explicitly. The migration succeeding proved nothing; the
`has_function_privilege('anon', …)` probe is what showed `true` after the revoke.
The second attempt revoked from all three and the probe returned `false`.

Verification after the fix: supervisor, technician and manager logins all still
issued tokens; `technician_route` still returned a route; `set_port_status` still
worked for a supervisor (it calls two of the revoked helpers internally, as the
owner). Nothing in the app lost a function.

## §16 Batch H — the PIN rule that was never applied (09/11/2026)

Found while checking whether Batch H had broken anything, by asking a question
nobody had asked: *which accounts are still on a PIN the department chose?*

```sql
select username, role, must_change_pin from public.users;
→ 6 rows, every one of them false
```

Batch B had built the rule properly — `must_change_pin`, a forced-change screen
that cannot be skipped, and an `upsert_team_member` that sets the flag whenever a
supervisor resets somebody's PIN. It protected nobody, because it only ever
applied to people created *after* the migration. The five seeded accounts, whose
PINs are printed in `README.md`, and the manager created this afternoon, could all
sign in with a PIN that is in the repository.

The fix is small on purpose:

* **`flag_department_pins(token)`** — supervisor only, flags every active
  supervisor and technician in their own group, returns how many. It is a
  function rather than a one-off `UPDATE` so it can be pressed again after a
  new person is added on a known PIN.
* **A banner on the Team screen** — *"5 people can still sign in with the PIN the
  department set"* — with the consequence in the same sentence and one button.
  Each affected member also carries a *PIN not changed yet* chip.
* **It is a button, not an automatic flag.** Flipping the column by migration
  would have put a PIN-change screen in front of a head manager mid-demonstration.
  A supervisor chooses the moment; `RUNBOOK` §10 step 2 says the moment is the
  end of the pilot.

Probed live in a rolled-back transaction: a manager calling it is refused by
name; a supervisor gets `{flagged: 5}` for the five active staff, and the
manager's account is correctly outside the group's staff list.

**What this says about the process**, recorded because it will happen again: the
feature was built, tested, deployed, documented — and inert. The test it lacked
was not a unit test of the flag, it was a question about the data. Two of Batch
H's three findings came from that shape of question rather than from a failing
assertion.
