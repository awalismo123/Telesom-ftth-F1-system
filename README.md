# Telesom FTTH — Group F1 Field Operations System

A modern, bilingual (**Somali / English**) field operations web app for Telesom's **Fixed Broadband Department — Group F1**.

It replaces the daily *"picture of the table"* workflow sent in the group chat with a live system: upload the daily **Pending Installation (Galinta)** and **Cilada** sheets, auto-extract only **Group F1** rows, cluster them by `Xaafada` / `Cablebox`, dispatch to technicians or 2-tech crews, and track live timers, blockers, optical `dBm` readings and cablebox history.

> Live stack: **Vite + React 19 + TypeScript + Tailwind CSS 4 + Supabase (Postgres + Realtime)** → deployed on **Vercel**.

---

## Build Progress

| Phase | Module | Status |
| :--- | :--- | :--- |
| **Phase 1** | Supabase schema, Fast PIN auth, bilingual UI, Supervisor shell, Mobile technician shell, **Team & 2-Tech Crew manager**, multi-group (F1→F2/F3/F5/GA) | ✅ **Live** |
| **Phase 2** | Daily picture (**JPEG/PNG OCR**, on-device) + Excel/CSV/paste ingestion, Group F1 filter, carry-over / repeat-fault decisions, undo | ✅ **Live** |
| **Phase 3** | Xaafada & Cablebox route clustering, bulk assignment, 1-click WhatsApp / Telegram dispatch summary | ✅ **Live** |
| **Phase 4** | Technician mobile route, `tel:` click-to-call, live timer, blockers, optical `dBm` capture | ✅ **Live** |
| **Phase 5** | Cablebox port & fault history registry, supervisor analytics, CSV + WhatsApp daily report | ✅ **Live** |

---

## Dispatching the day (Phase 3)

1. **Unassigned pool** — every open F1 job, with search (name, line, phone, box) and an *Urgent* filter. Tick jobs with the checkbox (or *Select all*).
2. **Assign** — the bottom bar opens the technician / crew picker. Crews are listed first because they are the normal unit; each row shows the load it will carry.
3. **Auto-cluster** — groups the pool by **cablebox** and, when a sheet has no box column (Galinta), by **xaafada**. Urgent clusters are placed first, then the rest go to the free team that already covers that area or box, so the load comes out even. You can untick any route before applying.
4. **Group-chat message** — one tap produces the WhatsApp text:
   * *Copy full plan* (every team underneath), *Copy for this team* (one short message), *Share*, or open WhatsApp / Telegram directly;
   * Somali or English, with an editable template (`{group} {date} {count} {crews} {crewsLabel} {blocks}`) saved per group;
   * phone numbers and urgency markers included, honouring the `063 441 8376` local format;
   * every generated message is written to `dispatch_log` for audit.
5. **Undo** — *Return to pool* releases a job; a job that has already been started can never be silently re-dispatched (the database refuses it and reports why).

---

## Working the day (Phase 4)

Open the app on a phone and sign in with the technician PIN — the route is already there.

1. **My route** — only the jobs assigned to *you* or to *your crew*, grouped by **cablebox** and then by `Xaafada`, in the order they should be worked: running → blocked → urgent → rest. Completed-today jobs fold away underneath. Cards show the box and port, the speed plan, repeat-fault history and the box's warning flags (damaged port, weak box, box full).
2. **Call the customer** — the big green button is a real `tel:` link, so it dials from the handset; the local `063 444 8080` format is what the technician reads out.
3. **Start** — one tap on the card (or inside the sheet). The timer is stored **on the server**, not on the phone: `accumulated_seconds + (now − active_started_at)`, with the phone clock corrected by the server offset. Closing the app, losing signal or switching tab never loses time. A *Job running* pill floats above the tab bar on every other tab so the clock is never hidden.
4. **Several timers at once are allowed, with a warning** — if another job is already running the app asks first and lists what is running; only an explicit *Start anyway* opens a second clock.
5. **Blocker** — one of the standardized reasons (*Customer Unreachable*, *Fiber Break*, *Box Full*, *Hardware Defective*, *Other*), each with a hint and the action to take. Saving it **pauses the clock** and leaves the job **Blocked** on the route; a `Fiber Break` / `Box Full` also writes a cablebox incident and raises the box's fault count.
6. **Resume** — the same card continues from the banked time; nothing is recalculated or lost.
7. **Complete** — the **optical `dBm` reading is mandatory** for every job (install and fault). Type it with the keypad in any habit (`-21.5`, `21.5`, `21,5` all become `-21.5`), or use a preset. The field colour tells the truth immediately: healthy `−27…−8 dBm`, a warning below `−27` (weak) or above `−8` (too strong), and an error outside `0…−40`. Add the port you moved the customer to (if you changed it) and what you did; both are stored with the duration and written to the job history.
8. **History** — every start, block, resume and completion of the job is listed with its time, the blocker reason, the `dBm` and the note, so the supervisor can reconstruct the day.

Supervisors see the same clocks read-only: the **Live in the field** strip on the dispatch board shows who is on which line right now, the ticking elapsed time, and every blocked job with its reason.

---

## The cablebox register & insights (Phase 5)

**Every box remembers everything.** Open *Cablebox History* (supervisor) or the *Boxes* tab (technician) and each box shows its port map, its health, every incident ever logged on it and every job done there — so the person sent to a box next week inherits what happened last week.

1. **Port map** — a tile per port: *Free*, *In use*, *Damaged*, *Reserved* or *Not checked*. Tap a port and set it in two taps; technicians and the supervisor can both do it in the field. Each change is stamped with who did it and writes an incident into the box history, and the box's damaged-port list and health colour follow immediately.
2. **Health that means something** — a box turns **warning** when it has a damaged port, a recent fault or a weak optical reading, and **critical** at three damaged ports or four faults in thirty days. A **chronic** badge marks any box with three or more faults in the window.
3. **History timeline** — installations, faults fixed, ports broken, box-full and fiber-break events, each with the port, the dBm, the note, the technician and how long ago.
4. **Jobs on that box** — line, customer, worker, time on the job and the dBm that was measured there.
5. **From the job to the box** — inside a technician's job sheet, *Box history* opens the same page without leaving the job.

**Insights** (supervisor) puts team output and infrastructure health side by side over 7, 30 or 90 days:

* **KPIs** — jobs completed, urgent share, average time on the job, share of readings inside the healthy `−27…−8 dBm` window, what is open / running / blocked right now;
* **Daily bars** — jobs completed per day, so a quiet Tuesday is visible at a glance;
* **Teams** — completed, average minutes, urgent, repeat visits and average dBm per crew or technician, plus live/blocked badges;
* **Cablebox health** — faults, damaged ports, average dBm and a chronic flag per box, clicking through to the full register;
* **Blockers** — which standard reason is costing the group the most time;
* **dBm quality** — how many readings were healthy, weak or too strong, and the group average.

**Leaving the app:** *Download CSV* writes the job list, the team table and the box table (Excel-ready, UTF-8 with BOM so Somali names stay intact), and *Copy WhatsApp report* produces the group-chat message — completed jobs, average time, dBm quality, team lines, boxes needing attention and the top blockers.

**Demo history:** because a brand-new register is empty and impossible to judge, *Load demo history* seeds 36 realistic completed jobs, incidents and port states across thirty days, every row flagged `is_demo`. They feed the analytics so you can see what the screens look like, and *Remove demo data* deletes them again in one tap — real jobs are never touched.

---

## Quality gates

Every change is checked the same way, locally and in CI (`.github/workflows/ci.yml`):

```bash
npm run typecheck   # tsc -b, zero errors
npm test            # pure-function tests (money maths, timers, dBm, CSV, reports)
npm run build       # production build
npm run verify      # all three, in order
```

The interface is defensive by design:

* **Crash containment** — the header, the page and the whole app each sit inside an error boundary, so one broken panel never blanks a technician's route.
* **Every action speaks** — a toast confirms a job started, a port changed or a report left the app; failures arrive as a sentence ("This job is not assigned to you") rather than a Postgres stack trace, in Somali or English.
* **Sessions fail gracefully** — when a token dies mid-shift the app returns to the login screen with a clear reason instead of showing a raw database error inside a form.
* **Typed work is never lost** — the completion form (dBm, port, notes) is drafted to the device on every keystroke and offered back when the job is reopened.
* **Connectivity is honest** — an offline strip appears immediately and disappears when the signal returns.

---

## Sign-in Accounts (seeded)

| Role | Username | Phone | PIN |
| :--- | :--- | :--- | :--- |
| Supervisor | `supervisor` | `634000001` | `1234` |
| Technician (Crew A) | `cabdi` | `634100101` | `1111` |
| Technician (Crew A) | `xasan` | `634100102` | `1111` |
| Technician (Crew B) | `maxamed` | `634100103` | `1111` |
| Technician (Crew B) | `mustafe` | `634100104` | `1111` |

*Login accepts either the username or the Telesom phone number. Every user can change their own PIN from the header menu.*

---

## How the daily picture import works

1. **Upload** the group-chat picture (or take a photo, drop a CSV, or paste rows out of Excel).
2. **On-device OCR** (`Tesseract.js`, self-hosted — the picture never leaves the device):
   * Deskew (hand-held photos) → Otsu binarisation → ruled-line detection (horizontal + vertical) → **rules erased** so the text is clean → recognition.
   * Words are mapped into the detected cells by their coordinates, then fuzzy-matched onto the **Galinta** (12 cols) or **Cilada** (13 cols) template — OCR typos such as `Shagada`, `Refiumber`, `Datelin` still resolve correctly.
   * Every column is then re-read as a strip with a character whitelist (`digits` for line/phone, `0-9:.` for time, …) and every cell that is still empty is re-read on its own from a contrast-stretched crop.
   * Readings are **scored against the column type** instead of "longest wins": a phone must be 9 digits starting with `6`, a line 6 digits, a group one of `F1…F6 / GA / GB`. A stray border read as a leading `1` (`1633277158`) is dropped, `Fl / FI / FS` become `F1 / F1 / F5`, and a reading that cannot be right is left **empty** rather than filled with garbage.
   * A merged or missed divider (a whole column shifting by one) is detected by scoring the alignment and corrected automatically.
3. **Field intelligence**: `degdeg / DEG DEG / dd / dadaji` → auto **URGENT**; `Qaatay / Muu` → router picked-up state; `F2 OLt2-1 ODF4-45 SPL1-1 FAT48-1` → box `FAT48` + port `1`; day-first vs month-first dates decided per sheet.
4. **Verify & fix** every cell against the source picture before anything is written.
5. **Decide per existing line** — nothing is auto-overwritten:
   * *Carry-over* (still open) → keep open + refresh details (default), skip, or create a separate task
   * *Repeat fault* (was completed) → new linked fault (default), reopen the old one, or skip
   * *Duplicate of today* → skip (default) or refresh
6. **Confirm** → one atomic transaction, with **undo** available from the import history.

### Measured accuracy (both real sample pictures, in `samples/`)

| | Galinta (13 rows) | Cilada (19 rows) |
|---|---|---|
| Template recognised | 0.92 header score | 1.00 header score |
| Rows found | 13 / 13 | 19 / 19 |
| Line number | 13 / 13 | 18 / 19 |
| Customer name | 13 / 13 | 18 / 19 |
| Phone | 12 / 13 | 17 / 19 |
| Group | 13 / 13 | 19 / 19 |
| Xaafada | 13 / 13 | — |

The same pictures pushed through a *field-photo* simulation (72 % scale, JPEG quality 45) still give line/name 100 % / 95 %, phone 85 % / 74 %, group 92 % / 89 %.
Anything that cannot be read is **left empty and highlighted** in the review screen — the app never guesses a phone number — and the per-column read quality is shown above the table.

OCR tuning harness (dev only): `npm run ocr:lab` (clean + rotated + degraded modes).

## Project Structure

```
├── docs/
│   └── ARCHITECTURE_AND_PLAN.md     # Full system design & build roadmap
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql   # Complete DB schema, RLS, RPCs & seed data
├── src/
│   ├── components/
│   │   ├── LoginScreen.tsx          # PIN login + numeric keypad + quick test accounts
│   │   ├── HeaderBar.tsx            # Language toggle, group switcher, PIN change, logout
│   │   ├── supervisor/
│   │   │   ├── SupervisorShell.tsx
│   │   │   ├── TeamAndCrewManager.tsx
│   │   │   └── ingest/
│   │   │       ├── IngestWizard.tsx       # picture → verify → decide → commit
│   │   │       ├── ExtractionReview.tsx   # editable cells + grid overlay
│   │   │       └── ConflictPanel.tsx      # carry-over / repeat / duplicate decisions
│   │   └── technician/
│   │       └── TechnicianShell.tsx
│   ├── contexts/AuthContext.tsx     # Session token, active group, PIN auth
│   ├── lib/
│   │   ├── i18n.tsx                 # Somali / English dictionary + provider
│   │   ├── importer.ts              # diff engine: new / carry-over / repeat / duplicate
│   │   ├── supabase.ts              # Supabase client
│   │   └── ocr/
│   │       ├── imageOps.ts          # binarise, ruled-line detection, rule removal
│   │       ├── assemble.ts          # words + grid → table cells
│   │       ├── templates.ts         # Galinta & Cilada column templates
│   │       ├── normalize.ts         # line/phone/date/group/cablebox/complaint parsers
│   │       ├── extract.ts           # cells → typed rows
│   │       ├── paste.ts             # clipboard / CSV / TSV
│   │       └── engine.ts            # in-browser Tesseract pipeline
│   ├── types/database.ts            # Shared TypeScript domain types
│   ├── App.tsx
│   └── main.tsx
├── vercel.json                      # SPA rewrites for Vercel
└── vite.config.ts
```

---

## Local Development

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build
```

Environment variables (optional — sensible defaults are already baked in):

```bash
cp .env.example .env
# VITE_SUPABASE_URL=...
# VITE_SUPABASE_ANON_KEY=...
```

---

## Deploy to Vercel (auto-deploy on every push)

1. Go to [vercel.com/new](https://vercel.com/new) and import **`awalismo123/Telesom-ftth-F1-system`**.
2. Framework preset: **Vite** (auto-detected) — Build command `npm run build`, Output directory `dist`.
3. Add Environment Variables (optional but recommended):
   * `VITE_SUPABASE_URL` = `https://pjrzncnhhlfaxuvlcdse.supabase.co`
   * `VITE_SUPABASE_ANON_KEY` = *(publishable / anon key from Supabase settings)*
4. Click **Deploy**. From then on, every push to `main` redeploys automatically.

`vercel.json` already contains the SPA rewrite so deep links work.

---

## Deploy notes for Vercel

The OCR worker, WASM core and English model are **not committed** (they live in `node_modules`).
`npm run build` first runs `scripts/vendor-tesseract.mjs`, which copies them into `public/tesseract`
before Vite builds — so no CDN call and no extra configuration is needed.

## Database

Supabase project: **`telesom ftth f1`** (`pjrzncnhhlfaxuvlcdse`, `eu-west-1`).

Core tables: `groups`, `users`, `user_credentials`, `user_sessions`, `crews`, `crew_members`, `cableboxes`, `cablebox_logs`, `import_batches`, `tasks`, `task_work_logs`.

**Security model**

* Row Level Security is enabled on every table.
* Credentials (`user_credentials`) and sessions (`user_sessions`) have **zero** public policies — they are never readable with the anon key.
* All writes go through `SECURITY DEFINER` Postgres RPCs:
  `authenticate_pin`, `verify_session`, `logout_session`, `set_preferred_language`, `change_own_pin`,
  `upsert_team_member`, `upsert_crew`, `upsert_group`.

Import RPCs: `find_existing_tasks`, `commit_import_batch`, `undo_import_batch`, `ensure_cablebox`.

Migration files: `supabase/migrations/001_initial_schema.sql`, `supabase/migrations/002_ingestion.sql`.
