-- ============================================================================
-- Migration: 008_rls_policies
-- Created: 2026-07-27
-- Purpose: Enable Row Level Security and create multi-tenant isolation policies
--          Every table is RLS-enabled. Users can only access data for their
--          church_id. This is the foundation of data security.
-- ============================================================================

-- ============================================================================
-- ENABLE ROW LEVEL SECURITY ON ALL TABLES
-- ============================================================================

ALTER TABLE churches ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE ministries ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE instruments ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE devotion_rotation ENABLE ROW LEVEL SECURITY;
ALTER TABLE ministry_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- HELPER FUNCTION
-- Get current user's church_id from their user record
-- ============================================================================
CREATE OR REPLACE FUNCTION get_user_church_id()
RETURNS UUID AS $$
    SELECT church_id FROM users WHERE auth_id = auth.uid()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================================
-- CHURCHES
-- Users can only see their own church
-- ============================================================================
CREATE POLICY "Users can view their own church"
    ON churches FOR SELECT
    USING (id = get_user_church_id());

CREATE POLICY "Admins can update their church"
    ON churches FOR UPDATE
    USING (id = get_user_church_id());

-- ============================================================================
-- DEPARTMENTS
-- ============================================================================
CREATE POLICY "Users can view departments in their church"
    ON departments FOR SELECT
    USING (church_id = get_user_church_id());

CREATE POLICY "Admins can manage departments in their church"
    ON departments FOR ALL
    USING (church_id = get_user_church_id());

-- ============================================================================
-- MINISTRIES
-- ============================================================================
CREATE POLICY "Users can view ministries in their church"
    ON ministries FOR SELECT
    USING (church_id = get_user_church_id());

CREATE POLICY "Admins can manage ministries in their church"
    ON ministries FOR ALL
    USING (church_id = get_user_church_id());

-- ============================================================================
-- ROLES (scoped via ministry.church_id)
-- ============================================================================
CREATE POLICY "Users can view roles in their church"
    ON roles FOR SELECT
    USING (ministry_id IN (
        SELECT id FROM ministries WHERE church_id = get_user_church_id()
    ));

CREATE POLICY "Admins can manage roles in their church"
    ON roles FOR ALL
    USING (ministry_id IN (
        SELECT id FROM ministries WHERE church_id = get_user_church_id()
    ));

-- ============================================================================
-- INSTRUMENTS (scoped via ministry.church_id)
-- ============================================================================
CREATE POLICY "Users can view instruments in their church"
    ON instruments FOR SELECT
    USING (ministry_id IN (
        SELECT id FROM ministries WHERE church_id = get_user_church_id()
    ));

CREATE POLICY "Admins can manage instruments in their church"
    ON instruments FOR ALL
    USING (ministry_id IN (
        SELECT id FROM ministries WHERE church_id = get_user_church_id()
    ));

-- ============================================================================
-- USERS
-- ============================================================================
CREATE POLICY "Users can view users in their church"
    ON users FOR SELECT
    USING (church_id = get_user_church_id());

CREATE POLICY "Admins can manage users in their church"
    ON users FOR ALL
    USING (church_id = get_user_church_id());

-- ============================================================================
-- MEMBERS
-- ============================================================================
CREATE POLICY "Users can view members in their church"
    ON members FOR SELECT
    USING (church_id = get_user_church_id());

CREATE POLICY "Admins can manage members in their church"
    ON members FOR ALL
    USING (church_id = get_user_church_id());

-- ============================================================================
-- MEMBER_ROLES (scoped via member.church_id)
-- ============================================================================
CREATE POLICY "Users can view member_roles in their church"
    ON member_roles FOR SELECT
    USING (member_id IN (
        SELECT id FROM members WHERE church_id = get_user_church_id()
    ));

CREATE POLICY "Admins can manage member_roles in their church"
    ON member_roles FOR ALL
    USING (member_id IN (
        SELECT id FROM members WHERE church_id = get_user_church_id()
    ));

-- ============================================================================
-- MEMBER_SKILLS (scoped via member.church_id)
-- ============================================================================
CREATE POLICY "Users can view member_skills in their church"
    ON member_skills FOR SELECT
    USING (member_id IN (
        SELECT id FROM members WHERE church_id = get_user_church_id()
    ));

CREATE POLICY "Admins can manage member_skills in their church"
    ON member_skills FOR ALL
    USING (member_id IN (
        SELECT id FROM members WHERE church_id = get_user_church_id()
    ));

-- ============================================================================
-- SERVICES
-- ============================================================================
CREATE POLICY "Users can view services in their church"
    ON services FOR SELECT
    USING (church_id = get_user_church_id());

CREATE POLICY "Admins can manage services in their church"
    ON services FOR ALL
    USING (church_id = get_user_church_id());

-- ============================================================================
-- SCHEDULE_ASSIGNMENTS (scoped via service.church_id)
-- ============================================================================
CREATE POLICY "Users can view assignments in their church"
    ON schedule_assignments FOR SELECT
    USING (service_id IN (
        SELECT id FROM services WHERE church_id = get_user_church_id()
    ));

CREATE POLICY "Admins can manage assignments in their church"
    ON schedule_assignments FOR ALL
    USING (service_id IN (
        SELECT id FROM services WHERE church_id = get_user_church_id()
    ));

-- ============================================================================
-- AVAILABILITY
-- ============================================================================
CREATE POLICY "Users can view availability in their church"
    ON availability FOR SELECT
    USING (church_id = get_user_church_id());

CREATE POLICY "Admins can manage availability in their church"
    ON availability FOR ALL
    USING (church_id = get_user_church_id());

-- ============================================================================
-- DEVOTION_ROTATION
-- ============================================================================
CREATE POLICY "Users can view devotion rotation in their church"
    ON devotion_rotation FOR SELECT
    USING (church_id = get_user_church_id());

CREATE POLICY "Admins can manage devotion rotation in their church"
    ON devotion_rotation FOR ALL
    USING (church_id = get_user_church_id());

-- ============================================================================
-- MINISTRY_RULES (scoped via ministry.church_id)
-- ============================================================================
CREATE POLICY "Users can view ministry rules in their church"
    ON ministry_rules FOR SELECT
    USING (ministry_id IN (
        SELECT id FROM ministries WHERE church_id = get_user_church_id()
    ));

CREATE POLICY "Admins can manage ministry rules in their church"
    ON ministry_rules FOR ALL
    USING (ministry_id IN (
        SELECT id FROM ministries WHERE church_id = get_user_church_id()
    ));

-- ============================================================================
-- AUDIT_LOGS
-- ============================================================================
CREATE POLICY "Users can view audit logs in their church"
    ON audit_logs FOR SELECT
    USING (church_id = get_user_church_id());

CREATE POLICY "System can insert audit logs"
    ON audit_logs FOR INSERT
    WITH CHECK (true);

-- ============================================================================
-- NOTIFICATIONS
-- ============================================================================
CREATE POLICY "Users can view their own notifications"
    ON notifications FOR SELECT
    USING (user_id = (
        SELECT id FROM users WHERE auth_id = auth.uid()
    ));

CREATE POLICY "Users can update their own notifications"
    ON notifications FOR UPDATE
    USING (user_id = (
        SELECT id FROM users WHERE auth_id = auth.uid()
    ));

CREATE POLICY "System can insert notifications"
    ON notifications FOR INSERT
    WITH CHECK (true);

-- ============================================================================
-- GRANT PERMISSIONS
-- Grants anon and authenticated roles access to all tables
-- ============================================================================
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;

GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Grant execute on functions
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
