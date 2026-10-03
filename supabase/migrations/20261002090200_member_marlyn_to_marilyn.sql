-- Rename member "Marlyn" to "Marilyn", atomically, across all four surfaces.
--
-- WHY ALL FOUR, AND NOT ONE. A name-login member is spread over four rows, and
-- the login will break unless every one of them moves together:
--
--   auth.users                    email, raw_user_meta_data
--   auth.identities               identity_data -> 'email'
--   public.users                  email, full_name
--   public.members                full_name, login_name
--
-- The synthetic email is DERIVED, not random: `POST /api/auth/name` builds
-- `${member.login_name}.${member.church_id}@name-login.invalid`
-- (src/app/api/auth/name/route.ts). So renaming the member changes the email the
-- app will look for on the next sign-in. And the sign-in path prefers the
-- stored address over the derived one -- `signInEmail = user?.email ||
-- syntheticEmail` -- so `public.users.email` is the address actually used, while
-- `auth.users.email` is the row GoTrue resolves it against.
--
-- Leave `auth.users.email` on the old synthetic and the member is silently
-- signed-in-to-tomorrow, while any NEW member created from the renamed row gets
-- the new address: two identities for one person. Leave `auth.identities` stale
-- and a password reset mails the old address. Leave `public.members.login_name`
-- alone and `public.users.email` alone and the person can no longer sign in at
-- all, because `POST /api/auth/name` matches `login_name` first.
--
-- ONE TRANSACTION, NO PARTIAL RENAME. All four updates commit together or not at
-- all. `public.members` carries `AFTER UPDATE` trigger `audit_members_changes`,
-- which RAISEs (SQLSTATE 23000, "refusing to write an audit row without a
-- tenant") if it cannot resolve both a church and an actor. That is deliberate:
-- if this migration can produce a half-renamed member, the transaction must roll
-- back whole rather than commit an identity nobody can sign in to. This file
-- asserts both the tenant and the actor up front so that failure is a clear
-- message here rather than an opaque 23000 halfway through.
--
-- WHAT IS DELIBERATELY NOT TOUCHED:
--
--   * `encrypted_password`. The password hash is preserved verbatim. A rename is
--     not a re-provisioning; the member keeps the password they already know. If
--     this migration reset credentials, every Marilyn would be silently locked
--     out of a service they were rostered for.
--   * `email_confirmed_at`, and `email_verified` / `phone_verified` in both
--     `raw_user_meta_data` and `identity_data`. She has already proved she owns
--     this address; a rename proves nothing new about the person, so the
--     confirmation is carried across rather than re-requested. `email_confirmed`
--     is deliberately NOT set here either: clearing confirmation would force a
--     re-verification mail for a rename that changed no ownership.
--   * `public.users.role`, `is_active`, `auth_id`, `church_id`, `user_id` -- the
--     link between member, user and auth user is unchanged.
--   * Every other member, user and auth user in the database.
--
-- `user_metadata` gets its `login_name` key rewritten and nothing else. It is
-- written at creation as `{ member_id, login_name }` (name/route.ts:262) and is
-- never read back by any code in `src/`, so adding an `email` or `full_name` key
-- here would invent surface this rename does not need.
--
-- IDEMPOTENCE IS CHECKED FIRST, before the pre-conditions, so re-running an
-- applied migration is a clean no-op instead of a precondition failure.

DO $rename$
DECLARE
  c_church     CONSTANT UUID := 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  c_auth_uid   CONSTANT UUID := '095a4693-1572-4260-b55b-29d4570b83cb';
  c_user_id    CONSTANT UUID := 'd01e0dc0-6b71-4b42-9796-2c7a3e36959a';
  c_member_id  CONSTANT UUID := '1efd0d2b-6c7c-4aed-ac4c-cc58c13e3fda';

  c_old_login  CONSTANT TEXT  := 'marlyn';
  c_new_login  CONSTANT TEXT  := 'marilyn';
  c_old_name   CONSTANT TEXT  := 'Marlyn';
  c_new_name   CONSTANT TEXT  := 'Marilyn';
  c_old_email  CONSTANT TEXT  := 'marlyn.d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11@name-login.invalid';
  c_new_email  CONSTANT TEXT  := 'marilyn.d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11@name-login.invalid';

  v_member       RECORD;
  v_user         RECORD;
  v_auth         RECORD;
  v_identity     RECORD;
  v_member_found   BOOLEAN;
  v_user_found     BOOLEAN;
  v_auth_found     BOOLEAN;
  v_identity_found BOOLEAN;
  v_password     TEXT;
  v_confirmed_at TIMESTAMPTZ;
  v_meta_verified JSONB;
BEGIN
  -- -------------------------------------------------------------------------
  -- 1. Serialise concurrent applications of THIS migration
  -- -------------------------------------------------------------------------
  PERFORM pg_advisory_xact_lock(
    hashtextextended('johia:rename-marlyn-to-marilyn:20261002090200', 0)::bigint);

  -- -------------------------------------------------------------------------
  -- 2. Idempotence, checked BEFORE the pre-conditions
  -- -------------------------------------------------------------------------
  SELECT * INTO v_member FROM public.members WHERE id = c_member_id;
  v_member_found := FOUND;
  SELECT * INTO v_user   FROM public.users   WHERE id = c_user_id;
  v_user_found := FOUND;
  SELECT * INTO v_auth   FROM auth.users     WHERE id = c_auth_uid;
  v_auth_found := FOUND;
  SELECT * INTO v_identity FROM auth.identities
   WHERE user_id = c_auth_uid AND provider = 'email';
  v_identity_found := FOUND;

  IF v_member_found AND v_user_found AND v_auth_found AND v_identity_found
     AND v_member.full_name = c_new_name
     AND v_member.login_name = c_new_login
     AND v_user.full_name = c_new_name
     AND v_user.email = c_new_email
     AND v_auth.email = c_new_email
     AND v_identity.identity_data->>'email' = c_new_email THEN
    RAISE NOTICE 'marlyn -> marilyn: already applied on all four surfaces; no-op.';
    RETURN;
  END IF;

  -- -------------------------------------------------------------------------
  -- 3. Pre-conditions: the database must look like the one this was written for
  -- -------------------------------------------------------------------------
  IF NOT v_member_found THEN
    RAISE EXCEPTION 'rename aborted: member % does not exist.', c_member_id;
  END IF;
  IF v_member.church_id IS DISTINCT FROM c_church THEN
    RAISE EXCEPTION 'rename aborted: member % is in church %, expected %.', c_member_id, v_member.church_id, c_church;
  END IF;
  IF v_member.full_name IS DISTINCT FROM c_old_name OR v_member.login_name IS DISTINCT FROM c_old_login THEN
    RAISE EXCEPTION 'rename aborted: member % is %/% , expected %/%.',
      c_member_id, v_member.full_name, v_member.login_name, c_old_name, c_old_login;
  END IF;

  IF NOT v_user_found THEN
    RAISE EXCEPTION 'rename aborted: public.users row % does not exist.', c_user_id;
  END IF;
  IF v_user.church_id IS DISTINCT FROM c_church THEN
    RAISE EXCEPTION 'rename aborted: public.users row % is in church %, expected %.', c_user_id, v_user.church_id, c_church;
  END IF;
  IF v_user.auth_id IS DISTINCT FROM c_auth_uid THEN
    RAISE EXCEPTION 'rename aborted: public.users row % points at auth user %, expected %.',
      c_user_id, v_user.auth_id, c_auth_uid;
  END IF;
  IF v_user.full_name IS DISTINCT FROM c_old_name OR v_user.email IS DISTINCT FROM c_old_email THEN
    RAISE EXCEPTION 'rename aborted: public.users row % is %/% , expected %/%.',
      c_user_id, v_user.full_name, v_user.email, c_old_name, c_old_email;
  END IF;

  IF NOT v_auth_found THEN
    RAISE EXCEPTION 'rename aborted: auth user % does not exist.', c_auth_uid;
  END IF;
  IF v_auth.email IS DISTINCT FROM c_old_email THEN
    RAISE EXCEPTION 'rename aborted: auth user % has email %, expected %.', c_auth_uid, v_auth.email, c_old_email;
  END IF;
  -- The member row must actually point at this user, or the rename would fix a
  -- person who cannot sign in while breaking the one who can.
  IF (SELECT m.user_id FROM public.members m WHERE m.id = c_member_id) IS DISTINCT FROM c_user_id THEN
    RAISE EXCEPTION 'rename aborted: member % does not point at public.users row %.', c_member_id, c_user_id;
  END IF;

  IF NOT v_identity_found THEN
    RAISE EXCEPTION 'rename aborted: auth user % has no email identity.', c_auth_uid;
  END IF;
  IF v_identity.identity_data->>'email' IS DISTINCT FROM c_old_email THEN
    RAISE EXCEPTION 'rename aborted: auth identity for % holds %, expected %.',
      c_auth_uid, v_identity.identity_data->>'email', c_old_email;
  END IF;

  -- `public.members` has `UNIQUE (church_id, login_name)`. Assert the destination
  -- is free so the failure names the collision instead of surfacing a raw 23505
  -- from inside the UPDATE.
  IF EXISTS (SELECT 1 FROM public.members m
             WHERE m.church_id = c_church AND m.login_name = c_new_login AND m.id <> c_member_id) THEN
    RAISE EXCEPTION 'rename aborted: another member in church % already has login_name %.', c_church, c_new_login;
  END IF;

  -- No unique index on `public.users.email` and none on the auth email beyond
  -- GoTrue's own UNIQUE, but a collision would be a silent second identity, so
  -- both destinations are asserted free on every surface.
  IF EXISTS (SELECT 1 FROM public.users u WHERE u.email = c_new_email AND u.id <> c_user_id) THEN
    RAISE EXCEPTION 'rename aborted: public.users already holds email %.', c_new_email;
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users a WHERE a.email = c_new_email AND a.id <> c_auth_uid) THEN
    RAISE EXCEPTION 'rename aborted: auth.users already holds email %.', c_new_email;
  END IF;

  -- `log_audit_change` aborts the whole transaction (23000) when it cannot
  -- resolve an actor, so the actor this UPDATE will be attributed to is checked
  -- here, up front, rather than discovered as a mid-transaction failure.
  IF NOT EXISTS (SELECT 1 FROM public.users
                  WHERE id = '00000000-0000-0000-0000-000000000000'::UUID) THEN
    RAISE EXCEPTION
      'rename aborted: the System Migration User (00000000-0000-0000-0000-000000000000) is missing, so audit_members_changes cannot attribute this update.';
  END IF;

  -- Capture the credentials this migration must NOT alter, to compare at the end.
  SELECT encrypted_password, email_confirmed_at, raw_user_meta_data
  INTO v_password, v_confirmed_at, v_meta_verified
  FROM auth.users WHERE id = c_auth_uid;

  -- -------------------------------------------------------------------------
  -- 4. The four surfaces, in one transaction
  -- -------------------------------------------------------------------------

  -- (1) auth.users: email moves, credentials do not. `email_confirmed_at` and
  --     `encrypted_password` are deliberately absent from the SET list.
  UPDATE auth.users
     SET email = c_new_email,
         raw_user_meta_data = jsonb_set(
           COALESCE(raw_user_meta_data, '{}'::jsonb), '{login_name}', to_jsonb(c_new_login), false)
   WHERE id = c_auth_uid;

  -- (2) auth.identities: `provider_id` is the user id for the email provider, so
  --     it is NOT rewritten -- only the cached address inside identity_data.
  --     jsonb_set touches the one key and leaves email_verified / phone_verified
  --     exactly as they were.
  UPDATE auth.identities
     SET identity_data = jsonb_set(COALESCE(identity_data, '{}'::jsonb), '{email}', to_jsonb(c_new_email), false)
   WHERE user_id = c_auth_uid AND provider = 'email';

  -- (3) public.users: the address the name-login flow actually signs in with.
  UPDATE public.users
     SET email = c_new_email, full_name = c_new_name
   WHERE id = c_user_id AND church_id = c_church;

  -- (4) public.members: the human-facing name and the login key. This UPDATE
  --     fires audit_members_changes, which writes the `members_updated` audit row
  --     for the old and new values under the System Migration User.
  UPDATE public.members
     SET full_name = c_new_name, login_name = c_new_login
   WHERE id = c_member_id AND church_id = c_church;

  -- -------------------------------------------------------------------------
  -- 5. Post-conditions: all four surfaces agree, credentials are intact
  -- -------------------------------------------------------------------------
  SELECT * INTO v_member FROM public.members WHERE id = c_member_id;
  IF v_member.full_name IS DISTINCT FROM c_new_name OR v_member.login_name IS DISTINCT FROM c_new_login THEN
    RAISE EXCEPTION 'rename post-condition failed: member is %/% , expected %/%.',
      v_member.full_name, v_member.login_name, c_new_name, c_new_login;
  END IF;

  SELECT * INTO v_user FROM public.users WHERE id = c_user_id;
  IF v_user.full_name IS DISTINCT FROM c_new_name OR v_user.email IS DISTINCT FROM c_new_email THEN
    RAISE EXCEPTION 'rename post-condition failed: public.users is %/% , expected %/%.',
      v_user.full_name, v_user.email, c_new_name, c_new_email;
  END IF;

  SELECT * INTO v_auth FROM auth.users WHERE id = c_auth_uid;
  IF v_auth.email IS DISTINCT FROM c_new_email THEN
    RAISE EXCEPTION 'rename post-condition failed: auth.users email is %.', v_auth.email;
  END IF;
  IF v_auth.encrypted_password IS DISTINCT FROM v_password THEN
    RAISE EXCEPTION 'rename post-condition failed: the password hash changed. A rename must never re-provision credentials.';
  END IF;
  IF v_auth.email_confirmed_at IS DISTINCT FROM v_confirmed_at THEN
    RAISE EXCEPTION 'rename post-condition failed: email_confirmed_at moved from % to %. A rename must not re-request verification.',
      v_confirmed_at, v_auth.email_confirmed_at;
  END IF;
  IF COALESCE(v_auth.raw_user_meta_data->>'member_id', '') IS DISTINCT
     FROM COALESCE(v_meta_verified->>'member_id', '') THEN
    RAISE EXCEPTION 'rename post-condition failed: user_metadata.member_id was altered.';
  END IF;
  IF COALESCE(v_auth.raw_user_meta_data->>'email_verified', '')
     IS DISTINCT FROM COALESCE(v_meta_verified->>'email_verified', '') THEN
    RAISE EXCEPTION 'rename post-condition failed: user_metadata.email_verified was altered.';
  END IF;
  IF v_auth.raw_user_meta_data->>'login_name' IS DISTINCT FROM c_new_login THEN
    RAISE EXCEPTION 'rename post-condition failed: user_metadata.login_name is %.', v_auth.raw_user_meta_data->>'login_name';
  END IF;

  SELECT * INTO v_identity FROM auth.identities
   WHERE user_id = c_auth_uid AND provider = 'email';
  IF v_identity.identity_data->>'email' IS DISTINCT FROM c_new_email THEN
    RAISE EXCEPTION 'rename post-condition failed: auth identity email is %.', v_identity.identity_data->>'email';
  END IF;
  IF v_identity.provider_id IS DISTINCT FROM c_auth_uid::text THEN
    RAISE EXCEPTION 'rename post-condition failed: auth identity provider_id moved; it must stay the user id.';
  END IF;

  -- The member still points at the same user, the same auth user, and the same
  -- role: a rename that changed who signs in is not a rename.
  IF (SELECT m.user_id FROM public.members m WHERE m.id = c_member_id) IS DISTINCT FROM c_user_id
     OR (SELECT u.auth_id FROM public.users u WHERE u.id = c_user_id) IS DISTINCT FROM c_auth_uid
     OR (SELECT u.role FROM public.users u WHERE u.id = c_user_id) IS DISTINCT FROM 'member' THEN
    RAISE EXCEPTION 'rename post-condition failed: the member/user/auth linkage or role changed.';
  END IF;

  -- No 'Marlyn' string survives anywhere it is authoritative.
  IF EXISTS (SELECT 1 FROM public.members m WHERE m.church_id = c_church AND m.login_name = c_old_login)
     OR EXISTS (SELECT 1 FROM public.users u WHERE u.email = c_old_email) THEN
    RAISE EXCEPTION 'rename post-condition failed: the old name or address still exists on an authoritative row.';
  END IF;

  RAISE NOTICE 'marlyn -> marilyn: applied on all four surfaces; password hash and email confirmation preserved.';
END;
$rename$;