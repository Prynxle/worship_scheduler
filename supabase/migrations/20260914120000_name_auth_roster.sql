-- ============================================================================
-- Migration: name_auth_roster
-- Purpose: Add case-insensitive name login support and seed the JOHIA roster.
--
-- Name login is intentionally a lightweight identification flow. It is not
-- suitable for sensitive deployments without a second factor or password.
-- ============================================================================

ALTER TABLE members
    ADD COLUMN IF NOT EXISTS login_name VARCHAR(100);

-- This migration runs without auth.uid(). The existing audit trigger uses a
-- placeholder user ID in that case, which violates audit_logs.user_id's FK.
-- Keep auditing enabled for normal application writes after this migration.
ALTER TABLE members DISABLE TRIGGER audit_members_changes;

UPDATE members
SET login_name = CASE
    WHEN lower(full_name) = 'kassahun tesfaye' THEN 'kass'
    WHEN lower(full_name) = 'zedrick paul' THEN 'zedrick'
    ELSE lower(regexp_replace(trim(coalesce(nickname, full_name)), '\\s+', ' ', 'g'))
END
WHERE login_name IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_members_church_login_name
    ON members (church_id, login_name);

INSERT INTO roles (ministry_id, name, description, min_required, max_allowed, priority)
SELECT m.id, v.name, v.description, 0, 99, v.priority
FROM ministries m
CROSS JOIN (VALUES
    ('Instrumentalist', 'Worship team instrumentalists', 6),
    ('Backup', 'Worship team backup members', 7)
) AS v(name, description, priority)
WHERE m.name = 'Worship Team'
  AND NOT EXISTS (
      SELECT 1 FROM roles r WHERE r.ministry_id = m.id AND r.name = v.name
  );

WITH roster(name, role_name) AS (
    VALUES
        ('Zedrick', 'Instrumentalist'), ('Kass', 'Instrumentalist'),
        ('Simone', 'Instrumentalist'), ('Mat', 'Instrumentalist'),
        ('Kai', 'Instrumentalist'), ('Pia', 'Instrumentalist'),
        ('Lom', 'Instrumentalist'), ('Ivan', 'Instrumentalist'),
        ('Chelzy', 'Instrumentalist'), ('Caleb', 'Instrumentalist'),
        ('Marlyn', 'Backup'), ('Feng', 'Backup'), ('Heidi', 'Backup'),
        ('Dhon', 'Backup'), ('Sam', 'Backup'), ('Maricar', 'Backup'),
        ('Beng', 'Backup'), ('Princess', 'Backup'), ('Shael', 'Backup'),
        ('Kai', 'Backup'),
        ('Feng', 'Worship Leader'), ('Heidi', 'Worship Leader'),
        ('Princess', 'Worship Leader'), ('Dhon', 'Worship Leader'),
        ('Marlyn', 'Worship Leader'), ('Shael', 'Worship Leader')
), church AS (
    SELECT id FROM churches WHERE name = 'JOHIA Bankers' LIMIT 1
), worship AS (
    SELECT d.id AS department_id, d.church_id
    FROM departments d
    JOIN church c ON c.id = d.church_id
    WHERE d.name = 'Worship'
    LIMIT 1
), names AS (
    SELECT DISTINCT lower(name) AS login_name, initcap(name) AS full_name
    FROM roster
)
INSERT INTO members (church_id, department_id, full_name, login_name, status, max_monthly_assignments, priority_score)
SELECT w.church_id, w.department_id, n.full_name, n.login_name, 'active', 3, 50
FROM names n
CROSS JOIN worship w
WHERE NOT EXISTS (
    SELECT 1 FROM members existing
    WHERE existing.church_id = w.church_id
      AND existing.login_name = n.login_name
);

WITH roster(name, role_name) AS (
    VALUES
        ('Zedrick', 'Instrumentalist'), ('Kass', 'Instrumentalist'),
        ('Simone', 'Instrumentalist'), ('Mat', 'Instrumentalist'),
        ('Kai', 'Instrumentalist'), ('Pia', 'Instrumentalist'),
        ('Lom', 'Instrumentalist'), ('Ivan', 'Instrumentalist'),
        ('Chelzy', 'Instrumentalist'), ('Caleb', 'Instrumentalist'),
        ('Marlyn', 'Backup'), ('Feng', 'Backup'), ('Heidi', 'Backup'),
        ('Dhon', 'Backup'), ('Sam', 'Backup'), ('Maricar', 'Backup'),
        ('Beng', 'Backup'), ('Princess', 'Backup'), ('Shael', 'Backup'),
        ('Kai', 'Backup'),
        ('Feng', 'Worship Leader'), ('Heidi', 'Worship Leader'),
        ('Princess', 'Worship Leader'), ('Dhon', 'Worship Leader'),
        ('Marlyn', 'Worship Leader'), ('Shael', 'Worship Leader')
)
INSERT INTO member_roles (member_id, role_id, skill_level, is_preferred)
SELECT m.id, r.id,
       CASE WHEN r.name = 'Worship Leader' THEN 'advanced' ELSE 'intermediate' END,
       r.name = 'Worship Leader'
FROM roster x
JOIN members m ON m.login_name = lower(x.name)
JOIN roles r ON r.name = x.role_name
JOIN ministries ministry ON ministry.id = r.ministry_id
WHERE ministry.name = 'Worship Team'
ON CONFLICT (member_id, role_id) DO NOTHING;

COMMENT ON COLUMN members.login_name IS
    'Canonical case-insensitive name used by the lightweight name login flow.';

ALTER TABLE members ENABLE TRIGGER audit_members_changes;
