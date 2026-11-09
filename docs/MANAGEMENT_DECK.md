# The meeting — eight slides, in order

> Written to be *said*, not read. Each slide is one idea, one number, or one
> screenshot. If a slide needs explaining twice, it is the wrong slide.

**Who is in the room:** a department head, a supervisor, probably someone from
IT. They have twenty minutes and one question: *does this make my job easier or
my life harder?*

**The rule:** never demo a feature they did not ask for. Show the daily sheet
problem, then the sheet being solved.

---

## Slide 1 — "Today, the daily sheet lives in a WhatsApp group"

**On screen:** a photo of a real (or redacted) Galinta sheet, a WhatsApp group
screenshot with three copies of it, and a sticky note that says *"who has this
one?"*

**Say:** "Every morning this photo arrives. Whoever is at the desk reads it,
picks out the F1 rows, decides who goes where, and tells people — usually by
phone. By afternoon, nobody can say with certainty who is on which line or how
long it took."

**The number:** *we do not know how many jobs are open right now, or how long
the oldest one has waited.*

---

## Slide 2 — "So we wrote the thing that reads it"

**On screen:** the sign-in screen, in Somali. The version stamp is visible.

**Say:** "One web address. No install. It works on any phone that has a browser
— the ones they already carry. It asks for a name and a PIN."

**Do not** say "we built an app". Say "we wrote the thing that reads the sheet".

---

## Slide 3 — "It reads the photo on the phone, and keeps only F1"

**On screen:** the import screen mid-recognition → the extracted rows → the
duplicates panel.

**Say:** "The photo never leaves the phone. The recognition happens inside the
browser — there is no outside service looking at our customers' names. It keeps
only rows where Group is F1. And it never imports a duplicate silently: every
one of these is a person's decision."

**The number:** *19 of 19 rows on a Cilada sheet, 13 of 13 on Galinta, in the
lab.*

**If IT asks the good question — "where does the photo go?"** — answer exactly:
"Into a private table behind the same sign-in as everything else. There is no
URL for it."

---

## Slide 4 — "The work is grouped by street and by box, not by who is free"

**On screen:** the dispatch board, then the plan sheet sorted by Xaafada.

**Say:** "It groups by street and by cablebox, because that is how driving works.
Urgent first, then geography. One technician or a two-man crew — the same vehicle
they already share."

**The number:** *a plan for the whole group in three taps, and it is copied as a
WhatsApp message they already know how to read.*

---

## Slide 5 — "The technician gets their list, and their own timer"

**On screen:** the technician route on a phone (or a phone-sized window), the
running timer, then the block + resume.

**Say:** "They see their own jobs — not the whole group's. Tap the number, it
dials. Start when they arrive, the clock runs. If they cannot do the job, they
block it with a reason and it stays theirs until they can. When they finish,
they must enter the optical reading."

**Say this, because it is the part that changes behaviour:** "The timer is not
there to catch anyone. It is how the department learns what a job actually costs
— which is the number every conversation about staffing runs into."

---

## Slide 6 — "Every box remembers"

**On screen:** a cablebox, its port map, its fault history, a job's warning that
this is the third fault on that box in thirty days.

**Say:** "A customer calls back a week later. Today the technician drives there
to find out. With this, the phone already knows that box has been repaired three
times, and which ports are damaged."

**The number:** *the difference between a repeat visit and a repair.*

---

## Slide 7 — "At the end of the day, the report writes itself"

**On screen:** Analytics, then the CSV and the WhatsApp text.

**Say:** "One click gives the day as a spreadsheet for the record, and as a
message for the group — the same two things you already produce by hand."

---

## Slide 8 — "One group, one month, real sheets. Then you decide."

**On screen:** four lines, nothing else.

```
PILOT — Group F1, one month
  compare:  repeat visits · time per job · jobs waiting > 3 days
  cost:     ~$25/month (database backups + no pausing)
  stop if:  it does not beat the current process on all three
```

**Say:** "We are not asking you to replace anything. We are asking for one month
and one group. If those three numbers do not improve, we stop and we have lost
nothing."

**Then stop talking.** The silence is where the yes happens.

---

## Questions that will come, and the honest answers

| They ask | Say | Never say |
| :--- | :--- | :--- |
| "Who can see customer data?" | "Only someone signed in, only their own group. Without a session the database returns nothing — you can watch me prove it." | "It's secure." |
| "What if the internet is down?" | "Typed notes stay on the phone, but a job cannot be submitted until there is signal. That is a deliberate trade for this phase." | "It works offline." |
| "What if the phone is lost?" | "The supervisor resets the PIN immediately. The record of the work is not on the phone." | "It's fine." |
| "Who owns this when you leave?" | "The runbook and handover pack name an owner for each thing. That is part of the pilot, not an afterthought." | "I'll always be around." |
| "Can it do F2 and F3?" | "The database is multi-group today. Cross-group reporting for a manager is a small next step, not a rebuild." | "Yes, everything." |
| "How much?" | "About $25–65 a month to run properly. Against one avoided repeat visit a week, it pays for itself." | A vague shrug. |

---

## What not to put on a slide

* **The test count.** 203 tests is a reason to trust the work; it is not a
  reason for a manager to approve it. Mention it only if IT asks how you know it
  will not break.
* **Architecture diagrams.** One sentence: "the phone talks to the database
  through functions that check who you are." That is the whole diagram they need.
* **A roadmap of every remaining feature.** It invites "come back when it is
  finished". The pilot framing is the ask.

---

## The one line to leave in the room

> "The sheet arrives as a photo at nine, and by ten every technician has their
> own list on their own phone — and at six the report is already written."
