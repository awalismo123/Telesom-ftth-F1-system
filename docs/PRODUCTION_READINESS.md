# Production readiness — what is done, what is missing, what to say

> Written 09/11/2026, after Batch F. Every claim below was checked against the
> live system, not against the plan. Where something is a judgement call it says
> so. Where a number is measured, the number is here.

---

## 1. The answer in one paragraph

**The system is functionally complete and it is live.** All five modules your
managers asked for exist and work: sheet photos in, only F1 rows kept,
dispatch by area and cablebox, a technician route with a live timer, dBm
completion, box health and a daily report. It is bilingual, it has 137 tests,
and it installs on a phone.

**It is now safe to put real customer data into it.** The hole described in the
first version of this document — every customer name, phone number and address
readable without signing in — is closed, and closed the same way the writes were
already protected: by the database, not by the screen.

**It is not yet something you can hand over and walk away from.** The remaining
gaps are operational, not structural:

1. **Operational trust.** No database backups, no error monitoring, no uptime
   alert, no browser tests, and hosting on a plan that pauses a quiet project
   and keeps one day of logs.
2. **The questions managers ask next** — an audit screen, photo proof, period
   reports, a read-only manager view. The data for the audit screen already
   exists; only the screen is missing.

Everything else — the features, the language, the documentation, the design —
is genuinely in the state you would show people. Detail below.

---

## 2. Readiness scorecard

| Area | State | What it means in a meeting |
| :--- | :--- | :--- |
| Functional scope (5 modules) | ✅ complete | Nothing on the brief is missing |
| Bilingual EN/SO | ✅ enforced by test | Cannot drift back to English-only |
| Offline tolerance | ⚠️ online-only by your decision | Drafts survive a failed submit, nothing queues |
| **Access control** | ✅ fixed in Batch B | Anonymous read of customer data now returns nothing |
| **File storage** | ✅ fixed in Batch B | Private; no public URL exists for a sheet photo |
| **Brute-force resistance** | ✅ fixed in Batch B | 5 attempts, then a 15-minute lock; supervisor-issued PINs must be replaced |
| Backups / disaster recovery | ❌ none on current plan | A bad delete is unrecoverable |
| Error monitoring | ❌ none | You learn about crashes by phone call |
| Uptime / alerting | ❌ none | Nobody is told when it goes down |
| Test coverage | ⚠️ 137 unit tests, **0 browser tests** | Logic is proven; the click-path is not |
| Mobile / PWA | ✅ installable, safe-area aware | Not yet held in a real technician's hand |
| Docs (runbook, limits) | ✅ good | But no technician-facing guide |
| Cost / licensing | ⚠️ free tiers | Needs ~$25–65/month to be legitimate |

---

## 3. What failed a review, and what was done about it

This section is kept as it was written *before* the fix, with the outcome added,
because "we fixed it" is only credible next to what it looked like.

### 3.1 Anyone could read the customer list without signing in — **FIXED**

Every table was readable by the anonymous role:

```sql
-- 11 tables, all: FOR SELECT USING (true), role {public}
tasks, users, crews, crew_members, cableboxes, cablebox_logs,
cablebox_ports, import_batches, task_work_logs, dispatch_log, groups
```

Proof, run against production with **no login at all**:

```
GET /rest/v1/users?select=username,full_name,phone,role
→ [{"username":"xasan","full_name":"Xasan Cali Nuur","phone":"634100102",…}, …]
```

The anonymous key is inside the JavaScript bundle, so this was not a secret
anyone had to steal — it was published.

**What was done (migration 011).** The write path was already safe: every
mutation goes through a `SECURITY DEFINER` function that validates a session
token. Reads now work the same way. Eleven token-checked functions
(`list_open_tasks`, `group_overview`, `get_task`, `list_work_logs`, `my_team`,
`list_import_batches`, `list_live_moves`, `list_resumed_since`, `list_groups`,
`upload_sheet_image`, `get_sheet_image`) each resolve the caller from the token
and refuse a group the caller does not belong to. All eleven open SELECT
policies were dropped.

The same request that returned names and phone numbers now returns `[]`:

```
GET /rest/v1/users?select=full_name,phone
→ []
GET /rest/v1/tasks?select=id
→ []
```

`tests/access.test.ts` fails the build if any file in `src/` reads a table
directly, if a read function loses its token check, or if an open policy is
restored.

### 3.2 Sheet photos were in a public bucket — **FIXED**

```
storage.buckets:  sheet-images → public = true
policies:         read (public) · upload (public INSERT)
```

Every daily sheet is a photograph of customer names, phone numbers and line
numbers, and object URLs were served without authentication.

**What was done.** The bucket is private and its policies are gone. New sheets
go into a `sheet_images` table with row-level security and no policies, written
and read only through `upload_sheet_image` / `get_sheet_image` — so no public
URL for a customer sheet exists to be guessed. The client no longer calls
`storage.from`, `getPublicUrl` or `createSignedUrl` anywhere (enforced by test).

**One consequence, stated plainly:** the three photos imported before this
change are still in the private bucket but are no longer reachable from the app.
That is the correct trade — they remain on the phone that took them.

### 3.3 A 4-digit PIN with no attempt limit — **FIXED**

```
authenticate_pin(p_identifier, p_pin)
  — no attempt counter, no delay, no lockout
```

4 digits is 10,000 combinations, the username `supervisor` is guessable, and the
default PINs (`1234`, `1111`) were active on all five accounts.

**What was done.** Five wrong PINs lock the account for fifteen minutes, and the
counter resets on success or after the lock expires. Length is checked before a
hash is computed. `must_change_pin` was added: an account created by a
supervisor — or whose PIN a supervisor resets — cannot reach the app until the
person chooses their own, and the change clears the flag.

The lockout is **verified against the live database**, not just written: five
wrong PINs, then the correct one, and the correct one is refused.

**A defect found while verifying it, worth recording.** The first version raised
an exception on a wrong PIN. That aborts the request's transaction — which
rolled back the `failed_attempts` update it had just written. The counter never
moved, so the lockout never happened. The function now *returns*
`{ ok: false, reason: 'locked' | 'invalid' }` instead of raising, and a test
forbids a `RAISE` in that function.

### 3.4 No backups — **still open (Batch G)**

The Supabase project is on the Free plan: **no automated backups, no
point-in-time recovery, one day of logs, and the project pauses after a week of
low activity.** If someone deletes the wrong rows, or a migration goes wrong,
the data is gone — there is no undo and no support escalation on that plan.

At 44 jobs and 2 cableboxes the exposure is small today. At 40 jobs a day it is
a week of a supervisor's work.

**Fix:** Supabase Pro ($25/month) for daily backups with 7-day retention and no
pausing — or, if the budget is refused, a nightly `pg_dump` to storage with the
restore drill actually performed once and written down. A backup you have never
restored from is a hope, not a backup.

### 3.5 Real data and demo data live in the same database — **open, by design**

Of 44 jobs in production, **36 are demo** and **8 are real test rows**. For a
first demo that is an asset, because the screens are not empty. But:

* a manager looking at "completed jobs this month" is looking at mostly
  synthetic numbers unless you say so;
* the moment real sheets start flowing in, the demo rows must be cleared and the
  demo seeding turned off in production, or the analytics are wrong.

**Fix:** a "Go live" checklist in `RUNBOOK.md`, and the demo banner on the
Insights screen ("36 demo jobs are included in these numbers", one-tap removal)
repeated on the Overview and the daily report, where the numbers are quoted.

## 4. What managers will ask for that does not exist yet

These are not defects — they are the questions that come after "it looks good".

| Their question | Today's answer | What to build | Effort |
| :--- | :--- | :--- | :--- |
| "Show me who changed this job and when" | Data exists (`dispatch_log`, `task_work_logs`, `cancelled_by`), **no screen** | Activity / audit screen, filterable by job, person, day; exportable | 2 days |
| "Prove the technician was actually there" | dBm + notes + timestamps | Optional photo on completion (camera, in-browser, same storage discipline), stored per job | 1–2 days |
| "What did we do last month?" | 30-day analytics + today's CSV | Period picker (this week / month / custom) and a one-page PDF | 2 days |
| "Which jobs have been waiting too long?" | Board is ordered by date, no aging badge | "Waiting 3 days" badge + an SLA target per job type | 1 day |
| "Tell the technician when work arrives" | They must open the app | In-app badge exists (notifications bell); real push needs a service worker or WhatsApp send | 2–3 days |
| "Show me F2 and F3 too" | `upsert_group` exists; supervisor is scoped to one group | A manager role that sees all groups, read-only | 2–3 days |
| "Can a manager see it without changing anything?" | Two roles only: supervisor, technician | Read-only manager role | 1 day |
| "Is this version the one I approved?" | No version number anywhere | Version + build date in the footer of the login and the hub | 2 hours |
| "What happens when the network is down?" | Online-only, by your decision | Offline queue, or an explicit written acceptance of the risk | 3–5 days / 0 |
| "Who is allowed to see customer numbers?" | Everyone with the URL | **That is 3.1** — fix before asking | — |

The first three are what turns "a good app" into "a system the department runs
on". The audit screen in particular is cheap: the data is already there.

---

## 5. What is already strong — say this with confidence

* **The ocr is real.** Sheet photos are read in the browser with Tesseract —
  no image is uploaded to any AI service, nothing leaves the phone. Only rows
  where Group = F1 are kept, and duplicates are **never** auto-imported; each
  one is confirmed by a person. Lab-verified 19/19 on Cilada and 13/13 on
  Galinta.
* **The work model is right.** A blocker pauses the timer and the job stays
  blocked and resumable; dBm is mandatory to complete; typed notes survive a
  failed submit; several timers are allowed with a confirmation.
* **It is bilingual for real.** 137 tests fail the build if a string appears in
  only one language, if a translation key dies, or if PIN copy contradicts the
  input. Somali takes the singular after a numeral (`4 shaqo`), dates are
  day-first, and "today" is the local day — not the UTC day.
* **It is fast on a weak phone.** First load 181 kB gzipped, screens loaded on
  demand, OCR only downloaded when used, budget enforced in CI.
* **Reads are authorised, not open.** Eleven token-checked functions replaced
  every direct table read, the sheet archive is private, five wrong PINs lock an
  account, and a supervisor-issued PIN cannot survive first use. `src/` contains
  no table read at all — a test enforces it.
* **It is documented.** `RUNBOOK.md` (rotate PINs, add a group, restore data),
  `KNOWN_LIMITS.md`, architecture and decision record.

---

## 6. The plan to close it

Four batches. **B is done** — the gate before real customer data is open.

| Batch | Contents | Why | Effort |
| :--- | :--- | :--- | :--- |
| **B — Access control** ✅ **done** | Token-scoped reads, private sheet archive, PIN attempt limits, forced first-login change, security headers, dependency audit | Turns "demo" into "deployable" | 3–4 days |
| **G — Operational trust** | Supabase Pro (backups, no pause), uptime monitor with an alert to a real phone, error capture (own table or Sentry), a browser smoke test of the three critical paths on every deploy, restore drill performed and recorded | You can hand it over without being the only person who can fix it | 3 days |
| **H — Manager pack** | Audit screen, photo proof on completion, period reports + PDF, aging/SLA badge, read-only manager role | Answers the questions in §4 | 5–7 days |
| **I — Handover** ✅ **done** | `docs/HANDOVER.md`: the bilingual technician card, the 30-minute training run, a one-page data policy, release notes; version stamp on the sign-in screen | The part that makes it *the department's* system rather than yours | 2 days |

Suggested order: **G → H.** G because without it a single bad night undoes months
of work, and it needs your Supabase billing decision before anyone can start it.
H because those are the questions that will be asked in the second meeting.

The management deck is in `docs/MANAGEMENT_DECK.md` — eight slides, written to be
said rather than read, with the honest answer to every question in §9.

---

## 7. What it costs to run properly

| Item | Cost | Note |
| :--- | :--- | :--- |
| Supabase Pro | $25 / month | No pausing, daily backups 7-day retention. Free plan is not suitable for live work |
| Vercel | $0–20 / month | The Hobby tier is for personal, non-commercial projects — confirm before running Telesom work on it, or move to Pro |
| Domain (optional) | ~$12 / year | `f1.telesom.so` reads better than a vercel.app URL |
| Phone data | existing | The app is deliberately light: 181 kB first load |

**≈ $25–65 per month, all in.** Against one avoided repeat visit per week, that
pays for itself immediately — that comparison is worth putting on the slide.

---

## 8. What to say in the meeting

**One paragraph:**

> "Group F1's daily sheet used to be a photo in a WhatsApp group and a
> supervisor's memory. This system reads that photo, keeps only the F1 rows,
> groups the work by area and cablebox, sends each technician their own list on
> their phone, and records how long each job took and what the optical reading
> was. At the end of the day it produces the report as a CSV and as a WhatsApp
> message. It works in Somali and English, it runs on any phone with a browser,
> and it does not send our customer photos to any outside service."

**Three numbers:**

1. Five modules, all built — sheets, dispatch, technician, execution, analytics.
2. 181 kB first load: it opens on a weak phone and a weak connection.
3. 137 automated tests, so the app cannot quietly break between releases.

**The pilot, not the rollout:**

> "One group, one month, real sheets. We compare repeat visits, average time per
> job, and how many jobs sit more than three days. If it does not beat the
> current process on those three, we stop."

That framing is what gets a yes, because it costs them a month and no money.

**Two questions to answer honestly if asked — do not improvise:**

1. *"Who can see customer data?"* — "Only someone signed in. Every read goes
   through a function that checks the session and the group; without a session
   the database returns nothing." That is true today and it is verifiable in
   front of them.
2. *"What happens if the internet is down?"* — The technician's typed notes are
   kept on the device, but the job cannot be submitted until there is signal.
   That is a deliberate trade-off for this phase; write it down rather than
   promising offline.

---

## 9. If they bring someone technical

They will paste the URL into a browser and look at the network tab. What they
will find now, and what you can say about each:

| They try | What happens | What to say |
| :--- | :--- | :--- |
| `GET /rest/v1/tasks` with the key from the bundle | `[]` | "Every read goes through a function that checks the session. The key is an identifier, not a password." |
| Six wrong PINs | The account locks for 15 minutes | "Five attempts, then a lock. No default PIN survives first use." |
| Sign in as a technician, look for supervisor tools | No supervisor screen exists in that session | "The shell is chosen by the session's own role, and the server refuses supervisor actions from a technician token." |
| Look at the JavaScript bundle | React, the app code, and a public anon key | "The key is public by design; it grants what the database allows, and the database now allows nothing without a session." |
| Open a sheet photo URL | No URL exists | "The photos live in a private table, not a public bucket." |

What they will still find missing is in §3.4 and §6 — backups, monitoring, and a
browser test. Those are operational, and the honest answer is "in the next
batch", not "soon".
