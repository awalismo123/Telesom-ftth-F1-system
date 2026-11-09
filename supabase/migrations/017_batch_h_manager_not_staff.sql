-- ============================================================================
-- 017 — the manager is not one of the supervisor's staff
--
-- Migration 014 attaches a manager to a group so the role has a home row. That
-- placement had a side effect nobody asked for: `group_overview` returns every
-- user in the group, so the manager appeared in the supervisor's Team list —
-- with an edit button whose save is now refused by 014's own guard.
--
-- A screen that offers an action which cannot succeed is worse than a screen
-- that does not mention the person. Managers are filtered out of the list.
--
-- Everything else in this function is unchanged from migration 011: same keys,
-- same counts, same group check.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.group_overview(p_token uuid, p_group_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user public.users;
  v_member boolean;
BEGIN
  v_user := public.get_session_user(p_token);

  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.group_id = p_group_id AND u.id = v_user.id
  ) INTO v_member;

  IF NOT v_member THEN
    RAISE EXCEPTION 'Not allowed for this group';
  END IF;

  RETURN jsonb_build_object(
    'members', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', u.id,
        'group_id', u.group_id,
        'username', u.username,
        'full_name', u.full_name,
        'phone', u.phone,
        'role', u.role,
        'is_active', u.is_active,
        'preferred_lang', u.preferred_lang,
        'must_change_pin', u.must_change_pin
      ) ORDER BY u.role, u.full_name)
      FROM public.users u
      WHERE u.group_id = p_group_id
        -- The manager is not this supervisor's staff: they cannot be edited
        -- from the Team screen, so they are not listed there.
        AND u.role IN ('supervisor', 'technician')
    ), '[]'::jsonb),
    'crews', COALESCE((
      SELECT jsonb_agg(to_jsonb(c) ORDER BY c.name)
      FROM public.crews c WHERE c.group_id = p_group_id
    ), '[]'::jsonb),
    'crew_members', COALESCE((
      SELECT jsonb_agg(to_jsonb(cm))
      FROM public.crew_members cm
      JOIN public.crews c ON c.id = cm.crew_id
      WHERE c.group_id = p_group_id
    ), '[]'::jsonb),
    'cableboxes', COALESCE((
      SELECT jsonb_agg(to_jsonb(b) ORDER BY b.box_code)
      FROM public.cableboxes b WHERE b.group_id = p_group_id
    ), '[]'::jsonb),
    'counts', jsonb_build_object(
      'technicians', (SELECT count(*) FROM public.users u
                       WHERE u.group_id = p_group_id AND u.role = 'technician' AND u.is_active),
      'crews', (SELECT count(*) FROM public.crews c
                 WHERE c.group_id = p_group_id AND c.is_active),
      'open_tasks', (SELECT count(*) FROM public.tasks t
                      WHERE t.group_id = p_group_id
                        AND t.status IN ('unassigned', 'assigned', 'in_progress', 'blocked')),
      'unassigned', (SELECT count(*) FROM public.tasks t
                      WHERE t.group_id = p_group_id AND t.status = 'unassigned')
    )
  );
END;
$$;
