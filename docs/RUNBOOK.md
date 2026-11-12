# Runbook — operating Group F1

Everything an operator does **without a developer**. Each task says what to tap,
what to expect, and what it looks like when it goes wrong.

- Production: <https://telesomftthfonesystem.vercel.app>
- Supabase project: `pjrzncnhhlfaxuvlcdse` (`eu-west-1`)
- Every push to `main` deploys. There is no staging environment.

---

## 1. Daily open

1. **Supervisor signs in** — username `supervisor` or phone `634000001`, 4-digit PIN.
2. **Read the first screen.** It answers one question — *what needs me now* — and
   leads with the most urgent thing, in this order: blocked, past the 3-day
   promise, unassigned. If it says "nothing is blocked, none past the promise",
   the day is under control and you can go straight to the sheet.
3. **Upload the sheet** → *Daily Sheet Upload*. Photograph the Galinta or Cilada
   table, or paste/import the file. Confirm only the rows you want; duplicates are
   never imported without a tap.
4. **Dispatch** → *Dispatch & clustering*. Tick jobs, choose a technician or crew,
   or press *Auto-cluster*, then **Copy full plan** into the group chat.
5. **Watch the day** in the live strip: who is running, who is blocked, for how long.
6. **Close the day** in *Insights* → download the CSV and copy the WhatsApp report.

**The five tiles under the headline** are blocked, over-3-days, unassigned,
crews out (out of the total active crews), and jobs closed since midnight. The
"today" figures use the phone's own date, not the server's — Hargeisa is UTC+3,
and a job closed just after midnight must land on the day the shift happened.

**If the dispatch pool says "this list stops at 600 jobs"**, there are more open
jobs than the board loads. Filter by box or area rather than scrolling — the
board is telling you it cannot show you everything.

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

### Reset a manager's PIN

Managers are not on *Team & Crews* (they are not group staff — migration 017),
so a manager who forgets their PIN is reset in the SQL editor, not in the app:

```sql
update public.user_credentials c
   set pin_hash = extensions.crypt('482913', extensions.gen_salt('bf')),
       failed_attempts = 0,
       locked_until = null,
       updated_at = now()
  from public.users u
 where u.id = c.user_id and u.username = 'maamule';

update public.users set must_change_pin = true where username = 'maamule';
```

They sign in once with the temporary PIN and are forced to choose their own.

### Everyone is locked out (after migration 018)

Migration 018 deletes every published PIN by rotating the hash to a random value
nobody knows. Anyone who had not yet chosen their own PIN therefore cannot sign
in, and **cannot reset themselves** — `change_own_pin` needs the PIN they no
longer have.

The supervisor fixes this from *Team & Crews* → edit member → new PIN → save,
which clears the lock and forces a change at first sign-in. Do this for one
person at a time and hand the temporary PIN over in person.

For a manager, or if the supervisor's own account is the one that is stuck, use
the SQL in *Reset a manager's PIN* above (swap the username).

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

**A crew is meant to be one or two people.** The app calls the second member a
*partner* and the vehicle is a two-person vehicle, but nothing stops a crew
having three members or none. Measured on the live project (09/11/2026): Crew A
had **0 members**, Crew B had **3**.

An empty crew still counts in "crews out of N", so the first screen can say
"0/2" while three people are actually in the field. Fix the roster on *Team &
Crews* before reading the crew numbers.


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

*Insights* → **Load demo history** creates **36 completed jobs across the last 29
days**, spread over the boxes, each with a work log, a port marked in use, and a
chronic bad port per box so the health flags have something to say.
**Remove demo data** deletes only rows with `is_demo = true`; real work is never
touched.

**Verified, not assumed.** On the live database: seeding produced 44 jobs (8 real
+ 36 demo) and 38 box events; removing returned it to 8 jobs, 0 demo rows, 0 box
events, 40 work logs, and the exact prior port map (16 ports — 13 unknown, 3
damaged, 0 occupied). Nothing was left behind.

**The banner follows the numbers.** Any screen whose figures demo data can
inflate now says so:

| Screen | What it says |
| :--- | :--- |
| Insights | "36 demo jobs are included in these numbers" + the two buttons |
| Period report (printed too) | "36 of 44 jobs in this report are demo — remove them before filing this" |
| Manager portfolio | "36 of 44 jobs in this window are demo. The group figures below include synthetic work." |

If no banner appears, no demo rows are in that scope — the count is zero. Do not
train yourself to ignore the banner: it is only ever shown when the number really
is affected.

**Before quoting a number to management**, look for the banner. If it is there,
either remove the demo data or say the number is mixed.

**A quirk:** seeded jobs have a `reported_date` spread across the month but a
`created_at` of the moment they were seeded, so a period report counts all 36 in
the window that contains the seed. That is why the disclosure counts on
`created_at` — so the label and the number it labels always agree.

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

### The merge went in but the site did not change

Vercel is connected (it comments a preview link on each PR), but it does not
always promote a merge to production. Check, in this order:

1. Vercel → the project → **Deployments**: does the `main` commit appear? If not,
   the push never reached Vercel — check the project's Git connection.
2. If it appears and says *Ready* but the live URL is unchanged: the project's
   **production branch** is not `main`, or an **Ignored Build Step** skipped it,
   or the project is **paused** (a free-tier project pauses after inactivity).
3. If it appears and says *Error*: open the build log — a type error fails
   `npm run verify` locally too.

Do not diagnose this by looking at the footer version: `BUILD_DATE` is a
constant in `src/lib/version.ts`, so an old build and a new one can carry the
same label. Compare a string you actually changed.

### CI is red for every push, in about a second

That is not your code. Open any failed run and read the annotation:

> The job was not started because your account is locked due to a billing issue.

GitHub Actions will not start a job while the owning account has an unresolved
billing problem, even on a public repository where minutes are free. It is fixed
in **GitHub → Settings → Billing**, by the account owner. Nobody in the field can
fix it, and no workflow change helps.

Meanwhile:

```bash
npm run verify          # typecheck, 212 tests, build, bundle budget, credentials
npm run hooks:install   # once per clone — runs verify before every git push
```

If a push is blocked by the hook and you are certain, `git push --no-verify`.
Treat that as a conscious choice, not an accident.

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
| 2 | Replace every PIN | *Team & Crews* → the amber **Department PINs still in use** banner → **Flag all of them**. Every active member (including you) then chooses their own PIN at next sign-in. Doing it member by member also works. |
| 3 | Delete or deactivate the demo accounts | Demo technicians and their phones are in `Team`. Deactivate rather than delete, so no audit trail is lost. |
| 4 | Confirm the seed functions cannot run | `seed_demo_data` is supervisor-only and needs a token; do not call it again in production. |
| 5 | Take a backup | Supabase → Database → Backups, or `pg_dump` to a file you keep. **Do this before step 1**, not after. |
| 6 | Note the numbers | Record open jobs, box count, technician count. If anything looks wrong later, this is the reference. |
| 7 | Remove the demo manager | `delete from public.users where username = 'maamule';` — the read-only manager seeded for the pilot. Recreate it per §10a, with its own PIN. |
| 8 | Give the manager a real account | §10a, below. Never reuse the seeded PIN. |

### 10a. Creating a manager account

A manager reads every group and writes nothing. The role cannot be created from
the app on purpose: a group supervisor who could create one could read the other
groups (see `KNOWN_LIMITS` §7b). Run this once per manager, in the SQL editor,
with a PIN the manager will change on first sign-in:

```sql
with new_user as (
  insert into public.users (group_id, username, full_name, phone, role, is_active, must_change_pin)
  values (
    (select id from public.groups where code = 'F1'),
    'maamule2',
    'Manager name here',
    '634000010',
    'manager',
    true,
    true                      -- forces their own PIN on first sign-in
  )
  returning id
)
insert into public.user_credentials (user_id, pin_hash)
select id, extensions.crypt('123456', extensions.gen_salt('bf')) from new_user;
```

To give someone read-only access temporarily, deactivate the account rather than
changing its role: `update public.users set is_active = false where username = '…';`

**Verify before telling them it works:** sign in once, confirm the header says
*Manager · read only*, confirm the Groups tab lists every group, and confirm the
database refuses a write from that session:

```sql
select public.set_port_status('<manager token>', '<box id>', 1, 'damaged', 'probe');
-- ERROR: A manager account is read-only
```

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
