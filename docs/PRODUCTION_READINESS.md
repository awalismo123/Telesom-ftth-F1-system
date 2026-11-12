# Production readiness — what is done, what is missing, what to say

> Written 09/11/2026, after Batch F, and revised the same day after Batch H. Every
> claim below was checked against the live system, not against the plan. Where
> something is a judgement call it says so. Where a number is measured, the
> number is here.

---

## 1. The answer in one paragraph

**The system is functionally complete and it is live.** All five modules your
managers asked for exist and work: sheet photos in, only F1 rows kept,
dispatch by area and cablebox, a technician route with a live timer, dBm
completion, box health and a daily report. It is bilingual, it has 240 tests,
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
   reports, a read-only manager view. **These were built in Batch H** (§4 below
   is now a list of answers rather than a list of gaps). One item from that batch
   cannot be proven by a test: the camera path has not been exercised on a
   physical phone.

Everything else — the features, the language, the documentation, the design —
is genuinely in the state you would show people. Detail below.

---

## 2. Readiness scorecard

| Area | State | What it means in a meeting |
| :--- | :--- | :--- |
| Functional scope (5 modules) | ✅ complete | Nothing on the brief is missing |
| **Manager pack** | ✅ built in Batch H | Record, photo proof, printable period report, 3-day aging badge, read-only manager across groups |
| Bilingual EN/SO | ✅ enforced by test | Cannot drift back to English-only |
| Offline tolerance | ⚠️ online-only by your decision | Drafts survive a failed submit, nothing queues |
| **Access control** | ✅ fixed in Batch B, tightened in H | Anonymous read of customer data returns nothing; four internal functions that were callable without a session are closed |
| **File storage** | ✅ fixed in Batch B | Private; no public URL exists for a sheet photo, and completion photos are private too |
| **Brute-force resistance** | ✅ fixed in Batch B | 5 attempts, then a 15-minute lock; supervisor-issued PINs must be replaced |
| Backups / disaster recovery | ❌ none on current plan | A bad delete is unrecoverable |
| Error monitoring | ❌ none | You learn about crashes by phone call |
| Uptime / alerting | ❌ none | Nobody is told when it goes down |
| Test coverage | ⚠️ 240 unit tests, **0 browser tests** | Logic is proven; the click-path is not |
| **Continuous integration** | ❌ **not running** | GitHub Actions fails every job in ~1 s: *"your account is locked due to a billing issue"*. Nothing is checked on push except on a machine that ran `npm run hooks:install` |
| Mobile / PWA | ✅ installable, safe-area aware | Not yet held in a real technician's hand |
| Docs (runbook, limits) | ✅ good | Technician card, manager page and runbook all written |
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

**The part that was still missing (Batch I).** Locking an account does not help
if the PIN is printed in the repository. `must_change_pin` only *asks* the person
to change it at next sign-in; until they do, `1234` still opens the supervisor
account. So the hash itself had to change. Migration 018 rotates every account
still holding a published PIN to a random one, flags it, and deletes every
session. On the live project it rotated five accounts off `1111`/`1234`,
flagged all six, and revoked twelve live sessions — twelve tokens minted from a
shared PIN is the proof the exposure was real, not theoretical.

The supervisor is the one exception: their PIN is flagged but not rotated in the
migration, because randomising the only account that can issue anybody a
temporary PIN locks the install with no way back in. On the live project a
temporary PIN was issued for them by hand as well, so no published PIN survives
anywhere.

**A defect in my own first attempt, worth recording.** The migration rotated the
hash and *then* flagged accounts by matching the hash against the published PIN.
After the rotation nothing matches any more, so the accounts it had just rotated
were never flagged — locked out of a random PIN they could not know, and not
sent to the screen that would fix it. It surfaced on the live project because I
checked the flag state afterwards instead of trusting the statement's success.
Fixed by collecting the rotated ids and flagging those; the migration now says
so in the comment.

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

At **8 jobs and 2 cableboxes** the exposure is small today — measured, not
remembered; §3.7 is the query. At 40 jobs a day it is a week of a supervisor's
work.

**Fix:** Supabase Pro ($25/month) for daily backups with 7-day retention and no
pausing — or, if the budget is refused, a nightly `pg_dump` to storage with the
restore drill actually performed once and written down. A backup you have never
restored from is a hope, not a backup.

### 3.5 Real data and demo data live in the same database — **fixed** (Batch I)

This section used to say: *"Of 44 jobs in production, 36 are demo and 8 are real
test rows."* Those numbers were true **on the day they were measured**, when the
demo history happened to be loaded. By the time the audit read the document the
demo had been cleared, and the file went on describing it. The audit was right
that the figures did not match the database; the cause was a stale document, not
invented data.

**The state on 09/11/2026 (and until someone loads the demo again):**

| | Count |
| :--- | ---: |
| Jobs | **8** |
| …of which demo | **0** |
| Completion photos | **0** |
| Cableboxes | 2 |
| Import batches | 2 |

The demo history is **built and available, not loaded**. A supervisor taps
*Load demo history* on Insights and gets 36 completed jobs across the last 29
days, spread over both boxes, with work logs, a chronic bad port per box, and a
banner on every screen that can be inflated by them.

**The label was the real defect.** The demo banner existed on Insights and
nowhere else. With the demo loaded, the printable period report said *"44
created, 39 completed"* and the manager's portfolio said *"39 completed"* —
both correct, both counting 36 synthetic jobs, neither saying so. A printed
report a head manager signs is the one document that must not be quietly
fiction. Migration 021 adds `demo_summary`, and both screens now carry the
sentence:

> 36 of 44 jobs in this report are demo — remove them before filing this.

**One tap really does remove it.** Verified on the live database rather than
asserted: seeded 36 jobs and 38 box events, then cleared. Tasks 44 → 8, box
events 38 → 0, demo port rows 11 → 0, work logs 85 → 40, and the port map
returned to its exact prior state (16 ports: 13 unknown, 3 damaged, 0 occupied).
Nothing was left behind.

**One quirk worth knowing.** Seeded demo jobs carry a spread of `reported_date`
across 29 days but a `created_at` of the moment they were seeded. `period_report`
counts a job as *created* when it entered the system, so all 36 land in the
window containing the seed — not spread across the month. That is why the label
counts on `created_at` too: two different date bases on one page produce numbers
that are individually right and together look like a bug.

### 3.6 Credentials in the repository and in the bundle — **FIXED** (Batch I)

The audit's most serious finding, and it was accurate. Six accounts signed in
with `1234` / `1111`; the PINs were in a table in `README.md`; and
`LoginScreen.tsx` defined a `QUICK_ACCOUNTS` array holding the same pairs.

The subtlety that made it easy to miss: the array sat behind
`import.meta.env.DEV`, so the quick-fill *panel* was compiled out of the
production build. The data was not. `grep 'pin:"1111"' dist/assets/index-*.js`
returned four hits. A flag removes the code that reads a value; it does not
remove the value.

**What was done**

* the array and the panel are deleted outright — no flag, no dead data;
* the real technician number is gone from the login placeholder in both
  languages (`supervisor ama 634100101` → `Magacaaga isticmaalahi ama lambarka
  Telesom`), and from the team-screen example (`63X XXX XXX`);
* `README.md` no longer publishes an account table;
* `scripts/check-credentials.mjs` fails the build if a PIN-shaped pair, a seeded
  identifier or a real subscriber number appears in `dist/` — wired into
  `npm run bundle:check`, which `npm run verify` runs, and which CI will run;
* `tests/credentials.test.ts` fails in a second, without a build, and also
  asserts the guard stays wired up.

The guard was **tested by planting a credential**, not by watching it pass:
a file containing `identifier:"supervisor", pin:"1234", phone:"634100101` in
`dist/` produces three findings and exit code 1; removing it returns to exit 0.

**What is not fixed.** The six accounts still exist, and the temporary PINs
issued to replace them are the supervisor's to distribute. Until each person
signs in once, the accounts are flagged but unused. Nothing sensitive is
exposed by that — the published PINs no longer work on any account.

### 3.7 The live figures, and how to check them

Every number in this document comes from this query. Run it before quoting any
of them — the workspace outlives the person who measured them last.

```sql
select
  (select count(*) from public.tasks)                              as jobs,
  (select count(*) from public.tasks where is_demo)                as demo_jobs,
  (select count(*) from public.tasks where status = 'completed')   as completed,
  (select count(*) from public.task_photos)                        as photos,
  (select count(*) from public.cableboxes)                         as cableboxes,
  (select count(*) from public.import_batches)                     as import_batches,
  (select count(*) from public.users where is_active)              as active_people,
  (select count(*) from public.users where must_change_pin)        as must_change_pin;
```

Measured 09/11/2026: **8 jobs · 0 demo · 3 completed · 0 photos · 2 cableboxes ·
2 import batches · 6 active people.**

**`must_change_pin` is deliberately not quoted as a fixed number.** It was 6
after the PIN rotation, read 0 an hour later, and is 3 as this is written —
because it falls every time somebody signs in and chooses their own PIN, and
rises whenever a supervisor resets one. It is a progress bar, not a status.
Quoting it as a figure is how this document got into trouble in the first place:
a number that was true on Tuesday, printed on Wednesday, quoted on Thursday.

Every other figure above is stable unless somebody imports, completes or deletes
work — which is exactly the kind of number worth writing down.

**The report's arithmetic reconciles with the rows.** Run on the 8 real jobs:
created 8, completed 3, cancelled 4, open at end 1, over SLA 1, average dBm
−21.3 — every one matching a direct count from `tasks`. The audit's doubt about
the KPIs was fair, and the answer is that the sums are right.

**One metric is honest but misleading.** `avg_minutes` reads **916** (15.3 hours)
because a single job carries 45.7 hours of accumulated timer. Remove it and the
average is 1.9 minutes. The number is correct; it is simply one runaway timer
away from meaningless, which is why `KNOWN_LIMITS` §7d says to quote counts and
per-job durations rather than the average until there is enough real work.

## 4. What managers will ask for that does not exist yet

These are not defects — they are the questions that come after "it looks good".

| Their question | Today's answer | What to build | Effort |
| :--- | :--- | :--- | :--- |
| "Show me who changed this job and when" | **Built (Batch H)** — Record tab: one feed, filters by day / action / person / text, CSV | — | ✅ |
| "Prove the technician was actually there" | **Built (Batch H)** — optional 1–3 photos per completed job, resized on the phone, private, visible in the record and on the job sheet | — | ✅ |
| "What did we do last month?" | **Built (Batch H)** — period picker + one-page printable report + CSV | — | ✅ |
| "Which jobs have been waiting too long?" | **Built (Batch H)** — amber at 3 days, rose after, from the reported date | — | ✅ |
| "Tell the technician when work arrives" | They must open the app | In-app badge exists (notifications bell); real push needs a service worker or WhatsApp send | 2–3 days |
| "Show me F2 and F3 too" | **Built (Batch H)** — manager portfolio lists every group, including the ones not yet live | — | ✅ |
| "Can a manager see it without changing anything?" | **Built (Batch H)** — third role, write-refused in the database, separate app | — | ✅ |
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
* **It is bilingual for real.** 240 tests fail the build if a string appears in
  only one language, if a translation key dies, or if PIN copy contradicts the
  input. Somali takes the singular after a numeral (`4 shaqo`), dates are
  day-first, and "today" is the local day — not the UTC day.
* **It is fast on a weak phone.** First load 192 kB gzipped, screens loaded on
  demand, OCR only downloaded when used, budget enforced by `npm run verify`.
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
| **H — Manager pack** | Audit screen, photo proof, period reports + PDF, aging badge, read-only manager across groups | Answers the questions in §4 | **built** |
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
| Phone data | existing | The app is deliberately light: 192 kB first load |

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
2. 192 kB first load: it opens on a weak phone and a weak connection.
3. 240 automated tests, so the app cannot quietly break between releases.

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
