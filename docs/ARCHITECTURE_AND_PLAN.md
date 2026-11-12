# Telesom FTTH — Group F1 Operations System
**Architecture, Real Sheet Mapping & Step-by-Step Build Plan**

---

## 1. Confirmed Product & Infrastructure Decisions

| Area | Decision | Implementation Detail |
| :--- | :--- | :--- |
| **Supabase Project** | **`telesom ftth f1`** (`pjrzncnhhlfaxuvlcdse`) | PostgreSQL 17 + Realtime (`eu-west-1`) syncing Supervisor desktop & Technician 4G mobile views live. |
| **Deployment Target** | **GitHub → Vercel Auto-Deploy** | Vite SPA + `vercel.json` SPA rewrites so every push to `awalismo123/Telesom-ftth-F1-system` deploys automatically on Vercel. |
| **Daily Sheet Ingestion** | **Daily Group Chat Images (`.jpeg`/`.png`)** + Excel/PDF/Paste | Smart Grid-Line Table OCR Engine calibrated to Telesom's **`Pending Installation` (*Galinta*)** and **`CILADA KU TAAGAN GROUP-KA` (*Cilada*)** table screenshots, with side-by-side image verification before import. |
| **Auth & Field Assignment** | **Fast PIN Login + Individual & 2-Tech Crews** | Quick Username/Phone + 4-digit PIN authentication (`pgcrypto` bcrypt RPCs) + assignment to individual techs or 2-person crews/vehicles. |
| **Interface & Chat Language** | **Bilingual (`SO` / `EN` Toggle)** | Instant Somali / English UI switch + customizable Somali/English WhatsApp/Telegram dispatch summary generator. |
| **Multi-Group Scalability** | **`F1` Primary → Ready for `F2`, `F3`, `F5`, `GA`** | Multi-group schema seeded with Telesom's real FBB groups (`F1` active default; `F2`, `F3`, `F5`, `GA` ready for department-wide rollout). |

---

## 2. Real Telesom Sheet Schemas (From Actual Department Reports)

### Sheet Type A: `Pending Installation` (*Galinta*)
* **Report Header:** `Fixed Broadband Department — Pending Installation`
* **Columns (12):** `ID` | `CustName` | `Line_No` | `XNumber` | `Ref-Number` | `Xaafada` | `Service` | `Shaqada` | `DateIn` | `TimeIn` | `Speed` | `Group`
* **Domain Rules:**
  * **Group Filter:** Extract rows where `Group = F1` (ignoring `F2`, `F3`, `F5`, etc.).
  * **`Line_No`:** 6-digit FTTH service line number (e.g., `575888`, `574594`) — primary deduplication key.
  * **`Ref-Number`:** Customer's Telesom mobile number (e.g., `634477140` → clickable `tel:0634477140`).
  * **`XNumber`:** Router/ONT equipment status (`Qaatay` = customer already collected router, `Muu` = not collected yet, or serial/number). Surfaced prominently on Technician job cards!
  * **`Shaqada`:** Installation sub-type (`Line`, `Installation`, `Kala wareejin` / `Wareejin` relocation).
  * **`Speed`:** Package tier (`1 MB`, `TLite`, `NOR`).

### Sheet Type B: `CILADA KU TAAGAN GROUP-KA` (*Active Faults / Cilada*)
* **Report Header:** `Fixed Broadband Department — CILADA KU TAAGAN GROUP-KA`
* **Columns (12):** `ID` | `Customer Name` | `RefNumber` | `DISC` | `Line` | `Cablebox` | `Type` | `Group` | `Time` | `Date In` | `Date Out` | `TimeOut` | `Complain-type`
* **Domain Rules:**
  * **Group Filter:** Extract rows where `Group = F1` (ignoring `F2`, `F3`, `GA`, etc.).
  * **`Line`:** 6-digit FTTH line number (e.g., `520491`, `573776`).
  * **`RefNumber`:** Customer's contact phone (`634582018`, `8831958`) → `tel:` click-to-call.
  * **`Complain-type` Urgency Auto-Detection:** Values like `degdeg`, `DEG DEG`, `dd`, and `dadaji` automatically mark the task as **URGENT (`Degdeg`)**!
  * **`Cablebox` Parsing:** Supports full OLT/ODF/SPL/FAT strings (e.g., `F2 OLt2-1 ODF4-45 SPL1-1 FAT48-1` or `B6 (52)-4`), extracting box code, upstream path, and port number.
  * **Smart `Xaafada` & `Cablebox` Memory:** Since the `Cilada` sheet omits `Xaafada` (and sometimes `Cablebox`), the system automatically enriches known `Line` or `Cablebox` records from historical installations/repairs and lets Supervisors set/group `Xaafada` during dispatch.
  * **Carry-Over Detection:** Open faults from earlier `Date In` dates (`10/26`, `10/27`) are tracked with aging/carry-over badges without creating duplicates.

---

## 3. Daily Image Table Extraction Pipeline (Module 1)

Because daily sheets arrive as **table images (`.jpeg`, `.png`)** in the group chat:
1. **Canvas Grid-Line Detection:** Detects exact horizontal row borders and vertical column dividers in Telesom's bordered report images, isolating every cell cleanly even when adjacent cells (like `Cablebox` or `XNumber`) are empty or wrap onto multiple lines.
2. **Column-Aware OCR + Telesom Field Normalizer:** Runs high-DPI cell recognition (`tesseract.js`) with column-specific post-processing (digits-only cleanup for `Line` and `RefNumber`, group token matching `F1`/`F2`/`F3`/`F5`/`GA`, date/time normalization) + optional AI Vision API hook.
3. **Side-by-Side Visual Verification:** Displays the uploaded group-chat picture next to the extracted **Group F1** rows so the Supervisor can verify or quick-edit any cell in 1 second before clicking **Confirm Import**.
4. **Also Supports:** `.xlsx`, `.xls`, `.csv`, `.pdf`, and raw copy-paste.

---

## 4. Phased Build Plan ("One by One")

* **Phase 1 — Foundation, Supabase Schema, Bilingual PIN Auth & Team/Crew Manager** *(Building Now)*
  * Provision full PostgreSQL schema, Realtime publications, and `pgcrypto` PIN RPCs on `telesom ftth f1`.
  * Scaffold Vite + React + TypeScript + Tailwind app with `vercel.json` for seamless Vercel auto-deploy.
  * Build Bilingual (`SO` / `EN`) UI, Fast 4-Digit PIN Login, Supervisor Command Center shell, Mobile Technician shell, and live **Team & 2-Tech Crew Management**.
* **Phase 2 — Module 1: Daily Picture (`JPEG/PNG`) + Excel/PDF Smart Ingestion**
  * Build and test the Telesom Image Grid OCR Extractor directly against both `Pending Installation` and `CILADA KU TAAGAN GROUP-KA` formats, plus Excel/CSV/PDF/Paste, strict `F1` filtering, and deduplication.
* **Phase 3 — Module 2: Supervisor Dispatch, Route Clustering & Group Chat Summary** ✅ **Shipped**
  * Cluster unassigned F1 tasks by `Cablebox` first and `Xaafada` second, assign to individual techs or 2-tech crews, balance workloads, and generate 1-click WhatsApp/Telegram dispatch summaries.
  * **Clustering (`src/lib/dispatch.ts`)** — bucket key = canonical box code (`FAT48-1` → `FAT48`) else the neighbourhood; within a bucket: urgent → carried-over → oldest `Date In`. Clusters larger than six jobs are cut into numbered chunks.
  * **Auto-plan** — urgent and large clusters are placed first; each goes to the target with the lowest load, with bonuses for a crew whose `zone_focus` covers the area, or one already working that box. A soft ceiling of six jobs per target nudges the split without ever blocking a route.
  * **Assignment (`assign_tasks` RPC)** — supervisor-only, same-group, one technician *or* one crew per call. Jobs that are `in_progress`, `completed` or `blocked` are refused and returned in `skipped_detail` with their reason, so the board can say *why* rather than silently reassigning live work. Every assignment/unassignment writes a `task_work_logs` row.
  * **Message** — one master plan or one message per team; Somali/English; editable template stored per group in `localStorage`; `{group} {date} {count} {crews} {crewsLabel} {blocks}` placeholders; local `063 441 8376` phone formatting; copy / Web Share / `wa.me` / `t.me`; each generated message recorded in `dispatch_log`.
  * **Load (`dispatch_load` RPC)** — per technician and per crew: open, in-progress, urgent and completed-today counts, plus crew membership, so the lanes are accurate even for a technician with nothing assigned.
* **Phase 4 — Modules 3 & 4: Technician Mobile View + Live Execution & Timer Engine** ✅ **Shipped**
  * Mobile route cards, `tel:` click-to-call, `XNumber` (`Qaatay`/`Muu`) & `Cablebox` warnings, persistent live timer, standardized blockers, and `dBm` optical power completion flow.
  * **Route (`technician_route` RPC)** — one call returns the technician's own jobs *plus* the jobs of their crew(s), never anybody else's: open work and work completed today, ordered running → blocked → urgent → oldest, each task carrying its cablebox health, damaged ports, OLT path and incident history for the warnings.
  * **Server-side timer** — `active_started_at` + `accumulated_seconds` live on the row; the browser only renders `accumulated + (server_now − started)`, corrected by the offset between the server clock and the phone clock, so a backgrounded tab, a flat battery or a wrong handset clock cannot corrupt the duration.
  * **`start_task`** — idempotent (re-start reports `already_running`), refuses another crew's job, and with `p_force = false` returns `needs_confirmation` plus the jobs already running instead of opening a second clock. Multiple timers are allowed only after that explicit confirmation.
  * **`block_task` / `resume_task`** — the blocker banks the session seconds and leaves the job `blocked` (never completed); `fiber_break` and `box_full` also append a `cablebox_logs` incident and raise `fault_count` / `health_status`. `resume_task` restarts the clock from the banked total.
  * **`complete_task`** — requires an optical `dBm` between `0` and `−40` (`NULL`, `> 0` and `< −40` are rejected in the database, not just the form), optionally records the port the customer was moved to, banks the session, and stamps `completed_at` / `completed_by`.
  * **`live_status`** — supervisor read-only view of every `in_progress` / `blocked` job in the group with the worker (technician or crew) name, for the *Live in the field* strip.
  * **Guard hardening** — every RPC uses `IF is_task_worker(...) IS NOT TRUE THEN RAISE`, because `assigned_user_id = user` is `NULL` for crew jobs and a plain `IF NOT NULL` would silently pass; `is_task_worker` also `COALESCE`s to `false`.
* **Phase 5 — Module 5: Cablebox Infrastructure Registry & Supervisor Analytics** ✅ **Shipped**
  * Port-level damage & `dBm` history per `Cablebox`, chronic box alerts, real-time field operations monitor, efficiency metrics, and daily export report.
  * **`cablebox_ports`** — one row per port (`free` / `occupied` / `damaged` / `reserved` / `unknown`) with the line, customer, note, who changed it and when. Materialised from the box's `total_ports` on first read, so a new box needs no setup.
  * **`set_port_status`** — technicians *and* the supervisor can mark a port from the phone; the RPC validates the port against `total_ports`, writes a `port_damaged` (or release `note`) incident, and calls `recompute_box_state`, which re-derives `damaged_ports`, `health_status` and `last_optical_dbm`.
  * **Health rule** — `critical` at ≥3 damaged ports or ≥4 faults in 30 days; `warning` with any damaged port, any recent fault or the latest reading below −27 dBm; otherwise `healthy`. `chronic` = ≥3 faults in the window.
  * **`box_directory` / `box_detail`** — the list view (usage, faults, 30-day completions, open jobs, average dBm, last activity) and the deep view (port map, 40 most recent incidents, 25 most recent jobs, 30-day stats).
  * **`ops_analytics`** — KPI totals, dBm bands, a zero-filled daily series, per-worker rows (crew *or* technician via `coalesce(crew.name, user.full_name)`), per-box rows with chronic detection, and the blocker breakdown from `task_work_logs`.
  * **`report_jobs`** — the flat completed-job list behind the CSV export, kept separate so the dashboard payload stays small.
  * **Exports** — CSV (jobs, teams, boxes; UTF-8 BOM for Somali names) built entirely in the browser, and a WhatsApp/Telegram report in Somali or English.
  * **Demo mode** — `seed_demo_data` / `clear_demo_data` create and remove 36 flagged sample jobs with incidents, blockers and port states so the screens can be judged on day one; `is_demo` keeps them separate from real work and the supervisor sees a banner whenever they are present.

---

# 5. Architecture as built (after Batch F, 31/10/2026)

This section describes the system **as it exists**, not as it was planned. The
sections above are the original design record and are kept for history.

## 5.1 Shape

```
Browser (phone or desk)
├── React 19 + Vite, one SPA, six cached chunks
├── Providers, outermost first:
│     LanguageProvider → ToastProvider → ConfigGate → AuthProvider → NavigationProvider
├── Two shells, chosen by the saved session's role — never by the last screen used
│     SupervisorShell    TechnicianShell
└── src/lib/*            pure logic + RPC calls, no JSX

Supabase
├── Postgres  (RLS on every table; all writes via SECURITY DEFINER RPCs)
├── Realtime  (postgres_changes on `tasks`)
└── no storage, no edge functions, no direct table writes from the client
```

The client holds **no secrets**. The anon key is public by design; the security
boundary is Row Level Security plus the RPCs' own checks.

## 5.2 Data model

| Table | Holds | Notable columns |
| :--- | :--- | :--- |
| `groups` | F1, F2, F3 … | `code` unique; F1 is the primary team |
| `users` | people | `role` (supervisor/technician), `is_active`, `preferred_lang` |
| `user_credentials`, `user_sessions` | PIN hashes, tokens | **no public policy at all** |
| `crews`, `crew_members` | 2-tech vehicles | one job → one crew → one timer |
| `cableboxes` | the box register | `box_code` unique **department-wide**, port count, health |
| `cablebox_ports` | the port map | per port: free/occupied/damaged/reserved, who changed it |
| `cablebox_logs` | box history | every fault, reading and note, with who |
| `import_batches` | one per sheet upload | counts read/matched/created/skipped, undoable |
| `tasks` | the jobs | see below |
| `task_work_logs` | the audit trail | imported, assigned, started, blocked, resumed, completed, cancelled, reopened |
| `dispatch_log` | group-chat messages | the exact text sent, by whom |

`tasks` carries the whole job lifecycle:

- **identity** — `line_number`, `customer_name`, `customer_phone`, `dedup_key`
- **classification** — `task_type` (installation/cilada), `priority`, `is_repeat_fault`, `carryover_count`
- **place** — `xaafada`, `cablebox_code_raw`, `cablebox_id`, `port_number`
- **assignment** — `status`, `assigned_user_id` / `assigned_crew_id`, `assigned_by/at`
- **time** — `active_started_at` + `accumulated_seconds` (server-derived; never a local stopwatch)
- **outcome** — `optical_dbm`, `completion_notes`, `completed_at/by`
- **cancellation** — `status='cancelled'`, `cancelled_at/by`, `cancel_reason`
- **provenance** — `source` (sheet/manual), `created_by`, `intake_notes`, `reopened_count`, `is_demo`

`cancelled` is terminal: a `BEFORE UPDATE` trigger refuses to move a cancelled job
anywhere unless the caller is `reopen_task`.

## 5.3 RPC inventory

Every write, **and every read**, is a function. Since Batch B there is no direct
table access from the browser at all: an unauthenticated request to PostgREST
returns an empty array, because the tables have no anonymous read policy.

| Area | Functions |
| :--- | :--- |
| Auth & people | `authenticate_pin`, `verify_session`, `logout_session`, `build_auth_payload`, `change_own_pin`, `set_preferred_language`, `upsert_team_member`, `upsert_crew`, `upsert_group` |
| Ingest | `find_existing_tasks`, `commit_import_batch`, `undo_import_batch`, `ensure_cablebox` |
| Dispatch | `assign_tasks`, `unassign_tasks`, `dispatch_load`, `log_dispatch` |
| Execution | `technician_route`, `start_task`, `block_task`, `resume_task`, `complete_task`, `live_status` |
| Registry | `box_directory`, `box_detail`, `set_port_status`, `upsert_cablebox`, `ops_analytics`, `report_jobs` |
| Corrections | `create_manual_task`, `cancel_task`, `reopen_task` |
| Search | `global_search` |
| **PINs (Batch H)** | `flag_department_pins` — supervisor flags every active member so each chooses their own PIN at next sign-in |
| **Manager (Batch H)** | `manager_portfolio`, `manager_activity`, `manager_report`, `manager_tasks` — read-only, every group, refused to every other role; `internal_period_stats` is internal and revoked |
| **Proof (Batch H)** | `add_task_photo`, `list_task_photos`, `get_task_photo` — private `task_photos` table, no policies, worker-or-supervisor only |
| **Record (Batch H)** | `group_activity` (job + dispatch + cancel + phone-in events in one feed), `period_report` (created / completed / cancelled / open at end / waiting past the promise, per tech, per box, per day) |
| **Reads (Batch B)** | `list_groups`, `group_overview`, `list_open_tasks`, `get_task`, `list_work_logs`, `list_live_moves`, `list_resumed_since`, `list_import_batches`, `my_team`, `upload_sheet_image`, `get_sheet_image` |
| Demo | `seed_demo_data`, `clear_demo_data` |

The read functions are the security boundary, so they have a shape that is not
optional: `p_token uuid` is the first argument, the first statement resolves the
caller with `get_session_user`, and anything taking a `p_group_id` also proves
the caller belongs to that group. `tests/access.test.ts` enforces all three.

## 5.4 Modules and their one job

| File | Responsibility |
| :--- | :--- |
| `lib/i18n.tsx` | typed dictionary, `{placeholder}` interpolation, `<html lang>` |
| `lib/format.ts` | `dd/mm/yyyy`, month names, `,` grouping, plural rules (`3 shaqo` / `3 jobs`) |
| `lib/errors.ts` | one sentence per failure, per language — never a gateway's English |
| `lib/dispatch.ts` | clustering, auto-plan, the WhatsApp/Telegram message |
| `lib/execution.ts` | server-clock arithmetic, blocker catalogue, dBm bands |
| `lib/importer.ts` | diff engine: new / carry-over / repeat / duplicate |
| `lib/registry.ts` | box health, port usage, analytics shapes |
| `lib/realtime.ts` | one channel per subscriber, debounce, never throws |
| `lib/cache.ts` | stale-while-revalidate for instant tab switches |
| `lib/navigation.tsx` | "take me to that job" across shells |
| `lib/ocr/*` | grid-line OCR in the browser; the image never leaves the device |

The rule that keeps this testable: **`lib/` has no JSX and no React state.** The
screens render; the logic is pure and covered by `tests/`.

## 5.5 Quality gates

`npm run verify` = `tsc -b` → `node --test tests/*` → `vite build` → bundle budget.

- **204 tests**, no browser: pure logic, server-side rendering of the real
  component tree, and source-level lint (design system, i18n, realtime, OCR).
- **Performance budget**: first load ≤ 200 kB gzip; currently **≈192 kB**.
- **Accessibility lint**: no text below 10 px, contrast ≥ 4.5:1, every icon-only
  button named.
- **Language lint**: every dictionary key in both languages, no dead keys, no
  English-only copy — scanned across line breaks, since a footer wrapped between
  tags is still visible English. PIN copy is checked against what the inputs
  actually accept (4–6 digits).
- **Access lint**: `src/` may not read a table directly, every read function must
  take `p_token` first and resolve the caller, no open `SELECT USING (true)`
  policy may exist, and the realtime signal may not carry row data.

GitHub Actions does not execute on this account, so the local run is the gate;
the Vercel check still runs and must be green.

## 5.6 Decisions that would otherwise be re-litigated

| Decision | Why |
| :--- | :--- |
| Cancel, never delete | The "who cancelled this and why" answer must survive months |
| `cancelled` enforced in a trigger | Four RPCs each guard `completed`; a fifth would forget |
| Duplicates never auto-imported | A supervisor confirming a row is cheaper than reconciling a twin |
| dBm mandatory to complete | The reading is the proof; without it the job is an opinion |
| Timer from the server clock | Phone clocks lie, phones sleep, phones get locked |
| OCR in the browser | Customer data never leaves the phone; no per-image cost |
| One channel per subscriber | The library keys channels by topic; sharing one crashed a screen |
| Derived notifications | A notifications table drifts from reality and must be cleaned up |
| Inline bilingual pairs for screen copy | The dictionary is for shared vocabulary; a screen's own sentence belongs next to it |
