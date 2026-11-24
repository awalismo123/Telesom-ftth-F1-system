# Implementation plan — product improvements

Written 15/11/2026 against `main` @ `3cc6d83`, branch `arena/192e0685-telesom-ftth-f1-system`.

**Baseline measured before any change:** `npm run verify` → **268/268 tests, 0 fail**, bundle
**194.0 kB** of a 200 kB budget, credentials clean.

---

## 0. What the code inspection changed about the plan

The earlier review (`MISSING_FEATURES.md`) was written from a read of the code, and four of its
conclusions do not survive re-checking against live data and the current UI. These matter because
three of the thirteen requested features are **partly or wholly already built**.

| Earlier claim | What the code actually shows | Effect on this plan |
| :--- | :--- | :--- |
| "Crew A has 0 members, Crew B has 3" | **Both crews now have 0 members.** `crew_members` holds 0 rows. | Phase 1 must not assume any crew has members; the *fix* must not block the supervisor from repairing an empty roster. |
| "Bulk reassignment is missing" | **It exists.** `DispatchBoard` has multi-select (`selected`), a picker, and calls `assignTasks({ taskIds: selected })`. `assign_tasks` already takes `p_task_ids uuid[]` and writes `task_work_logs` rows. | Phase 12 shrinks to a **confirmation step**. No new RPC, no new audit — the audit already fires. |
| "SLA is displayed and never acts" | **Partly false.** `TaskCard` already renders `agingBand` → `due` / `late` labels, and `today_summary` counts `over_sla`. | Phase 10 shrinks to surfacing **approaching** jobs (due today) in the supervisor panel, plus a warning list. |
| "Box health is a port list" | `cableboxes.fault_count` **is** maintained — incremented on `cilada` completion (`005_execution.sql:289`, `007:104`). It is a *lifetime* counter with no time window. | Phase 6 adds **windowed** counts computed from `tasks`; it does not need a new counter. |

Two further findings that shape the design:

* **`scheduled_date` already exists** (`001_initial_schema.sql:149`, `NOT NULL DEFAULT CURRENT_DATE`)
  but nothing reads it. `src/lib/importer.ts:271` hardcodes it to today, and neither
  `list_open_tasks` nor `technician_route` filters on it. Live: **all 8 tasks have a
  `scheduled_date` that is not today** — they carry the date they were imported.
* **There are no coordinates anywhere.** `cableboxes` has `location_notes` but no latitude or
  longitude, and no geolocation code exists. Phase 4 therefore **cannot** offer a real map pin and
  must not pretend to.

### Live data state (read-only, no writes made)

| | |
| :--- | ---: |
| Tasks | 8 |
| Active users | 6 |
| Crews | 2 — **0 members each** |
| `crew_members` rows | **0** |
| Tasks with `scheduled_date <> today` | 8 |
| Tasks with `is_repeat_fault` | 0 |
| Photos | 0 |
| Cableboxes | 2 |
| `task_work_logs` rows | 41 |

---

## 1. Cost and dependency position

**No new vendors, no paid tiers, no external services.** Everything below uses:

* PostgreSQL features the project already has (Supabase Free — already paid for, already configured).
* The existing `wa.me` link helper (`src/lib/dispatch.ts:435`) — a plain URL, no API key, no quota,
  no message cost to us. The supervisor's own WhatsApp app sends it.
* Existing storage (`task_photos`, bytea + token-checked RPC) for before/after photos.

**One thing I will not do without asking:** nothing here needs a paid service. If a future phase
would, I will stop and say so rather than install it quietly.

**Usage limits worth naming:**

| Tool | Free? | Limit that matters |
| :--- | :--- | :--- |
| Supabase Free (existing) | yes | 500 MB database. Photos live *in* the DB as bytea, capped at 2 MB each, max 3 per job. Adding a second photo kind raises the ceiling to 6/job — see Phase 13 risk. |
| `wa.me` deep link | yes | Opens the user's WhatsApp. No API, no quota. Cannot send without a human tap. |
| Google Maps / `geo:` link | yes | A URL, not an API — no key, no billing. `geo:` opens the phone's map app; a `maps.google.com/?q=` URL is the fallback. |
| GitHub Actions | **broken** (billing) | Not used by this plan. Verification is local `npm run verify`. |

---

## 2. Phases

Ordered as requested. Each phase is independently shippable and reversible.

Estimated effort assumes one working session per phase of roughly the size of this one.

---

### Phase 1 — Crew size rules — ✅ DONE 15/11/2026

**Effort:** ~1–2 hours (took about that). **Depends on:** nothing.

> **Result:** migration 023 applied to the live project; 16 new tests; `npm run verify` green at
> **285/285 tests, 194.1 kB of a 200 kB budget**. Confirmed live: `crews_total=0`, `crews_empty=2`
> — the two real crews are reported as unusable instead of as capacity. The rebuilt
> `today_summary` was diffed against the live function key-by-key: **15 keys in, 15 keys out, none
> dropped**.
>
> **Drift found and healed while doing this:** the live `today_summary` had a `due_today` key that
> existed in **no migration file**. Replaying the migrations from scratch would have produced a
> different function than production. 023 now records it, so the repo and the database agree again.
>
> **Also found:** `tests/sla.test.ts` was asserting "5 overdue checks" when only 4 were live — it
> was counting a `period_report` copy from 012 that 013 replaces. The scan now resolves the newest
> definition of each function and asserts the *set of function names*, so a superseded copy can no
> longer inflate the count and a missing one names itself.

**What changes**

1. **Database (`023_crew_size_rules.sql`)**
   * A `BEFORE INSERT/UPDATE` trigger on `crew_members` rejecting a **third** member on any crew.
     A hard cap of 2.
   * `upsert_crew` gains a check: an **active** crew must have between 1 and 2 members. Inactive
     crews may have zero (that is how you retire a crew without deleting its history).
2. **Honest counts `today_summary`**
   * `crews_total` counts only crews that have **at least one member**. An empty crew is not a crew
     you can send out, and counting it is what produced `0/2` while nobody was actually available.
   * Add `crews_empty` so the panel can say so out loud rather than hiding it.
3. **UI**
   * *Team & Crews*: a crew with 0 members shows an inline warning and cannot be saved as active.
   * *Today panel*: if any active crew is empty, one quiet line says how many.
   * *Dispatch*: an empty crew is not offered as a target (it cannot be dispatched meaningfully).

**Data safety:** read-only plus constraints. **No rows are deleted or rewritten.** Existing crews
keep their 0 members; the supervisor is prompted to fix them, not forced.

**Rollback:** `DROP TRIGGER`, restore the previous `today_summary` from `022`. One file, one
re-run.

**Risk:** the cap is enforced on write. If someone legitimately needs 3 on a vehicle, the constraint
now says no — which is the point, but it is a policy the user should confirm (see Decisions).

**Tests:** crew cap accepts 1 and 2, rejects 3; `crews_total` excludes empty crews; an inactive
empty crew is allowed; the panel shows the empty-crew count.

---

### Phase 2 — Job scheduling — ✅ DONE 15/11/2026

**Effort:** ~3–4 hours (took about that). **Depends on:** Phase 1.

> **Result:** migration 024 applied live; `npm run verify` green at **308/308 tests, 194.9 kB of
> 200 kB**. `set_task_schedule` probed inside `BEGIN…ROLLBACK` on a real job: moved it 5 days back
> to +3 days, wrote exactly one `scheduled` audit line, refused a second identical call (no log
> noise), refused a 1999 date, and refused to move a closed job. Rollback left 0 stray rows.
>
> **Two things inspection changed, and the plan was wrong about:**
>
> 1. **The sheets have no planned-date column** — only `DateIn` and `DateOut`. So "date taken from
>    the plan when present" cannot mean "from the sheet". The date is a supervisor decision, and
>    the import default (arrival day) is unchanged. Implementing the plan as written would have
>    meant inventing a column that does not exist.
> 2. **`task_work_logs.action` is a CHECK allow-list** and `'scheduled'` was not on it. The audit
>    line the RPC writes would have failed at run time on a live job, with nothing in the type
>    check to catch it. 024 widens the allow-list; a test now pins the DB list to the client's
>    vocabulary so it cannot drift silently again.
>
> **Also dropped from the plan, deliberately:** the `ManualTaskSheet` date field. Creating a
> phone-in job already opens the job-actions sheet, which now carries the planned-day control — a
> second date field would have been a second way to do one thing.
>
> **A claim I had to retract mid-build:** I wrote a comment saying `routeStats` lost jobs across
> midnight. It did not — both sides of that comparison were UTC, so they agreed with each other.
> The real defect was milder: the tile disagreed with the header (which uses the phone's day) for
> three hours a night. The comment now says that, and the test pins the actual property.

**What changes**

1. **Database (`024_scheduling.sql`)**
   * `CREATE INDEX idx_tasks_scheduled ON tasks(group_id, scheduled_date)`.
   * `list_open_tasks` orders by `scheduled_date, reported_date` instead of `reported_date` alone,
     so the pool reads in the order work is due.
2. **Importer**
   * `src/lib/importer.ts:271` stops hardcoding today. Date is taken from the plan when present,
     else today. Existing rows are untouched.
3. **Manual entry** — `ManualTaskSheet` gains a date field, defaulting to today.
4. **Dispatch board** — a **"Planned" lane** listing jobs whose `scheduled_date` is in the future.
   The existing pool and lanes are unchanged; today's jobs behave exactly as now.
5. **Workload by day** — a small strip: per technician, count of assigned jobs for today / next 3
   days, from `scheduled_date`.
6. **Technician route** — a future-dated job is shown with its date and **not** offered as "next
   job" until its day arrives (`nextJob` gains a date filter).

**Conservative choice, stated:** a future job still appears on the technician's list (labelled),
rather than being hidden. Hiding it risks a technician never learning it exists; labelling it
cannot cause harm. This can be tightened once the supervisor has used it.

**Rollback:** drop the index, restore `list_open_tasks` and the importer line. Rows unaffected.

**Risk:** `list_open_tasks` is called on every board load. Changing its `ORDER BY` is low risk but
touches a hot path — the 600-row `LIMIT` and its test (`OPEN_TASK_CAP`) must keep passing.

**Tests:** a past, today and future job sort correctly; `nextJob` ignores a future job; the
planned lane excludes today; importer keeps a supplied date and defaults to today otherwise.

---

### Phase 3 — Customer updates (WhatsApp) — ✅ DONE 15/11/2026

**Effort:** ~3–4 hours (took about that). **Depends on:** Phase 2 for the date in the message.

> **Result:** migration 025 applied live; `npm run verify` green at **323/323 tests, 195.2 kB of
> 200 kB**. `mark_en_route` probed inside `BEGIN…ROLLBACK` on a real job: stamped once, a second
> press kept the **original** timestamp (one log line, not two), reassigning the job **cleared**
> the stamp, and a completed, a cancelled and an unknown job were all refused. Rollback left
> 0 stray rows.
>
> **Nothing sends.** The message text is built in the browser; `wa.me/?text=` opens WhatsApp's own
> contact picker with the text ready. There is no recipient number in the URL, no server-side send,
> no API key, and no cost. Tests fail the build if `wa.me/\<number\>` appears, if the text module
> ever gains a `fetch`/`rpc`, or if a **clock time** reaches a customer message.
>
> **Built beyond the plan, because it was nearly free:** the supervisor can preview and copy the
> same per-job message in both languages from the job sheet. The plan only had the technician
> button; the wording, the day and the group sign-off were already computed, and a supervisor
> relaying it by hand is the same act.
>
> **Small refactor taken while here:** the clipboard-with-textarea-fallback existed inside
> `DispatchMessageSheet`. A second caller would have meant a third copy, so it became
> `copyPlainText()` in `format.ts` — and it now reports failure instead of showing a tick it did
> not earn.
>
> **Caught by an existing test:** the first version used `bg-emerald-600`; `tests/brand.test.ts`
> rejected it as un-branded. Moved to `brand-700`, which is also the contrast-safe shade.

**What changes**

1. **Supervisor: one-tap message per job.** Built on the existing `whatsappLink()`:
   `https://wa.me/?text=…`. No number in the URL means WhatsApp opens its own picker, so the
   supervisor chooses the contact — no customer phone book leaves the app.
2. **Technician: "On my way".** New RPC `mark_en_route(token, task_id)` recording
   `en_route_at timestamptz` on the task, returning the prepared text. The button records the time
   and **opens** WhatsApp; it never sends. The route card then shows "travelling since 09:41".
3. **Wording** is plain, bilingual, and says the day — never a precise time the department cannot
   keep: *"Telesom technician is coming today (Tue 18 Nov)."*

**Data safety:** one nullable column, additive.

**Rollback:** drop the column and function; the button disappears.

**Risk:** `wa.me` needs the recipient's number. Without it WhatsApp opens a picker — acceptable,
and it is how the dispatch summary already works. **We do not store a customer WhatsApp number
separately from `customer_phone`**, and I will not add one.

**Tests:** message text contains the date and the line number, both languages; `mark_en_route`
stamps once and is idempotent; the link is `wa.me` with an encoded body and **no** auto-send path.

---

### Phase 4 — Directions for a job — ✅ DONE 15/11/2026

**Effort:** ~1–2 hours. **Depends on:** nothing. **No migration** — this phase is a URL builder.

> **Result:** `npm run verify` green at **347/347 tests, 195.3 kB of 200 kB**. Three screens carry
> the link: the technician's job sheet, the technician's route card (compact), and the supervisor's
> job sheet.
>
> **Checked the live data before designing:** `xaafada` really holds `Gantalaha` and `JIGJIGAYAR`,
> and `location_notes` holds `"Port 7 connector clip loose — use Ports 1–6 or 8"`. That last one
> settled a design question — location notes are written **for colleagues**, so they are excluded
> from a map query (they would produce noise) and included in "copy the address", where they are
> the "second gate on the left" detail that actually gets someone there.
>
> **A real bug I introduced and then guarded against:** the first version put the map link inside
> the route card's outer `<button>`. An `<a>` inside a `<button>` is invalid HTML, and a tap would
> open both the map and the job sheet. The type check cannot see it and browsers tolerate it. There
> is now a scan test over every `.tsx` asserting no anchor is nested in a button — verified to fail
> when the bug is re-injected.
>
> **A false positive worth recording:** the first version of that scan flagged the JSX comment that
> *explains* the rule. The scan now blanks comments before matching. A lint that cries wolf gets
> switched off.
>
> **What is honestly missing:** the supervisor's task payload has no `cablebox_notes` (only the
> technician's route does), so the supervisor's copy-the-address includes box code and area but not
> the notes. Widening a hot RPC for that was not worth it; recorded rather than silently dropped.

**What changes**

* A **"Find on map"** link on the job sheet and route card, built from what we actually have:
  the cablebox code and the neighbourhood. It opens a **map search**, labelled as a search.
* Copy is explicit: *"Opens a map search for the box name — not a saved pin."*

**Why not coordinates:** none exist, and inventing them would send a technician to the wrong
street while looking authoritative. The lowest-cost honest option is a text search the technician
can visually confirm against the box name they already have.

**Consequence to accept:** a box name that is not unique in the city can resolve to the wrong
place. The label says so. If accuracy is needed later, the fix is capturing a coordinate **once
per box, on site**, by a technician — a Phase 4b, not something to fake now.

**Tests:** the URL is a search URL, never a coordinate pair; the label states it is not a saved pin.

---

### Phase 5 — Materials tracking — ✅ DONE 15/11/2026

**Effort:** ~4–5 hours (took about that). **Depends on:** nothing.

> **Result:** migration 026 applied live (table + 3 functions, RLS on with **no policies**,
> `REVOKE ALL` from anon/authenticated — verified `has_table_privilege` is false for select, insert
> and delete). `npm run verify` green at **372/372 tests, 195.4 kB of 200 kB**.
>
> **Probed live inside `BEGIN…ROLLBACK`:** `"Drop   cable  "` was stored as `"Drop cable"`; 6 m +
> 4.5 m aggregated to **10.5 m with `jobs = 1`**; a connector in `pcs` stayed in its own row; and
> empty item, zero quantity and an unknown unit were all refused.
>
> **The number I refused to build.** "Stock on hand" is `received − used`, and **nothing records a
> delivery**. `0 − used` gives a negative number that drifts from the shelf every week, and a
> supervisor would eventually reorder against it. So this tracks **usage**, which is a fact. The
> label is a shared constant (`USAGE_LABEL`) and a test fails the build if it ever says
> "stock"/"remaining"/"on hand", or if the module grows a `stockLevel`/`received` identifier.
>
> **Bundle discipline.** The hot bundle had 4.7 kB of headroom. Everything materials-related is
> `React.lazy` — `MaterialsPicker` ships as its own **2.35 kB gzip** chunk, fetched while the
> completion form is already on screen. The measured cost to the hot bundle was **0.1 kB**. The
> usage report went inside the already-lazy Analytics panel rather than a new chunk.
>
> **Caught by an existing test:** `tests/a11y.test.ts` rejected my 40 px Add button — the minimum
> on a phone is 44. Fixed the whole row, not just the one control it named.
>
> **Deliberately allowed on a completed job:** the shop is counted the next morning, and a missing
> line is discovered then. Refusing the correction would leave the record permanently short, which
> is worse than a late entry with a timestamp on it.
>
> **Two of my own test regexes were wrong** and the failures were mine, not the code's: one matched
> the word "received" inside the comment explaining why there is no stock figure, and one expected
> `> 0` where the migration uses `BETWEEN 1 AND`. Both fixed to check code rather than prose.

**What changes**

1. **New table `task_materials`** (`025_materials.sql`): `task_id`, `item` (text), `quantity`
   (numeric > 0), `unit`, `recorded_by`, `created_at`. RLS on, reachable only through
   token-checked functions, matching how `task_photos` is locked down.
2. **Recording:** on a completed job, a short list — add item + quantity. Free text with a small
   set of common items as suggestions (router, ONT, patch cord, drop cable, connector).
3. **Reporting:** a **usage summary** per period and per technician.

**The honest limit, stated up front:** a *stock-on-hand* figure requires stock to be **received**
into the system as well as issued. Nothing records receipts today. A number computed only from
usage would drift from the shelf and be worse than no number.

So this phase delivers **usage tracking, which can be reliable**, and a clearly-labelled
**"usage in period"**. Stock-on-hand is offered as **Phase 5b only if** the department agrees to
record deliveries too; until then the screen says *"Stock on hand is not tracked — only usage."*

**Rollback:** drop the table. Nothing else references it.

**Tests:** quantity must be positive; a job's materials sum; the report labels itself as usage,
not stock.

---

### Phase 6 — Equipment-box fault history — ✅ DONE 15/11/2026

**Effort:** ~3 hours. **Depends on:** nothing. **No table** — one read-only function.

> **Result:** migration 027 applied live; `npm run verify` green at **386/386 tests, 195.4 kB**.
> The panel lives inside the already-lazy Analytics tab, so the hot bundle did not move.
>
> **The plan was wrong about the date.** It said to window on `completed_at`. That scores the
> *worst* box — five faults reported this week, none fixed yet — at **zero**. A fault is evidence
> the moment it is reported, so the window applies to `reported_date` and the payload says
> `basis: 'reported'`. A test fails the build if the window is ever applied to completion time.
>
> **A finding that matters more than the feature.** Measured live: **zero of eight tasks carry
> either `cablebox_id` or `cablebox_code_raw`.** So on today's data this leaderboard is empty — and
> it will stay empty until imports and manual entry actually record which box a job belongs to.
> The function therefore matches a box **two ways** (FK, then case-insensitive raw code) and counts
> faults that match neither as `unassigned_faults`, shown as a warning rather than swallowed. A
> table that silently discards rows reads as a healthy estate.
>
> **Probed live inside `BEGIN…ROLLBACK`** with five manufactured faults: 2 attributed to `B6 (52)`
> (one by FK, one by lowercase raw code), the **cancelled** one excluded, a fault **200 days old**
> excluded by the 30-day window, `FAT48` returned with **0**, and `unassigned = 1`. Rollback left
> no probe rows.
>
> **Still using the lifetime counter?** No. `cableboxes.fault_count` is untouched and unused here —
> it cannot answer "this month" and cannot be reset without losing the history behind it.

**What changes**

* A **box fault leaderboard** on the supervisor screen: fault jobs per cablebox over a chosen
  window (7 / 30 / 90 days), ranked worst first.
* The window is computed from `tasks` by `cablebox_id` and `completed_at` — windowed and honest,
  rather than the lifetime `fault_count` counter, which cannot answer "since when".
* The period is printed on the screen and in the CSV, so the number can never be quoted without
  its window.

**Tests:** counts respect the window boundaries; a box with no faults still appears with 0;
the label states the window.

---

### Phase 7 — Repeat-fault escalation — ✅ DONE 15/11/2026

**Effort:** ~3 hours. **Depends on:** nothing (identity is the line, not the box). **No table.**

> **Result:** migration 028 applied live; `npm run verify` green at **414/414 tests, 195.5 kB**.
> The supervisor card lives inside the already-lazy Analytics tab and the job-sheet badge is a
> shared chunk both lazy panels already pull in, so the hot bundle moved 0.1 kB.

> **The plan's rule could not work — this is the important finding.** The plan said to count jobs
> where `is_repeat_fault = true` **or** `previous_task_id IS NOT NULL`. The importer sets that flag
> in exactly one case (`src/lib/importer.ts:188`): a line coming back **after a completed job**.
> The first fault on a line is never flagged, so **three real faults produce two flags** — the
> escalation would need a *fourth* fault to fire. Worse, a fault that arrives while an earlier job
> is still open is a carryover and is never flagged at all, so the rule silently depends on how
> fast the crew closes work. Measured live: **0 of 28 tasks** carry the flag or a
> `previous_task_id`, so the rule would never have fired on real data.
>
> The count is therefore of the **fault jobs themselves** — non-cancelled `cilada` jobs sharing a
> `line_number` inside the window. `is_repeat_fault` is still returned, as `flagged_repeats`, and
> shown as `2/3` beside the count: evidence on the row, never the trigger. A test fails the build
> if anyone rebuilds the threshold on the flag.

> **The plan was also too sure that the box would help.** It said "the customer's card and the box
> both carry the flag". Boxes still carry nothing — all 28 jobs have a null box, the Phase 6
> finding. The watch list shows the box when a job happens to name one and stays silent otherwise.

> **Probed live inside `BEGIN…ROLLBACK`** with manufactured faults: a line with three in-window
> faults plus a **cancelled** one plus a **200-day-old** one returned **3** (both excluded); a line
> with two did not appear; three **blank** line numbers did not group into one customer; an
> `installation` on a flagged line was not counted; and a 7-day window correctly found nothing.
> `get_task`'s own rules gate the per-job call, so supervisors and managers follow existing
> access, and the watch list refuses technicians. Rollback left 28 tasks and no probe rows.

**What changes**

* `repeat_fault_watch(token, group, days = 90, threshold = 3)` — the supervisor watch list: one row
  per line at or above the threshold, with the newest known name, phone, area and box, the fault
  count, the open count and the last fault date.
* `repeat_fault_count(token, task, days = 90)` — one job's line, for the job sheet. Returns
  `known: false` when the job has no line number, so an unattributable job can never be escalated.
* **Supervisor:** "Repeat faults — last 90 days" in Analytics, worst line first, with the note
  explaining what is and is not counted.
* **Job sheet (technician and supervisor):** a quiet grey line under the threshold, an amber
  "N faults in 90 days — worth investigating" at or above it.

**Tests (28):** two faults do not escalate, three do; a job with no line number never escalates;
the heading always states its window; the fault count is not built on the importer flag, and the
window is on `reported_date`; blank line numbers are never grouped; the threshold cannot be set
below 2.

**Explicitly not claimed:** "repeat" never means "the same phone number appeared twice" — two
different customers can share a phone. Identity is `line_number`, which is what the sheet keys on.
The copy says **"worth investigating"**, never "repeat offender", and no leaderboard ranks
technicians by it.

### Phase 8 — Technician workload and performance — ✅ DONE 15/11/2026

**Effort:** ~3 hours. **Depends on:** nothing new. **No table** — one read-only function.

> **Result:** migration 029 applied live; `npm run verify` green at **449/449 tests, 195.5 kB**.
> The card lives inside the already-lazy Analytics tab, so the hot bundle did not move at all.

> **A leaderboard was already shipping, and it is now gone.** The existing "Teams & technicians" card
> sorted by `completed DESC` and drew a progress bar scaled to whoever closed the most jobs that
> window. That is precisely the thing the group asked not to have: a technician measured on jobs
> closed will close a job before it is fixed. The card is now **alphabetical**, the bar is deleted,
> and every number (completed, live, blocked, avg, urgent, dBm, repeat) is still there. A test pins
> the absence of the ratio.

> **The plan's disclaimer text was wrong, so it was not used.** The draft said recorded time
> *"includes travel, waiting for access and blockers"*. In this app a blocker **pauses** the clock —
> `005_execution.sql` banks the accumulated seconds and clears `active_started_at` — and travel is
> counted only if the technician pressed Start before setting off. A disclaimer that misdescribes its
> own number is worse than none, so the printed note now says what is actually counted. The test
> asserts the blocker-pauses wording in both languages.

> **Where the plan says nothing, and this does:** the median is computed over *plausible* timers
> only, and the ones set aside are **counted and shown**, never silently dropped or capped —
> `KNOWN_LIMITS` §7d asked for exactly that. A completion is impossible when its recorded time
> exceeds the job's own age, which is arithmetic rather than opinion.

> **What that rule does not catch, and the screen shows anyway.** The real 45.7-hour timer from §7d
> sits on a job old enough to "plausibly" take 45 hours, so it is *not* impossible and passes into
> the set. The median absorbs it (3 minutes) — and the card prints the **longest** job beside the
> median, flagged amber when it is more than four times the median, so the outlier is visible rather
> than averaged away.

> **`ops_analytics.techs` could not be reused.** It is keyed by **crew** ("F1 - Crew A") and carries
> no user id, so it cannot be joined to people. The people-level panel is therefore its own card and
> its own function, rather than a second interpretation of the same field.

**What changes**

* `tech_workload(token, group, days = 30)` — per active technician: open now, running, blocked,
  completed in the window, plausible completion durations, impossible-timer count, and open jobs by
  day (scheduled date, falling back to the report date).
* **Supervisor Analytics:** "Technician workload — last N days", alphabetical, with the fixed note
  printed inside the card.
* Crew and crew-mates are handled: a job assigned to a crew counts toward each member.

**Tests (34):** median of an odd count, an even count and a single job; empty is `null`, not zero;
the median survives the 45.7-hour case that breaks the average; the outlier rule fires at 4× the
median with a one-hour floor; alphabetical order is not influenced by completed counts; an idle
supervisor is not a row of zeros but one who closed jobs is shown; the server's `ORDER BY` is by name
and the completion count is not capped by the duration-array limit.

**Explicitly not claimed:** this does not measure effort, speed or quality. It measures how long
jobs were marked running, which includes a technician's own delays and excludes several outside
their control. That sentence is on the screen.

### Phase 9 — Customer job history — ✅ DONE 15/11/2026

**Effort:** ~2 hours. **Depends on:** nothing. **No table** — one read-only function.

> **Result:** migration 030 applied live; `npm run verify` green at **474/474 tests, 195.5 kB**.

**What changes**

* `line_history(token, group, line, exclude_task, limit)` — every job recorded against a line:
  date, type, status, dBm, technician, notes, in newest-first order. Cancellations are **included**.
* A collapsible **"Earlier jobs on this line"** panel on the job sheet, reached from the search
  palette by opening a job. It does not query until it is opened, so a technician pays nothing for
  a lookup they did not ask for.
* When two or more readings sit within 2 dB of each other, the panel says so — a steady weak signal
  points at the drop or splitter rather than at the customer's own equipment.

**Tests (25):** the current job is excluded from its own history; entries are newest first and rows
with no date fall to the end rather than to 1970; a line with no history says so instead of showing
an empty box; a job with no line gets a *different* sentence, because "nothing recorded" and
"cannot look it up" are not the same fact; a missing dBm is skipped rather than read as 0 (0 dBm is
a perfect signal); the SQL is keyed on the line and never on the customer name; a blank line returns
nothing rather than the whole group.

**Explicitly not claimed:** the history shows what was recorded, not what happened. A job that was
never written on a sheet is not in this list, and the panel does not imply the list is complete.

### Phase 10 — SLA warnings — ✅ DONE 15/11/2026

**Effort:** ~1.5 hours. **Depends on:** nothing. **No table** — one read-only function.

> **Result:** migration 031 applied live; `npm run verify` green at **499/499 tests, 195.8 kB**.

> **`SLA_DAYS` was not touched.** It is still 3 in `src/lib/activity.ts`, and the migration
> declares its own `v_sla constant int := 3` rather than reading a setting. A warning list is not
> evidence for changing a promise made to customers, and a test fails if an `ALTER` or an `UPDATE
> public.tasks` ever appears in this migration.

> **Every other number on the screen measures a promise already broken.** `over_sla`,
> `waiting_over_sla` and the red `late` badge all count jobs that have *passed* three days. Nothing
> counted the jobs that reach three days **today** — which is the only group where acting now still
> keeps the promise. That is what this adds.

> **The boundary matches the rest of the app, deliberately.** `agingBand` says `days === sla` → due
> and `days > sla` → late; 013's `waiting_over_sla` uses `< now() - interval '3 days'`, strictly
> less. The SQL uses `= CURRENT_DATE - 3` for due and `< CURRENT_DATE - 3` for late, and a test pins
> both, because reversing either one moves the deadline.

**What changes**

* `sla_watch(token, group)` — the jobs at the deadline today, with customer, phone, area, box,
  assignee and whether anybody is assigned at all.
* **Supervisor landing page:** a "Due today" card with a one-sentence headline, the list ordered
  unassigned → urgent → oldest, a `tel:` link per row, and the late count stated separately.
* The card is `React.lazy`-loaded: it moved the first screen's bundle by 1.2 kB when bundled
  directly, and the supervisor's landing page has a hard budget.

**Tests (25):** a job at exactly 3 days is due and at 4 is late; a late job is never shown as due
today even if the server sends it; unassigned sorts first; the headline leads with the number, is
singular at one, mentions unassigned work first, and never says "SLA"; the SQL uses `=` for due and
`<` for late and counts from the report date.

**Explicitly not claimed:** "due today" means the customer reported it three days ago. It does not
mean the job was assigned three days ago, and it is not a measure of anybody's speed.

### Phase 11 — Printable job sheet — ✅ DONE 15/11/2026

**Effort:** ~2 hours. **Depends on:** nothing new (reads the job already on screen). **No migration.**

> **Result:** `npm run verify` green at **521/521 tests, 195.8 kB**. No database change at all.

> **A real defect was caught before it shipped.** The print stylesheet hides the app behind a sheet by
> keying on `.print-root` (`index.css`: `body:has(.print-root) > #root { display: none }`). The first
> version of this view lacked that class, so printing would have put a screenshot of the whole app on
> the paper behind the job sheet. A test now pins the class.

> **Three accessibility failures were also caught by the existing design tests**, not by review:
> `text-[9px]` (below the legible floor) and `bg-brand-600` with white text (3.58:1). Both corrected
> to 10 px and `brand-700`.

**What changes**

* A **"Job sheet"** button on the execution sheet opens a one-page print view: line, customer, phone,
  area, cable box, port, type, priority, technician, reported/started/completed times, time on job,
  dBm reading, blocker and notes.
* Reuses the letterhead, `print-colour` emblem rule, `BUILD_LABEL` footnote and the browser's own
  print dialogue — no new dependency, no bundle cost beyond the view itself.
* **There is no per-job dBm target in the data**, so the sheet prints the reading against the
  app-wide healthy window (−27 … −8 dBm) and says which. Inventing a target would be worse.

**Tests (22):** the port and the dBm are on the sheet; a field with no value is **omitted**, never
printed as "—"; port 0 is not a port; a zero duration is not "0 min"; an unparseable timestamp is
dropped rather than printed as `Invalid Date`; a job with nothing recorded produces almost no fields;
the view carries `print-root`; printing is an explicit action with no bulk print.

**Privacy:** the sheet carries a name, phone and address. It opens only for the job in front of you,
on an explicit button press, and nothing else prints differently.

### Phase 12 — Bulk reassignment confirmation — ✅ DONE 15/11/2026

**Effort:** ~1 hour. **Depends on:** nothing. **No migration.**

> **Result:** `npm run verify` green at **540/540 tests, 195.8 kB**. The audit trail
> (`task_work_logs`) already existed; what was missing was a step before the write.

> **The tap was one thumb-width from the wrong crew.** Choosing a target in the picker called
> `runAssign` directly. Twenty jobs moved, `task_work_logs` recorded it, and the crews found out when
> their phones changed. The confirmation is not an "are you sure?" box — it names **who**, **how
> many**, and **which line numbers**, because the useful question is "did I pick the right person and
> the right twenty?".

> **It warns about the two things that actually go wrong.** Urgent jobs in a bulk selection, and jobs
> that already belong to somebody else — reassigning those takes work off a crew, and nobody tells
> them. Both are stated as facts, not hedged.

**What changes**

* Picking a target now opens a summary: target name, job count, the first five line numbers (plus
  how many more), any urgent jobs, any already-assigned jobs, and the sentence "nothing has been
  assigned yet".
* **Cancel performs no call at all** — it only clears the pending target.
* The pending action is keyed on target **and** selection, so a changed selection cannot silently
  reuse a stale confirmation.

**Tests (19):** the confirm names the target, the count and the line numbers; one job is singular; a
long selection shows five and states the remainder; the preview never shows zero lines; urgent and
already-assigned jobs are called out; a clean selection produces no warnings; cancelling is a label
with no call; the board no longer contains `onClick={() => void runAssign(target)}`.

### Phase 13 — Before-and-after photos — ✅ DONE 15/11/2026

**Effort:** ~2.5 hours. **Depends on:** nothing. Migration 032.

> **Result:** migration 032 applied live; `npm run verify` green at **557/557 tests, 195.8 kB**.

> **The plan's file number was wrong.** It called this `026_photo_kind.sql`; 026 is the materials
> migration. This is **032**. The content is as planned.

> **The existing guard made the feature impossible, and that was the finding.** `add_task_photo`
> refused *any* photo unless the job was **completed** — right for proof, but a before photo is by
> definition taken before the work. The rule is now split: `after` still needs a completed job,
> `before` only needs a job that exists and is not cancelled.

> **A before photo never moves `tasks.proof_photo_id`.** Only an after photo sets the proof pointer,
> so a job photographed on arrival is not recorded as having photographic proof of completion. A test
> pins it.

> **The signature is preserved by a wrapper, not a default.** Two functions that could both match a
> four-argument call is exactly where PostgreSQL has to guess. The old
> `add_task_photo(token, task, mime, b64)` is kept as a thin wrapper delegating to `'after'`, so every
> existing caller and every existing photo behaves identically.

**What changes**

* `task_photos.kind` — `text NOT NULL DEFAULT 'after'` with a CHECK. **No backfill**: existing rows
  read as `after`, which is what they are.
* The execution sheet gains an **optional** before photo while the job is open, using the same
  in-browser compression as the proof photo. It is a separate call from completion, so a camera
  failure can never hold a finished job hostage.
* The cap is **3 per kind** (6 per job, up from 3). `list_task_photos` now reports `kind`.

**Tests (17):** anything unknown reads as `after` (never as `before`); a before photo cannot be taken
on a completed or cancelled job, and the reason is shown rather than the button silently vanishing; a
full before quota does not block the after; a legacy photo with no kind counts as `after`; the SQL
keeps the completed-job guard for `after` only, counts the cap per kind, and never rewrites existing
rows.

**Storage:** photos are `bytea` in a 500 MB free database. The ceiling per job doubles from 3 to 6.
Recorded in `KNOWN_LIMITS` §8c. If volume grows, the honest fix is object storage, not smaller proof.

---

### Phase 14 — The supervisor's command page — ✅ DONE 24/11/2026

**Effort:** ~3 hours. **Depends on:** nothing. **No migration.**

> **Result:** `npm run verify` green at **605/605 tests, 193.4 kB** (it went *down* from 195.8).

**The brief:** *"enhance every page of the system one by one … start with the command overview page
of the supervisor, make it best and it must have everything it needs."* This is the first page.

**What the page was.** Four tiles — technicians, crews, open jobs, box count — and a single dark
panel. Every one of those is a number a supervisor reads once and already knows. The nineteen open
jobs, two of them urgent and *all nineteen past the promise*, were not on the screen at all.

**What it is.** The page now answers, in reading order:

| Section | Question it answers |
|---|---|
| Shift header + headline | What is today about, and how fresh is this? |
| Attention rail (5 tiles) | What needs a decision, right now? |
| Work queue | Which jobs, whose, how old, and can I phone them? |
| Load board | Who is carrying what, and who is free? |
| Movement | Is the week going anywhere? |
| Live feed | What just happened? |
| SLA watch | The existing card, kept |

**What the reconnaissance found.** Nothing here needed a new table. `today_summary` has returned
`due_today` since migration 023 — the most actionable number on the screen — and **no component ever
read it**, because the TypeScript interface simply omitted the field. `dispatch_load` already carried
per-person and per-crew `open_jobs / active_jobs / urgent_jobs / done_today` and was used only on the
dispatch board. `group_activity` was only on the Record tab.

**Two defects found by probing the live database, not by testing the code.**

1. **A seven-day activity window was empty.** The live data's newest event is 16 Nov and the database
   clock read 24 Nov. The chart and the feed would have rendered correctly, honestly, and completely
   blank — and a supervisor would have had no way to tell a quiet week from a dead feed. The window
   is now thirty days (the chart still draws seven), and both panels name the **last day anything
   happened** when the window is silent.
2. **`todayHeadline` would have said "19 open, none past the promise."** That is arithmetic on the
   `reported_date <= today` boundary, and on the live data it was false: all nineteen were past it.
   The headline now reports the last real movement when the queue has stopped moving.

**What it refuses to do**

* **Show zeros when it does not know.** The old loader wrapped everything in `catch {}`, so a failed
  request left the page showing zero blocked jobs — a false all-clear. Each source now settles
  independently and the page **names the part that did not load**. A false zero is the most expensive
  kind of wrong on this screen.
* **Rank people.** Crews and technicians are alphabetical, and the footer says so. Sorting by open
  jobs would be a leaderboard under another name.
* **Hide an unroutable crew.** Two crews with zero members exist on the live database. A crew nobody
  is in is shown and flagged `no members`, because assigning work to it looks like it was sent.

**Live load is now real.** The page subscribes to `tasks` and `crew_members` and refetches debounced;
freshness is ticked every five seconds. Previously it read data on tab change and nothing else, so a
supervisor who left it open all shift read a stale screen.

**Adding a job from a phone call** is on the page, because the supervisor is on the line and making
them switch to Dispatch first is how the call ends up on a scrap of paper.

**Bundle.** The page is its own lazy chunk (31.2 kB / 9.5 kB gzip), warmed at shell mount. First-load
gzip **fell** from 195.8 to 193.4 kB, because the landing screen's weight left the entry bundle.

**Tests (48 new).** Ordering rules (urgent before oldest, ties broken by line number so the list never
reshuffles); unknown age sorts *after* dated jobs, never above them; a person inside a crew is not
listed twice; alphabetical rather than by workload; a stranded crew is never counted as available; a
quiet week names its last activity; a silent window does not fire the fallback when one day has data;
fourteen panels mounted through `renderToString` with the live shapes, asserting no `NaN` and that the
`tel:` link is present.

**Data protection.** No migration, no writes to production, no schema change. Every probe ran in a
`BEGIN … ROLLBACK`.

---

### Phase 15 — The dispatch board: one order, and work that cannot be routed — ✅ DONE 24/11/2026

**Effort:** ~2 hours. **Depends on:** nothing. **No migration.**

> **Result:** `npm run verify` green at **638/638 tests, 193.4 kB**.

**The reconnaissance finding:** the dispatch board is already the most complete screen in the app.
It has lane cards, auto-cluster, confirm-before-commit, message composition, job actions
(reassign / cancel / reopen / reschedule / photo proof / customer message), a live field strip, and
stranded-crew warnings. There was very little to "add". What it had was three specific defects.

**Defect 1 — the board was ordered worse than its own WhatsApp message.**

`compareTasks` (urgent → carried-over → oldest → line number) already existed, was already tested, and
was used to order `buildBlock` — the message a crew receives. The board never called it. The visible
pool was `searchTasks(pool)`, i.e. the server's order re-filtered in the browser, and the only control
that changed it was an *Urgent* tab you had to tap first.

The message a crew received was therefore **better ordered than the screen it was written from**. Both
now call `orderPool`, which wraps `compareTasks`, and a test asserts they can never diverge.

**Defect 2 — auto-cluster would build a "route" out of nothing.**

`clusterTasks` groups by cablebox, then by neighbourhood. A job with neither lands in one bucket with
every other such job. On the live data **6 of 19** open jobs are in that state — including **both
urgent jobs**. (This figure was first written as 8 and corrected in Phase 16: the census counts 13
open jobs in the group, six of them with neither an area nor a box.) Auto-cluster would have handed
one crew a batch spanning the city under the heading "No area / box", and nothing on the board said
so before the plan was made.

The board now counts routable vs unroutable work, names the offending line numbers, and states the
consequence in both languages.

**Defect 3 — a blocked board looked like a quiet afternoon.**

Both live crews have zero members, so `toTargets` returns nothing. The board rendered **zero lanes**,
a small amber note, and an empty grid. A day with work but nobody to send it to now has its own
blocking state that says why and what to do.

**New:** a triage sentence in the header, and four figures — waiting, urgent, past the promise,
routable/total. The sentence leads with **unroutability when nothing can be routed**, because being
late is a symptom the supervisor already understands while having no area is the obstacle in front of
them. When only some jobs are unroutable, urgency leads and the banner carries the caveat.

**Tests (29 new).** Board order ≡ message order; urgent → carried → oldest; the sort does not mutate
its input; identical jobs keep a stable order; carried-over is flagged even when fresh; age bands agree
with `SLA_DAYS`; triage counts each job once under its strongest reason; whitespace is not a place;
`Jigjigayar` / `JIGJIGAYAR` / `Jigjigayar ` are one area; an unroutable pool leads with unroutability
and a partly unroutable one does not; banner truncation; and the whole live pool (19 jobs, 2 urgent,
8 unroutable) driven through the pure layer in `render.test.tsx`.

**Not done, deliberately:** drag-and-drop between lanes (thumb-hostile on a phone, and the picker
already exists), per-lane manual ordering, and a new clustering algorithm. `clusterTasks` and
`autoPlan` work and are tested; replacing them is risk without a request.

---

## 3. Decisions I need from you

I have made conservative choices on all of these and will proceed with them unless told otherwise.
They are listed because each is a policy call, not a technical one.

| # | Question | My conservative default |
| :--- | :--- | :--- |
| 1 | **Max crew size** — is 2 a hard rule, or should a 3-person crew be allowed? | Hard cap **2**, matching the "2-tech crew/vehicle" model. |
| 2 | **Empty crews blocked** — should an active crew with no members be forbidden, or just warned? | **Forbidden to save as active**, warned where it already exists. Nothing deleted. |
| 3 | **Future-dated jobs on the technician's phone** — hidden until the day, or shown and labelled? | **Shown and labelled.** Hiding risks a job nobody knows exists. |
| 4 | **Stock-on-hand** — do you want deliveries recorded so stock can be real? | **No for now.** Usage is tracked and honestly labelled; stock needs receipts first. |
| 5 | **Repeat-fault threshold** — 3 faults in 90 days, as specified? | **Yes**, keyed on `line_number`. |
| 6 | **Before photos** — optional or required for certain job types? | **Optional everywhere**; requiring them would block closing a job. |
| 7 | **WhatsApp recipient** — open the picker, or pre-fill the customer's number? | **Open the picker** (the existing behaviour). Pre-filling risks messaging the wrong person if a phone number is shared. |

---

## 4. What I will not do

Restating the exclusions so they are not quietly reintroduced:

* No customer portal, no offline/sync engine, no third-party AI OCR, no in-app chat, no technician
  leaderboards, no scheduler beyond basic dates.
* No paid backups, no restore drills, no CI billing work — per instruction.
* No new vendor, no new dependency, no key that could start billing.
* No deletion or rewrite of production rows. Every migration here is additive; rollbacks are
  documented per phase.

---

## 5. Verification, every phase

Each phase ends with the same evidence, reported with real output rather than a claim:

```
npm run typecheck
npm test              # must stay green; count should grow
npm run verify        # includes bundle budget (200 kB) and the credential scan
```

Plus, where a migration is involved: applied to the live project **read-first**, verified with a
`BEGIN … ROLLBACK` probe before committing the change, and a stated rollback.

Production data is not modified. Where a probe needs a write, it runs inside a transaction that is
always rolled back.

### Phase 16 — Faults get their own system, and a job becomes editable — ✅ DONE 24/11/2026

**Effort:** ~5 hours. **Depends on:** Phase 15. **Migration:** 033 (applied).
**Result:** `npm run verify` green at **677/677 tests**.

> **Scope note.** This phase was opened as "enhance the dispatch page once more
> before Team". It turned into a data-model change, because two of the four things
> asked for — a fixed fault type and a 48-hour fault clock — cannot live in a
> component. They live in `task_sla_days` and a CHECK constraint, and everything
> else reads them from there.

**What the user asked for, and what it became.**

| Asked | Built |
|---|---|
| Installations and faults separated, each manageable | A two-tab split, two promises on the tabs, a fault board with its own queue and counts |
| Delete, edit, and see jobs one by one | `delete_task` + `edit_task` in SQL, the history panel and the delete section in the action sheet, `EditJobSheet` |
| Select all / multi-select → delete, edit, retype | `bulkDeletePlan`, `deleteTasksBulk`, `setFaultTypeBulk`, `setPriorityBulk`, select-all scoped to the active tab |
| Both kinds to one technician, several at once | Already true of assignment; the *route* now shows why: `technician_route_split` |
| Faults must be "best and perfect" | 48 h clock, 8 fixed types, breach-first ordering, an untyped count that is actionable |
| Anything else the agent judges missing | The job history panel (logs, materials, photos) and the delete-policy explanation |

**The four decisions, and why each went the way it did.**

**Delete is strict.** A job is deletable only if nobody has touched it: no assignee,
no timer, no work log, no photo, no material, no box log, no child. Everything else
must be cancelled instead. The reasoning is that a cancelled job is still evidence —
it says "we knew about this and here is why we stopped" — while a deleted one says
nothing. Completed jobs are never deletable at all. The rule is enforced in
`delete_task` and mirrored in `whyNoDelete`, and a test asserts the two agree on
every status.

**Two clocks, not one.** A fault is promised in 48 hours and an installation in 72.
The user rejected a single three-day promise, and the reasoning holds up: an
installation is a booking, and a fault is a customer who is already paying and whose
service has stopped. The cost of the second kind of lateness compounds hourly. Both
windows are defined once, in `task_sla_days(task_type)`, and every new consumer
reads that function. The four older report functions still type `interval '3 days'`;
`tests/sla.test.ts` was updated to follow the promise to its new home and to pin
that `today_summary` now calls the function rather than a literal.

**Fault types are a fixed list.** Eight values: no signal, slow speed, cut cable,
faulty box, damaged port, loose connector, power, other. Free text was rejected, and
correctly — a free-text field on a phone produces `cusub`, `cusbo`, `Cusub` and
`something` for the same job, and none of them can be counted. `NULL` means "not
recorded", never "unknown fault"; there is a real difference between a fault nobody
classified and a fault classified as "other", and collapsing them would make the
untyped count lie. A CHECK refuses a fault type on an installation.

**Ordering: breach first, then the urgent flag.** `faultQueue` sorts breached faults
before merely-due ones, and only then by the urgent flag and age. The one live
urgent fault is also the oldest breach, so the order does not change today — but if a
supervisor flags a fault urgent *this morning*, it must not jump ahead of one that
breached three days ago. Being late is a fact; being flagged is an opinion.

**The reconnaissance finding that mattered most:** six of the nine live faults have
**no area and no box**, and `clusterTasks` groups on exactly those two fields. Those
six could never be planned. Phase 15 could only *warn* about them, because there was
no way to supply the missing place short of a database console. This phase adds the
way, which is why the edit sheet is the most valuable control on the page even though
"edit" sounds like the least interesting item on the list.

**What this phase deliberately did not do.** It did not rewrite the four
`SECURITY DEFINER` report functions to use the per-type clock (see LIMITS 8n), did
not add coordinates or distances (LIMITS 8i), and did not make the fault type a
diagnosis field (LIMITS 8m).

**Tests added:** 33 in `tests/faults.test.ts` (clock parity read out of the
migration, queue ordering and stability, labels in both languages, the summary
sentence, the delete mirror against every status, the bulk plan), 3 render tests,
3 wiring guards, and the corrected SLA scan.

### Phase 17 — Team & Crews: a roster that cannot lose work — ✅ DONE 24/11/2026

**Effort:** ~3 hours. **Depends on:** Phases 15–16. **Migration:** 034 (applied).
**Result:** `npm run verify` green at **721/721 tests**.

**The reconnaissance finding.** This page looked complete and mostly was: members,
crews, groups, PIN flagging, a two-person cap, an empty-crew warning, live
updates. Six things were wrong, and three of them shared one cause — `is_active`.

That single column is what `dispatch_load` filters on to build the board's lanes.
It is also what both upsert functions set from a form, checking nothing.

**What was broken.**

| Found | Why it mattered |
|---|---|
| Deactivating a technician holding 2 open jobs succeeded silently | Their jobs left every lane while staying `assigned` — invisible work |
| Retiring a crew holding 2 open jobs did the same | Same, for a whole vehicle |
| An active crew could contain somebody off duty | A staffed-looking vehicle that cannot take a job |
| Six lanes presented as capacity for a two-vehicle department | A supervisor plans a shift against a number that is double |
| A crew's status could never be changed after creation | `setCActive` was only ever called on open, so the retirement rule had no door |
| Two members imported each got a crew; two shared one | Not a bug — but the roster never showed who was holding what, so it read like one |

**The rule, and why it refuses instead of helping.** Deactivating a person with work
is refused: *move the work, then retire the person.* Reassigning automatically was
considered and rejected — choosing who inherits two faults is a dispatch decision
made against a shift, and the roster has no shift in front of it. Inventing an
answer to that question is worse than refusing to answer it.

A job `in_progress` or `blocked` gets its own, harder sentence: somebody is standing
at the customer's house, which is not the same situation as a job waiting to be
picked up.

**Deliberately not done.** No bulk reassignment from the roster (it belongs on the
dispatch board, where the destination is chosen), and no deletion of people —
every historical reference is `NO ACTION`, so a person who has worked can only be
retired. `crew_members` was left as the one cascading link, which is right: a crew
link is not evidence.

**Tests added:** 26 in `tests/roster.test.ts` — the live failure reproduced exactly,
pluralisation, in-progress wording, the crew path, capacity counting including a
retired crew's members, and three guards that the *database* enforces the rule
rather than only the screen, because a client-side check is what another
supervisor's stale tab will bypass.

### Phase 18 — A PIN that signs in, and a fault that says what it is — ✅ DONE 25/11/2026

Started from two complaints that looked like two small bugs and turned out to be
five, four of them invisible from the code.

**The PIN.** "When I change a PIN in the supervisor it does not apply." It did not,
for three separate reasons, each hiding the next. A busy account was locked from
wrong sign-ins, and issuing a PIN left the lock in place — so a byte-for-byte
correct new PIN returned `locked`. The banner counted people who had *finished*
the job, not people who had not started it. And its only button could set a flag
but never clear one. All three are fixed: a supplied PIN clears the lock, the
banner reads a column that is set and cleared by the same actions that issue and
replace a PIN, and there is a second button for the honest case — everybody has
changed theirs and the flag is simply stale.

`pin_status` exposes both facts a supervisor needs: who is still on a department
PIN, and which accounts are locked out. The second one was invisible, which is why
"I gave him a new PIN" looked like a bug in the PIN and not a bug in the lock.

**The fault type.** The complaint column was already read from the sheet and
already stored, so the plumbing the request implied did not need doing. What was
wrong was the content: thirteen values, none of them a fault type — "CILAD" (the
word for *fault*), "degdeg" (urgent), a phone number, `c`, `dd`, `ok`. A mapper
now turns what it recognises into the eight types and returns nothing for the rest,
because guessing is worse than an honest blank. `set_fault_type` lets the
technician at the box answer it on their own job, which is the point: the customer
often cannot say whether it is slow speed or a cut cable until they have been
called.

**The fourth bug, found by reading the audit log.** All thirteen open faults had
`fault_type = 'no_signal'` and all thirteen complaints were junk, which does not
follow. The work log had the answer: every one was edited inside three seconds with
`before.fault_type = null`. `BulkEditSheet` defaulted its action to "Fault type"
and its select to `'no_signal'`, so opening it and pressing the primary button
reformed every unclassified fault into "No signal" with nobody choosing it. They
are back to "not recorded", which is honest, and the sheet now starts blank.

**Also:** Team & Crews lists a person's open jobs and can open the dispatch board's
own edit and action sheets on them, so a supervisor no longer leaves the screen to
correct a job. `team_workload` carries enough columns to show a job instead of only
counting it.

**Tests added:** 21 — 11 in `tests/pins.test.ts` (the flag decides, the count
reaches zero, the PIN length rule, lockout wording, and that the removed sentence is
gone from the screen), 10 in `tests/faultType.test.ts` (the client list equals the
database CHECK, junk maps to nothing, a set type is never overwritten by an import,
the technician can only touch their own job, the bulk sheet cannot invent a type).
