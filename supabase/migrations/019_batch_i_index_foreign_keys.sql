-- ============================================================================
-- 019 — index every foreign key
--
-- The audit's P2 finding #8, third part: Supabase's linter reports 21 foreign
-- keys with no covering index. Verified against the live database — 35 foreign
-- keys in `public`, 14 covered, 21 not, exactly the number reported.
--
-- Why it matters, and why it is not urgent: Postgres does not index the
-- referencing side of a foreign key automatically. Reads by that column do a
-- sequential scan, and each delete on the parent table scans the child to check
-- for dependants. At eight tasks this is invisible. At 40 jobs a day for a year
-- it is a slow supervisor dashboard and a delete that takes seconds.
--
-- Additive and reversible: an index can be dropped with no data loss. No
-- function bodies change, so nothing the app reads can break.
--
-- `IF NOT EXISTS` is keyed on the index *name*, not its columns, so these names
-- must not collide with anything already present. They do not: the query that
-- produced this list only returns keys with no covering index at all.
-- ============================================================================

-- cablebox_logs
CREATE INDEX IF NOT EXISTS idx_cablebox_logs_logged_by ON public.cablebox_logs (logged_by);
CREATE INDEX IF NOT EXISTS idx_cablebox_logs_task_id   ON public.cablebox_logs (task_id);

-- cablebox_ports
CREATE INDEX IF NOT EXISTS idx_cablebox_ports_updated_by ON public.cablebox_ports (updated_by);

-- cableboxes
CREATE INDEX IF NOT EXISTS idx_cableboxes_group_id ON public.cableboxes (group_id);

-- crew_members
CREATE INDEX IF NOT EXISTS idx_crew_members_user_id ON public.crew_members (user_id);

-- dispatch_log
CREATE INDEX IF NOT EXISTS idx_dispatch_log_sent_by ON public.dispatch_log (sent_by);

-- import_batches
CREATE INDEX IF NOT EXISTS idx_import_batches_group_id   ON public.import_batches (group_id);
CREATE INDEX IF NOT EXISTS idx_import_batches_imported_by ON public.import_batches (imported_by);

-- sheet_images
CREATE INDEX IF NOT EXISTS idx_sheet_images_uploaded_by ON public.sheet_images (uploaded_by);

-- task_photos
CREATE INDEX IF NOT EXISTS idx_task_photos_uploaded_by ON public.task_photos (uploaded_by);

-- task_work_logs
CREATE INDEX IF NOT EXISTS idx_task_work_logs_task_id ON public.task_work_logs (task_id);
CREATE INDEX IF NOT EXISTS idx_task_work_logs_user_id ON public.task_work_logs (user_id);

-- tasks — eight unindexed keys on the busiest table
CREATE INDEX IF NOT EXISTS idx_tasks_active_started_by ON public.tasks (active_started_by);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_by       ON public.tasks (assigned_by);
CREATE INDEX IF NOT EXISTS idx_tasks_cancelled_by      ON public.tasks (cancelled_by);
CREATE INDEX IF NOT EXISTS idx_tasks_completed_by      ON public.tasks (completed_by);
CREATE INDEX IF NOT EXISTS idx_tasks_created_by        ON public.tasks (created_by);
CREATE INDEX IF NOT EXISTS idx_tasks_previous_task_id  ON public.tasks (previous_task_id);
CREATE INDEX IF NOT EXISTS idx_tasks_proof_photo_id    ON public.tasks (proof_photo_id);

-- user_sessions — the hot path: every RPC resolves a token against this table
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON public.user_sessions (user_id);

-- users
CREATE INDEX IF NOT EXISTS idx_users_group_id ON public.users (group_id);

-- ============================================================================
-- Expectation, checked after applying: the same query returns zero rows.
--
--   select c.conrelid::regclass, c.conname
--   from pg_constraint c
--   join pg_class t on t.oid = c.conrelid
--   join pg_namespace n on n.oid = t.relnamespace
--   where c.contype = 'f' and n.nspname = 'public'
--     and not exists (
--       select 1 from pg_index i
--       where i.indrelid = c.conrelid and i.indisvalid
--         and (i.indkey::int2[])[0:array_length(c.conkey,1)-1] = c.conkey
--     );
-- ============================================================================
