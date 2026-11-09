-- ============================================================================
-- 020 — grant hygiene, and the finding that reverses the audit's advice
--
-- The audit's P2 #8, second part: Supabase's linter reports 58 SECURITY DEFINER
-- functions executable by `anon` (linter rule 0028). The number is exactly
-- right — I reproduced it — and the conclusion drawn from it is wrong.
--
-- For this application, `anon`-executable functions are the architecture, not a
-- mistake. There is no Supabase Auth: the browser holds the public anon key and
-- a session token, calls `rpc(...)`, and each function validates that token
-- itself through `get_session_user`, which joins `user_sessions` on
-- `expires_at > now()` and `is_active`. Revoking `anon` from those functions
-- does not harden the app — it deletes it. Every screen would return
--
--   permission denied for function list_open_tasks
--
-- and nothing else would change, because the guard was never the grant.
--
-- I went through all 58 individually rather than trusting either the linter or
-- this argument. The breakdown:
--
--   1  authenticate_pin      the login endpoint. Must be callable by anon — it
--                            is how you get a token. Guarded by failed_attempts
--                            / locked_until (Batch B) and, since 018, by the
--                            fact that no published PIN works any more.
--   2  trigger functions     broadcast_change, block_manager_writes. PostgREST
--                            only exposes functions it can call as RPC; a
--                            function returning `trigger` is not one. Revoking
--                            here is cosmetic, and it is not free — see below.
--  54  token-first          p_token is argument one. 51 call get_session_user
--                            directly; list_task_photos and list_work_logs call
--                            get_task(p_token, …), which does; logout_session
--                            deletes the row for the token it is given, which is
--                            the whole operation. All 54 are guarded.
--   1  is_task_worker        internal helper taking whole `users` and `tasks`
--                            rows. This is the only one worth revoking.
--
-- That is 58 accounted for, and zero open doors. The linter's warning is
-- advisory and, for this schema, a false positive; it exists because it cannot
-- know that the guard lives inside the function body.
--
-- Why the trigger functions keep their grant: a PostgreSQL trigger does not
-- check the *calling* user's EXECUTE privilege before firing, but SECURITY
-- DEFINER functions and session-role interactions around trigger execution are
-- subtle enough that revoking for a cosmetic gain risks breaking
-- `broadcast_change` — the realtime feed every screen depends on — for the sake
-- of a linter line. Not a trade worth making blind. If it is ever done, do it
-- with a write performed through the anon role and the realtime socket open.
-- ============================================================================

-- The one function that is neither RPC nor guarded: a helper whose results are
-- already exposed through the functions that call it.
REVOKE EXECUTE ON FUNCTION public.is_task_worker(public.users, public.tasks)
  FROM anon, authenticated;

COMMENT ON FUNCTION public.is_task_worker(public.users, public.tasks) IS
  'Internal helper. Not an RPC endpoint; EXECUTE revoked from anon and authenticated in 020.';

-- ----------------------------------------------------------------------------
-- Standing rule for future functions
-- ----------------------------------------------------------------------------
-- Every new SECURITY DEFINER function that is exposed to PostgREST must take
-- `p_token uuid` as its first argument and start with
--
--   v_caller := public.get_session_user(p_token);
--
-- and must then check the caller's role or group before doing anything. A
-- grant is not a permission model; the check inside the body is. This is why
-- 018 verified the *state* it claimed to create rather than trusting that a
-- statement ran — the same reasoning, one level up.
-- ----------------------------------------------------------------------------

COMMENT ON FUNCTION public.authenticate_pin(text, text) IS
  'Login. The only credentials endpoint callable by anon — it is how a token is obtained. '
  'Lockout: 5 attempts / 15 minutes (Batch B). Published PINs retired by 018.';
