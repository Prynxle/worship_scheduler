-- ============================================================================
-- Migration: member_truth_values
-- Purpose: JOHIA roster truth values for member skills and roles.
--
-- Writes the coordinator's roster truth values into the database for the
-- church 'JOHIA Bankers' and its 'Worship Team' ministry:
--   A. Creates canonical instruments Guitar 1 / Guitar 2 / Bass (Piano and
--      Drums already exist and are resolved by name, never duplicated).
--   B. Inserts 17 instrument skill rows (member_skills) resolved via
--      members.login_name + instruments.name.
--   C. Inserts the 2 missing role rows (member_roles): Chelzy -> Backup and
--      Dhon -> Instrumentalist.
--   D. Deletes the exact 5 legacy rows that contradict the truth values
--      (4 member_roles + 1 member_skills for Kass and Zedrick).
--
-- All IDs are resolved via joins on names. No UUIDs are fabricated. Every
-- insert uses ON CONFLICT ... DO NOTHING for idempotency and safety.
--
-- Rollback: full DB rollback requires a compensating reverse migration that
-- re-inserts the five deleted rows and removes the three instruments if
-- unused; removing the file alone does not restore data.
--
-- Known operational note: an existing published demo service (2026-07-12)
-- assigned Kass as Worship Leader; after this migration re-validating it
-- produces a correct role_validation critical — expected, flagged as
-- follow-up.
--
-- Out of scope (documented warnings only, NOT fixed here):
--   * Pre-existing engine 'Singer' backup-filter mismatch.
--   * Stale published demo schedules referencing legacy roles.
--   * Legacy demo members (David Kim, Emily Chen, Michael Brown, Grace Lee,
--     Tom, Rachel) and legacy instruments (Electric Guitar, Acoustic Guitar,
--     Keyboard) are intentionally not touched.
-- ============================================================================

-- ============================================================================
-- Step A: Canonical instruments (idempotent)
-- Creates 'Guitar 1', 'Guitar 2', 'Bass' under the 'Worship Team' ministry of
-- 'JOHIA Bankers'. 'Piano' and 'Drums' already exist and are NOT re-created.
-- ============================================================================
INSERT INTO instruments (ministry_id, name, description, is_required, min_count, max_count)
SELECT m.id, v.name, v.description, v.is_required, v.min_count, v.max_count
FROM churches c
JOIN ministries m ON m.church_id = c.id
CROSS JOIN (VALUES
    ('Guitar 1', 'Lead guitar', true::boolean, 1, 1),
    ('Guitar 2', 'Second guitar', false::boolean, 0, 1),
    ('Bass',     'Bass guitar',   true::boolean, 1, 1)
) AS v(name, description, is_required, min_count, max_count)
WHERE c.name = 'JOHIA Bankers'
  AND m.name = 'Worship Team'
  AND NOT EXISTS (
      SELECT 1 FROM instruments i
      WHERE i.ministry_id = m.id AND i.name = v.name
  );

-- ============================================================================
-- Step B: Instrument skills (member_skills) — 17 rows total.
-- Kass -> Piano is included as an idempotent no-op (already exists from the
-- legacy seed as 'expert'; truth value does not replace it).
-- ============================================================================
WITH skills(name, instrument_name) AS (
    VALUES
        ('Zedrick', 'Guitar 1'),
        ('Zedrick', 'Guitar 2'),
        ('Zedrick', 'Piano'),
        ('Zedrick', 'Bass'),
        ('Pia',     'Guitar 2'),
        ('Kass',    'Piano'),
        ('Lom',     'Bass'),
        ('Simone',  'Drums'),
        ('Chelzy',  'Piano'),
        ('Mat',     'Guitar 1'),
        ('Mat',     'Guitar 2'),
        ('Mat',     'Bass'),
        ('Ivan',    'Guitar 1'),
        ('Ivan',    'Guitar 2'),
        ('Kai',     'Guitar 2'),
        ('Caleb',   'Bass'),
        ('Dhon',    'Bass')
)
INSERT INTO member_skills (member_id, instrument_id, skill_level, is_primary, fallback_member_id)
SELECT mb.id, i.id, 'advanced', true, NULL
FROM skills s
JOIN members mb ON mb.login_name = lower(s.name)
JOIN churches c ON c.id = mb.church_id
JOIN ministries m ON m.church_id = c.id AND m.name = 'Worship Team'
JOIN instruments i ON i.ministry_id = m.id AND i.name = s.instrument_name
WHERE c.name = 'JOHIA Bankers'
ON CONFLICT (member_id, instrument_id) DO NOTHING;

-- ============================================================================
-- Step C: Role rows (member_roles) — exactly 2 rows.
-- 'Backup' and 'Instrumentalist' roles already exist (created in
-- 20260914120000_name_auth_roster.sql) under the 'Worship Team' ministry.
-- ============================================================================
WITH roster_roles(name, role_name) AS (
    VALUES
        ('Chelzy', 'Backup'),
        ('Dhon',   'Instrumentalist')
)
INSERT INTO member_roles (member_id, role_id, skill_level, is_preferred)
SELECT mb.id, r.id, 'intermediate', false
FROM roster_roles x
JOIN members mb ON mb.login_name = lower(x.name)
JOIN churches c ON c.id = mb.church_id
JOIN ministries m ON m.church_id = c.id AND m.name = 'Worship Team'
JOIN roles r ON r.ministry_id = m.id AND r.name = x.role_name
WHERE c.name = 'JOHIA Bankers'
ON CONFLICT (member_id, role_id) DO NOTHING;

-- ============================================================================
-- Step D: Delete contradicting legacy rows (exactly 5 rows total).
-- 4 member_roles: Kass -> 'Worship Leader', Kass -> 'Pianist/Keyboard',
--                 Zedrick -> 'Pianist/Keyboard', Zedrick -> 'Drummer'
-- 1 member_skills: Zedrick -> 'Keyboard'
--
-- Scoped exactly: church 'JOHIA Bankers' + members.login_name + role/instrument
-- name within the 'Worship Team' ministry. Legacy demo members and their rows
-- are NOT touched (their login_names are dave/em/mike/grace/tom/rachel).
-- ============================================================================
-- Expected affected rows: 4 (member_roles)
DELETE FROM member_roles mr
USING members mb
JOIN churches c ON c.id = mb.church_id
JOIN ministries m ON m.church_id = c.id AND m.name = 'Worship Team'
JOIN roles r ON r.ministry_id = m.id
WHERE mr.member_id = mb.id
  AND mr.role_id = r.id
  AND c.name = 'JOHIA Bankers'
  AND mb.login_name IN ('kass', 'zedrick')
  AND r.name IN ('Worship Leader', 'Pianist/Keyboard', 'Drummer');

-- Expected affected rows: 1 (member_skills)
DELETE FROM member_skills ms
USING members mb
JOIN churches c ON c.id = mb.church_id
JOIN ministries m ON m.church_id = c.id AND m.name = 'Worship Team'
JOIN instruments i ON i.ministry_id = m.id
WHERE ms.member_id = mb.id
  AND ms.instrument_id = i.id
  AND c.name = 'JOHIA Bankers'
  AND mb.login_name = 'zedrick'
  AND i.name = 'Keyboard';