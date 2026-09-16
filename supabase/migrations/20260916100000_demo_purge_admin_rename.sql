-- ============================================================================
-- Migration: demo_purge_admin_rename
-- Purpose: Purge the legacy demo seed data from the JOHIA Bankers church and
--          convert the remaining seed users into the real staff login
--          identities.
--
-- After this migration the database contains ONLY the truth:
--   * Deletes the legacy demo users/members (David Kim, Emily Chen, Michael
--     Brown, Grace Lee, Thomas Wright, Rachel Adams) and their demo services,
--     assignments, roles, skills, devotion rows, audit rows, and notifications.
--   * Renames the admin seed row to 'Developer' (username johiaapp).
--   * Repurposes Sarah Wilson's coordinator row (never deleted) to
--     'Coordinator Zedrick' (username coordzed, email coordzed@johiabankers.com)
--     and inserts 'Coordinator Marilyn' (username coordmarilyn, email
--     coordmarilyn@johiabankers.com) with a deterministic id.
--   * Clears the fake seed auth_id values so real Supabase Auth identities are
--     provisioned lazily on first staff sign-in (see src/lib/auth/staff-login.ts).
--   * Normalizes member display names to the roster truth (Kass, Zedrick).
--
-- Passwords are never stored in this migration or anywhere in the application
-- schema. Staff passwords live only in Supabase Auth (hashed) and come from
-- environment variables at runtime (ADMIN_LOGIN_PASSWORD,
-- COORDINATOR_LOGIN_PASSWORD). Usernames are stored in users.username but
-- credentials are not.
--
-- The System Migration User (00000000-0000-0000-0000-000000000000) is never
-- deleted.
--
-- This file is designed to run as a single transaction. The three audit
-- triggers are disabled FIRST so the data purge does not write rows into
-- audit_logs (the zero-UUID church fallback in the trigger would abort the
-- assignment deletes). They are re-enabled symmetrically LAST. A failure
-- mid-migration rolls the whole change back because the transaction aborts.
--
-- Manual recovery if this migration fails partway through (for example after
-- applying statements one-by-one outside a transaction): re-enable the audit
-- triggers by hand with:
--   ALTER TABLE members ENABLE TRIGGER audit_members_changes;
--   ALTER TABLE services ENABLE TRIGGER audit_services_changes;
--   ALTER TABLE schedule_assignments ENABLE TRIGGER audit_assignments_changes;
-- Otherwise, full rollback requires restoring a database snapshot taken before
-- this migration; renaming/deleting data is not reversible by running SQL in
-- reverse.
-- ============================================================================

-- ============================================================================
-- Capture the legacy demo ids for the purge while their rows still exist.
-- Deletes below are resolved by login_name/email (church-scoped) instead of
-- hardcoding stale UUIDs; the audit_logs cleanup runs AFTER the members are
-- deleted, so ids are pinned at the start of the transaction.
-- ============================================================================
CREATE TEMP TABLE demo_purge_member_ids AS
SELECT m.id
FROM members m
JOIN churches c ON c.id = m.church_id
WHERE c.name = 'JOHIA Bankers'
  AND m.login_name IN ('dave', 'em', 'mike', 'grace', 'tom', 'rachel');

CREATE TEMP TABLE demo_purge_service_ids AS
SELECT s.id
FROM services s
JOIN churches c ON c.id = s.church_id
WHERE c.name = 'JOHIA Bankers'
  AND s.id IN (
      '11111111-1111-1111-1111-111111111101'::UUID,
      '11111111-1111-1111-1111-111111111102'::UUID,
      '11111111-1111-1111-1111-111111111103'::UUID,
      '11111111-1111-1111-1111-111111111104'::UUID
  );

-- ============================================================================
-- Schema: staff username column
-- ============================================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(100);

CREATE UNIQUE INDEX IF NOT EXISTS users_church_username_unique_idx
    ON users (church_id, username)
    WHERE username IS NOT NULL;

-- ============================================================================
-- Disable audit triggers before the data purge (see header notes).
-- ============================================================================
ALTER TABLE schedule_assignments DISABLE TRIGGER audit_assignments_changes;
ALTER TABLE services DISABLE TRIGGER audit_services_changes;
ALTER TABLE members DISABLE TRIGGER audit_members_changes;

-- ============================================================================
-- DELETE ORDER (exact): dependent child rows before parents.
-- ============================================================================

-- 1. Assignments for demo services and any assignments referencing demo members.
DELETE FROM schedule_assignments
WHERE member_id IN (SELECT id FROM demo_purge_member_ids);

DELETE FROM schedule_assignments
WHERE service_id IN (SELECT id FROM demo_purge_service_ids);

-- 2. Demo services.
DELETE FROM services
WHERE id IN (SELECT id FROM demo_purge_service_ids);

-- 3. Demo member roles.
DELETE FROM member_roles
WHERE member_id IN (SELECT id FROM demo_purge_member_ids);

-- 4. Demo member skills.
DELETE FROM member_skills
WHERE member_id IN (SELECT id FROM demo_purge_member_ids);

-- 5. Demo availability.
DELETE FROM availability
WHERE member_id IN (SELECT id FROM demo_purge_member_ids);

-- 6. Demo devotion rotation entries.
DELETE FROM devotion_rotation
WHERE member_id IN (SELECT id FROM demo_purge_member_ids);

-- 7. Demo members.
DELETE FROM members
WHERE id IN (SELECT id FROM demo_purge_member_ids);

-- 8. Legacy audit rows: those written by/for the deleted users and those whose
--    entity_id belongs to the deleted demo members/services.
DELETE FROM audit_logs
WHERE user_id IN (
    SELECT u.id
    FROM users u
    JOIN churches c ON c.id = u.church_id
    WHERE c.name = 'JOHIA Bankers'
      AND u.email IN (
          'member1@johiabankers.com',
          'member2@johiabankers.com',
          'member3@johiabankers.com'
      )
)
   OR entity_id IN (SELECT id FROM demo_purge_member_ids)
   OR entity_id IN (SELECT id FROM demo_purge_service_ids);

-- 9. Notifications for the demo users.
DELETE FROM notifications
WHERE user_id IN (
    SELECT u.id
    FROM users u
    JOIN churches c ON c.id = u.church_id
    WHERE c.name = 'JOHIA Bankers'
      AND u.email IN (
          'member1@johiabankers.com',
          'member2@johiabankers.com',
          'member3@johiabankers.com'
      )
);

-- 10. Demo users (member login users only) — deleted last after their
--     dependent rows are gone.
DELETE FROM users
WHERE id IN (
    SELECT u.id
    FROM users u
    JOIN churches c ON c.id = u.church_id
    WHERE c.name = 'JOHIA Bankers'
      AND u.email IN (
          'member1@johiabankers.com',
          'member2@johiabankers.com',
          'member3@johiabankers.com'
      )
);

-- ============================================================================
-- Identity changes: real staff accounts.
-- ============================================================================

-- Rename the admin seed row to the Developer login identity. The auth_id is
-- cleared so the first staff sign-in lazily provisions the real Supabase Auth
-- identity (or resets an existing one via the interrupted-attempt recovery path
-- in the auth route). Match by deterministic seed UUID instead of email, which
-- may already have been changed to the auth-email form before this migration
-- runs (admin@johiabankers.com → johiaapp@johiabankers.com).
UPDATE users u
SET full_name = 'Developer',
    username = 'johiaapp',
    email = 'johiaapp@johiabankers.com',
    auth_id = NULL
FROM churches c
WHERE c.id = u.church_id
  AND c.name = 'JOHIA Bankers'
  AND u.id = 'e1eebc99-9c0b-4ef8-bb6d-6bb9bd380a01'::UUID;

-- Repurpose the Sarah Wilson seed row (never deleted) into the Coordinator
-- Zedrick login identity.
UPDATE users u
SET full_name = 'Coordinator Zedrick',
    username = 'coordzed',
    auth_id = NULL,
    email = 'coordzed@johiabankers.com'
FROM churches c
WHERE c.id = u.church_id
  AND c.name = 'JOHIA Bankers'
  AND u.email = 'coordinator@johiabankers.com';

-- Insert the Coordinator Marilyn login identity with a deterministic id so
-- the app and future migrations can rely on it.
INSERT INTO users (id, auth_id, email, full_name, role, is_active, church_id, username)
SELECT
    'e1eebc99-9c0b-4ef8-bb6d-6bb9bd380a09'::UUID,
    NULL,
    'coordmarilyn@johiabankers.com',
    'Coordinator Marilyn',
    'coordinator',
    true,
    c.id,
    'coordmarilyn'
FROM churches c
WHERE c.name = 'JOHIA Bankers'
ON CONFLICT (id) DO NOTHING;

-- Normalize member display names to the roster truth (Kass, Zedrick).
-- login_name stays 'kass' / 'zedrick'; the full_name guard keeps this
-- migration idempotent after the first application.
UPDATE members m
SET full_name = 'Kass'
FROM churches c
WHERE c.id = m.church_id
  AND c.name = 'JOHIA Bankers'
  AND m.login_name = 'kass'
  AND m.full_name = 'Kassahun Tesfaye';

UPDATE members m
SET full_name = 'Zedrick'
FROM churches c
WHERE c.id = m.church_id
  AND c.name = 'JOHIA Bankers'
  AND m.login_name = 'zedrick'
  AND m.full_name = 'Zedrick Paul';

-- ============================================================================
-- Re-enable audit triggers symmetrically last.
-- ============================================================================
ALTER TABLE members ENABLE TRIGGER audit_members_changes;
ALTER TABLE services ENABLE TRIGGER audit_services_changes;
ALTER TABLE schedule_assignments ENABLE TRIGGER audit_assignments_changes;