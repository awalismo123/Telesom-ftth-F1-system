# External Audit — Verdict and Remediation Plan

**Subject:** Telesom FBB · Group F1 field system (`Telesom-ftth-F1-system`)
**Audit under review:** 12-page external review, 09/11/2026
**This review:** every material claim re-tested against source, the live Supabase project (`pjrzncnhhlfaxuvlcdse`, eu-west-1, Postgres 17.11) and production (`telesomftthfonesystem.vercel.app`)
**Code state:** `main` = `349d87b` · 204/204 tests · tsc clean · 191.4 kB of a 200 kB budget

---

## 1. Bottom line

The audit is **substantially correct**. Eleven of its twelve material findings reproduce exactly; several are worse than stated because the numbers it quoted are real counts, not estimates.

It has **one overstated finding** (the demo-data story) and **one framing error** that changes how P0-1 should be read but not whether it must be fixed.

Nothing in the audit requires a rewrite. The critical items are a rotation, a ledger reconciliation and a monitoring decision — days of work, not weeks. The one item that cannot be closed by engineering alone is the backup line (P1-4), which is a billing decision.

**Current honest readiness: fit for a supervised pilot in one group with test data. Not fit to hold customer records.** Three blockers: published PINs, no backups, no alerting.

---

## 2. Claim-by-claim verdict

| # | Claim | Verdict | Doable | Fixable | Phase |
|---|---|---|---|---|---|
| P0-1 | Credentials are public (source + build) | **True**, framing aside | Yes | Yes | 0 |
| P0-2 | Login is not a security boundary; real technician number shown | **True** | Yes | Yes | 0 |
| P1-3 | Migration ledger does not match reality | **True** | Yes | Yes | 1 |
| P1-4 | No backups, no point-in-time recovery | **True** | Yes | Yes, if funded | 2 |
| P1-5 | CI never runs anything | **True**, one detail wrong | Yes | Yes | 1 |
| P1-6 | Published figures describe data that is not there | **True**; "no demo banner anywhere" **false** | Yes | Yes | 3 |
| P1-7 | No browser checks, no uptime or error monitoring | **True** | Yes | Yes | 1–2 |
| P2-8 | 15 tables without RLS policies, 58 anon-executable definer functions, 21 unindexed FKs | **True, exact** | Yes | Partly (by design) | 1 |
| P2-9 | Lockout is per-user only, no IP throttle | **True** | Yes | Yes | 2 |
| P2-10 | 14-day sessions in `localStorage` | **True** | Yes | Yes | 2 |
| P2-11 | SLA of 3 days hardcoded in two places | **True** | Yes | Yes | 1 |
| UI-12 | Build-progress panel, English-only hint, i18n test blind spot | **True** | Yes | Yes | 4 |

---

## 3. Evidence, claim by claim

### P0-1 — Credentials are public: **true**

- `README.md` lines ~228–233 publish six working accounts with PINs (`1234` / `1111`) in a public GitHub repository.
- `src/components/LoginScreen.tsx:47` defines `QUICK_ACCOUNTS` with the same identifiers and PINs.
- A fresh `npm run build` leaves them in the shipped file: `grep dist/assets/index-*.js` returns `pin:"1111"` ×4, `pin:"1234"` ×1, `identifier:"maamule"`.
- `must_change_pin` is `false` on **0 of 6** accounts, so nothing forces a rotation after first login.

**Where the audit's framing is wrong.** It implies a visitor can sign in from the demo buttons. They cannot: those buttons render behind `DEV_BUILD`, which compiles to `false`, so the panel code is dead. The strings survive as **unreachable data**, readable by anyone who opens the JS file. That is a credential disclosure, not a UI bypass — worse in one way (silent), milder in another (not clickable). Either way the credentials must be rotated, because they are public whether or not a button shows them.

**One fact the audit did not have.** Production is **not** built from current `main`. `HEAD` shows the placeholder `supervisor ama 634100101`; the live site shows `supervisor ama 634...`. So the deployed bundle is older than the code we are reviewing, and I will not claim it does or does not contain the PIN literals. Treat it as compromised until proven otherwise.

**This ambiguity does not block the fix.** Rotation happens server-side. Once the six PINs are replaced and sessions revoked, every bundle that was ever published becomes worthless — including whatever Vercel is serving.

### P0-2 — Login is not a security boundary: **true**

- The login screen's own placeholder names a real seeded technician: `identifierPlaceholder` = `'supervisor or 634100101'` (en, `src/lib/i18n.tsx:12`) / `'supervisor ama 634100101'` (so, line 184).
- Anyone with the app open reads a valid username off the form.

Fix is copy, not code: generic wording ("username or Telesom number"), and keep real numbers out of every translation string. One test should assert no `63\d{7}` pattern appears in `i18n.tsx`.

### P1-3 — Migration ledger does not match reality: **true**

- `supabase_migrations.schema_migrations` holds **10** rows, ending at `010 batch_e_cancel_reopen_search`.
- The repo holds **17** migrations; **011–017 are applied live** (verified: `group_overview`, `flag_department_pins`, the 016 PIN rule and the 017 manager filter all exist and behave as written).

Consequence: a rebuild from ledger + repo produces a database in an unknown state, and `supabase db push` would try to replay 011–017 against objects that already exist.

**Fix:** insert the seven missing ledger rows with `CREATE OR REPLACE` markers **without replaying the SQL**. Do not run the migration bodies again — 011/012/013 contain `CREATE OR REPLACE` and constraint work that is not safe to re-run blind.

### P1-4 — No backups, no point-in-time recovery: **true**

- Project is on the free tier; free tier has no automated backups and no PITR.
- Free tier also pauses after roughly seven days of low activity. A field system used in bursts is exactly the profile that gets paused.
- Billing tier is not exposed through the API, so this is inferred from the absence of backup endpoints — the audit's hedge here is correct and I am repeating it.

**Fix requires money, not code** (Pro, $25/mo, gives daily backups with 7-day retention and no pausing). This is the Batch G blocker. Until it is funded the honest statement to management is: *"a lost table cannot be recovered."*

### P1-5 — CI never runs anything: **true, with one detail the audit missed**

- Five of five runs fail. The failing job shows **0 steps, ~1 second, empty runner name**. No step ever executed. That is an account-level Actions restriction, not a red test suite — the audit's implication that the build is failing is wrong in mechanism, right in effect: nothing is verified on push.
- Separately, `npm run bundle:check` exists (`scripts/check-bundle.mjs`) and is **not wired into `.github/workflows/ci.yml`**. Even with a working runner, the credential leak would pass CI. That part the audit got right, and it is the detail I would not have caught without it.

### P1-6 — Published figures describe absent data: **true; one sub-claim false**

Live counts: **8 tasks** (4 assigned, 3 completed, 1 cancelled, 0 unassigned, 0 blocked), **0 photos**, **5 groups**, **6 users**, **2 crews**, **0 demo rows**.

`docs/PRODUCTION_READINESS.md:171` states *"Of 44 jobs in production, 36 are demo and 8 are real test rows."* There are no 44 jobs and no demo rows. Line 161 reasons from the same phantom 44.

**The audit's sub-claim is false.** It reports no demo banner anywhere. `src/components/supervisor/Analytics.tsx:253–275` has a bilingual demo banner, a "Remove demo data" control and a "Load demo history" button — built in Phase 5 as specified. The controls exist; they simply have nothing to act on, because the demo seed was never loaded into this project. That is a **stale-document problem**, not a missing-feature problem, and it is cheaper: correct the figures, then either seed the demo or stop claiming demo data.

### P1-7 — No browser checks, no monitoring: **true**

No end-to-end test in the pipeline; no uptime check; no error capture. If the site were down or throwing, the first report would come from a technician in the field.

### P2-8 — Advisors: **true, exact**

Reproduced the audit's three numbers precisely: **15** tables with RLS enabled and no policy, **58** `SECURITY DEFINER` functions executable by `anon`, **21** foreign keys without a covering index.

Refinement the audit did not do — of the 58:

- **54** take a session token as their first argument and are therefore guarded by their own body;
- **2** are trigger functions, which `anon` cannot call directly;
- **4** have no `p_token` argument, and of those **2 both lack a token and contain writes**.

So the genuinely dangerous set is **2 functions**, not 58. That pair must lose its `anon` grant. The remaining 52 token-first functions should still have `EXECUTE` revoked from `anon` as defence in depth, but they are not open doors. The 21 unindexed FKs matter at scale, not at 8 rows — worth fixing, not urgent.

### P2-9 — Lockout is per-user only: **true**

`c_max_attempts` 5 and `c_lock_minutes` 15 apply per user row. There is no IP dimension and no progressive delay, so an attacker can spray one PIN candidate across many identifiers, or simply wait out the lock. With six known identifiers and 10⁴ possible 4-digit PINs, this is a slow but real grind.

### P2-10 — Long-lived sessions in `localStorage`: **true**

`user_sessions.expires_at default now() + interval '14 days'`; tokens persist in `localStorage` and are readable by any script on the origin. Acceptable for a pilot with rotated PINs; should become a shorter expiry with sliding renewal before real customer data.

### P2-11 — SLA hardcoded twice: **true**

`src/lib/activity.ts:252` `SLA_DAYS = 3`, and `interval '3 days'` hardcoded in migrations `012` (line 229) and `013` (line 413). Change one, the reports disagree with the queries. A single database-side setting is the fix.

### UI-12 — Three UI findings: **true**

- The overview's headline panel is a **build-progress roadmap** ("Step-by-Step Build Progress") presented to field staff as if it were operational content. True, and it is the first thing a manager sees.
- `SupervisorShell.tsx:218` `hint={`Group ${activeGroup?.code ?? 'F1'} field ready`}` is English-only in a bilingual app. True — arguably worse than the audit says, because it is the one string that makes the system look unfinished to a Somali-speaking supervisor.
- `tests/i18n.test.ts` cannot see it: `COPY_ATTR` (line 153) only matches double-quoted attributes, `JSX_TEXT` (line 162) skips `{}`, and the key check (line 100) uses `\b${key}\b`. Template literals are invisible to the guard. True, and it means the i18n test's green tick is weaker than it looks.

---

## 4. What the audit got wrong or overstated

1. **"No demo banner anywhere."** False. The banner, the purge control and the seed control all exist in `Analytics.tsx`. The data is missing, not the safety rail.
2. **CI framed as a failing pipeline.** Nothing fails — no runner is ever assigned (0 steps, 1 second). The remedy is an account setting, not a code fix.
3. **P0-1 framed as a login bypass.** The quick-fill panel is dead code in production. The exposure is the published credential, not a clickable door.
4. **58 open functions presented as a block.** Only 2 combine no token with writes. Presenting 58 as equally dangerous would send a team on a week-long grant rewrite for little gain.

None of these change the priority order. They change the effort estimate downward and the narrative upward: this is a system with a publishing problem and an operations problem, not a system with a broken core.

---

## 5. Phased remediation plan

Ordered by risk removed per day of work. Phases 0–1 are days, not weeks. Phase 2 is the only one gated on a decision.

### Phase 0 — Containment (≈1 day, do first, no dependencies) — **DONE 09/11/2026**

| Task | Files |
|---|---|
| Rotate all six PINs; set `must_change_pin = true` | SQL on `users` |
| Revoke every session (forces re-login everywhere) | `DELETE FROM user_sessions` |
| Delete `QUICK_ACCOUNTS` and the demo panel entirely; keep a `DEV_BUILD`-free login | `src/components/LoginScreen.tsx` |
| Remove the credential table from the README; replace with "request credentials from the system owner" | `README.md` |
| Replace `634100101` with generic copy in both languages | `src/lib/i18n.tsx:12,184` |
| Add a build-time guard: fail the build if `pin:"` or a `63\d{7}` literal appears in `dist/` | `scripts/check-bundle.mjs` |
| Redeploy, then verify the **deployed** asset, not just local `dist/` | Vercel |

**Acceptance:** no PIN or phone literal in `dist/`; `bundle:check` passes and fails when a literal is injected deliberately; all previously published credentials rejected by `authenticate_pin`; production serves a build whose placeholder is generic.

**Outcome.** All seven tasks are done in the repository, and the database side is
done on the live project: five accounts rotated off `1111`/`1234`, all six
flagged `must_change_pin`, **12 live sessions deleted**, and `authenticate_pin`
now refuses every published PIN on every account. Temporary PINs were issued
per account and delivered separately — deliberately not written into this
repository, which is the whole point.

The guard was proven by planting `pin:"1234"` and `634100101` in `dist/`: three
findings, exit 1; clean on removal. `npm run verify` is green at 209 tests,
190.9 kB of a 200 kB budget.

Two defects were found and fixed while doing it, both worth recording because
both looked like success:

* the first version of migration 018 rotated the hash and then flagged accounts
  by **matching the hash against the published PIN** — which no longer matched
  anything after the rotation, so the rotated accounts were never flagged. They
  would have been locked out of a PIN nobody knew, with no forced-change screen;
* a `npm run build 2>&1 | tail` reported exit 0 while the build had actually
  failed because `node_modules` was missing — the pipe returned `tail`'s status.
  Caught by looking at `dist/`, which was empty.

**Still open in Phase 0:** production redeploy. Merged to `main` as `2d25184`;
Vercel built the PR preview successfully (status *Ready*), so the branch compiles
in their environment — but ~15 minutes later the production URL still served the
old login copy. The preview is access-protected, so the deployed bundle could not
be inspected directly.

Two things to do in the Vercel dashboard, neither of which is reachable from
here: check whether the `main` commit appears in *Deployments* at all, and if it
does, why it was not promoted to production (production branch setting, an
"ignored build step", or a paused project). The PINs are dead in the database
either way, so this is a consistency problem rather than an exposure — but "the
fix is merged" and "the fix is live" are different sentences and only the first
one is currently true.

**A correction to this document's own reasoning.** Earlier drafts treated the
production placeholder reading `supervisor ama 634...` as proof that production
was built from older code than `main` (which held `634100101`). That inference
was too strong: an ellipsis in a rendered placeholder is exactly what a clipped
input looks like, so it may have been a rendering artifact. The drift is
unconfirmed, and the only solid observation is the one above — after the merge,
production did not change.

### Phase 1 — Release trust (≈2 days) — **DONE 09/11/2026, one item blocked on billing**

| Task | Notes |
|---|---|
| Restore the Actions runner, then confirm a real job with real steps | Account-level; verify by step count, not by green badge |
| Wire `bundle:check` into CI | `.github/workflows/ci.yml` |
| Reconcile the migration ledger | Insert 011–017 rows; do **not** replay |
| Revoke `EXECUTE` from `anon` on the 2 token-less write functions | Highest-value grant fix |
| Revoke `anon` on the remaining 52 token-first definer functions | Defence in depth |
| Single source of truth for the SLA | `activity.ts` + `012` + `013` |
| Add the 21 FK indexes | One migration |

**Outcome.**

*CI — blocked, and now for a known reason.* The failure annotation reads
**"The job was not started because your account is locked due to a billing
issue."** Earlier sessions recorded this as an unexplained account restriction;
it is billing. The repository is public, so Actions minutes are free — a billing
lock on the owning account blocks runs regardless of visibility. No workflow
change can fix it: the account owner clears it in GitHub → Settings → Billing.

`bundle:check` is now a CI step, so the moment runs resume the audit's P0 is
gated on every push. Because that is not today, `npm run hooks:install` wires
the same `npm run verify` to `git push` as a stopgap. It is a stopgap: it runs
only on machines that installed it and can be skipped with `--no-verify`.

*Ledger — done.* 8 rows back-filled for 011–018 (`created_by =
'ledger-reconciliation'`, `statements = NULL` because they were applied by hand
and **not** replayed), plus 019–020 for the work below. `list_migrations` now
returns 20 rows for 20 files.

*FK indexes — done.* The audit's 21 was exact: 35 foreign keys, 14 covered, 21
not. Migration 019 adds all 21; the same query now returns zero rows.

*Grants — the audit's advice was wrong, and following it would have broken the
app.* This is the most important correction in the whole review. The linter's 58
`anon`-executable definer functions are, for this architecture, correct: there is
no Supabase Auth, the browser holds the public anon key, and each function
validates `p_token` inside its own body via `get_session_user`. Revoking `anon`
from those functions does not harden anything — it turns every RPC into
`permission denied` and deletes the application. All 58 were checked
individually:

| Group | Count | Verdict |
| :--- | ---: | :--- |
| `authenticate_pin` | 1 | Must be anon — it issues the token. Lockout + 018 are the guard. |
| Trigger functions | 2 | Not callable via PostgREST (a `trigger` return type is not an RPC). |
| Token-first | 54 | 51 call `get_session_user`; 2 call `get_task` which does; 1 deletes the row for the token it is given. |
| `is_task_worker` | 1 | Internal helper. **Revoked** from `anon`/`authenticated` (020). |

Zero open doors. The trigger functions keep their grant deliberately: revoking
is cosmetic, and PostgreSQL's interaction between trigger execution and
`SECURITY DEFINER` privileges is subtle enough that a blind revoke risks
`broadcast_change` — the realtime feed — for a linter line.

*SLA — guarded, not unified.* The audit said two hardcoded sites; there are
five. Unifying them means rewriting four `SECURITY DEFINER` report functions to
swap a constant that already agrees, and a mistake there breaks the supervisor's
daily report silently. That is a worse trade than the duplication. Instead
`tests/sla.test.ts` anchors on the shape of an overdue check
(`< … - interval 'N days'`), finds all four, and fails if any differs from
`SLA_DAYS`. Verified by changing `SLA_DAYS` to 4: the test named all four sites.
It reads the repository only — a live edit in the SQL editor still drifts, which
is why the promise changes by migration, never by hand.

**Acceptance:** CI shows a job with >0 steps — **not met, billing**;
`bundle:check` runs there — met in config, unverified in a run;
`list_migrations` returns 20 — met; `is_task_worker` not anon-executable — met;
SLA drift — caught by test, not unified by design.

**Verified against the live database after the changes:** supervisor sign-in
succeeded, `list_open_tasks` returned 4, `my_team` 1, `group_overview` 5
members with a `counts` object, `ops_analytics` returned its `totals` key, and
`start_task` executed through `is_task_worker` without a permission error. The
test session and the task it started were both reverted.

### Phase 2 — Protect the service (Batch G; gated on billing)

| Task | Notes |
|---|---|
| Fund Pro, enable daily backups | Blocks everything else in this phase |
| **Restore drill** — restore to a scratch project and diff row counts | A backup never restored is not a backup |
| Uptime check on the production URL, alert to the owner | External watcher |
| Error capture (client + RPC failures) | Must not fire on the false errors we already fixed |
| Name an owner and a response window | Written, not implied |
| Optionally: IP-aware throttle, shorter session expiry | Only if the pilot widens |

**Acceptance:** one documented restore performed end-to-end with timings; an induced outage raises an alert within the agreed window; a known failure appears in error capture.

### Phase 3 — Honest demo (≈0.5 day)

- Correct `PRODUCTION_READINESS.md` (44/36 → 8 tasks, 0 photo, 0 demo).
- Either seed the demo history and label it, or remove the claim. The controls already exist in `Analytics.tsx`.
- Label any demo-derived figure on the Portfolio and report screens as demo.
- Validate the KPIs the audit questioned against the 8 real rows.

**Acceptance:** every number in the docs is reproducible from a query in the doc; no screen shows demo-influenced numbers unlabelled.

### Phase 4 — Interface honesty (≈2 days)

- Replace the roadmap panel with a **"today" dashboard**: jobs open, blocked, unassigned, crews out — operational content in the most valuable space on the screen.
- Translate `field ready` (template literal → i18n key).
- Extend the i18n scanner: template literals, single-quoted attributes, `{}` expressions. This is what makes Phase 4 stay fixed.
- Pagination / "showing X of Y" on task lists.
- Accessibility and small-screen pass on the technician view.

**Acceptance:** i18n test fails when a hardcoded English template literal is introduced; roadmap panel gone; every visible string resolves through `t()` in both languages.

### Phase 5 — Pilot expansion (defer until 0–4 are closed)

CRM integration, ONT data, SSO, multi-group rollout. Deliberately last: every item here increases the blast radius of anything left open above.

---

## 6. What I would tell head management

The system's core is sound: 204 tests, type-checked, a bundle budget, three role-separated portals, and an OCR path that never uploads a sheet. The audit found real problems, and they are concentrated in **publishing and operations**, not in the product's logic.

The three that decide whether this can hold customer data:

1. **Published PINs** — fixable in a day, must happen before any real subscriber record enters the system.
2. **No backups** — not fixable without funding; one bad delete is unrecoverable today.
3. **No alerting** — nobody would know the system was down until a technician said so.

Phases 0 and 1 are about a week of work and remove most of the risk. Phase 2 needs a $25/month decision. Phases 3–4 are honesty and polish, and they are the difference between a system that looks unfinished and one that looks finished.

I would not present the current demo figures to management again until Phase 3 is done.
