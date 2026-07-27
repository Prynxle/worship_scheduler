-- ============================================================================
-- Migration: 010_seed_data
-- Created: 2026-07-27
-- Purpose: Seed initial demo data for testing the scheduling system
--          Creates a sample church with departments, ministries, roles,
--          members, and initial configuration for development/preview.
-- ============================================================================

-- ============================================================================
-- DEMO CHURCH
-- ============================================================================
INSERT INTO churches (id, name, address, city, country, phone, email, settings)
VALUES (
    'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID,
    'JOHIA Bankers',
    '123 Grace Avenue',
    'Springfield',
    'United States',
    '+1-555-0123',
    'admin@johiabankers.com',
    '{
        "default_max_monthly_assignments": 3,
        "default_min_backup_singers": 3,
        "default_max_backup_singers": 5,
        "cooldown_weeks": 1,
        "enable_fairness": true,
        "enable_cooldown": true,
        "enable_leader_rotation": true
    }'::jsonb
);

-- ============================================================================
-- DEPARTMENTS
-- ============================================================================
INSERT INTO departments (id, church_id, name, description)
VALUES
    ('a1eebc99-9c0b-4ef8-bb6d-6bb9bd380a12'::UUID, 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, 'Worship', 'Music and worship ministry'),
    ('a1eebc99-9c0b-4ef8-bb6d-6bb9bd380a13'::UUID, 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, 'Media', 'Sound and media production'),
    ('a1eebc99-9c0b-4ef8-bb6d-6bb9bd380a14'::UUID, 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, 'Prayer', 'Prayer ministry and intercession');

-- ============================================================================
-- MINISTRIES
-- ============================================================================
INSERT INTO ministries (id, church_id, name, description, config, priority, is_active)
VALUES
    ('b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, 'Worship Team', 'Sunday worship team', '{"min_members": 3, "max_members": 8, "requires_leader": true, "allows_dual_role": false, "auto_generate": true}'::jsonb, 1, true),
    ('b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a12'::UUID, 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, 'Sound Team', 'Sound and AV team', '{"min_members": 1, "max_members": 3, "requires_leader": false, "allows_dual_role": true, "auto_generate": true}'::jsonb, 2, true),
    ('b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a13'::UUID, 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, 'Devotion', 'Monthly devotion leader', '{"min_members": 1, "max_members": 1, "requires_leader": true, "allows_dual_role": false, "auto_generate": true}'::jsonb, 3, true);

-- ============================================================================
-- ROLES
-- ============================================================================
INSERT INTO roles (id, ministry_id, name, description, min_required, max_allowed, priority)
VALUES
    ('c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, 'Worship Leader', 'Leads the worship team', 1, 1, 1),
    ('c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a12'::UUID, 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, 'Vocalist', 'Background vocalist', 3, 5, 2),
    ('c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a13'::UUID, 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, 'Guitarist', 'Electric or acoustic guitar', 1, 2, 3),
    ('c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a14'::UUID, 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, 'Drummer', 'Percussion', 1, 1, 4),
    ('c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a15'::UUID, 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, 'Pianist/Keyboard', 'Keys', 1, 1, 5),
    ('c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a16'::UUID, 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a12'::UUID, 'Sound Engineer', 'Operates sound system', 1, 2, 1),
    ('c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a17'::UUID, 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a13'::UUID, 'Devotion Leader', 'Leads monthly devotion', 1, 1, 1);

-- ============================================================================
-- INSTRUMENTS
-- ============================================================================
INSERT INTO instruments (id, ministry_id, name, description, is_required, min_count, max_count)
VALUES
    ('d1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, 'Electric Guitar', 'Primary guitar', true, 1, 2),
    ('d1eebc99-9c0b-4ef8-bb6d-6bb9bd380a12'::UUID, 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, 'Acoustic Guitar', 'Backup guitar', false, 0, 1),
    ('d1eebc99-9c0b-4ef8-bb6d-6bb9bd380a13'::UUID, 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, 'Drums', 'Drum kit', true, 1, 1),
    ('d1eebc99-9c0b-4ef8-bb6d-6bb9bd380a14'::UUID, 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, 'Piano', 'Grand or upright', true, 1, 1),
    ('d1eebc99-9c0b-4ef8-bb6d-6bb9bd380a15'::UUID, 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, 'Keyboard', 'Synthesizer', false, 0, 1);

-- ============================================================================
-- MINISTRY RULES
-- ============================================================================
INSERT INTO ministry_rules (ministry_id, rule_type, rule_config, severity, is_active)
VALUES
    ('b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, 'availability_check', '{}'::jsonb, 'critical', true),
    ('b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, 'assignment_limit', '{"max_monthly": 3}'::jsonb, 'critical', true),
    ('b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, 'backup_count', '{"min_backup_singers": 3}'::jsonb, 'critical', true),
    ('b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, 'leader_count', '{"count": 1}'::jsonb, 'critical', true),
    ('b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, 'cooldown', '{"weeks": 1}'::jsonb, 'warning', true),
    ('b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, 'fairness', '{}'::jsonb, 'suggestion', true),
    ('b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, 'leader_rotation', '{}'::jsonb, 'warning', true),
    ('b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, 'devotion_sequence', '{}'::jsonb, 'warning', true),
    ('b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, 'dual_role_check', '{}'::jsonb, 'critical', true);

-- ============================================================================
-- DEMO USERS (using fake auth_id UUIDs for testing)
-- ============================================================================
INSERT INTO users (id, auth_id, email, full_name, role, is_active, church_id)
VALUES
    ('e1eebc99-9c0b-4ef8-bb6d-6bb9bd380a01'::UUID, '00000000-0000-0000-0000-000000000001'::UUID, 'admin@johiabankers.com', 'Pastor James', 'admin', true, 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID),
    ('e1eebc99-9c0b-4ef8-bb6d-6bb9bd380a02'::UUID, '00000000-0000-0000-0000-000000000002'::UUID, 'coordinator@johiabankers.com', 'Sarah Wilson', 'coordinator', true, 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID),
    ('e1eebc99-9c0b-4ef8-bb6d-6bb9bd380a03'::UUID, '00000000-0000-0000-0000-000000000003'::UUID, 'member1@johiabankers.com', 'David Kim', 'member', true, 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID),
    ('e1eebc99-9c0b-4ef8-bb6d-6bb9bd380a04'::UUID, '00000000-0000-0000-0000-000000000004'::UUID, 'member2@johiabankers.com', 'Emily Chen', 'member', true, 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID),
    ('e1eebc99-9c0b-4ef8-bb6d-6bb9bd380a05'::UUID, '00000000-0000-0000-0000-000000000005'::UUID, 'member3@johiabankers.com', 'Michael Brown', 'member', true, 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID);

-- ============================================================================
-- DEMO MEMBERS
-- ============================================================================
INSERT INTO members (id, user_id, church_id, department_id, full_name, nickname, gender, phone, status, max_monthly_assignments, priority_score)
VALUES
    ('f1eebc99-9c0b-4ef8-bb6d-6bb9bd380a01'::UUID, 'e1eebc99-9c0b-4ef8-bb6d-6bb9bd380a03'::UUID, 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, 'a1eebc99-9c0b-4ef8-bb6d-6bb9bd380a12'::UUID, 'David Kim', 'Dave', 'male', '+1-555-1001', 'active', 3, 85),
    ('f1eebc99-9c0b-4ef8-bb6d-6bb9bd380a02'::UUID, 'e1eebc99-9c0b-4ef8-bb6d-6bb9bd380a04'::UUID, 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, 'a1eebc99-9c0b-4ef8-bb6d-6bb9bd380a12'::UUID, 'Emily Chen', 'Em', 'female', '+1-555-1002', 'active', 3, 75),
    ('f1eebc99-9c0b-4ef8-bb6d-6bb9bd380a03'::UUID, 'e1eebc99-9c0b-4ef8-bb6d-6bb9bd380a05'::UUID, 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, 'a1eebc99-9c0b-4ef8-bb6d-6bb9bd380a12'::UUID, 'Michael Brown', 'Mike', 'male', '+1-555-1003', 'active', 3, 70),
    ('f1eebc99-9c0b-4ef8-bb6d-6bb9bd380a04'::UUID, NULL, 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, 'a1eebc99-9c0b-4ef8-bb6d-6bb9bd380a12'::UUID, 'Kassahun Tesfaye', 'Kass', 'male', '+1-555-1004', 'active', 3, 90),
    ('f1eebc99-9c0b-4ef8-bb6d-6bb9bd380a05'::UUID, NULL, 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, 'a1eebc99-9c0b-4ef8-bb6d-6bb9bd380a12'::UUID, 'Zedrick Paul', 'Zed', 'male', '+1-555-1005', 'active', 3, 95),
    ('f1eebc99-9c0b-4ef8-bb6d-6bb9bd380a06'::UUID, NULL, 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, 'a1eebc99-9c0b-4ef8-bb6d-6bb9bd380a12'::UUID, 'Grace Lee', 'Grace', 'female', '+1-555-1006', 'active', 3, 65),
    ('f1eebc99-9c0b-4ef8-bb6d-6bb9bd380a07'::UUID, NULL, 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, 'a1eebc99-9c0b-4ef8-bb6d-6bb9bd380a12'::UUID, 'Thomas Wright', 'Tom', 'male', '+1-555-1007', 'active', 3, 60),
    ('f1eebc99-9c0b-4ef8-bb6d-6bb9bd380a08'::UUID, NULL, 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, 'a1eebc99-9c0b-4ef8-bb6d-6bb9bd380a12'::UUID, 'Rachel Adams', 'Rachel', 'female', '+1-555-1008', 'active', 3, 55);

-- ============================================================================
-- MEMBER ROLES (what each member can do)
-- ============================================================================
INSERT INTO member_roles (member_id, role_id, skill_level, is_preferred)
VALUES
    ('f1eebc99-9c0b-4ef8-bb6d-6bb9bd380a01'::UUID, 'c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, 'expert', true),
    ('f1eebc99-9c0b-4ef8-bb6d-6bb9bd380a01'::UUID, 'c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a12'::UUID, 'advanced', false),
    ('f1eebc99-9c0b-4ef8-bb6d-6bb9bd380a02'::UUID, 'c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a12'::UUID, 'expert', true),
    ('f1eebc99-9c0b-4ef8-bb6d-6bb9bd380a02'::UUID, 'c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a13'::UUID, 'advanced', false),
    ('f1eebc99-9c0b-4ef8-bb6d-6bb9bd380a03'::UUID, 'c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a13'::UUID, 'expert', true),
    ('f1eebc99-9c0b-4ef8-bb6d-6bb9bd380a03'::UUID, 'c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a12'::UUID, 'intermediate', false),
    ('f1eebc99-9c0b-4ef8-bb6d-6bb9bd380a04'::UUID, 'c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a15'::UUID, 'expert', true),
    ('f1eebc99-9c0b-4ef8-bb6d-6bb9bd380a04'::UUID, 'c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, 'advanced', false),
    ('f1eebc99-9c0b-4ef8-bb6d-6bb9bd380a05'::UUID, 'c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a15'::UUID, 'advanced', true),
    ('f1eebc99-9c0b-4ef8-bb6d-6bb9bd380a05'::UUID, 'c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a14'::UUID, 'intermediate', false),
    ('f1eebc99-9c0b-4ef8-bb6d-6bb9bd380a06'::UUID, 'c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a12'::UUID, 'intermediate', true),
    ('f1eebc99-9c0b-4ef8-bb6d-6bb9bd380a07'::UUID, 'c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a12'::UUID, 'advanced', true),
    ('f1eebc99-9c0b-4ef8-bb6d-6bb9bd380a08'::UUID, 'c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a12'::UUID, 'beginner', true);

-- ============================================================================
-- MEMBER SKILLS (instruments)
-- ============================================================================
INSERT INTO member_skills (member_id, instrument_id, skill_level, is_primary)
VALUES
    ('f1eebc99-9c0b-4ef8-bb6d-6bb9bd380a01'::UUID, 'd1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, 'advanced', true),
    ('f1eebc99-9c0b-4ef8-bb6d-6bb9bd380a02'::UUID, 'd1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, 'advanced', true),
    ('f1eebc99-9c0b-4ef8-bb6d-6bb9bd380a03'::UUID, 'd1eebc99-9c0b-4ef8-bb6d-6bb9bd380a12'::UUID, 'expert', true),
    ('f1eebc99-9c0b-4ef8-bb6d-6bb9bd380a04'::UUID, 'd1eebc99-9c0b-4ef8-bb6d-6bb9bd380a14'::UUID, 'expert', true),
    ('f1eebc99-9c0b-4ef8-bb6d-6bb9bd380a05'::UUID, 'd1eebc99-9c0b-4ef8-bb6d-6bb9bd380a15'::UUID, 'advanced', true);

-- ============================================================================
-- DEVOTION ROTATION (sequential order)
-- ============================================================================
INSERT INTO devotion_rotation (church_id, member_id, position, is_active)
VALUES
    ('d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, 'f1eebc99-9c0b-4ef8-bb6d-6bb9bd380a04'::UUID, 1, true),
    ('d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, 'f1eebc99-9c0b-4ef8-bb6d-6bb9bd380a05'::UUID, 2, true),
    ('d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, 'f1eebc99-9c0b-4ef8-bb6d-6bb9bd380a01'::UUID, 3, true),
    ('d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, 'f1eebc99-9c0b-4ef8-bb6d-6bb9bd380a02'::UUID, 4, true),
    ('d0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, 'f1eebc99-9c0b-4ef8-bb6d-6bb9bd380a03'::UUID, 5, true);

-- ============================================================================
-- DEMO SERVICES (July 2026)
-- ============================================================================
INSERT INTO services (id, church_id, date, week_number, month, year, service_type, status, generated_by)
VALUES
    ('11111111-1111-1111-1111-111111111101'::UUID, 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, '2026-07-05', 1, 6, 2026, 'sunday', 'published', 'e1eebc99-9c0b-4ef8-bb6d-6bb9bd380a02'::UUID),
    ('11111111-1111-1111-1111-111111111102'::UUID, 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, '2026-07-12', 2, 6, 2026, 'sunday', 'published', 'e1eebc99-9c0b-4ef8-bb6d-6bb9bd380a02'::UUID),
    ('11111111-1111-1111-1111-111111111103'::UUID, 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, '2026-07-19', 3, 6, 2026, 'sunday', 'validated', 'e1eebc99-9c0b-4ef8-bb6d-6bb9bd380a02'::UUID),
    ('11111111-1111-1111-1111-111111111104'::UUID, 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, '2026-07-26', 4, 6, 2026, 'sunday', 'draft', 'e1eebc99-9c0b-4ef8-bb6d-6bb9bd380a02'::UUID);

-- ============================================================================
-- DEMO ASSIGNMENTS (for first two services)
-- ============================================================================

-- Service 1 (July 5)
INSERT INTO schedule_assignments (service_id, member_id, role_id, instrument_id, is_leader, status, assigned_by)
VALUES
    ('11111111-1111-1111-1111-111111111101'::UUID, 'f1eebc99-9c0b-4ef8-bb6d-6bb9bd380a01'::UUID, 'c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, NULL, true, 'confirmed', 'e1eebc99-9c0b-4ef8-bb6d-6bb9bd380a02'::UUID),
    ('11111111-1111-1111-1111-111111111101'::UUID, 'f1eebc99-9c0b-4ef8-bb6d-6bb9bd380a02'::UUID, 'c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a12'::UUID, 'd1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, false, 'confirmed', 'e1eebc99-9c0b-4ef8-bb6d-6bb9bd380a02'::UUID),
    ('11111111-1111-1111-1111-111111111101'::UUID, 'f1eebc99-9c0b-4ef8-bb6d-6bb9bd380a03'::UUID, 'c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a13'::UUID, 'd1eebc99-9c0b-4ef8-bb6d-6bb9bd380a12'::UUID, false, 'confirmed', 'e1eebc99-9c0b-4ef8-bb6d-6bb9bd380a02'::UUID),
    ('11111111-1111-1111-1111-111111111101'::UUID, 'f1eebc99-9c0b-4ef8-bb6d-6bb9bd380a04'::UUID, 'c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a15'::UUID, 'd1eebc99-9c0b-4ef8-bb6d-6bb9bd380a14'::UUID, false, 'confirmed', 'e1eebc99-9c0b-4ef8-bb6d-6bb9bd380a02'::UUID),
    ('11111111-1111-1111-1111-111111111101'::UUID, 'f1eebc99-9c0b-4ef8-bb6d-6bb9bd380a05'::UUID, 'c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a14'::UUID, 'd1eebc99-9c0b-4ef8-bb6d-6bb9bd380a13'::UUID, false, 'confirmed', 'e1eebc99-9c0b-4ef8-bb6d-6bb9bd380a02'::UUID);

-- Service 2 (July 12)
INSERT INTO schedule_assignments (service_id, member_id, role_id, instrument_id, is_leader, status, assigned_by)
VALUES
    ('11111111-1111-1111-1111-111111111102'::UUID, 'f1eebc99-9c0b-4ef8-bb6d-6bb9bd380a04'::UUID, 'c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, NULL, true, 'confirmed', 'e1eebc99-9c0b-4ef8-bb6d-6bb9bd380a02'::UUID),
    ('11111111-1111-1111-1111-111111111102'::UUID, 'f1eebc99-9c0b-4ef8-bb6d-6bb9bd380a06'::UUID, 'c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a12'::UUID, 'd1eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID, false, 'confirmed', 'e1eebc99-9c0b-4ef8-bb6d-6bb9bd380a02'::UUID),
    ('11111111-1111-1111-1111-111111111102'::UUID, 'f1eebc99-9c0b-4ef8-bb6d-6bb9bd380a07'::UUID, 'c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a13'::UUID, 'd1eebc99-9c0b-4ef8-bb6d-6bb9bd380a12'::UUID, false, 'confirmed', 'e1eebc99-9c0b-4ef8-bb6d-6bb9bd380a02'::UUID),
    ('11111111-1111-1111-1111-111111111102'::UUID, 'f1eebc99-9c0b-4ef8-bb6d-6bb9bd380a08'::UUID, 'c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a12'::UUID, 'd1eebc99-9c0b-4ef8-bb6d-6bb9bd380a14'::UUID, false, 'confirmed', 'e1eebc99-9c0b-4ef8-bb6d-6bb9bd380a02'::UUID),
    ('11111111-1111-1111-1111-111111111102'::UUID, 'f1eebc99-9c0b-4ef8-bb6d-6bb9bd380a01'::UUID, 'c1eebc99-9c0b-4ef8-bb6d-6bb9bd380a14'::UUID, 'd1eebc99-9c0b-4ef8-bb6d-6bb9bd380a13'::UUID, false, 'confirmed', 'e1eebc99-9c0b-4ef8-bb6d-6bb9bd380a02'::UUID);
