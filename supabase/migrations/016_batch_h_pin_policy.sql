-- ============================================================================
-- 016 — the PIN rule that was never applied
--
-- Batch B added `must_change_pin`: an account whose PIN somebody else chose is
-- forced to replace it at next sign-in, and `upsert_team_member` sets the flag
-- whenever a supervisor resets a PIN.
--
-- It was correct, and it protected nobody. Every account that already existed
-- still carries `must_change_pin = false`, so all six — the supervisor and the
-- four technicians whose PINs are printed in the README, and the manager — can
-- sign in today with a PIN that is published in the repository. The rule only
-- ever applied to people added *after* the migration.
--
-- The fix is a button, not a blanket flag. Flipping the column for everyone
-- during a demonstration would put a PIN-change screen in front of a head
-- manager; flipping it the day before real customers arrive is exactly right.
-- A supervisor decides when, on the Team screen, and can see who is affected.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.flag_department_pins(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $fn$
DECLARE
  v_caller public.users;
  v_count int := 0;
BEGIN
  v_caller := public.get_session_user(p_token);

  IF v_caller.role <> 'supervisor' THEN
    RAISE EXCEPTION 'Only a supervisor can flag the department PINs';
  END IF;

  -- Includes the supervisor's own account: that PIN is as public as the rest.
  -- Anyone who wants to stay signed in simply presses it at the end of the day.
  UPDATE public.users u
     SET must_change_pin = true,
         updated_at = now()
   WHERE u.group_id = v_caller.group_id
     AND u.is_active
     AND u.role IN ('supervisor', 'technician')
     AND u.must_change_pin = false;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'flagged', v_count,
    'group_id', v_caller.group_id,
    'at', now()
  );
END;
$fn$;

COMMENT ON FUNCTION public.flag_department_pins(uuid) IS
  'Supervisor: force every active member of the group to choose their own PIN at next sign-in.';

GRANT EXECUTE ON FUNCTION public.flag_department_pins(uuid) TO anon, authenticated;

-- Managers are not in the supervisor's group context and are created by SQL
-- (migration 014 §2, RUNBOOK §10a), so they are handled by the runbook rather
-- than by this button.
