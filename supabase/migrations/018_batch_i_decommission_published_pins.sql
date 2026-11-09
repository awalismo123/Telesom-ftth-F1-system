-- ============================================================================
-- 018 — decommission the published PINs
--
-- The audit's P0: six seeded accounts signed in with `1234` / `1111`, printed in
-- the README and left in the built bundle as unreachable data. Migration 016
-- added the button that *flags* those accounts; it did not make the published
-- PINs stop working. Until the hash changes, `1234` opens the supervisor account
-- whether or not anybody has pressed the button.
--
-- This migration changes the hash. Every account still holding a published PIN
-- is moved to a random PIN that nobody knows, and flagged so that whoever holds
-- it must choose their own at the first sign-in after a supervisor issues them
-- a temporary one from the Team screen (`upsert_team_member`, 014 §2 — which
-- already sets the flag on every reset).
--
-- The supervisor is the one deliberate exception. Randomising their PIN would
-- lock the only account that can issue anybody else a temporary PIN, on a fresh
-- install or on a live one, with no way back in. Their published PIN therefore
-- stays valid for exactly one more sign-in, and `must_change_pin = true` makes
-- that sign-in end on the PIN-change screen where the old PIN is replaced.
-- The published PIN stops working the moment they use it.
--
-- Re-running is safe: it matches on the hash, so an account that has already
-- chosen its own PIN no longer matches and is left alone.
-- ============================================================================


DO $$
DECLARE
  -- Every PIN ever printed in this repository. Keep this list in step with
  -- history; it is a blocklist, not a password list.
  v_published text[] := ARRAY['1234', '1111'];
  v_pin text;
  v_rotated uuid[] := ARRAY[]::uuid[];
  v_batch uuid[];
BEGIN
  FOREACH v_pin IN ARRAY v_published LOOP
    -- Rotate the hash so the published PIN cannot be used again, and keep the
    -- ids. `RETURNING … INTO` would keep only the last row, so the update is
    -- wrapped in a CTE and aggregated.
    WITH rotated AS (
      UPDATE public.user_credentials c
         SET pin_hash = extensions.crypt(
               lpad((floor(random() * 1000000))::int::text, 6, '0'),
               extensions.gen_salt('bf')
             ),
             failed_attempts = 0,
             locked_until = NULL,
             updated_at = now()
        FROM public.users u
       WHERE u.id = c.user_id
         AND u.role IN ('technician', 'manager')
         AND c.pin_hash = extensions.crypt(v_pin, c.pin_hash)
      RETURNING c.user_id
    )
    SELECT coalesce(array_agg(user_id), ARRAY[]::uuid[]) INTO v_batch FROM rotated;

    IF array_length(v_batch, 1) > 0 THEN
      RAISE NOTICE '[018] rotated % account(s) off the published PIN %',
        array_length(v_batch, 1), v_pin;
      v_rotated := v_rotated || v_batch;
    END IF;
  END LOOP;

  -- Flag on the ids we touched, plus anything still holding a published PIN
  -- (the supervisor, who is deliberately not rotated — see the header).
  --
  -- Flagging on a hash match alone would be a bug: once the hash is rotated the
  -- account no longer matches, so it would escape the forced-change screen
  -- while being unable to sign in. That mistake was made on the live project on
  -- the first run; the rotation worked and the flag did not.
  UPDATE public.users u
     SET must_change_pin = true,
         updated_at = now()
   WHERE u.is_active
     AND u.must_change_pin = false
     AND (
       u.id = ANY (v_rotated)
       OR EXISTS (
         SELECT 1 FROM public.user_credentials c
          WHERE c.user_id = u.id
            AND (c.pin_hash = extensions.crypt('1234', c.pin_hash)
              OR c.pin_hash = extensions.crypt('1111', c.pin_hash))
       )
     );

  RAISE NOTICE '[018] flagged every account that needed a forced PIN change';

  -- Sessions are the other half. A token issued under the old PIN survives a
  -- password change unless it is deleted, so every session goes.
  DELETE FROM public.user_sessions;
  RAISE NOTICE '[018] revoked all sessions';
END $$;
-- ============================================================================
-- OPERATIONAL NOTE — after this migration
--
-- Technicians and managers can no longer sign in with the PIN they had. A
-- supervisor issues a temporary PIN per person from the Team screen, which
-- already forces a change at first sign-in. Managers are not on that screen
-- (017); they are reset by an administrator — see RUNBOOK §10a.
--
-- Nothing in this file, and nothing in this repository, contains a usable PIN.
-- A temporary PIN is delivered in person and lives only in that conversation.
-- ============================================================================
