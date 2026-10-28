-- ============================================================================
-- Telesom FTTH Field Operations System (Group F1 & Multi-Group Scalable)
-- Migration 001: Core Schema, Security RPCs, Seed Data & Realtime
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ----------------------------------------------------------------------------
-- 1. GROUPS (F1 Active Primary; F2, F3, F5, GA Ready for Department Scaling)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 2. USERS & PRIVATE CREDENTIALS / SESSIONS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE RESTRICT,
  username text NOT NULL UNIQUE,
  full_name text NOT NULL,
  phone text UNIQUE,
  role text NOT NULL CHECK (role IN ('supervisor', 'technician')),
  preferred_lang text NOT NULL DEFAULT 'so' CHECK (preferred_lang IN ('so', 'en')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Isolated PIN credential table (zero public access; verified only via RPC)
CREATE TABLE IF NOT EXISTS public.user_credentials (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  pin_hash text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Isolated session tokens table (verified only via RPC)
CREATE TABLE IF NOT EXISTS public.user_sessions (
  token uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 3. FIELD CREWS (2-Technician Vehicles / Sub-Teams)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.crews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  name text NOT NULL,
  vehicle_tag text,
  zone_focus text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (group_id, name)
);

CREATE TABLE IF NOT EXISTS public.crew_members (
  crew_id uuid NOT NULL REFERENCES public.crews(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (crew_id, user_id)
);

-- ----------------------------------------------------------------------------
-- 4. INFRASTRUCTURE: CABLEBOX REGISTRY & PORT / SIGNAL LOGS
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cableboxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid REFERENCES public.groups(id) ON DELETE SET NULL,
  box_code text NOT NULL UNIQUE,
  olt_path text,
  xaafada text,
  total_ports int NOT NULL DEFAULT 8 CHECK (total_ports IN (4, 8, 12, 16, 24, 32)),
  damaged_ports int[] NOT NULL DEFAULT '{}',
  health_status text NOT NULL DEFAULT 'healthy' CHECK (health_status IN ('healthy', 'warning', 'critical')),
  fault_count int NOT NULL DEFAULT 0,
  last_optical_dbm numeric(5,2),
  location_notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 5. DAILY SHEET IMPORT BATCHES & TASKS (Galinta + Cilada)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  imported_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  sheet_category text NOT NULL CHECK (sheet_category IN ('installation', 'cilada')),
  source_type text NOT NULL CHECK (source_type IN ('image', 'excel', 'pdf', 'paste')),
  file_name text,
  print_date date,
  total_rows_read int NOT NULL DEFAULT 0,
  group_matched_rows int NOT NULL DEFAULT 0,
  new_tasks_created int NOT NULL DEFAULT 0,
  duplicates_skipped int NOT NULL DEFAULT 0,
  carryovers_updated int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  import_batch_id uuid REFERENCES public.import_batches(id) ON DELETE SET NULL,
  sheet_row_id int,
  task_type text NOT NULL CHECK (task_type IN ('installation', 'cilada')),
  line_number text NOT NULL,
  customer_name text NOT NULL,
  customer_phone text,
  x_number text,
  disc_code text,
  service_type text NOT NULL DEFAULT 'Fiber',
  work_subtype text,
  speed_plan text,
  xaafada text,
  cablebox_code_raw text,
  cablebox_id uuid REFERENCES public.cableboxes(id) ON DELETE SET NULL,
  port_number int,
  reported_date date,
  reported_time text,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'urgent')),
  carryover_count int NOT NULL DEFAULT 0,
  is_repeat_fault boolean NOT NULL DEFAULT false,
  previous_fault_summary text,
  status text NOT NULL DEFAULT 'unassigned' CHECK (status IN ('unassigned', 'assigned', 'in_progress', 'blocked', 'completed')),
  assigned_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  assigned_crew_id uuid REFERENCES public.crews(id) ON DELETE SET NULL,
  assigned_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  assigned_at timestamptz,
  active_started_at timestamptz,
  active_started_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  accumulated_seconds int NOT NULL DEFAULT 0,
  blocker_reason text CHECK (blocker_reason IS NULL OR blocker_reason IN ('customer_unreachable', 'fiber_break', 'box_full', 'hardware_defective', 'other')),
  blocker_notes text,
  blocked_at timestamptz,
  optical_dbm numeric(5,2),
  completion_notes text,
  completed_at timestamptz,
  completed_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  scheduled_date date NOT NULL DEFAULT CURRENT_DATE,
  last_seen_on_sheet_date date DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_group_status ON public.tasks(group_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_line_number ON public.tasks(line_number);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_user ON public.tasks(assigned_user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned_crew ON public.tasks(assigned_crew_id);
CREATE INDEX IF NOT EXISTS idx_tasks_xaafada ON public.tasks(xaafada);

CREATE TABLE IF NOT EXISTS public.cablebox_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cablebox_id uuid NOT NULL REFERENCES public.cableboxes(id) ON DELETE CASCADE,
  task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  logged_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('installation', 'cilada_fixed', 'port_damaged', 'box_full', 'fiber_break', 'inspection', 'note')),
  port_number int,
  optical_dbm numeric(5,2),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.task_work_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('imported', 'assigned', 'started', 'paused', 'blocked', 'resumed', 'completed', 'reopened')),
  session_seconds int NOT NULL DEFAULT 0,
  blocker_reason text,
  optical_dbm numeric(5,2),
  port_number int,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY (RLS)
-- ----------------------------------------------------------------------------
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crew_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cableboxes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cablebox_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_work_logs ENABLE ROW LEVEL SECURITY;

-- Public read policies on operational non-secret tables (user_credentials & user_sessions have ZERO policies!)
CREATE POLICY "Allow read groups" ON public.groups FOR SELECT USING (true);
CREATE POLICY "Allow read users" ON public.users FOR SELECT USING (true);
CREATE POLICY "Allow read crews" ON public.crews FOR SELECT USING (true);
CREATE POLICY "Allow read crew_members" ON public.crew_members FOR SELECT USING (true);
CREATE POLICY "Allow read cableboxes" ON public.cableboxes FOR SELECT USING (true);
CREATE POLICY "Allow read cablebox_logs" ON public.cablebox_logs FOR SELECT USING (true);
CREATE POLICY "Allow read import_batches" ON public.import_batches FOR SELECT USING (true);
CREATE POLICY "Allow read tasks" ON public.tasks FOR SELECT USING (true);
CREATE POLICY "Allow read task_work_logs" ON public.task_work_logs FOR SELECT USING (true);

-- ----------------------------------------------------------------------------
-- 7. HELPER & AUTH / TEAM MANAGEMENT RPC FUNCTIONS (SECURITY DEFINER)
-- ----------------------------------------------------------------------------

-- Internal helper: resolve active user from session token
CREATE OR REPLACE FUNCTION public.get_session_user(p_token uuid)
RETURNS public.users
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.users;
BEGIN
  IF p_token IS NULL THEN
    RAISE EXCEPTION 'Session token required';
  END IF;

  SELECT u.* INTO v_user
  FROM public.user_sessions s
  JOIN public.users u ON u.id = s.user_id
  WHERE s.token = p_token
    AND s.expires_at > now()
    AND u.is_active = true;

  IF v_user.id IS NULL THEN
    RAISE EXCEPTION 'Invalid or expired session';
  END IF;

  RETURN v_user;
END;
$$;

-- Build full session payload (user + group + active crews)
CREATE OR REPLACE FUNCTION public.build_auth_payload(p_user_id uuid, p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'token', p_token,
    'user', jsonb_build_object(
      'id', u.id,
      'group_id', u.group_id,
      'username', u.username,
      'full_name', u.full_name,
      'phone', u.phone,
      'role', u.role,
      'preferred_lang', u.preferred_lang,
      'is_active', u.is_active
    ),
    'group', jsonb_build_object(
      'id', g.id,
      'code', g.code,
      'name', g.name
    ),
    'crews', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'vehicle_tag', c.vehicle_tag,
        'zone_focus', c.zone_focus
      ))
      FROM public.crew_members cm
      JOIN public.crews c ON c.id = cm.crew_id
      WHERE cm.user_id = u.id AND c.is_active = true
    ), '[]'::jsonb)
  )
  INTO v_result
  FROM public.users u
  JOIN public.groups g ON g.id = u.group_id
  WHERE u.id = p_user_id;

  RETURN v_result;
END;
$$;

-- Fast PIN Login (accepts username OR phone number + 4-6 digit PIN)
CREATE OR REPLACE FUNCTION public.authenticate_pin(p_identifier text, p_pin text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_clean_id text := lower(trim(p_identifier));
  v_digits text := regexp_replace(p_identifier, '\D', '', 'g');
  v_user public.users;
  v_hash text;
  v_token uuid;
BEGIN
  SELECT u.* INTO v_user
  FROM public.users u
  WHERE u.is_active = true
    AND (
      lower(u.username) = v_clean_id
      OR (v_digits <> '' AND regexp_replace(COALESCE(u.phone, ''), '\D', '', 'g') = v_digits)
      OR (length(v_digits) >= 7 AND right(regexp_replace(COALESCE(u.phone, ''), '\D', '', 'g'), 7) = right(v_digits, 7))
    )
  LIMIT 1;

  IF v_user.id IS NULL THEN
    RAISE EXCEPTION 'Invalid username/phone or PIN';
  END IF;

  SELECT pin_hash INTO v_hash
  FROM public.user_credentials
  WHERE user_id = v_user.id;

  IF v_hash IS NULL OR v_hash <> extensions.crypt(trim(p_pin), v_hash) THEN
    RAISE EXCEPTION 'Invalid username/phone or PIN';
  END IF;

  INSERT INTO public.user_sessions (user_id)
  VALUES (v_user.id)
  RETURNING token INTO v_token;

  RETURN public.build_auth_payload(v_user.id, v_token);
END;
$$;

-- Restore existing session token
CREATE OR REPLACE FUNCTION public.verify_session(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.users;
BEGIN
  v_user := public.get_session_user(p_token);
  RETURN public.build_auth_payload(v_user.id, p_token);
END;
$$;

-- Logout session
CREATE OR REPLACE FUNCTION public.logout_session(p_token uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  DELETE FROM public.user_sessions WHERE token = p_token;
  RETURN true;
END;
$$;

-- Update user's preferred language ('so' | 'en')
CREATE OR REPLACE FUNCTION public.set_preferred_language(p_token uuid, p_lang text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.users;
BEGIN
  v_user := public.get_session_user(p_token);
  UPDATE public.users
  SET preferred_lang = p_lang, updated_at = now()
  WHERE id = v_user.id;
  RETURN true;
END;
$$;

-- Self-service PIN change for logged-in user
CREATE OR REPLACE FUNCTION public.change_own_pin(p_token uuid, p_current_pin text, p_new_pin text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.users;
  v_hash text;
BEGIN
  v_user := public.get_session_user(p_token);

  IF trim(p_new_pin) !~ '^\d{4,6}$' THEN
    RAISE EXCEPTION 'PIN must be 4 to 6 digits';
  END IF;

  SELECT pin_hash INTO v_hash FROM public.user_credentials WHERE user_id = v_user.id;
  IF v_hash IS NULL OR v_hash <> extensions.crypt(trim(p_current_pin), v_hash) THEN
    RAISE EXCEPTION 'Current PIN is incorrect';
  END IF;

  UPDATE public.user_credentials
  SET pin_hash = extensions.crypt(trim(p_new_pin), extensions.gen_salt('bf')),
      updated_at = now()
  WHERE user_id = v_user.id;

  RETURN true;
END;
$$;

-- Supervisor RPC: Create or Update Team Member (Technician or Supervisor)
CREATE OR REPLACE FUNCTION public.upsert_team_member(
  p_token uuid,
  p_member_id uuid,
  p_group_id uuid,
  p_username text,
  p_full_name text,
  p_phone text,
  p_role text,
  p_pin text,
  p_is_active boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller public.users;
  v_target_id uuid;
  v_clean_username text := lower(regexp_replace(trim(p_username), '\s+', '_', 'g'));
  v_clean_phone text := NULLIF(trim(COALESCE(p_phone, '')), '');
BEGIN
  v_caller := public.get_session_user(p_token);
  IF v_caller.role <> 'supervisor' THEN
    RAISE EXCEPTION 'Only supervisors can manage team members';
  END IF;

  IF p_member_id IS NULL THEN
    IF COALESCE(trim(p_pin), '') !~ '^\d{4,6}$' THEN
      RAISE EXCEPTION 'New member requires a 4 to 6 digit PIN';
    END IF;

    INSERT INTO public.users (group_id, username, full_name, phone, role, is_active)
    VALUES (p_group_id, v_clean_username, trim(p_full_name), v_clean_phone, p_role, p_is_active)
    RETURNING id INTO v_target_id;

    INSERT INTO public.user_credentials (user_id, pin_hash)
    VALUES (v_target_id, extensions.crypt(trim(p_pin), extensions.gen_salt('bf')));
  ELSE
    UPDATE public.users
    SET group_id = p_group_id,
        username = v_clean_username,
        full_name = trim(p_full_name),
        phone = v_clean_phone,
        role = p_role,
        is_active = p_is_active,
        updated_at = now()
    WHERE id = p_member_id
    RETURNING id INTO v_target_id;

    IF COALESCE(trim(p_pin), '') <> '' THEN
      IF trim(p_pin) !~ '^\d{4,6}$' THEN
        RAISE EXCEPTION 'PIN must be 4 to 6 digits';
      END IF;
      INSERT INTO public.user_credentials (user_id, pin_hash)
      VALUES (v_target_id, extensions.crypt(trim(p_pin), extensions.gen_salt('bf')))
      ON CONFLICT (user_id) DO UPDATE
      SET pin_hash = EXCLUDED.pin_hash, updated_at = now();
    END IF;
  END IF;

  RETURN v_target_id;
END;
$$;

-- Supervisor RPC: Create or Update 2-Tech Crew & Members
CREATE OR REPLACE FUNCTION public.upsert_crew(
  p_token uuid,
  p_crew_id uuid,
  p_group_id uuid,
  p_name text,
  p_vehicle_tag text,
  p_zone_focus text,
  p_member_ids uuid[],
  p_is_active boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller public.users;
  v_target_crew_id uuid;
  v_uid uuid;
BEGIN
  v_caller := public.get_session_user(p_token);
  IF v_caller.role <> 'supervisor' THEN
    RAISE EXCEPTION 'Only supervisors can manage crews';
  END IF;

  IF p_crew_id IS NULL THEN
    INSERT INTO public.crews (group_id, name, vehicle_tag, zone_focus, is_active)
    VALUES (p_group_id, trim(p_name), NULLIF(trim(COALESCE(p_vehicle_tag, '')), ''), NULLIF(trim(COALESCE(p_zone_focus, '')), ''), p_is_active)
    RETURNING id INTO v_target_crew_id;
  ELSE
    UPDATE public.crews
    SET name = trim(p_name),
        vehicle_tag = NULLIF(trim(COALESCE(p_vehicle_tag, '')), ''),
        zone_focus = NULLIF(trim(COALESCE(p_zone_focus, '')), ''),
        is_active = p_is_active
    WHERE id = p_crew_id
    RETURNING id INTO v_target_crew_id;
  END IF;

  DELETE FROM public.crew_members WHERE crew_id = v_target_crew_id;

  IF p_member_ids IS NOT NULL THEN
    FOREACH v_uid IN ARRAY p_member_ids LOOP
      INSERT INTO public.crew_members (crew_id, user_id)
      VALUES (v_target_crew_id, v_uid)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END IF;

  RETURN v_target_crew_id;
END;
$$;

-- Supervisor RPC: Toggle or add department group (F2, F3, F5, GA, etc.)
CREATE OR REPLACE FUNCTION public.upsert_group(
  p_token uuid,
  p_code text,
  p_name text,
  p_description text,
  p_is_active boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller public.users;
  v_gid uuid;
BEGIN
  v_caller := public.get_session_user(p_token);
  IF v_caller.role <> 'supervisor' THEN
    RAISE EXCEPTION 'Only supervisors can manage groups';
  END IF;

  INSERT INTO public.groups (code, name, description, is_active)
  VALUES (upper(trim(p_code)), trim(p_name), NULLIF(trim(COALESCE(p_description, '')), ''), p_is_active)
  ON CONFLICT (code) DO UPDATE
  SET name = EXCLUDED.name,
      description = EXCLUDED.description,
      is_active = EXCLUDED.is_active
  RETURNING id INTO v_gid;

  RETURN v_gid;
END;
$$;

-- ----------------------------------------------------------------------------
-- 8. REALTIME PUBLICATION
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.tasks;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.cableboxes;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.crews;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.crew_members;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.users;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ----------------------------------------------------------------------------
-- 9. SEED DATA: TELESOM FBB GROUPS + GROUP F1 TEAM & CREWS
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_f1_id uuid;
  v_sup_id uuid;
  v_t1_id uuid;
  v_t2_id uuid;
  v_t3_id uuid;
  v_t4_id uuid;
  v_crew_a uuid;
  v_crew_b uuid;
BEGIN
  INSERT INTO public.groups (code, name, description, is_active) VALUES
    ('F1', 'Group F1 — Fixed Broadband', 'Primary FTTH Installation & Cilada Field Team', true),
    ('F2', 'Group F2 — Fixed Broadband', 'Ready for department expansion', false),
    ('F3', 'Group F3 — Fixed Broadband', 'Ready for department expansion', false),
    ('F5', 'Group F5 — Fixed Broadband', 'Ready for department expansion', false),
    ('GA', 'Group GA — Fixed Broadband', 'Ready for department expansion', false)
  ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name;

  SELECT id INTO v_f1_id FROM public.groups WHERE code = 'F1';

  -- Supervisor (Username: supervisor | Phone: 634000001 | PIN: 1234)
  INSERT INTO public.users (group_id, username, full_name, phone, role, preferred_lang)
  VALUES (v_f1_id, 'supervisor', 'F1 Supervisor (Kormeeraha F1)', '634000001', 'supervisor', 'so')
  ON CONFLICT (username) DO UPDATE SET full_name = EXCLUDED.full_name
  RETURNING id INTO v_sup_id;

  INSERT INTO public.user_credentials (user_id, pin_hash)
  VALUES (v_sup_id, extensions.crypt('1234', extensions.gen_salt('bf')))
  ON CONFLICT (user_id) DO NOTHING;

  -- 4 Group F1 Technicians (PIN: 1111)
  INSERT INTO public.users (group_id, username, full_name, phone, role, preferred_lang)
  VALUES (v_f1_id, 'cabdi', 'Cabdiraxmaan Maxamed', '634100101', 'technician', 'so')
  ON CONFLICT (username) DO UPDATE SET full_name = EXCLUDED.full_name
  RETURNING id INTO v_t1_id;
  INSERT INTO public.user_credentials (user_id, pin_hash)
  VALUES (v_t1_id, extensions.crypt('1111', extensions.gen_salt('bf')))
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.users (group_id, username, full_name, phone, role, preferred_lang)
  VALUES (v_f1_id, 'xasan', 'Xasan Cali Nuur', '634100102', 'technician', 'so')
  ON CONFLICT (username) DO UPDATE SET full_name = EXCLUDED.full_name
  RETURNING id INTO v_t2_id;
  INSERT INTO public.user_credentials (user_id, pin_hash)
  VALUES (v_t2_id, extensions.crypt('1111', extensions.gen_salt('bf')))
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.users (group_id, username, full_name, phone, role, preferred_lang)
  VALUES (v_f1_id, 'maxamed', 'Maxamed Yuusuf Faarax', '634100103', 'technician', 'so')
  ON CONFLICT (username) DO UPDATE SET full_name = EXCLUDED.full_name
  RETURNING id INTO v_t3_id;
  INSERT INTO public.user_credentials (user_id, pin_hash)
  VALUES (v_t3_id, extensions.crypt('1111', extensions.gen_salt('bf')))
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO public.users (group_id, username, full_name, phone, role, preferred_lang)
  VALUES (v_f1_id, 'mustafe', 'Mustafe Axmed Xuseen', '634100104', 'technician', 'so')
  ON CONFLICT (username) DO UPDATE SET full_name = EXCLUDED.full_name
  RETURNING id INTO v_t4_id;
  INSERT INTO public.user_credentials (user_id, pin_hash)
  VALUES (v_t4_id, extensions.crypt('1111', extensions.gen_salt('bf')))
  ON CONFLICT (user_id) DO NOTHING;

  -- 2 Initial 2-Tech Crews for Group F1
  INSERT INTO public.crews (group_id, name, vehicle_tag, zone_focus)
  VALUES (v_f1_id, 'F1 - Crew A', 'Gaadhi 01', 'Jigjigayar & Gantalaha')
  ON CONFLICT (group_id, name) DO UPDATE SET zone_focus = EXCLUDED.zone_focus
  RETURNING id INTO v_crew_a;

  INSERT INTO public.crews (group_id, name, vehicle_tag, zone_focus)
  VALUES (v_f1_id, 'F1 - Crew B', 'Gaadhi 02', 'Bada Cas & New Hargeisa')
  ON CONFLICT (group_id, name) DO UPDATE SET zone_focus = EXCLUDED.zone_focus
  RETURNING id INTO v_crew_b;

  INSERT INTO public.crew_members (crew_id, user_id) VALUES
    (v_crew_a, v_t1_id),
    (v_crew_a, v_t2_id),
    (v_crew_b, v_t3_id),
    (v_crew_b, v_t4_id)
  ON CONFLICT DO NOTHING;

  -- Seed known Cableboxes from sample Telesom F1 sheet for instant infrastructure memory
  INSERT INTO public.cableboxes (group_id, box_code, olt_path, xaafada, total_ports, damaged_ports, health_status, fault_count, last_optical_dbm, location_notes)
  VALUES
    (v_f1_id, 'FAT48', 'F2 OLt2-1 ODF4-45 SPL1-1', 'Jigjigayar', 8, ARRAY[7], 'warning', 1, -21.4, 'Port 7 connector clip loose — use Ports 1–6 or 8'),
    (v_f1_id, 'B6 (52)', NULL, 'Gantalaha', 8, '{}'::int[], 'healthy', 1, -18.8, 'Pole mount near main junction')
  ON CONFLICT (box_code) DO NOTHING;
END $$;
