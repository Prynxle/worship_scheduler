-- ============================================================================
-- Migration: 002_member_management
-- Created: 2026-07-27
-- Purpose: Create member management tables (users, members, member_roles, member_skills)
--          Members are the core entities for scheduling. Each member has:
--          - Personal info (name, gender, contact)
--          - Church membership and department assignment
--          - Role qualifications (what they can do)
--          - Skill levels (how proficient they are)
--          - Scheduling limits and history
-- ============================================================================

-- ============================================================================
-- USERS
-- Supabase auth integration. Links to auth.users(id) via auth_id.
-- Stores user-level data that persists beyond auth metadata.
-- ============================================================================
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    auth_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'coordinator', 'member')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    church_id UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- MEMBERS
-- Ministry team members. Each member belongs to a church and can be assigned
-- to various roles across services. The scheduling engine reads this table
-- to determine eligibility, availability, and assignment history.
-- ============================================================================
CREATE TABLE members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    church_id UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
    department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
    
    -- Personal information
    full_name VARCHAR(255) NOT NULL,
    nickname VARCHAR(100),
    gender VARCHAR(20) CHECK (gender IN ('male', 'female', 'other')),
    phone VARCHAR(50),
    avatar_url TEXT,
    
    -- Scheduling configuration
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    max_monthly_assignments INTEGER NOT NULL DEFAULT 3,
    priority_score INTEGER NOT NULL DEFAULT 50,
    
    -- Assignment history (denormalized for performance)
    last_scheduled_date DATE,
    total_assignments INTEGER NOT NULL DEFAULT 0,
    
    -- Notes for coordinators
    notes TEXT,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- MEMBER_ROLES
-- Junction table: which roles a member is qualified for.
-- The scheduling engine uses this to validate role assignments.
-- skill_level determines priority when multiple candidates exist.
-- ============================================================================
CREATE TABLE member_roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    skill_level VARCHAR(20) NOT NULL DEFAULT 'intermediate' 
        CHECK (skill_level IN ('beginner', 'intermediate', 'advanced', 'expert')),
    is_preferred BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(member_id, role_id)
);

-- ============================================================================
-- MEMBER_SKILLS
-- Junction table: which instruments a member can play.
-- is_primary: true = primary player, false = fallback player.
-- fallback_member_id: for instrument fallback chains (e.g., if Kass unavailable, Zedrick plays piano).
-- ============================================================================
CREATE TABLE member_skills (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    instrument_id UUID NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
    skill_level VARCHAR(20) NOT NULL DEFAULT 'intermediate'
        CHECK (skill_level IN ('beginner', 'intermediate', 'advanced', 'expert')),
    is_primary BOOLEAN NOT NULL DEFAULT true,
    fallback_member_id UUID REFERENCES members(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(member_id, instrument_id)
);

-- ============================================================================
-- INDEXES
-- ============================================================================
CREATE INDEX idx_users_auth_id ON users(auth_id);
CREATE INDEX idx_users_church_id ON users(church_id);
CREATE INDEX idx_members_church_id ON members(church_id);
CREATE INDEX idx_members_status ON members(church_id, status);
CREATE INDEX idx_members_department_id ON members(department_id);
CREATE INDEX idx_members_last_scheduled ON members(last_scheduled_date);
CREATE INDEX idx_member_roles_member_id ON member_roles(member_id);
CREATE INDEX idx_member_roles_role_id ON member_roles(role_id);
CREATE INDEX idx_member_skills_member_id ON member_skills(member_id);
CREATE INDEX idx_member_skills_instrument_id ON member_skills(instrument_id);

-- ============================================================================
-- UPDATED_AT TRIGGERS
-- ============================================================================
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_members_updated_at
    BEFORE UPDATE ON members
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
