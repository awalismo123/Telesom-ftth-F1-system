# Handover pack — the technician card, the training hour, the data policy

> Everything in this file is written to be handed over, not read by a developer.
> It is deliberately bilingual where it leaves the building: a technician reads
> Somali, a manager reads English, and nobody should need a translator for the
> two pages that matter.

---

## 1. The technician card (one page, WhatsApp-able)

**Print it, or send the Somali half to the group chat.** Two screens wide, no
scroll on a phone.

```
┌─────────────────────────────────────────────┐
│  TELESOM F1 — SHAQADAADA MAANTA            │
│                                             │
│  1. Fur link-ga. Geli magacaaga iyo PIN.   │
│     (PIN-ka waxaa ku siiyay kormeeraha —    │
│      marka hore waa inaad beddeshaa.)       │
│                                             │
│  2. Waxaad arki doontaa SHAQADAADA kaliya.  │
│     Shaqo kasta waxay leedahay:             │
│       • Lambarka khadka (line)              │
│       • Magaca macmiilka iyo telefoonkiisa  │
│       • Xaafada iyo sanduuqa (FAT)          │
│                                             │
│  3. Riix telefoonka si aad u wacdo.         │
│                                             │
│  4. Marka aad gaarto:  BILOW (Start)        │
│     ↳ Saacaddu way socotaa.                 │
│                                             │
│  5. Haddii aad shaqada qaban karin:         │
│     XAYIR (Block) + sababta.                │
│     ↳ Saacaddu way istaagtaa.               │
│     ↳ Marka aad dib u bilaabayso: DIB U     │
│       BILOW (Resume).                       │
│                                             │
│  6. Marka aad dhammeeyso:  DHAMMEE          │
│     ↳ WAA QASAB inaad geliso dBm.           │
│     ↳ Qor waxaad sameysay.                  │
│                                             │
│  ⚠ Ha ka bixin shaqada mid kale.            │
│  ⚠ Haddii internet-ku go'o, qoraalkaaga     │
│     lama tirtirayo — dib u isku day.        │
└─────────────────────────────────────────────┘
```

And the same card in English, for the supervisor's copy:

```
┌─────────────────────────────────────────────┐
│  TELESOM F1 — YOUR WORK TODAY              │
│                                             │
│  1. Open the link. Sign in with your name   │
│     and PIN. (The supervisor gave you the   │
│     PIN — the app will ask you to change it │
│     the first time.)                        │
│                                             │
│  2. You see only YOUR work. Each job shows: │
│       • Line number                         │
│       • Customer name and phone             │
│       • Area (Xaafada) and box (FAT)        │
│                                             │
│  3. Tap the phone number to call.           │
│                                             │
│  4. When you arrive:  START                 │
│     ↳ the timer runs                        │
│                                             │
│  5. If you cannot do the job:               │
│     BLOCK + the reason.                     │
│     ↳ the timer stops; the job stays yours  │
│     ↳ when you can go back: RESUME          │
│                                             │
│  6. When you finish:  COMPLETE              │
│     ↳ dBm is required                       │
│     ↳ write what you did                    │
│                                             │
│  ⚠ Never start two jobs on purpose.         │
│  ⚠ If the signal drops your typed notes are │
│     kept — try again.                       │
└─────────────────────────────────────────────┘
```

**Photo proof (optional, and worth taking)**

When a technician completes a job the completion form offers **Take a photo**.
It opens the camera, shrinks the picture on the phone (640 px, roughly 40–120 kB,
so it does not eat their data), and attaches it to the finished job. A supervisor
sees a green *Photo* chip on that completion in the record, and on the job sheet.

Two sentences to say with it:

* "The photo is how the department proves the joint was made — take it of the
  work, not of the customer."
* "If it will not upload, the job is still finished. Press retry; do not
  photograph it twice."

It is **not** mandatory, on purpose: a phone with a dead camera must not stop a
job from being closed.

---

**Three things to say out loud when handing a phone over**

1. "The timer is your record, not a stopwatch. It is how the department knows
   how long a job really takes — nobody is checking whether you were fast."
2. "Block it, do not fake it. A blocked job with a reason is a fact the
   supervisor can act on; a job you never touch is a mystery."
3. "Your PIN is yours. If someone else uses it, the record says you did the
   work."

---

## 2. The training hour (30 minutes, run it once)

Run it in the yard, with the phones the team will actually use, before the first
real sheet. Do not demo on a laptop.

| Min | What | Who holds the phone |
| --- | :--- | :--- |
| 0–3 | Why: one photo replaces the WhatsApp group + the supervisor's memory. What changes for them: they get their own list. | Supervisor speaks |
| 3–8 | Sign-in: the PIN they were given, and being asked to choose their own. **Everyone signs in on their own phone now.** | Each technician |
| 8–13 | The route screen. Find your own name on the list. Tap a phone number — does it open the dialler? | Each technician |
| 13–20 | One real job, start to finish: START → (pretend to work) → COMPLETE with a dBm. Use a test job, not a customer's. | One technician, others watch |
| 20–24 | A blocked job: BLOCK with "customer unreachable" → RESUME. Show that the timer stopped. | One technician |
| 24–27 | What happens when the signal drops: type a note, turn on aeroplane mode, press Complete, see the error, turn it back on, press again — the note is still there. | Supervisor demonstrates |
| 27–30 | Questions, and the card (§1) to everyone in the group chat. | All |

**What "done" looks like:** every technician has signed in on their own phone,
has completed one test job, and has the card in their chat.

**Do not** train all five on one phone. The session belongs to whoever signed in
last, and that is exactly the mistake that puts a supervisor's screen in a
technician's hand.

---

## 3. Data policy — one page for the manager

**What is stored**

| Data | Where | Who can see it |
| :--- | :--- | :--- |
| Customer name, phone, address, line number | Database | Any signed-in member of Group F1 |
| The sheet photo an import came from | Private table | Any signed-in member of Group F1, through the app |
| Technician timings, dBm readings, notes | Database | Any signed-in member of Group F1 |
| Completion photos (0–3 per job) | Private table | Any signed-in member of Group F1, through the app |
| The record of who changed what, when | Database, read-only | Group F1 members, and a manager |
| PINs | Hashed (bcrypt), never readable | Nobody — not even a developer |
| Session tokens | The technician's own browser + the database | That person |

**What is not stored, ever**

* Nothing is sent to a third-party AI or OCR service. Sheet photos are read
  **inside the phone's browser**; the picture never leaves the device for
  recognition.
* No location, no camera roll, no contacts.
* No analytics or tracking scripts.

**Who can do what**

* A **technician** sees their own route and their crew's; they cannot assign
  work, register a box, or see another group.
* A **supervisor** sees all of Group F1 and can assign, cancel, reopen, register
  boxes and manage people.
* A **manager** sees every group, including every group's customer names, phone
  numbers, notes and photos — and can change nothing: the database refuses every
  write from a manager session. Nothing records which manager looked at which
  group; say that out loud before granting the role.
* **Nobody** can read data without signing in — the database returns nothing at
  all to an anonymous request. This is enforced by the database, not by the
  screen.

**Retention** — everything is kept until it is deleted. Job history is the point
of the system, so it is not pruned automatically. Deleting a person does not
delete their work; deactivating them keeps the record intact.

**Where it runs** — Supabase (database, `eu-west-1`) and Vercel (the web app).
Both are outside Somalia; this is worth stating plainly to whoever signs off.

**What to do if a phone is lost** — the supervisor resets that person's PIN
immediately (Team → edit → new PIN). The old session stays valid until it
expires or the person signs in again on another device; if that matters, the
Supabase dashboard can end sessions.

---

## 4. Release notes

### v1.14.0 (15/11/2026) — before and after

A technician can now photograph the state they found, not only the work they
finished.

* **This required changing a rule, not just adding a button.** The server
  refused *any* photo unless the job was completed — correct for proof, and
  impossible for a before photo. `after` still needs a completed job; `before`
  only needs a job that exists and is not cancelled.
* **A before photo never becomes the proof.** Only an after photo moves
  `tasks.proof_photo_id`, so a job photographed on arrival is not recorded as
  having photographic proof of completion.
* **Optional means optional.** Nothing in the completion path waits for one, and
  the job closes normally without it.
* **Nothing was rewritten.** `kind` defaults to `after`, so every existing photo
  reads as what it actually is. No backfill.
* **The old upload call still works**, kept as a thin wrapper rather than a
  default argument — two functions that could both match a four-argument call is
  where PostgreSQL has to guess.
* **The cap is 3 per kind**, so 6 per job. That doubles the worst case in a
  500 MB database and is written down in `KNOWN_LIMITS` §8c.

### v1.13.0 (15/11/2026) — the last step before the crews see it

Bulk reassignment now asks first. Picking a technician or crew opens a summary
that names the target, the number of jobs, the first few line numbers, and
anything worth noticing — before anything changes.

* **It was a single tap.** Twenty jobs moved, the audit log recorded it, and the
  crews found out when their phones changed. A mistake there is not undoable
  without another bulk operation in the opposite direction.
* **The confirm names the jobs, not just the count.** "20 jobs" with no evidence
  of which is the box people dismiss on reflex.
* **Urgent jobs and already-assigned jobs are called out.** Reassigning work that
  already belongs to somebody takes it off them, and nobody tells them.
* **Cancel performs no call at all.**

### v1.12.0 (15/11/2026) — a job sheet you can carry

The execution sheet gains **"Job sheet"**: a one-page print view for a single
job — line, customer, phone, area, box, port, type, times, time on job, dBm,
blocker and notes, with a signature block.

* **Empty fields are left out, not printed as "—".** A page of dashes teaches
  the reader that dashes are noise, and then a genuinely missing port number
  looks like everything else.
* **It prints the reading against the app's healthy window** (−27 … −8 dBm),
  because there is no per-job target in the data and inventing one would be
  worse than saying which window is used.
* **Explicit action, one job at a time.** The sheet carries a name, phone and
  address; there is no bulk print.
* Uses the browser's own print dialogue — no new dependency, and the same
  mechanism as the period report.

### v1.11.0 (15/11/2026) — the jobs still worth saving

The supervisor's landing page gains **"Due today"**: the jobs that reach the
three-day promise today, with the customer, the phone number and who — if
anyone — is assigned.

* **The list is the ones that are not late yet.** `over_sla` and the red `late`
  badge count promises already broken. These are the jobs where doing something
  now still keeps the promise.
* **`SLA_DAYS` is still 3.** A warning list is not evidence for changing a
  promise made to customers, and the migration hard-codes the constant rather
  than reading a setting.
* **The boundary matches everywhere else**: due at exactly three days, late at
  four — the same rule `agingBand` puts on every job card.
* Unassigned jobs sort first, then urgent, then the oldest report. A late count
  is shown separately so the two are never confused.

### v1.10.0 (15/11/2026) — somebody has been here before

The job sheet gains "Earlier jobs on this line": every job recorded against the
same line number, newest first, with its date, type, outcome, dBm reading,
technician and notes.

* **Collapsed, and it does not query until opened.** A technician opening a job
  pays nothing for a lookup they did not ask for.
* **Cancellations are included.** Somebody probably visited and found nothing;
  leaving it out makes the history shorter than the customer's memory of it.
* **Keyed on the line, never the name.** Names are typed from a photograph of a
  spreadsheet and drift between sheets, so grouping on a name splits one
  customer into two histories.
* **A missing dBm is skipped, not read as 0.** Zero dBm is a perfect signal, and
  saying that about a job nobody measured would be a lie.
* When several visits show the same reading within 2 dB, the panel says the
  fault is more likely in the drop or splitter than indoors.
* A job with no line number says it cannot be looked up — a different sentence
  from "no earlier jobs", because they are different facts.

> **What it does not claim.** The list is what was recorded, not what happened.
> A visit nobody wrote down is not in it.

### v1.9.0 (15/11/2026) — who is carrying too much

Analytics gains "Technician workload — last N days": per person, open jobs,
running, blocked, completed, the **median** time on a job, the longest, and the
day they are busiest.

* **A leaderboard was removed.** The existing "Teams & technicians" card sorted
  by jobs closed and drew a bar scaled to whoever closed the most. A technician
  measured on jobs closed will close a job before it is fixed. It is now
  alphabetical, the bar is gone, and every number is still there.
* **Median, not average.** The live average is 916 minutes because one timer
  was left running for 45.7 hours. The median of the same three jobs is 3
  minutes, which describes the job instead of the accident.
* **Impossible timers are counted, not hidden.** A completion whose recorded
  time exceeds the job's own age is set aside — nobody can work on a job for
  longer than it has existed — and the card says how many were set aside.
* **The 45-hour outlier is still visible.** It sits on a job old enough to
  "plausibly" take that long, so it is not impossible; the card prints the
  longest time beside the median and flags it when it is more than four times
  the middle figure.
* **The note is printed in the card, not in a tooltip**, and it is accurate: a
  blocker *pauses* the clock, and travel before Start and the gaps between jobs
  are not counted.

> **What this does not say.** It does not measure effort, speed or quality. It
> measures how long jobs were marked running — which includes a technician's own
> delays and excludes several outside their control. Nobody is ranked.

### v1.8.0 (15/11/2026) — the line that keeps coming back

A line with three fault jobs in 90 days is now flagged, on the supervisor's
Analytics tab and on the job sheet both roles open.

* **Counted from the faults, not from the "repeat" flag.** The importer only
  flags a line that comes back *after a completed job*, so three real faults
  produce two flags — a rule built on the flag needs a fourth fault to fire, and
  it misses any job that arrives while an earlier one is still open. The count
  is of the non-cancelled fault jobs sharing a line number in the window.
  `is_repeat_fault` is shown beside it as evidence (`2/3`), never as the trigger.
* **Identity is the line number.** Never the phone: a shop, a family or a
  borrowed handset would turn an innocent household into a repeat offender.
  Blank line numbers are excluded, so anonymous jobs cannot all merge into one.
* **It says "worth investigating".** Not "repeat offender" — that is a judgement
  about the person, and the copy avoids it in both languages.
* Cancelled faults are excluded and open faults are counted separately.

> **On today's data this list is empty, and that is honest.** No line in the
> project has three fault jobs in 90 days yet, and the importer flag has never
> once been set. The feature is live and will populate as faults accumulate.

### v1.7.0 (15/11/2026) — which box keeps breaking

Analytics gains "Box faults — last N days", worst first, for the same 7/30/90
window as the rest of the page.

* **Windowed, not lifetime.** `cableboxes.fault_count` cannot answer "this
  month" and cannot be reset without losing the history behind it. The count is
  computed from jobs at query time, so it can be recomputed for any window.
* **Windowed on the report date, not the completion date.** Five faults reported
  this week and none fixed yet is the *worst* box in the group; scoring on
  completion would rank it zero.
* **Cancelled faults are excluded; open faults are counted separately.**
* **Faults that name no box are surfaced, not swallowed.**

> **This panel is empty on today's data, and that is the finding.** Zero of the
> eight jobs in the project carry either a `cablebox_id` or a
> `cablebox_code_raw`. Until imports and manual entry record which box a job
> belongs to, this leaderboard has nothing to rank — and the same gap limits any
> per-box history.

### v1.6.0 (15/11/2026) — materials used

A technician can record what a job consumed: metres of drop cable, connectors,
a router. The supervisor gets a usage figure per period in Analytics.

* **Usage, never stock.** A stock figure is `received − used`, and nothing in
  this system records a delivery. `0 − used` would be negative and drift from
  the shelf weekly, and somebody would reorder against it. The screen says
  *"This counts what was used, not what is left. Stock on hand is not
  tracked."* — and a test fails the build if any label claims otherwise.
* **One tap for the common items**, because the person recording this is
  standing in a stairwell. The unit is remembered between lines.
* **A failure never blocks completion.** Materials matter; they matter less
  than recording the dBm reading and closing the work.
* **Corrections are allowed on a completed job.** The shop is counted the next
  morning and a missing line is found then; refusing the fix would leave the
  record permanently short.
* **Locked down like the photos.** RLS on, no policies, `REVOKE ALL` from
  `anon` and `authenticated` — reachable only through token-checked functions.
* **2.35 kB, on demand.** The picker is a lazy chunk; the hot bundle grew by
  0.1 kB.

### v1.5.0 (15/11/2026) — directions, honestly

A technician can now tap "Find on map" on a job and land on a map search for
that cable box.

* **It is a search, and the screen says so.** *"Opens a map search for the box
  name — not a saved pin."* There are no coordinates anywhere in this system,
  and a pin on the city centre would send someone to the wrong street while
  looking authoritative.
* **The query is box code plus neighbourhood**, because a box code is only
  unique within the group's list, not within a city.
* **Location notes are excluded from the search** and included in "copy the
  address" — they are written for colleagues ("port 7 clip loose"), not for a
  geocoder, but they are exactly what gets someone to the right cabinet.
* **Google Maps by default, OpenStreetMap available, `geo:` for offline map
  apps.** All three are plain URLs: no API key, no account, no billing, no tile
  quota. Nothing can start costing money.
* **A link inside a button is now a test failure.** The first version of the
  route-card link sat inside the card's own `<button>` — invalid HTML, and a tap
  opened two things at once. The type check cannot see that; a scan over every
  `.tsx` now can.

### v1.4.0 (15/11/2026) — telling the customer

The app has never spoken to a customer. A person waiting at home had no way of
knowing whether anyone was coming today or on Thursday — and the supervisor had
no quick way to say so.

* **"On my way"** on the technician's job sheet. It records `en_route_at` and
  opens WhatsApp with the message ready. It does not send: WhatsApp's own
  contact picker opens, and a person presses send. No customer number is stored
  and none travels in the link.
* **The same message for the supervisor**, in both languages, from the job
  sheet — copy it, or open WhatsApp.
* **Day-granular on purpose.** The text says *"planned for Thu 26/11/2026 …
  we cannot give an exact time"*. No clock time can reach a customer message; a
  test fails the build if one does.
* **A journey belongs to a person.** Reassigning a job clears the stamp, so a
  job cannot claim someone has been driving to it since 09:41 after it has
  changed hands.
* **A second press does not move the clock.** The first press is when the
  journey began.

### v1.3.0 (15/11/2026) — crew size rules and job scheduling

Two of the defects that made the app's numbers untrustworthy, and the first
release where a job can be planned for another day.

* **A crew is one or two people (migration 023).** Nothing enforced it. Measured
  on the live project: both active crews had **zero** members, and earlier the
  same day one had three. A trigger now rejects a third; `upsert_crew` refuses an
  active crew with nobody in it. Inactive crews may still be empty — that is how
  a vehicle is retired without deleting its history.
* **"Crews out of N" stopped lying.** `crews_total` counted active crew *rows*,
  so an empty crew counted as a crew you could send out. It now counts only crews
  with a member, and `crews_empty` reports the stranded ones. The board names
  them instead of letting them vanish.
* **Scheduling (migration 024).** `scheduled_date` had existed since the first
  schema and **nothing read it**. A job can now be planned for a later day: it
  leaves today's pool, appears in a Planned list, and stays on the technician's
  phone labelled — but is never offered as "next job" before its day.
* **Two silent drifts found while doing the above.** The live `today_summary`
  had a `due_today` key that existed in **no migration file**, so a replay from
  scratch would have produced a different function than production. And
  `tests/sla.test.ts` asserted five overdue checks when only four were live — it
  was counting a `period_report` copy that a later migration replaces.
* **An RPC that would have failed on a live job.** `task_work_logs.action` is a
  CHECK allow-list and `'scheduled'` was not on it, so the audit line for a
  reschedule would have raised a constraint violation at run time. Nothing in the
  type check could catch it. The allow-list is widened and a test pins it to the
  client's vocabulary.

### v1.2.0 (15/11/2026) — Telesom brand and usability

The app becomes a Telesom product rather than a green internal tool.

* **Real brand.** The published palette is wrong (it omits the emblem's royal
  blue), so colours were sampled from the logo files and the emblem was fitted
  to the artwork by least squares. One drawing, four encodings, with a test that
  fails if they drift apart.
* **480 colour utilities swapped without changing a single contrast ratio** —
  every brand shade sits at the luminance of the emerald it replaced.
* **An accessibility failure the rebrand exposed:** six surfaces carried 11 px
  white text at 3.58:1 before this release. All moved to a passing shade, with a
  lint to stop it returning.
* **Larger-text mode** (`Aa`): Normal → Large → Extra large, scaling both the
  rem system and ~390 px-locked labels.
* **Next-job band** on the technician route: one job, one action, shown only
  when no timer is already running.
* **Letterhead** on the period report, printed in colour.
* **Version labels now tell the truth.** 1.1.0 was still stamped on builds
  that had shipped three merges of change; the label is part of the release.

### v1.1.0 (09/11/2026) — the manager pack

The manager pack. Nothing a technician does changes; four things are added.

* **A record.** A new *Record* tab shows every change in the group — who
  assigned, started, blocked, completed or cancelled what, and when — with
  filters and a CSV. Until now the audit trail existed in the database and
  nowhere a person could see it.
* **Photo proof.** A technician can attach up to three photos when completing a
  job. They are resized on the phone, stored privately, and visible on the
  completion in the record and on the job sheet.
* **A period report.** From Analytics: pick a week, a month or any two dates and
  get a one-page report — arrivals, completions, cancellations, still open,
  waiting past the promise, average time and signal, per technician, per
  cablebox, day by day. **Print / PDF** uses the browser's own print dialogue,
  so no PDF library ships; **Download CSV** gives the same numbers to a
  spreadsheet.
* **The 3-day promise, on the board.** Every open job shows how long the
  customer has been waiting: amber on day three, rose after. Completed and
  cancelled jobs drop out of the count.
* **A read-only manager** who can see every group (§6).

Two things were also found and fixed while building it, and both were live: four
internal database functions were executable by anyone with the public key (one
could create a cablebox in any group, another could read any user's name and
phone), and the period report's "open at end" and "waiting over 3 days" figures
were measured from the wrong moment. Details in `docs/PERFECTION_PLAN.md` §14–15.

**Known limits** — online-only; the camera path has not yet been exercised on a
physical phone; photos add about 4 MB a day at 40 photographed jobs, which is a
plan decision before the pilot. See `KNOWN_LIMITS.md`.

---

## 4b. Release notes — v1.0.0 (09/11/2026)

The first version that may be used with real customer data.

**What changed since the demo build**

* **Reading data now requires signing in.** Before this version, anyone with the
  web address could read the customer list. The database now returns nothing
  without a session.
* **Sheet photos are private.** They no longer sit in a public bucket with a
  guessable URL.
* **PIN guessing is limited.** Five wrong attempts lock an account for fifteen
  minutes, and a PIN the supervisor set must be replaced at first sign-in.
* **Security headers** on every response; the app refuses to be embedded in
  another site.

**What was already there** — sheet OCR in the browser, duplicate confirmation,
dispatch by area and box, technician routes, live timers, blockers, dBm
completion, box history, analytics, daily CSV + WhatsApp report, EN/SO
throughout.

**Known limits** — online-only; no automatic backups yet (see
`PRODUCTION_READINESS.md` §3.4).

---

## 5. Who to call

Fill this in before handover. A system with no named owner is a system nobody
maintains.

| Role | Name | Phone | Owns |
| :--- | :--- | :--- | :--- |
| Department owner | | | Whether the pilot continues |
| Group F1 supervisor | | | Daily operation, PINs, team |
| Technical contact | | | Deploys, database, this app |
| Supabase account holder | | | Billing, backups, the project itself |

---

## 6. The manager

A third account type exists for the department head: **read-only, every group**.
It is not the supervisor's app with buttons hidden — it is a separate, smaller
app, and the database refuses every write from it.

**What they see**

| Tab | What is on it |
| :--- | :--- |
| Groups | One card per group — open, blocked, late, completed, staff, last activity — with that group's open jobs behind a disclosure |
| Record | Every change in every group: who, when, which line, with the photo where one exists |
| Report | A printable one-pager for any date range, with a *By group* table |

**What they cannot do:** assign, cancel, complete, import, edit a port, edit the
team. Not in the app, and not by calling the database directly — a manager
session's writes raise *A manager account is read-only*.

**How to create one:** `RUNBOOK.md` §10a. Deliberately a SQL step, not a button:
a group supervisor who could create a manager could read the other groups.

**Before showing it:** sign in once on the phone or laptop they will use, confirm
the chip says *Manager · read only*, and confirm the Groups tab lists every
group — including the ones marked *Not live yet*, which is the truth until F2
and F3 have staff.

**The three numbers to point at:** *Over 3 days* (the promise), *Blocked* (work
waiting on something), and *Completed* in the window they chose. Everything else
on the screen is context for those three.
