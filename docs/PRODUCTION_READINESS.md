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

**It is not yet something you should put real customer data into, and it is not
yet something you can hand over and walk away from.** There are two classes of
gap, and neither is a large build:

1. **Access control.** Today, anyone who knows the web address can read every
   customer's name, phone number and address *without signing in*. I verified
   this today with one request. This is the single thing that would end the
   conversation badly if a manager or IT person tried it — and it takes them
   under a minute to try.
2. **Operational trust.** No database backups, no error monitoring, no uptime
   alert, no browser tests, and hosting on a plan that pauses a quiet project
   and keeps one day of logs.

Everything else — the features, the language, the documentation, the design —
is genuinely in the state you would show people. Detail below.

---

## 2. Readiness scorecard

| Area | State | What it means in a meeting |
| :--- | :--- | :--- |
| Functional scope (5 modules) | ✅ complete | Nothing on the brief is missing |
| Bilingual EN/SO | ✅ enforced by test | Cannot drift back to English-only |
| Offline tolerance | ⚠️ online-only by your decision | Drafts survive a failed submit, nothing queues |
| **Access control** | ❌ **fails** | Anonymous read of all customer data |
| **File storage** | ❌ **fails** | Sheet photos in a public bucket, anonymous upload allowed |
| **Brute-force resistance** | ❌ **fails** | 4-digit PIN, unlimited attempts |
| Backups / disaster recovery | ❌ none on current plan | A bad delete is unrecoverable |
| Error monitoring | ❌ none | You learn about crashes by phone call |
| Uptime / alerting | ❌ none | Nobody is told when it goes down |
| Test coverage | ⚠️ 137 unit tests, **0 browser tests** | Logic is proven; the click-path is not |
| Mobile / PWA | ✅ installable, safe-area aware | Not yet held in a real technician's hand |
| Docs (runbook, limits) | ✅ good | But no technician-facing guide |
| Cost / licensing | ⚠️ free tiers | Needs ~$25–65/month to be legitimate |

---

## 3. The five things that fail a review — with evidence

### 3.1 Anyone can read the customer list without signing in

Every table is readable by the anonymous role:

```sql
-- 11 tables, all: FOR SELECT USING (true), role {public}
tasks, users, crews, crew_members, cableboxes, cablebox_logs,
cablebox_ports, import_batches, task_work_logs, dispatch_log, groups
```

Proof, run today against production with **no login at all**:

```
GET /rest/v1/users?select=username,full_name,phone,role
→ [{"username":"xasan","full_name":"Xasan Cali Nuur","phone":"634100102",…}, …]
```

The same request works against `tasks`, which holds customer names, phone
numbers and addresses. The anonymous key is inside the JavaScript bundle, so
this is not a secret anyone has to steal — it is published.

**Why it exists:** the app was built to be fast and simple, and the PIN system
is custom, not Supabase Auth, so table reads were left open and every write goes
through a `SECURITY DEFINER` function that checks the token. The *writes* are
safe. The *reads* are not.

**Why it is the one thing to fix first:** telecom customer data is exactly the
kind of data a manager has to be able to say "only our people can see this"
about. It is one PR of work (Batch B, already designed and deferred by your
instruction), and it is the difference between a demo and a system.

### 3.2 Sheet photos are in a public bucket with anonymous upload

```
storage.buckets:  sheet-images → public = true
storage policies: "sheet images read"   (public, bucket_id = 'sheet-images')
                  "sheet images upload" (public, INSERT allowed)
```

Every daily sheet is a photograph of a table of customer names, phone numbers
and line numbers. In a public bucket, any object URL is served without
authentication — and the database itself publishes the paths
(`import_batches.source_image_path`). Separately, the upload policy lets anyone
with the key write files into your bucket, which is a storage-cost and abuse
problem rather than a privacy one.

**Fix:** private bucket, signed URLs for the supervisor's review screen, and an
upload policy scoped to a server-checked session. Half a day.

### 3.3 A 4-digit PIN with no attempt limit

```
authenticate_pin(p_identifier, p_pin)
  — looks up by username or phone
  — compares crypt(pin, hash)
  — no attempt counter, no delay, no lockout
```

4 digits is 10,000 combinations. The username `supervisor` is guessable and is
in the demo documentation; the default PINs (`1234`, `1111`) are still active on
all five accounts. On a laptop, that is not "hard to break", it is "a few
minutes".

**Fix, in the same batch:** count failed attempts per account and per device,
lock after 5 for 15 minutes, force a PIN change on first login for any account
still on a default, and require 5–6 digits. The input already accepts 4–6.

### 3.4 No backups

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

### 3.5 Real data and demo data live in the same database

Of 44 jobs in production, **36 are demo** and **8 are real test rows**. That is
deliberate and one tap removes the demo set — for a first demo it is an asset,
because the screens are not empty. But it means:

* a manager looking at "completed jobs this month" is looking at mostly
  synthetic numbers unless you say so;
* the moment real sheets start flowing in, the demo rows must be cleared and the
  demo seeding turned off in production, or the analytics are wrong.

**Fix:** a "Go live" checklist in the runbook, and the demo banner that exists on
the Insights screen ("36 demo jobs are included in these numbers", with a
one-tap removal) repeated on the Overview and the daily report, where the
numbers are actually quoted.

---

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
* **It is documented.** `RUNBOOK.md` (rotate PINs, add a group, restore data),
  `KNOWN_LIMITS.md` (including the two exposures in §3), architecture and
  decision record.

---

## 6. The plan to close it

Four batches. **B is the only one that must happen before real customer data.**

| Batch | Contents | Why | Effort |
| :--- | :--- | :--- | :--- |
| **B — Access control** | Reads via token-scoped RPCs (or RLS keyed to the session token), private storage bucket with signed URLs, PIN attempt limits + forced first-login change, security headers, dependency + secret audit | Turns "demo" into "deployable" | 3–4 days |
| **G — Operational trust** | Supabase Pro (backups, no pause), uptime monitor with an alert to a real phone, error capture (own table or Sentry), a browser smoke test of the three critical paths on every deploy, restore drill performed and recorded | You can hand it over without being the only person who can fix it | 3 days |
| **H — Manager pack** | Audit screen, photo proof on completion, period reports + PDF, aging/SLA badge, read-only manager role | Answers the questions in §4 | 5–7 days |
| **I — Handover** | One-page technician guide (WhatsApp-able, bilingual), a 30-minute training script, data policy one-pager, release notes + version number on screen | The part that makes it *the department's* system rather than yours | 2 days |

Suggested order: **B → G → I → H.** B because it gates everything. G because
without it a single bad night undoes months. I before H because adoption
problems are more expensive than missing reports.

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

1. *"Who can see customer data right now?"* — Today: anyone with the address.
   Say that plainly and say it is the next thing being fixed (§3.1), with a date.
   Improvising here is what destroys trust later.
2. *"What happens if the internet is down?"* — The technician's typed notes are
   kept on the device, but the job cannot be submitted until there is signal.
   That is a deliberate trade-off for this phase; write it down rather than
   promising offline.

---

## 9. If you present it before Batch B

The honest risk: a technically curious manager will paste the URL into a browser
or hand it to IT, and within a minute see a list of customer phone numbers with
no login. That is not a subtle flaw and it is not explainable-away in a meeting.

Everything else can be presented as "in progress". This one cannot. **Fix §3.1
and §3.2 first** — that is roughly four days of work, and it changes the
sentence from *"it works"* to *"it is ready to be deployed."*
