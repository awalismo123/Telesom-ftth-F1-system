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
