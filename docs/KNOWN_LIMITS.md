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

## 7e. A crew is one or two people — **CLOSED** (migration 023)

**This was an open defect.** The model says a two-person vehicle and the copy
calls the second member a partner, but nothing enforced either bound. Measured
on 15/11/2026: both active crews had **zero** members, and earlier the same day
one had three.

It mattered because `today_summary` reported "crews out of N" by counting active
crew rows. An empty crew counted toward N, so the supervisor's first screen
could read `0/2` while nobody was available — or `2/2` while a three-person crew
had taken the only vehicle.

Closed by migration 023:

* a trigger rejects a third member on any crew;
* `upsert_crew` refuses to save an **active** crew with nobody in it (inactive
  crews may be empty — that is how a vehicle is retired without deleting its
  history);
* `crews_total` counts only crews with at least one member, and `crews_empty`
  reports the stranded ones so the screen can say so instead of hiding it;
* an empty crew is not offered as a dispatch target, and both the team screen
  and the dispatch board name it.

**What is still not enforced:** nothing stops a crew being *deactivated* while
jobs are assigned to it. Those jobs keep their `assigned_crew_id` and stay
visible to the members, which is the desirable behaviour — but the crew will not
appear in the dispatch target list.

**Live data as of 15/11/2026:** both crews still have zero members. The
supervisor has to add technicians; the system now says so rather than quietly
counting them as capacity.

---

## 7f. The screen says which day it counted, and it means the phone's day

`today_summary` takes the date from the browser. That is deliberate — Hargeisa is
UTC+3 and the server is UTC, so the three hours around midnight belong to
whichever day the person living in them says. The panel prints that date
under "TODAY".

The limit: a phone with a wrong clock gets wrong "today" counts. The counts are
still internally consistent (they describe the day the phone claims), and a
technician whose clock has drifted a full day would see it plainly in the label.

---

## 7g. Larger text scales but does not re-flow

The **Aa** control grows type up to Extra large (21 px root). It does not
re-lay-out the screens, so at the largest setting:

* long customer names can wrap to three lines on a 360 px phone,
* dense tables in the manager portfolio may clip a column,
* the header can hide the *Sign out* label below 380 px wide (the button is
  still there, still labelled for screen readers).

This is a deliberate trade: re-flowing every screen for three sizes would triple
the layout surface area and the testing that goes with it. If a specific screen
is unreadable at Extra large for a real person, that is a bug worth reporting —
it should be handled there rather than by shrinking the mode.

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
## 7h. A planned job leaves today's list, but stays on the phone

**Behaviour, not a defect — recorded so nobody is surprised by it.**

A job whose `scheduled_date` is in the future:

* is **removed** from the dispatch board's pool and from every crew lane, because a job planned
  for Thursday is not something to send a crew to on Tuesday;
* appears in a **Planned** list on the board, with its date, and one tap opens the job where the
  date can be changed;
* stays on the **technician's phone**, labelled (`in 2 days`), but is never offered as "next job"
  until its day arrives. Hiding it risks a technician never learning it exists; labelling it
  cannot cause harm.

`scheduled_date` is set by the supervisor or defaults to the day the job arrived. The department
sheets have **no planned-date column** — only `DateIn` and `DateOut` — so a date cannot be
imported. Anyone expecting the plan date to come from the sheet is expecting something that is
not there.

**The limit:** a job planned for a later day is still visible to the supervisor, but nothing
reminds anyone on the morning it becomes due. It simply reappears in the pool. There is no
notification.

---


## 7i. The customer message goes to whoever the phone picks

**Behaviour worth understanding before relying on it.**

"On my way" records the time and opens WhatsApp with the text ready. It does **not** address the
message, because no customer WhatsApp number is stored — the app has `customer_phone` from the
sheet and nothing else, and adding a second number would be one more field for a supervisor to
maintain and one more place for a wrong number to live.

So WhatsApp opens its own contact picker: **the technician chooses who to send to.** That is also
why the URL never contains a phone number, which is the point — a customer's number does not
travel in a link.

**The consequence to be honest about:** pressing the button and stopping there records the time
but tells the customer nothing. The screen says so ("WhatsApp opens and you press send"), and the
job then shows *Travelling since HH:MM*, so a supervisor can see a stamp with no way to know
whether the message was actually delivered. Delivery is not tracked and cannot be, without a paid
sender.

**Nothing is sent automatically, ever** — not on assignment, not on completion, not on a schedule.
Every message requires a person to press send.

---

## 7j. No clock times are ever promised to a customer

The message is day-granular by design: *"planned for Thu 26/11/2026 … we cannot give an exact
time"*. A department that says "between 2 and 4" and arrives at 6 has broken a promise it never
needed to make.

`tests/customerUpdate.test.ts` fails the build if a clock time, an `am`/`pm`, or a "9 to 11"
window ever reaches the text. The limitation is the mirror image: a customer cannot use the
message to plan their afternoon precisely, and some will ask for a time on the phone. The honest
answer is the one the message already gives.

## 7k. Directions are a search, not a location

**The limit, stated plainly: this app does not know where any cable box is.**

`cableboxes` holds `box_code`, `xaafada` and `location_notes`. `tasks` holds the same text fields.
**No latitude, no longitude, anywhere in the schema.** "Find on map" opens a map search for
`<box code>, <neighbourhood>` and labels itself as a search.

**Consequence:** a box code that is not unique in the city can resolve to the wrong place, and a
neighbourhood name can resolve to the middle of that neighbourhood. The technician is expected to
compare the box name on the map with the box name on the card — a check they are already able to
make, which is why the feature is honest rather than merely approximate.

**The cheapest real fix, if accuracy is ever needed:** capture a coordinate **once per box, on
site**, from a technician's phone, stored on `cableboxes` with who and when. It requires a visit to
each box and should be its own phase. Guessing a coordinate now would be worse than having none,
because a pin on a map is believed.

**Also missing here:** the supervisor's job sheet has no `cablebox_notes` (only the technician's
route payload does), so a supervisor's "copy the address" is box code and area only.

---

## 7l. Map providers are free and cannot bill us

Google Maps search URLs and OpenStreetMap search URLs are plain links opened in a browser. There
is **no API key, no account, no SDK and no embedded map**, so there is no tile quota to exceed and
nothing that can begin charging.

The deliberate trade: an embedded map would look better and would introduce a quota and a key.
A `wa.me`-style link cannot. If a supervisor ever wants a map drawn inside the app, that is a
different decision with a bill attached, and it is not made here.

## 7m. Materials are usage, not inventory

**There is no stock figure anywhere in this app, and this is deliberate.**

A stock level is `received − used`. Nothing records a delivery: no purchase order, no goods-in
step, no delivery note. A number computed as `0 − used` would be negative from the first job and
drift further from the shelf every week, and it would look exactly like a real figure on a screen.

So `task_materials` records what was **consumed**, which is a verifiable fact, and every screen
calls it usage. The line *"This counts what was used, not what is left"* appears wherever a total
does, and `tests/materials.test.ts` fails the build if a label or an identifier claims otherwise.

**What this can do:** tell the department what a period consumed, per item and per job count, so a
reorder can be based on evidence.

**What this cannot do:** say how many routers are on the shelf. Answering that needs a
`material_deliveries` table and one person to record arrivals — a different feature with a
different failure mode, not a missing column here.

**Also not tracked:** which technician used what. `recorded_by` exists on each line, so a per-tech
breakdown is *possible*, but the plan asked for per-period usage and a per-tech report invites
ranking technicians on consumption, which is not a measure of anything useful.

---

## 7n. Materials are attached to a job, not a store

`add_task_material` requires a task that the caller may act on (`is_task_worker`). There is no way
to record "the store issued 50 connectors to nobody in particular" — the recording is always
"this job used these".

The consequence: consumables that leave the store without a job (a broken drum, a return, a
transfer between groups) have nowhere to go and will make the usage total understate what actually
left. The store's own paperwork remains the authority; this figure is the job-level view.

## 7o. **Jobs do not record which box they belong to** — this blocks per-box history

Measured on the live project, 15/11/2026: of eight tasks, **zero** carry a
`cablebox_id`, and **zero** carry a `cablebox_code_raw`. Both columns exist and
both are null.

**What this means:**

* the box fault leaderboard (v1.7.0) is **empty**, correctly, because there is
  nothing to rank;
* any future "history for this box" screen has the same problem;
* `cableboxes.fault_count` is incremented on completion, but only for jobs that
  reference a box — so it too is unmoved by this data.

**The fix is upstream, not in the app.** The import and the phone-in form both
need to carry the box code, and the group's sheets need a column the OCR can map
to `cablebox`. Where a job genuinely has no box (a backbone fault), that is fine
— but it must be the exception, not all eight rows.

`box_fault_history` matches a box **two ways** (the FK, then a case-insensitive
match on the raw code) precisely so that a partially-filled import still
attributes what it can. Faults that match neither are counted as
`unassigned_faults` and shown as a warning, so this gap is visible rather than
looking like a healthy estate.

---

## 7p. Box fault counts are reported faults, not confirmed faults

The window applies to `reported_date` — when the customer reported the fault.
That is deliberate: a fault is evidence about the hardware the moment it is
reported, and waiting for completion would hide the box that is failing right
now.

The consequence: a fault reported by mistake and later cancelled is excluded,
but a fault that turns out to be the customer's own router still counts against
the box until somebody cancels it. If the group cancels mistakes reliably, the
figure is sound. If it does not, the figure overstates boxes where customers
misreport.

`open_faults` is shown separately so an unfixed backlog is never hidden inside a
total.

---

## 7q. "Repeat fault" counts jobs, and a job is not a fault

The escalation at three faults per 90 days counts **fault jobs sharing a line
number**. It does not know how many of them were the same underlying problem.

A short drop cable that was never replaced after the first visit produces three
separate jobs on one line, and the watch list is right to name it. But so does a
customer who reports the same dead router three times without letting anyone in.
The screen says **"worth investigating"** rather than "repeat offender" for
exactly this reason: the count is a reason to look, not a conclusion.

`is_repeat_fault` is shown beside the count (`2/3`) so a supervisor can see how
many of the jobs the importer itself recognised as returns. It is deliberately
**not** the trigger — see Phase 7 in the implementation plan for why a rule built
on that flag needs a fourth fault to fire.

## 7r. A shared phone number is never treated as a shared customer

Identity is `line_number`. Two customers can share a phone number — a shop, a
family, a borrowed handset — and a rule built on phone numbers would put an
innocent household on a supervisor's list. The note under the watch list states
this in both languages, because a list that silently ignores it invites the
reader to assume the opposite.

## 7s. A job with no line number cannot be escalated, and that is on purpose

Jobs with a blank or whitespace-only `line_number` are excluded from grouping.
Without that exclusion, every unattributable job in the group would look like a
single customer with a serial fault — the worst false positive this feature can
produce. The per-job lookup returns `known: false` in that case and the badge
renders nothing.

The cost: an anonymous job contributes no evidence either way. If blank line
numbers are common in the sheets, they should be fixed at import rather than
worked around here.

---

## 7t. The workload panel measures the job, not the person

`tech_workload` counts only the minutes a job was marked **running**. It
therefore includes a technician's own pauses and excludes several things that
are not their fault: travel before Start, waiting for access without pressing
Block, and the gaps between jobs. It says nothing about effort, skill or
quality, and it deliberately does not rank anybody.

The standing warning in the card is printed, not hidden in a tooltip.

## 7u. An impossible timer is set aside; merely enormous ones are shown

A completion is **impossible** when its recorded time is longer than the job has
existed — arithmetic, not opinion. Those are counted as `implausible_timers`,
excluded from the median, and stated on screen.

The rule deliberately does **not** catch the other case: the real 45.7-hour timer
from §7d belongs to a job old enough that 45 hours is technically possible. It
passes into the set. The median absorbs it (3 minutes), and the card prints the
**longest** job beside the median, in amber above four times the median, so a
forgotten timer is visible rather than quietly averaged away.

The consequence to keep in mind: if most timers in a window were forgotten, the
median is measured over a set that contains them. It is more robust than the
mean, not immune.

## 7v. A crew's number is not a person's number

`ops_analytics.techs` is keyed by **crew** ("F1 - Crew A") and carries no user
id. The workload panel is a separate function keyed by person. The two lists can
disagree, and that is expected: two people in one crew will each show the jobs
they personally closed, while the crew row shows the crew's total.

Neither is wrong. Do not add the two columns together.

## 7w. A duration is capped at 500 completions per person for the median

The duration array returned per technician stops at 500 completions, newest
first, to keep the payload bounded. The completion **count** is computed
separately and is never capped, so `completed` is always the true figure.

In practice 500 completions in one window is far beyond this group's volume. If
it is ever reached, the median describes the most recent 500 jobs only.

---

## 7x. Line history shows what was recorded, not what happened

The "Earlier jobs on this line" panel lists rows in `tasks` matching that line
number. A visit that nobody wrote on a sheet is not in the list, and neither is
one recorded under a different line number — except the single carryover linked
by `previous_task_id`, which is deliberately pulled in as well.

The panel does not claim completeness, and a short history should not be read as
"nobody has been here".

## 7y. A repeated reading points at the line, not at a diagnosis

When two or more visits show a dBm within 2 dB of each other, the panel says the
fault is *more likely* in the drop or splitter than indoors. That is a hint for
where to look first, not a finding: a customer whose router is unplugged three
times produces exactly the same pattern of "no reading", and the copy is worded
to say "more likely" for that reason.

Readings are skipped when absent rather than treated as 0 dBm. Zero is a perfect
signal, and reporting it for a job nobody measured would point a technician away
from the fault.

---

## 7z. "Due today" counts the report date, not the dispatch date

`sla_watch` puts a job on the list when the **customer reported it** exactly
three days ago. It does not know when the job was assigned, and it makes no
claim about how long anybody has been working on it.

A job that was assigned yesterday and reaches its deadline today appears on the
list alongside one that has sat unassigned since the call came in. That is
correct — the customer measures from the day they called, which is the rule the
whole app uses — but a supervisor reading the list should not conclude the crew
sat on it.

The unassigned count is shown separately and sorts to the top, because that is
the case where nobody has taken responsibility.

---

## 8a. The job sheet has no per-job dBm target

Nobody recorded a target against an individual job, so the printed sheet cannot
compare "target vs achieved". It prints the reading and the window the rest of
the app treats as healthy (−27 … −8 dBm), and says so in words. That is a
weaker claim than a target would be, and it is the strongest one the data
supports.

If the department wants a per-job target, it needs a column and a decision about
what the target is — not a number invented in the print view.

## 8b. The printed sheet shows what the database holds at that moment

Printing before the job is completed produces a sheet with no completion time,
no reading and no notes — because none exist yet. The sheet omits them rather
than printing blanks.

A sheet printed mid-job is a snapshot. If the job changes afterwards, the paper
does not update, and the reference at the top (`#A1B2C3D4`) is what ties it back
to the record.

---

## 8c. Two kinds of photo double the worst case per job

Photos are `bytea` inside the database, not object storage. The cap was 3 per
job; it is now **3 per kind**, so 6. At the client's compression (~640 px,
quality 0.6, usually 40–120 kB) that is roughly 0.25–0.75 MB per fully
photographed job, inside a 500 MB free-plan database.

This is a real capacity consideration, not a theoretical one. If photo volume
grows, the honest fix is Supabase Storage (free tier, 1 GB) rather than
shrinking the proof. Nothing in this migration makes that harder: `kind` is a
column either way.

## 8d. A before photo is evidence, not a measure of anybody

The before photo records the state on arrival. It is deliberately **not** used
to score technicians, and the copy on screen says so. A photo that feeds a
performance figure is a photo a technician will stage, and a staged photo is
worse than no photo.

It is also optional: nothing in the completion path waits for one, so a
technician without a working camera can still close a job.

## 8e. The command page shows up to 600 open jobs, and says so when it might be more

`list_open_tasks` returns at most **600** rows. The attention rail's counts come
from `today_summary`, which counts *every* open job in the database, so those
numbers are always exact. The **work queue** and the **urgent** figure are
counted from the loaded list, so at exactly 600 rows they mean "at least this
many". The page detects that case and replaces the "N more waiting" line with
the standard truncation notice rather than an understated number.

600 open jobs is roughly a year of work for this group. The check exists so the
day it stops being true is a notice, not a wrong number.

## 8f. The activity window is thirty days, not seven

The chart draws seven days but the data behind it covers thirty.

This is not padding. On 24/11/2026 the newest event in the live database was
from 16/11 — the department had not recorded anything for eight days, and a
seven-day window was **empty**. A correct, blank panel is indistinguishable from
a broken one, so:

* the window is thirty days, and
* when the drawn week is silent, both panels **name the last day anything
  happened**.

A supervisor can now tell a quiet week from a feed that has stopped. Neither
panel invents activity.

## 8g. The command page's "updated N ago" is honest about failure

If a load fails, the page says **"Partly out of date"** and names the parts that
did not arrive — it does not show the last-known numbers as if they were current,
and it does not show zeros.

The one thing it cannot do is keep retrying forever: a failed realtime
subscription recovers on the next change or the next manual refresh. If a
supervisor sees stale numbers and no banner, the connection is down and the page
does not know yet. Refresh is always one tap away in the header.

## 8h. Auto-cluster cannot route a job with no area and no box

`clusterTasks` groups work by cablebox first, then by neighbourhood. A job with
neither lands in a single "No area / box" bucket with every other such job.

On 24/11/2026 that was **8 of 19 open jobs**, including **both urgent ones**.
Auto-cluster would have handed one crew a batch spanning the city under that one
heading.

The board now says this before the plan is made, not after it is sent. What it
**cannot** do is invent the missing place: a job's area or box has to be added by
somebody who knows the address. The banner says exactly that.

## 8i. The dispatch pool is ordered by promise, not by distance

The board's order is urgent → carried-over → oldest → line number. That is the
order customers are served in, and the same order the crew reads in the WhatsApp
message.

It is **not** a shortest-route order. There are no coordinates for these jobs and
none are invented; the only geography is the box code and the neighbourhood name,
which is what `clusterTasks` groups on. A crew that wants the shortest drive
still needs the map link in the job sheet.

## 8j. "Routable" means "has a box or an area", nothing more

The header's routable/total figure counts a job as routable when it carries a
cablebox code or a neighbourhood. It does **not** mean the address is correct, nor
that the cluster it lands in is close by — only that a cluster can be formed
around it at all.

That is the honest lower bound: it is the difference between a plan that can be
made and one that cannot.
