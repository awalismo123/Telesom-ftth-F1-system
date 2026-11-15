# What the system is missing — a recommendation

Written 15/11/2026 against `main` @ `3db4cd9`.
Every claim below was checked in the code, not remembered.

---

## First: what is already strong

Worth stating so nobody rebuilds it.

* **The field loop closes.** Sheet → OCR → dedupe → dispatch → technician timer →
  dBm proof → box history → CSV and WhatsApp report. Most systems in this
  category stop at dispatch and never prove the job was done.
* **The honesty is real.** Demo rows are labelled, truncated lists say so, empty
  states explain themselves, errors are translated and never invented.
* **Repeat-fault detection exists** (`is_repeat_fault`, carried from the sheet).
* **The dedupe model is conservative** — nothing imports without a tap.
* **268 tests**, with lints that catch real regressions rather than decorating a
  build log.

The gaps below are about what happens *around* that loop.

---

## Tier 1 — Not features. Risks.

These are not "nice to add". They are the difference between a system he can
put in front of the department and one he cannot defend afterwards.

### 1. There is no backup, and no way to test a restore
**Blocked on ~$25/month.** Supabase Free has no automated backups and pauses
after ~7 days idle. If a table is dropped or a row corrupted, there is no
recovery path. Right now the honest sentence to management is *"a lost table
cannot be recovered."*

This is the single largest item on the list and it is not code. Everything else
in this document is worth less until it is closed.

### 2. CI is dead and nobody notices a broken build
GitHub Actions is billing-locked; every run fails. The protection is that
`npm run verify` is good and people run it — which is a habit, not a control.
Billing, owner-only.

### 3. Nothing outside the app tells anyone anything
`NotificationsBell` is derived in-app state. **There is no push, no SMS, no
email.** Consequences:

* a technician learns of a new job only by opening the app;
* a supervisor learns a job blew its SLA only by opening the app;
* the customer is told nothing, ever.

For a field service this is the biggest *technical* gap. See Tier 2 #4 for the
cheap version worth doing first.

---

## Tier 2 — The missing product

Ordered by how much operational pain each one removes per unit of work.

### 4. No customer contact loop
The customer has no idea when anyone is coming. The result is the call-back:
the customer phones the office, the office phones the technician, the technician
stops working.

**Cheapest version that helps:** a WhatsApp message the supervisor can send in
one tap per job — *"Your Telesom technician is coming today, 10:00–12:00"* —
generated from the same `wa.me` mechanism the dispatch summary already uses.
No SMS gateway, no cost, no new vendor.

**Full version:** the technician taps *"On my way"* on a route card, which
sends the same message and stamps a time. That is also the first real
customer-facing timestamp the system has ever had.

### 5. Nothing is scheduled — every job is "today"
`scheduled_date` exists in the schema and the importer **hardcodes it to today**
(`src/lib/importer.ts:271`). So the system cannot answer "what is booked for
Thursday", and a job imported on Friday for a Monday visit has no home.

**Add:** a date on import and on manual entry, a "Planned" lane on the dispatch
board, and a per-day technician load. This is the prerequisite for everything a
manager means by "planning".

### 6. No map, and no sense of distance
No geolocation, no coordinates, no routing. Clustering by `Xaafada`/`Cablebox`
is genuinely clever and gets most of the benefit — but a supervisor cannot see
that two crews are working 200 m apart, and a technician cannot open directions.

**Cheap version:** a "Directions" link per job (`geo:` URI with the box name, or
coordinates if they exist). **Honest caveat:** coordinates must be captured once
per box, and a wrong coordinate is worse than none.

### 7. Materials are invisible
Galinta involves handing over a router — `router_state` tracks *whether* it was
collected, but nothing tracks stock. Cable, splitters, ONTs, connectors are all
invisible. Every month-end reconciliation is manual.

**Add:** a simple consumption line per completed job (item + quantity) and a
stock-on-hand view. Not a warehouse system; a list that is right.

### 8. Box health is a port list, not a judgement
The registry shows ports and their status. It cannot answer *"which box will
fail next month"* — the question that turns reactive work into planned work.

**Add:** a fault count per box over a window (the data already exists in
completed tasks, which carry `cablebox_id`), and a ranked "worst boxes" list on
the supervisor screen. No ML; a count and a trend.

### 9. Repeat faults are tagged, never escalated
A repeat fault shows a blue warning on the card. Nothing stops it coming back a
fourth time. There is no rule like *"3 faults in 90 days → investigate the box,
not the drop."*

**Add:** the count on the card, and an escalation flag at three.

---

## Tier 3 — Worth doing, less urgent

10. **Technician performance, visible and fair** — analytics exist; the missing
    piece is per-person throughput and time, shown to the supervisor rather than
    only in the aggregate. Handle with care: a timer that runs while a job is
    blocked measures the blocker, not the person.
11. **Customer history in one place** — phone → all past jobs → outcome. Reuses
    `previous_task_id`.
12. **Crew cap enforced** — `crew_members` has no maximum and no minimum. Two
    active crews measure 0 and 3 members today. Enforce 1–2 in the database.
13. **SLA escalation** — the 3-day promise is displayed and never acts.
14. **Print-anything** — the period report prints well; a printable job sheet
    with the box, port and dBm target would help a technician on paper.
15. **Bulk reassignment** — dispatch is one job at a time outside auto-cluster.
16. **Photo before/after** — photo proof exists; a before photo makes a dispute
    about existing damage decidable.

---

## What I would refuse to add, and why

Being useful means saying no.

* **A customer portal.** It doubles the data-exposure surface (see
  `KNOWN_LIMITS` §7b: a manager already sees every group's customer data) and
  needs support nobody has staffed.
* **Offline mode.** Previously declined and still right: it means a sync engine
  with conflict resolution over data with no natural key. The failure mode is
  silent loss of field data, which is worse than needing a signal.
* **AI vision for OCR.** Already decided: in-browser, no third-party upload.
  Customer names and phone numbers must not leave the device.
* **A chat feature inside the app.** WhatsApp already works, has everyone on it,
  and does not need an account. Rebuild it worse.
* **Gamified dashboards for technicians.** Leaderboards on people doing
  difficult work in the heat produce the wrong behaviour — closing jobs to close
  them.
* **A second, more sophisticated scheduler before #5 exists.** Optimising an
  empty calendar is theatre.

---

## Recommended order

| # | Item | Why now | Size |
| ---: | :--- | :--- | :--- |
| 1 | Backups + one restore drill | The only irrecoverable failure | Billing |
| 2 | CI unblocked | No gate on future merges | Billing |
| 3 | Crew cap (1–2) | Wrong numbers on the landing screen today | Hours |
| 4 | Scheduling + "Planned" lane | Unlocks all real planning | Days |
| 5 | "On my way" WhatsApp | Removes the call-back loop | Days |
| 6 | Box fault counts + worst-boxes list | Turns reactive into planned | Days |
| 7 | Materials per job | Ends manual month-end | Days |
| 8 | Repeat-fault escalation | The data is already there | Days |

Items 1 and 2 are not code and are not mine to unblock. **Item 3 is a few hours
and fixes a number that is currently wrong on the screen the supervisor looks at
first** — I would do that before anything else on the list.

---

## The one-line summary

The system is good at the work it does — it is one of the few of its kind that
proves a job was done. What it cannot yet do is **plan, warn, or remember**: it
knows today, it does not know what is coming, it cannot tell anyone without
someone opening the app, and the box history it holds is not yet turned into a
judgement about what will fail next.
