# Runbook — operating Group F1

Everything an operator does **without a developer**. Each task says what to tap,
what to expect, and what it looks like when it goes wrong.

- Production: <https://telesomftthfonesystem.vercel.app>
- Supabase project: `pjrzncnhhlfaxuvlcdse` (`eu-west-1`)
- Every push to `main` deploys. There is no staging environment.

---

## 1. Daily open

1. **Supervisor signs in** — username `supervisor` or phone `634000001`, 4-digit PIN.
2. **Upload the sheet** → *Daily Sheet Upload*. Photograph the Galinta or Cilada
   table, or paste/import the file. Confirm only the rows you want; duplicates are
   never imported without a tap.
3. **Dispatch** → *Dispatch & clustering*. Tick jobs, choose a technician or crew,
   or press *Auto-cluster*, then **Copy full plan** into the group chat.
4. **Watch the day** in the live strip: who is running, who is blocked, for how long.
5. **Close the day** in *Insights* → download the CSV and copy the WhatsApp report.

A technician opens the same URL, signs in with their PIN, and sees only their route.

---

## 2. People

### Add a technician

*Team & Crews* → *Team Members* → **Add Team Member**.

| Field | Rule |
| :--- | :--- |
| Full name | Shown to supervisors on the dispatch board |
| Username | Login id, unique per group |
| Phone | `63xxxxxxx` — this is also a login id |
| Role | `technician` (supervisor access is deliberately rare) |
| PIN | 4–6 digits, chosen by the person at first sign-in |

The PIN is hashed; nobody — including a developer — can read it back. It can only
be replaced.

### Reset someone's PIN (they forgot it)

*Team & Crews* → edit the member → **new PIN** → save. The old PIN stops working
immediately; sessions already open stay valid until they expire.

**The person is then asked to choose their own PIN before the app opens.** That
is deliberate: a PIN the supervisor knows is a shared password, and it makes the
work log a record of "somebody" rather than of a person. Tell them the temporary
PIN and let them change it.

### Change your own PIN

Header → key icon → current PIN + new PIN. This is the only way that requires the
old PIN, so it is also the safe one to do on a borrowed phone.

### "It says too many wrong PINs"

Five wrong PINs lock the account for **15 minutes**, and the lock survives a
page reload because it is stored with the account, not in the browser. Either
wait, or reset the PIN (§2) — a reset clears the lock immediately.

If someone reports being locked out without typing a wrong PIN, treat it as a
question worth answering, not a nuisance: it means five attempts were made.

### Deactivate someone who left

Edit the member → **inactive**. They disappear from dispatch targets and cannot be
assigned new work, but their history — every job, every reading — stays intact.
Do **not** delete a person; deleting takes their jobs' audit trail with them.

---

## 3. Crews and vehicles

*Team & Crews* → *2-Tech Crews* → **Add crew**: name, vehicle tag, zone focus,
two members.

A job assigned to a **crew** is visible to both members on their phones. Whichever
of them starts it starts the same timer — the second phone shows it already
running rather than starting a second one.

---

## 4. Cableboxes

*Cablebox History* → **Register box**: code, area, OLT path, port count, notes.

* If the code already exists the sheet shows **the existing box** and offers to
  open it. Never create a second one: a twin box splits its own history.
* Box codes are **unique across the whole department**, not per group. If a box
  belongs to another group the sheet says so — pick a different code.
* Shrinking a box (e.g. 12 → 8 ports) is refused while a port above the new count
  is occupied, damaged or reserved. Free those ports first, or keep the size.

Ports are edited from the box sheet by the technician **and** the supervisor. Every
change records who made it and when.

---

## 5. Adding the next group (F2, F3, …)

1. *Team & Crews* → *FBB Groups* → **Add group**: code (e.g. `F4`), name, description.
2. Switch the active group from the header dropdown.
3. Add that group's technicians, crews and boxes.
4. Import its daily sheet — the extractor only keeps rows whose Group column
   matches the active group's code.

The database, the RPCs and every screen already handle multiple groups; nothing
needs deploying.

---

## 6. Fixing a mistake

| Situation | Do this |
| :--- | :--- |
| An import was wrong | *Daily Sheet Upload* → history → **Undo** that batch. Jobs it created are removed; jobs that already existed are untouched. |
| A job should not be worked | Job **⋮** → **Cancel the job** with a reason. Time already spent is kept. |
| A job was cancelled/completed by mistake | Job **⋮** → **Reopen the job**. The old reading and duration are written into its history. |
| The wrong technician has a job | Job **⋮** → assign to the right one, or **Return to the pool**. A job that is already *running* refuses to move — the technician must stop it first. |
| A port was marked damaged by mistake | Open the box → tap the port → set it back to *In use* or *Free*. |

**Nothing is ever hard-deleted except demo data and a reverted import.** That is
deliberate: the answer to "who cancelled this and why" has to exist three months
later.

---

## 7. Demo data

*Insights* → **Load demo history** creates ~30 days of flagged sample jobs so the
analytics and box health look real while training. **Remove demo data** deletes
only rows with `is_demo = true`; real work is never touched.

Before quoting any number to management, check the banner on *Insights*: it states
whether demo jobs are included.

---

## 8. When something is wrong

### "Invalid API key" / configuration card on the login screen

The app's Supabase key was rejected. Check that the project is not paused
(Supabase dashboard → project → *Restore*), then redeploy from Vercel. The app
blocks sign-in rather than showing empty screens — an empty dispatch board would
look like "no work today".

### The board does not update on its own

Live updates arrive over a WebSocket. If a phone's network blocks it, the screen
still refreshes every three minutes **while visible**. Pull-to-refresh (or the
refresh button) forces it immediately.

### Nobody can sign in

1. Confirm the project is healthy in the Supabase dashboard.
2. Try the supervisor account. If that works, the problem is one person's PIN —
   reset it (§2).
3. If the supervisor also fails, the sessions table or the auth function changed:
   see `supabase/migrations/007_session_and_health_fixes.sql` and re-apply only if
   it was never applied (check `list_migrations` first).

### A deploy broke something

Vercel → *Deployments* → the previous green deployment → **Promote**. The
database is not versioned with the deploy, so rolling back the front end is
always safe; migrations are forward-only and additive.

### Rotating the Supabase key

Only if the anon key leaked. The anon key is public by design (it ships in the
bundle) — what protects data is Row Level Security. Rotating it means updating the
built-in key in `src/lib/supabase.ts`, redeploying, and refreshing every phone.

**The real risk is not the anon key** — it is the open `tasks` policy documented in
`PERFECTION_PLAN.md` §9.9 and `KNOWN_LIMITS.md`.

---

## 9. Health checks

```bash
cd Telesom-ftth-F1-system
npm install
npm run verify          # typecheck → tests → build → bundle budget
```

`npm run verify` is the gate. It must pass before a merge. GitHub Actions does not
execute on this account, so the local run **is** CI; the Vercel check still runs
and must be green.

In production, the fastest health check is: the login screen loads, and the
supervisor signs in and sees a non-zero pool.

---

## 10. Going live checklist

Run this once, on the day real sheets start. Everything here is reversible
except the demo purge, which is only a demo purge.

| # | Step | How |
| :--- | :--- | :--- |
| 1 | Clear the demo set | Insights → **Remove demo data**. The banner disappears and the numbers become real. |
| 2 | Replace every PIN | *Team & Crews* → edit each member → new PIN. Each person is then forced to choose their own. |
| 3 | Delete or deactivate the demo accounts | Demo technicians and their phones are in `Team`. Deactivate rather than delete, so no audit trail is lost. |
| 4 | Confirm the seed functions cannot run | `seed_demo_data` is supervisor-only and needs a token; do not call it again in production. |
| 5 | Take a backup | Supabase → Database → Backups, or `pg_dump` to a file you keep. **Do this before step 1**, not after. |
| 6 | Note the numbers | Record open jobs, box count, technician count. If anything looks wrong later, this is the reference. |

---

## 11. What is protected, and what is not

Written down so nobody has to guess during an incident.

**Protected**

* Reading any table without a session — the database returns nothing.
* Reading another group's data, even with a session for a different group.
* Writing anything without a supervisor or owner token.
* Guessing a PIN — five attempts, then fifteen minutes.
* Finding a customer sheet photo by URL — no public URL exists.

**Not protected**

* A **shared phone** left signed in. The session persists for 30 days; use the
  sign-out button, and change the PIN if a phone is lost.
* **The database itself.** Supabase's service role can read everything; that key
  is never in the app, and it should never be pasted into a browser console.
* **Backups.** There are none on the current plan. A bad `DELETE` is permanent.

---
