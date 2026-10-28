# Telesom FTTH — Group F1 Field Operations System

A modern, bilingual (**Somali / English**) field operations web app for Telesom's **Fixed Broadband Department — Group F1**.

It replaces the daily *"picture of the table"* workflow sent in the group chat with a live system: upload the daily **Pending Installation (Galinta)** and **Cilada** sheets, auto-extract only **Group F1** rows, cluster them by `Xaafada` / `Cablebox`, dispatch to technicians or 2-tech crews, and track live timers, blockers, optical `dBm` readings and cablebox history.

> Live stack: **Vite + React 19 + TypeScript + Tailwind CSS 4 + Supabase (Postgres + Realtime)** → deployed on **Vercel**.

---

## Build Progress

| Phase | Module | Status |
| :--- | :--- | :--- |
| **Phase 1** | Supabase schema, Fast PIN auth, bilingual UI, Supervisor shell, Mobile technician shell, **Team & 2-Tech Crew manager**, multi-group (F1→F2/F3/F5/GA) | ✅ **Live** |
| **Phase 2** | Daily picture (**JPEG/PNG OCR**) + Excel/PDF/Paste ingestion, F1 filtering, deduplication | ⏳ Next |
| **Phase 3** | Xaafada & Cablebox route clustering, bulk assignment, 1-click WhatsApp dispatch summary | ⏳ Planned |
| **Phase 4** | Technician mobile route, `tel:` click-to-call, live timer, blockers, optical `dBm` capture | ⏳ Planned |
| **Phase 5** | Cablebox port & fault history registry, analytics dashboard, exports | ⏳ Planned |

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
│   │   │   └── TeamAndCrewManager.tsx
│   │   └── technician/
│   │       └── TechnicianShell.tsx
│   ├── contexts/AuthContext.tsx     # Session token, active group, PIN auth
│   ├── lib/
│   │   ├── i18n.tsx                 # Somali / English dictionary + provider
│   │   └── supabase.ts              # Supabase client
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

## Database

Supabase project: **`telesom ftth f1`** (`pjrzncnhhlfaxuvlcdse`, `eu-west-1`).

Core tables: `groups`, `users`, `user_credentials`, `user_sessions`, `crews`, `crew_members`, `cableboxes`, `cablebox_logs`, `import_batches`, `tasks`, `task_work_logs`.

**Security model**

* Row Level Security is enabled on every table.
* Credentials (`user_credentials`) and sessions (`user_sessions`) have **zero** public policies — they are never readable with the anon key.
* All writes go through `SECURITY DEFINER` Postgres RPCs:
  `authenticate_pin`, `verify_session`, `logout_session`, `set_preferred_language`, `change_own_pin`,
  `upsert_team_member`, `upsert_crew`, `upsert_group`.

Migration file: `supabase/migrations/001_initial_schema.sql`.
