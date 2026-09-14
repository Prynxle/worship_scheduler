-- Provide the existing audit trigger with a valid actor for server-side
-- migrations and name-login provisioning, where auth.uid() is null.
INSERT INTO users (id, auth_id, email, full_name, role, is_active, church_id)
SELECT
    '00000000-0000-0000-0000-000000000000'::UUID,
    NULL,
    'system@johiabankers.internal',
    'System Migration User',
    'admin',
    true,
    c.id
FROM churches c
WHERE c.name = 'JOHIA Bankers'
ON CONFLICT (id) DO NOTHING;

-- Complete links left behind by the first name-login attempt.
UPDATE members m
SET user_id = u.id
FROM users u
WHERE m.user_id IS NULL
  AND u.email LIKE '%@name-login.invalid'
  AND u.full_name = m.full_name
  AND u.church_id = m.church_id;
