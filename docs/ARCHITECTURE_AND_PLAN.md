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
* **Phase 4 — Modules 3 & 4: Technician Mobile View + Live Execution & Timer Engine**
  * Mobile route cards, `tel:` click-to-call, `XNumber` (`Qaatay`/`Muu`) & `Cablebox` warnings, persistent live timer, standardized blockers, and `dBm` optical power completion flow.
* **Phase 5 — Module 5: Cablebox Infrastructure Registry & Supervisor Analytics**
  * Port-level damage & `dBm` history per `Cablebox`, chronic box alerts, real-time field operations monitor, efficiency metrics, and daily export report.
