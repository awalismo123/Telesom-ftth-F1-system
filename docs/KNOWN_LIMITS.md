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

## 2. Search can show a job that is not yours

`global_search` returns any job in the group to any signed-in user of that group —
including a technician searching a line they are not assigned. They see the
customer's name and phone.

This is the same exposure the REST API already had (`tasks` has a single
`SELECT USING (true)` policy), now with a convenient door. It is *recorded*, not
fixed, because the fix is the security batch that was parked:

- make the `tasks` policy group- and role-scoped,
- give the technician role a policy that only sees its own jobs,
- keep supervisor search group-wide.

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

Not implemented. The app is text and numbers. A photograph of a finished
installation is not stored (the input sheet photo is used for OCR and is not
retained server-side either).

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
audience. The short version of what must change first:

1. **Reads are open.** All 11 operational tables are `SELECT USING (true)` for
   the anonymous role, so the customer list can be read with no login. Batch B.
2. **`sheet-images` is a public bucket** and allows anonymous upload. Batch B.
3. **PINs have no attempt limit** and default PINs are still active. Batch B.
4. **No backups** on the current plan, and a Free project pauses when idle.
   Batch G.

Anything in this file that is not in that list is a limitation, not a blocker.
