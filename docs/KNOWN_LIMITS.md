# Known limits

Written down on purpose. Every one of these is a decision someone can revisit;
none of them is a surprise waiting for the first bad day.

---

## 1. The app is online-only

No offline queue, no service-worker caching of data. A phone with no signal can
open the app shell but cannot load or save work. The offline banner says so
instead of failing silently, and **typed work is never lost**: notes and dBm
readings are kept in a local draft and re-offered when the connection returns.

*Why:* a correct offline sync for assignments, timers and cancellations is a
conflict-resolution problem, not a caching problem. Half of it would be worse than
none — two technicians working the same job offline is exactly the case a field
system must get right.

**Deliberately deferred by the owner.**

---

## 2. Search can show a technician a job that is not theirs — but not another group

**Corrected 09/11/2026.** This entry used to claim `global_search` returned jobs
from other groups. It does not: the function refuses a group the caller does not
belong to, and the probe below confirms it.

What is still true: a technician searching their **own** group sees the line
number, customer name and phone of jobs assigned to somebody else. That is a
deliberate trade — a technician covering for a colleague needs to find the job —
but it is broader than "my route".

```
global_search(technician, F2, '634')  → refused: Not allowed for this group
global_search(technician, F1, '634')  → allowed
```

Narrowing it to "my jobs plus my crew's" is a policy question for the
department, not a defect: it costs a technician the ability to look up a line
that a customer calls about directly. Recorded so the decision is made on
purpose rather than by default.

---

## 3. Realtime is a second delivery path to the same data

Every signed-in client subscribes to `postgres_changes` on `tasks` with the public
anon key. Same data as the REST API, second channel. When the policy above is
fixed, the realtime filter must follow it.

If a network blocks WebSockets, the screen falls back to a three-minute refresh
while visible — slower, never wrong.

---

## 4. OCR is good, not perfect

The extractor runs entirely in the browser (Tesseract + grid-line detection, no
image ever leaves the phone). On the real sample sheets it reads 19/19 Cilada and
13/13 Galinta rows. It is still OCR:

- a blurry or angled photo loses rows — the review screen shows what it read
  before anything is imported, and nothing is imported without confirmation;
- one known cell (`Ref-Number 634477140` on the Galinta sample) is misread and must
  be corrected by hand;
- mixed hand-writing is not attempted at all.

**Nobody's work is imported without a person seeing the rows first.**

---

## 5. Timers are server-derived and assume the crew works the job as one

A job assigned to a 2-tech crew has **one** timer. Both members can see and start
it; starting it twice does not double-count. If the two technicians work
separately on different halves, that is still one duration.

Several timers can run at once (a technician may start a second job), but the app
asks for confirmation first — the plan's rule.

---

## 6. Cancelled jobs keep their numbers

`accumulated_seconds` for a cancelled job is frozen and excluded from "jobs
completed" analytics. It is **not** excluded from time-spent reports if a report is
ever written on raw work logs — no report currently does.

---

## 7. Photos, attachments and signatures

**Completion photos exist since Batch H; attachments and signatures do not.**

A technician can take **one to three photographs** when a job is completed. They
are resized on the phone to 640 px / JPEG 0.6 (typically 40–120 kB), stored in a
private table (`task_photos`), and reachable only through a function that checks
the caller's group. A supervisor sees a *Photo* button on the completion in the
Record feed and on the job sheet.

Limits that are deliberate:

- **Not mandatory.** A phone with a dead camera must not stop a job from being
  closed. dBm is mandatory; the photo is evidence, not the completion.
- **Upload is a second call.** The job closes first, then the photo is sent. If
  the upload fails, the job stays complete and the technician gets a retry button
  — the bytes are kept in memory, not re-taken.
- **`bytea` in Postgres, not object storage.** Same reasoning as sheet photos in
  Batch B: one storage discipline, one access rule. The cost is that photos count
  against the 500 MB Free-plan database.
- **Storage will fill before anything else.** At 40 completed jobs a day, every
  one photographed at ~100 kB, that is about **4 MB a day / 120 MB a month**. The
  Free plan is 500 MB shared with the data. Either raise the plan, lower the
  quality (`PHOTO_QUALITY` in `src/lib/photo.ts`), or accept that proof is only
  kept for the recent past — **decide before the pilot, not after it fills**.
- **No bulk export of photos.** One at a time, by a signed-in person, on purpose.
- **Attachments other than photos and a signature capture remain unbuilt.**

---

## 7b. A manager can see every group's customer data

By design, and it is the widest read permission in the system: a manager sees
every group's jobs, customer names, phone numbers, notes and completion photos.

- It is **read-only**: writes from a manager session raise
  `A manager account is read-only` (trigger, migration 014), and no manager
  function contains an `INSERT`, `UPDATE` or `DELETE`.
- It is **not audited**: nothing records which manager opened which group's jobs.
  An access log per manager is a sensible next step if the role leaves the
  department.
- A **supervisor cannot create** a manager — that would let one group's
  supervisor mint an account that reads the others. Manager accounts are created
  by SQL; see `RUNBOOK`.
- Managers have no search box and no notifications: both would lead into screens
  built for actions the account cannot take.

---

## 7c. Everyone can still sign in with the PIN in the README — **CLOSED** (Batch I)

This section described a real hole: `must_change_pin` existed but had never been
set on the accounts that already existed, so six seeded accounts signed in with
`1234` / `1111` — printed in the README and, because a `DEV` flag only removes
the code that *renders* a value, still present in the production bundle.

Migration 018 changed the hashes, not just the flags. Every account on a
published PIN was rotated to a random one, flagged for a forced change, and all
sessions were deleted. Measured afterwards: **0 of 6 accounts accept a published
PIN**; 12 live session tokens were revoked. Temporary PINs were issued in person,
and people clear their flag by choosing their own PIN at first sign-in. The count
of `must_change_pin` therefore moves every time somebody signs in — it is a
progress bar, not a status, and is not quoted here as a figure.

The regression guard is now a build step: `scripts/check-credentials.mjs` fails
the build if a PIN pair, a seeded identifier or a real subscriber number appears
in `dist/`, and it was verified by planting one. See
`docs/PERFECTION_PLAN.md` §18 for why the flag did not work.

**What is still true:** a manager account is created by SQL (`RUNBOOK` §10a) and
must be given a PIN the person changes on first use. Nothing enforces that at
creation time beyond the flag itself.

---

## 7d. The average completion time is one long timer away from meaningless

Measured on the live data (8 real jobs, 09/11/2026): the period report shows
**avg_minutes 916** — 15.3 hours. That is arithmetically correct and practically
useless. Three completed jobs carry durations of 45.7 hours, 3 minutes and 29
seconds, so the average is entirely the first one.

The 45.7-hour figure is a timer that was started and left running, which the
design allows (a job may stay *in progress* overnight, and a crew that forgets to
stop it accumulates).

**Why it stays as it is:** changing a metric after a manager has quoted it is
worse than a metric that is honest about its shape. The fix, when it is wanted,
is a median alongside the mean, plus a rule that flags any completion whose
duration exceeds the job's own age — not a silent cap.

**What to do meanwhile:** quote the completed count and the per-job durations,
not the average, until there is enough real work for one outlier to stop
dominating.

---

## 8. iPhone specifics

- Installable via Safari → *Share* → *Add to Home Screen*; it runs full-screen with
  its own icon.
- `tel:` links open the dialler as expected.
- Background tabs pause their timers — that is intentional (battery), and the
  displayed time is recomputed from server timestamps on return, so nothing is
  lost.

---

## 9. Scale

Comfortable for a group of **tens of open jobs and a handful of technicians**. The
dispatch board loads up to 600 open jobs and does not window the list. Beyond a
few hundred open jobs, the pool and the lanes will feel heavy — that is the point
to add virtualised lists, not before.

The database indexes the shapes the app asks for (`group_id, status`,
`cablebox_id`, `line_number`, `assigned_*`).

---

## 10. Language coverage

Interface copy is fully Somali/English. Two exceptions, both documented:

- **Sheet column values** are shown as they appear on the department's sheets
  (`Galinta`, `Cilada`, complaint codes). Translating them would make the app
  disagree with the paper.
- **Customer names and notes** are free text in whatever the supervisor typed.

Dates are `dd/mm/yyyy`, numbers use `,` thousands separators, and Somali counts use
the singular after a numeral ("3 shaqo", not "3 shaqooyin") — see
`src/lib/format.ts`.

---

## 11. One language left, on purpose

Arabic and Amharic are not in the dictionary. The `translations` object is typed, so
adding a language is a compile-checked change: add the block, and TypeScript lists
every missing key.

---

## Before this handles real customer data

`docs/PRODUCTION_READINESS.md` is the full assessment written for a management
audience. The short version:

**Closed in Batch B (migration 011).**

1. **Reads are authorised.** The 11 open `SELECT USING (true)` policies are
   gone; every read goes through a token-checked function scoped to the caller's
   group. An unauthenticated request now returns `[]`.
2. **The sheet archive is private.** No public URL exists for a customer sheet.
3. **PINs are limited.** Five wrong attempts lock an account for 15 minutes, and
   a PIN issued by a supervisor must be replaced at first sign-in.

**Still open — operations, not structure.**

4. **No backups** on the current plan, and a Free project pauses when idle.
   Batch G.
5. **Demo and real data share a database.** Clearing the demo set is a go-live
   step, written down in `RUNBOOK.md`.

Anything in this file that is not in that list is a limitation, not a blocker.
