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

## 4. Release notes — v1.1.0 (09/11/2026)

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
