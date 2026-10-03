-- Hard-delete member Edison deocareza AND his login, on the explicit instruction
-- of the coordinator. Deactivate-and-hide is NOT what this is: the ask is that
-- the person be gone.
--
-- WHY A HARD DELETE AND NOT `status = 'inactive'`. The product has an inactive
-- status (Rule 6 already refuses to schedule inactive members), and using it
-- would be the safer default. It is not what was asked: an inactive row keeps
-- the member in every roster filter, keeps their availability on file, and keeps
-- their name in the assignment history. A coordinator asking for a deletion is
-- asking for none of that to remain queryable. (He is ALREADY `status =
-- 'inactive'` -- see below -- so status was tried before this and was not
-- accepted as the outcome.)
--
-- ============================================================================
-- WHAT IS ACTUALLY DESTROYED: FIVE ROWS ACROSS THREE TABLES
-- ============================================================================
--
-- This member has a FULL LOGIN. The three rows are linked by two foreign keys:
--
--   public.members  a8c5c261-d608-448f-a4ff-7ed9a9f82651
--       'Edison deocareza', login_name 'edison', status 'inactive',
--       church d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11,
--       user_id -> eee606b4-8b47-46ae-af6d-c64dad64a990
--
--   public.users    eee606b4-8b47-46ae-af6d-c64dad64a990
--       edison.d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11@name-login.invalid,
--       role 'member', is_active TRUE,
--       auth_id -> 95ef98b7-6888-4149-8934-3474fd5d2235
--
--   auth.users      95ef98b7-6888-4149-8934-3474fd5d2235
--       same synthetic address, 1 auth.identities row, 0 auth.sessions rows
--
-- Deleting the member alone would leave a working login pointing at a member
-- that no longer exists, so Option A -- delete the full stack -- is the
-- authorised outcome. The exact destruction scope is FIVE ROWS:
--
--   1 row  public.members      a8c5c261   direct DELETE (this file, step 4)
--   1 row  public.availability 0cd89c58   CASCADE from members
--   1 row  public.users        eee606b4   direct DELETE (this file, step 4)
--   1 row  auth.users          95ef98b7   direct DELETE (this file, step 4)
--   1 row  auth.identities     (user_id = 95ef98b7) CASCADE from auth.users
--
-- Every one of those five counts is asserted before the first DELETE, and the
-- three direct DELETEs additionally assert their own affected row count, so the
-- cascade cannot quietly grow or shrink the scope between the plan and the run.
--
-- `auth.sessions`, `auth.mfa_factors`, `auth.mfa_recovery_code_sets`,
-- `auth.webauthn_credentials`, `auth.webauthn_challenges`, `auth.oauth_consents`,
-- `auth.oauth_authorizations`, `auth.one_time_tokens` and `auth.scim_users` are
-- all empty for this auth user, which is why 1 identity is the whole cascade.
-- `auth.sessions` is asserted below; the rest are counted only in the header.
--
-- ============================================================================
-- THE AUDIT TRAIL ABOUT THE MEMBER IS NOT DELETED
-- ============================================================================
--
-- `audit_logs.entity_id` is a plain `uuid` with NO foreign key to `members` and
-- NO cascade. Nothing in this file touches `public.audit_logs`. The three
-- pre-existing rows for this entity SURVIVE and are the reason the total
-- post-condition is a COUNT and not a newness check:
--
--   members_created  1     (row creation)
--   members_updated  2     (edits made before this migration)
--   members_deleted  1     (written by THIS migration, via the trigger)
--   -------------------
--   total            4
--
-- The `audit_members_changes` trigger on `members` is `AFTER INSERT OR UPDATE OR
-- DELETE`, so deleting the parent row fires it and writes one `members_deleted`
-- row carrying the full OLD row -- the pre-image of the person being removed,
-- including `full_name` and `login_name`. The post-condition asserts that
-- pre-image is present, so the trail still says who the person was.
--
-- ============================================================================
-- THE ONE CASCADE THAT COULD DESTROY AUDIT HISTORY, AND WHY IT CANNOT
-- ============================================================================
--
-- `public.audit_logs.user_id -> public.users(id) ON DELETE CASCADE` -- constraint
-- `audit_logs_user_id_fkey`, and it is `NOT VALID` (`convalidated = false`).
-- Deleting the `public.users` row would therefore silently remove EVERY audit
-- row that names this user as its ACTOR. That is a real hazard and it is real
-- scope: `user_id` is not `entity_id`, so the cascade reaches history that has
-- nothing to do with the member row.
--
-- It is made safe by an assertion, not by trust. The cascade only ever fires
-- over rows that EXIST, so step 3 asserts, immediately before the first DELETE,
-- that
--
--   SELECT count(*) FROM public.audit_logs WHERE user_id = 'eee606b4-...'
--
-- is EXACTLY 0. Measured on the live database: it is 0. Every one of this
-- member's three audit rows is attributed to the System Migration User
-- (`00000000-0000-0000-0000-000000000000`), because they were written by
-- migrations and by trigger fallback rather than by a signed-in human. So the
-- cascade has an empty set to remove, the three rows above are untouched, and
-- the exactly-4 post-condition in step 5 is the proof after the fact.
--
-- `public.users.auth_id -> auth.users(id) ON DELETE CASCADE`
-- (`users_auth_id_fkey`) is also `NOT VALID`, and deleting the `auth.users` row
-- cascades to `auth.identities` -- that is the fifth destroyed row, and it is
-- counted and asserted rather than assumed.
--
-- Neither NOT VALID constraint is bundled into this file. Validating them is a
-- SEPARATE follow-up migration, gated behind a violation-count audit query that
-- must first prove the existing data would pass:
--
--   -- Run BEFORE writing that migration. Both must return 0.
--   SELECT count(*) FROM public.users u
--    WHERE u.auth_id IS NOT NULL
--      AND NOT EXISTS (SELECT 1 FROM auth.users a WHERE a.id = u.auth_id);
--   SELECT count(*) FROM public.audit_logs l
--    WHERE l.user_id IS NOT NULL
--      AND NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = l.user_id);
--
-- Only then: `ALTER TABLE public.users VALIDATE CONSTRAINT users_auth_id_fkey;`
-- and the same for `public.audit_logs VALIDATE CONSTRAINT
-- audit_logs_user_id_fkey;`. Validating is a rewrite-and-check of a constraint
-- that currently does not constrain anything, so folding it into a row-deletion
-- migration would couple an unrelated schema change to a data change, and would
-- make this file's failure mode ambiguous. It is not written here.
--
-- ============================================================================
-- DELETE ORDER IS THE LOAD-BEARING INVARIANT: members FIRST
-- ============================================================================
--
-- `public.members.user_id -> public.users(id) ON DELETE SET NULL`
-- (`members_user_id_fkey`, validated). This is not a passive relationship and it
-- is the reason the order below is `members` -> `public.users` -> `auth.users`
-- and must never be reversed.
--
-- If `public.users` is deleted while `members.user_id` still points at it, the
-- referential-action trigger issues an UPDATE against `members` -- it MUTATES the
-- member row, setting `user_id` to NULL. That UPDATE fires `audit_members_changes`
-- (AFTER INSERT OR UPDATE OR DELETE), and the trigger writes a FABRICATED
-- `members_updated` audit row for this entity. Nothing about the member changed:
-- the audit trail would assert that a person was edited in order to be deleted.
--
-- This was proven live, not reasoned about. Deleting in the reverse order
-- (`public.users` first) yields 5 rows for `entity_id = a8c5c261`, not 4. The
-- fifth is the SET NULL write. Deleting `members` first removes the target row,
-- so `SET NULL` has nothing to act on and never fires.
--
-- The step-4 DELETEs therefore run strictly in that order, each one asserted by
-- affected row count, and the step-5 post-condition asserts that the
-- `members_updated` count for this entity is UNCHANGED at 2. That last check is
-- the regression guard: if someone reorders these DELETEs, the migration does
-- not merely produce a different audit total, it fails loudly and rolls back.
--
-- (Note precisely what the ordering rests on: the SET NULL write. NOT VALID is
-- irrelevant to it -- `members_user_id_fkey` is validated -- and it would be
-- wrong to justify the order by distrusting the NOT VALID cascades.)
--
-- ============================================================================
-- `log_audit_change` AND RULE R3(b)
-- ============================================================================
--
-- The trigger function is `public.log_audit_change()` (SECURITY DEFINER, pinned
-- `search_path` to `public, pg_temp, auth`). It applies rule R3(b): for a DELETE
-- it never aborts the enclosing transaction. If it cannot resolve an audit
-- context it RAISEs a WARNING and skips the audit row instead of failing,
-- precisely so a cascaded child delete cannot take down the caller's transaction.
--
-- The practical consequence is that a hard delete can in principle complete
-- WITHOUT a `members_deleted` audit row. So this file does not rely on the
-- trigger to prove the deletion was recorded: the step-5 post-condition asserts
-- the `members_deleted` row EXISTS. If the context were unresolvable, this
-- migration would have deleted the person and then failed its own audit check --
-- caught, but late. The better guard is the actor precondition in step 3, which
-- makes the unresolvable case unreachable: in a migration session `auth.uid()` is
-- NULL, so the trigger falls back to the System Migration User, and that row is
-- asserted present up front.
--
-- `public.users` carries NO audit trigger -- only FK internals and
-- `update_users_updated_at`, which touches `updated_at` only and writes no audit
-- row. So deleting that row writes NO audit row of its own. `public.audit_logs`
-- carries NO triggers at all, so its cascade is pure row removal, which is
-- precisely why the zero-count assertion above is load-bearing.
--
-- ============================================================================
-- EXECUTION PATH IS MANDATORY
-- ============================================================================
--
-- This file MUST be executed as SQL against the database as role `postgres`,
-- which carries `bypassrls = true`. That is the path `supabase db push` and a
-- direct `psql` session use.
--
-- It MUST NOT be executed through PostgREST or as `service_role`. RLS is enabled
-- on `members`, `users`, `availability`, `devotion_rotation` and `audit_logs`, so
-- under those policies each statement sees only the rows the caller may touch.
-- The step-4 row-count assertions would still be computed, but a policy-filtered
-- DELETE can report 0 while a cascade has already removed a related row, which is
-- exactly the partial deletion the row-count guard exists to prevent. Under
-- `postgres` every predicate below evaluates against the whole table.
--
-- ============================================================================
-- IDEMPOTENCE HAS THREE STATES, NOT TWO
-- ============================================================================
--
-- Step 2 distinguishes: all three rows absent (clean no-op), all three present
-- (proceed), and ANY PARTIAL state (refuse). A partial state means a previous run
-- was interrupted or a human deleted part of the stack by hand; there is no way
-- to tell from inside this transaction whether the surviving rows are consistent,
-- so it aborts naming exactly which rows it found rather than silently returning
-- and reporting success.
--
-- CONCURRENCY. `pg_advisory_xact_lock` on a fixed key, taken before any read, so
-- two sessions applying this concurrently serialise on one lock rather than both
-- passing the idempotence check. The lock is transaction-scoped (`_xact_`), so
-- it is released by commit or rollback and cannot leak.

DO $purge$
DECLARE
  c_church     CONSTANT UUID := 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  c_member_id  CONSTANT UUID := 'a8c5c261-d608-448f-a4ff-7ed9a9f82651';
  c_user_id    CONSTANT UUID := 'eee606b4-8b47-46ae-af6d-c64dad64a990';
  c_auth_uid   CONSTANT UUID := '95ef98b7-6888-4149-8934-3474fd5d2235';

  c_expected_name   CONSTANT TEXT    := 'Edison deocareza';
  c_expected_login  CONSTANT TEXT    := 'edison';
  c_expected_status CONSTANT TEXT    := 'inactive';
  c_expected_role   CONSTANT TEXT    := 'member';
  c_expected_email  CONSTANT TEXT    := 'edison.d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11@name-login.invalid';

  -- The actor the `members_deleted` audit row will be attributed to. In a
  -- migration session `auth.uid()` is NULL, so `log_audit_change` falls back to
  -- this row. Asserted present in step 3 so R3(b)'s silent-WARNING path is
  -- unreachable rather than merely unlikely.
  c_system_actor CONSTANT UUID := '00000000-0000-0000-0000-000000000000';

  -- The one member-child row that exists today. Asserted, not hard-coded into a
  -- DELETE: the cascade is what actually removes it.
  c_availability_id CONSTANT UUID := '0cd89c58-c088-48bc-a8df-62e2f14f849d';

  -- Post-delete audit arithmetic. THREE pre-existing rows (1 created, 2 updated)
  -- plus the ONE `members_deleted` row this migration writes. `entity_id` is a
  -- uuid column, so these predicates compare as uuid, never as text.
  c_expected_audit_total   CONSTANT INTEGER := 4;
  c_expected_updated_rows  CONSTANT INTEGER := 2;

  v_member RECORD;
  v_user   RECORD;
  v_auth   RECORD;

  v_member_present BOOLEAN;
  v_user_present   BOOLEAN;
  v_auth_present   BOOLEAN;

  v_count         INTEGER;
  v_affected      INTEGER;
  v_audit_id      UUID;
  v_audit_updated INTEGER;
  v_audit_total   INTEGER;
BEGIN
  -- -------------------------------------------------------------------------
  -- 1. Serialise concurrent applications of THIS migration
  -- -------------------------------------------------------------------------
  PERFORM pg_advisory_xact_lock(
    hashtextextended('johia:delete-member-edison:20261002090300', 0)::bigint);

  -- -------------------------------------------------------------------------
  -- 2. Idempotence, checked BEFORE the pre-conditions. Three states, and the
  --    partial state REFUSES rather than returning.
  -- -------------------------------------------------------------------------
  SELECT * INTO v_member FROM public.members WHERE id = c_member_id;
  v_member_present := FOUND;
  SELECT * INTO v_user FROM public.users WHERE id = c_user_id;
  v_user_present := FOUND;
  SELECT * INTO v_auth FROM auth.users WHERE id = c_auth_uid;
  v_auth_present := FOUND;

  IF NOT v_member_present AND NOT v_user_present AND NOT v_auth_present THEN
    RAISE NOTICE
      'delete edison: member %, public.users % and auth.users % are all already absent; no-op.',
      c_member_id, c_user_id, c_auth_uid;
    RETURN;
  END IF;

  -- A partial state is not a state this file knows how to finish. It means an
  -- earlier run was interrupted or a human deleted part of the stack by hand,
  -- and the pre-conditions below would abort anyway -- but they would abort on
  -- whichever assertion happened to run first, which is a worse diagnostic than
  -- naming the surviving rows here.
  IF NOT (v_member_present AND v_user_present AND v_auth_present) THEN
    RAISE EXCEPTION
      'delete aborted: partial state. members present=%, public.users present=%, auth.users present=%. '
      'This migration only proceeds when all three of member % / public.users % / auth.user % exist, '
      'or when all three are absent. Resolve the partial state by hand before re-running; '
      'this file will not silently treat it as a no-op.',
      v_member_present, v_user_present, v_auth_present,
      c_member_id, c_user_id, c_auth_uid;
  END IF;

  -- -------------------------------------------------------------------------
  -- 3. Pre-conditions: the database must look like the database this file was
  --    written against. Every one is an assertion, not a branch -- if the data
  --    has drifted, the correct outcome is to abort naming what was found.
  -- -------------------------------------------------------------------------

  -- (a) The member row, asserted on every column the decision below rests on.
  --     NOTE: `public.members` has NO `is_active` column. Active status on a
  --     member is `status varchar(20)`, checked to 'active' / 'inactive'.
  --     `is_active` is a column of `public.users`, asserted in (b).
  IF v_member.church_id IS DISTINCT FROM c_church THEN
    RAISE EXCEPTION 'delete aborted: member % is in church %, expected %. Tenant scope mismatch; refusing to delete.',
      c_member_id, v_member.church_id, c_church;
  END IF;
  IF v_member.full_name IS DISTINCT FROM c_expected_name
     OR v_member.login_name IS DISTINCT FROM c_expected_login THEN
    RAISE EXCEPTION 'delete aborted: member % is %/% , expected %/%. Refusing to delete a different person.',
      c_member_id, v_member.full_name, v_member.login_name, c_expected_name, c_expected_login;
  END IF;
  IF v_member.status IS DISTINCT FROM c_expected_status THEN
    RAISE EXCEPTION
      'delete aborted: member % has status %, expected %. This file was written against an inactive member; '
      'if he has been reactivated, decide whether the deletion is still intended.',
      c_member_id, v_member.status, c_expected_status;
  END IF;
  IF v_member.user_id IS DISTINCT FROM c_user_id THEN
    RAISE EXCEPTION 'delete aborted: member % points at public.users %, expected %.',
      c_member_id, v_member.user_id, c_user_id;
  END IF;

  -- (b) The application user row, which is what carries the login. Asserted
  --     rather than absent-checked: the previous version of this file asserted
  --     NO user row existed, which was false, so the file could never succeed.
  --     It now asserts the row that is actually there, with its actual values.
  IF v_user.church_id IS DISTINCT FROM c_church THEN
    RAISE EXCEPTION 'delete aborted: public.users % is in church %, expected %.',
      c_user_id, v_user.church_id, c_church;
  END IF;
  IF v_user.email IS DISTINCT FROM c_expected_email THEN
    RAISE EXCEPTION 'delete aborted: public.users % has email %, expected %. Refusing to delete a different login.',
      c_user_id, v_user.email, c_expected_email;
  END IF;
  IF v_user.role IS DISTINCT FROM c_expected_role THEN
    RAISE EXCEPTION 'delete aborted: public.users % has role %, expected %. This file only deletes a plain member login.',
      c_user_id, v_user.role, c_expected_role;
  END IF;
  IF v_user.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'delete aborted: public.users % has is_active %, expected true. Refusing to delete a login that has been administratively disabled.',
      c_user_id, v_user.is_active;
  END IF;
  IF v_user.auth_id IS DISTINCT FROM c_auth_uid THEN
    RAISE EXCEPTION 'delete aborted: public.users % points at auth user %, expected %.',
      c_user_id, v_user.auth_id, c_auth_uid;
  END IF;

  -- (c) The GoTrue row. Deleting this cascades to `auth.identities`.
  IF v_auth.email IS DISTINCT FROM c_expected_email THEN
    RAISE EXCEPTION 'delete aborted: auth user % has email %, expected %.',
      c_auth_uid, v_auth.email, c_expected_email;
  END IF;

  -- (d) SIBLING LINKAGE. A shared link is the one way this file could destroy
  --     someone else's data: if a SECOND member pointed at this user row, or a
  --     SECOND user row at this auth row, the cascades would reach both.
  --     Both directions must be exactly one, and exactly the expected pair.
  SELECT count(*) INTO v_count FROM public.members WHERE user_id = c_user_id;
  IF v_count <> 1 THEN
    RAISE EXCEPTION
      'delete aborted: % public.members rows reference public.users %, expected exactly 1 (member %). '
      'A shared login would let this cascade delete another member row.',
      v_count, c_user_id, c_member_id;
  END IF;

  SELECT count(*) INTO v_count FROM public.users WHERE auth_id = c_auth_uid;
  IF v_count <> 1 THEN
    RAISE EXCEPTION
      'delete aborted: % public.users rows reference auth user %, expected exactly 1 (public.users %). '
      'A shared auth row would let this cascade delete another login.',
      v_count, c_auth_uid, c_user_id;
  END IF;

  SELECT count(*) INTO v_count FROM auth.identities WHERE user_id = c_auth_uid;
  IF v_count <> 1 THEN
    RAISE EXCEPTION
      'delete aborted: auth user % has % identity rows, expected exactly 1. The cascade scope in the header is 5 rows, and it would be wrong.',
      c_auth_uid, v_count;
  END IF;

  -- Zero live sessions means nobody is signed in as this user at the moment the
  -- row disappears. A non-zero count would not block the deletion -- the auth
  -- cascade would invalidate it -- but it would mean deleting a login somebody is
  -- currently using, which is worth a deliberate decision instead of a surprise.
  SELECT count(*) INTO v_count FROM auth.sessions WHERE user_id = c_auth_uid;
  IF v_count <> 0 THEN
    RAISE EXCEPTION
      'delete aborted: auth user % has % live auth.sessions rows, expected 0. Somebody is signed in as this member right now.',
      c_auth_uid, v_count;
  END IF;

  -- (e) THE LOAD-BEARING CASCADE GUARD. `audit_logs_user_id_fkey` is
  --     `ON DELETE CASCADE` and `NOT VALID`, so deleting the public.users row
  --     removes every audit row naming this user as ACTOR. Asserted to be
  --     exactly 0 BEFORE the first DELETE, so the cascade has an empty set to
  --     remove and the member's own audit history cannot be destroyed.
  SELECT count(*) INTO v_count FROM public.audit_logs WHERE user_id = c_user_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION
      'delete aborted: % audit_logs rows have user_id = public.users %. Deleting that row cascades them away, '
      'destroying audit history that is not about this member. Re-point those rows at the System Migration User '
      '(%), or reconsider the deletion, before re-running.',
      v_count, c_user_id, c_system_actor;
  END IF;

  -- (f) Child tables of `members`. Every one that is not `availability` is
  --     empty today, which is what makes this deletion clean; a re-run against
  --     changed data must abort rather than cascade into them silently.
  SELECT count(*) INTO v_count FROM public.schedule_assignments WHERE member_id = c_member_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION
      'delete aborted: % schedule_assignments reference member %. Deleting would silently rewrite that history; remove the assignments first.',
      v_count, c_member_id;
  END IF;
  SELECT count(*) INTO v_count FROM public.member_roles WHERE member_id = c_member_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'delete aborted: % member_roles reference member %.', v_count, c_member_id;
  END IF;
  SELECT count(*) INTO v_count FROM public.member_skills WHERE member_id = c_member_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'delete aborted: % member_skills reference member %.', v_count, c_member_id;
  END IF;
  -- The reverse direction of the same table: members OTHER than this one naming
  -- him as a fallback. Deleting him SET NULLs theirs, which is a mutation of
  -- rows this migration does not own, so it is asserted rather than permitted.
  SELECT count(*) INTO v_count FROM public.member_skills WHERE fallback_member_id = c_member_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION
      'delete aborted: % member_skills name member % as fallback_member_id. Deleting him SET NULLs those rows.',
      v_count, c_member_id;
  END IF;
  SELECT count(*) INTO v_count FROM public.availability_submissions WHERE member_id = c_member_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'delete aborted: % availability_submissions reference member %.', v_count, c_member_id;
  END IF;
  SELECT count(*) INTO v_count FROM public.devotion_rotation WHERE member_id = c_member_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'delete aborted: % devotion_rotation rows reference member %.', v_count, c_member_id;
  END IF;

  -- The one child row that does exist, asserted by id as well as by count so the
  -- post-condition can prove the CASCADE removed it rather than a hand DELETE.
  SELECT count(*) INTO v_count FROM public.availability WHERE member_id = c_member_id;
  IF v_count <> 1
     OR NOT EXISTS (SELECT 1 FROM public.availability WHERE id = c_availability_id AND member_id = c_member_id) THEN
    RAISE EXCEPTION
      'delete aborted: expected exactly one availability row (%), found a different set (count=%).',
      c_availability_id, v_count;
  END IF;

  -- (g) The System Migration User. `log_audit_change` resolves its actor as
  --     `auth.uid()` -> System Migration User, and `auth.uid()` is NULL in a
  --     migration session. Without this row the DELETE trigger would take R3(b)'s
  --     silent-WARNING path and skip the `members_deleted` audit row entirely.
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = c_system_actor) THEN
    RAISE EXCEPTION
      'delete aborted: the System Migration User (%) is missing, so members_deleted cannot be attributed.',
      c_system_actor;
  END IF;

  -- -------------------------------------------------------------------------
  -- 4. The deletes, in the ONE order that is safe: members -> users -> auth.
  --    Each affected row count is captured and asserted to be exactly 1, so a
  --    filtered delete (RLS, a drifted predicate) cannot masquerade as success.
  --    `public.availability` and `auth.identities` go with their parents via
  --    ON DELETE CASCADE; the `audit_members_changes` AFTER DELETE trigger writes
  --    the `members_deleted` pre-image.
  -- -------------------------------------------------------------------------

  -- (1) `members` FIRST. This is the ordering invariant: it removes the only row
  --     `members_user_id_fkey ON DELETE SET NULL` could act on, so the cascade
  --     never issues that UPDATE and never fabricates a `members_updated` audit
  --     row. Reversing steps (1) and (2) is what produces 5 audit rows instead
  --     of 4; see the header.
  DELETE FROM public.members WHERE id = c_member_id AND church_id = c_church;
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected <> 1 THEN
    RAISE EXCEPTION
      'delete post-condition failed: DELETE FROM public.members affected % rows, expected exactly 1. '
      'Either RLS filtered the statement or the row moved out of church % between the pre-condition and here.',
      v_affected, c_church;
  END IF;

  -- (2) `public.users`. Its only incoming reference was the member row just
  --     deleted, so the `members_user_id_fkey ON DELETE SET NULL` trigger has no
  --     target row and stays silent. The `audit_logs_user_id_fkey` cascade was
  --     proved empty in step 3(e).
  DELETE FROM public.users WHERE id = c_user_id AND church_id = c_church;
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected <> 1 THEN
    RAISE EXCEPTION
      'delete post-condition failed: DELETE FROM public.users affected % rows, expected exactly 1. '
      'Either RLS filtered the statement or the row moved out of church % between the pre-condition and here.',
      v_affected, c_church;
  END IF;

  -- (3) `auth.users`. `users_auth_id_fkey` cascades the other way, and this
  --     delete cascades to the single `auth.identities` row.
  DELETE FROM auth.users WHERE id = c_auth_uid;
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected <> 1 THEN
    RAISE EXCEPTION
      'delete post-condition failed: DELETE FROM auth.users affected % rows, expected exactly 1. '
      'No RLS applies to auth.users, so a 0 here means the row changed underneath this transaction.',
      v_affected;
  END IF;

  -- -------------------------------------------------------------------------
  -- 5. Post-conditions: all five rows gone, audit retained
  -- -------------------------------------------------------------------------
  IF EXISTS (SELECT 1 FROM public.members WHERE id = c_member_id) THEN
    RAISE EXCEPTION 'delete post-condition failed: member % still exists.', c_member_id;
  END IF;
  IF EXISTS (SELECT 1 FROM public.users WHERE id = c_user_id) THEN
    RAISE EXCEPTION 'delete post-condition failed: public.users % still exists.', c_user_id;
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE id = c_auth_uid) THEN
    RAISE EXCEPTION 'delete post-condition failed: auth user % still exists.', c_auth_uid;
  END IF;

  -- The two cascaded rows, proved gone.
  SELECT count(*) INTO v_count FROM public.availability WHERE member_id = c_member_id;
  IF v_count <> 0 THEN
    RAISE EXCEPTION
      'delete post-condition failed: % availability rows for member % survived the cascade.', v_count, c_member_id;
  END IF;
  SELECT count(*) INTO v_count FROM auth.identities WHERE user_id = c_auth_uid;
  IF v_count <> 0 THEN
    RAISE EXCEPTION
      'delete post-condition failed: % identity rows for auth user % survived the cascade.', v_count, c_auth_uid;
  END IF;

  -- The one thing a hard delete must NOT lose. Without this the deletion could
  -- complete with no record that it happened (see the R3(b) note in the header).
  SELECT l.id INTO v_audit_id
  FROM public.audit_logs l
  WHERE l.entity_id = c_member_id AND l.entity_type = 'members' AND l.action = 'members_deleted'
  ORDER BY l.created_at DESC
  LIMIT 1;
  IF v_audit_id IS NULL THEN
    RAISE EXCEPTION
      'delete post-condition failed: no members_deleted audit row was written for member %. The deletion completed unaudited.',
      c_member_id;
  END IF;

  -- And the pre-image was captured, so the trail still says who the person was.
  IF NOT EXISTS (SELECT 1 FROM public.audit_logs
                  WHERE id = v_audit_id
                    AND old_value->>'login_name' = c_expected_login
                    AND old_value->>'full_name' = c_expected_name) THEN
    RAISE EXCEPTION
      'delete post-condition failed: the members_deleted audit row % does not carry the expected pre-image (full_name=%, login_name=%).',
      v_audit_id,
      (SELECT old_value->>'full_name' FROM public.audit_logs WHERE id = v_audit_id),
      (SELECT old_value->>'login_name' FROM public.audit_logs WHERE id = v_audit_id);
  END IF;

  -- THE ORDERING REGRESSION GUARD. `members_updated` is NOT expected to be 0:
  -- this member was genuinely edited twice before this migration, and those two
  -- rows must survive. What must not exist is a THIRD one. If a future edit
  -- reverses the delete order, `members_user_id_fkey ON DELETE SET NULL` fires,
  -- `audit_members_changes` writes a fabricated `members_updated` row, and this
  -- count becomes 3 and the whole migration rolls back.
  SELECT count(*) INTO v_audit_updated
  FROM public.audit_logs
  WHERE entity_id = c_member_id AND entity_type = 'members' AND action = 'members_updated';
  IF v_audit_updated <> c_expected_updated_rows THEN
    RAISE EXCEPTION
      'delete post-condition failed: % members_updated audit rows exist for entity %, expected % (the 2 pre-existing edits, unchanged). '
      'A third row means ON DELETE SET NULL mutated the member row and the trigger fabricated an update -- the delete order is wrong.',
      v_audit_updated, c_member_id, c_expected_updated_rows;
  END IF;

  -- And the total, which is the arithmetic in the header: 3 pre-existing + 1 new.
  SELECT count(*) INTO v_audit_total
  FROM public.audit_logs
  WHERE entity_id = c_member_id AND entity_type = 'members';
  IF v_audit_total <> c_expected_audit_total THEN
    RAISE EXCEPTION
      'delete post-condition failed: % audit rows exist for entity % %, expected exactly % '
      '(1 members_created + % members_updated + 1 members_deleted). Audit history was destroyed, or written more than once.',
      v_audit_total, c_member_id, c_member_id, c_expected_audit_total, c_expected_updated_rows;
  END IF;

  RAISE NOTICE
    'delete edison: applied. 5 rows destroyed (members %, public.users %, auth.users %, availability % cascaded, 1 identity cascaded); '
    'audit row % retains the pre-image; % audit rows survive for this entity.',
    c_member_id, c_user_id, c_auth_uid, c_availability_id, v_audit_id, v_audit_total;
END;
$purge$;
