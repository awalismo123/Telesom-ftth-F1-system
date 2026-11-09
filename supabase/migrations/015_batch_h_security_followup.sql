-- ============================================================================
-- 015 — Batch H security follow-up: four helpers were facing the Internet
--
-- Found while probing the manager role, not while looking for it. The probe
-- listed every `public` function whose first argument is not `p_token` and
-- asked two questions of each: can `anon` execute it, and does it write?
--
--   ensure_cablebox(p_group_id, code, xaafada, olt_path)   writes  anon: yes
--   ensure_box_ports(p_box_id)                             writes  anon: yes
--   recompute_box_state(p_box_id)                          writes  anon: yes
--   build_auth_payload(p_user_id, p_token)                 reads   anon: yes
--
-- These are internal helpers: `ensure_cablebox` is called by the importer and by
-- the phone-in job, `ensure_box_ports` and `recompute_box_state` by the port
-- editor, and `build_auth_payload` by `authenticate_pin` and `verify_session`.
-- None of them is called by the browser — `grep` over `src/` finds no reference
-- — so revoking them removes nothing from the app and closes a hole:
--
--   POST /rest/v1/rpc/ensure_cablebox {"p_group_id": "<any>", "p_box_code": "X"}
--   → a cablebox created in a group the caller does not belong to, with no
--     session token at all.
--
-- `build_auth_payload` was a quieter problem: it never looked at its `p_token`,
-- so anyone holding the anon key and a user id could read that person's name,
-- phone number, role and group.
--
-- Both default grants were involved: Supabase grants EXECUTE on new functions to
-- `anon`, `authenticated` and `service_role`, **and** Postgres grants it to
-- PUBLIC. Revoking from `anon` alone left the PUBLIC grant in place, which is
-- why the first attempt below appeared to do nothing — the check that caught
-- that was `has_function_privilege('anon', …)`, not the migration succeeding.
-- ============================================================================

REVOKE ALL ON FUNCTION public.ensure_cablebox(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_box_ports(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recompute_box_state(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.build_auth_payload(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Nothing to re-grant: these run under SECURITY DEFINER as the owner (postgres)
-- inside authenticate_pin / commit_import_batch / set_port_status, which keep
-- their own grants and their own token checks.
