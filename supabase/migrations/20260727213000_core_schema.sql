-- ============================================================================
-- Migration: 001_core_schema
-- Created: 2026-07-27
-- Purpose: Create core organizational tables (churches, departments, ministries, roles)
--          This is the foundation of the multi-tenant architecture.
--          Every church is isolated via church_id for data security.
-- ============================================================================

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- CHURCHES
-- Root tenant entity. Every other table references church_id for isolation.
-- Stores church profile and configurable scheduling defaults.
-- ============================================================================
CREATE TABLE churches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(255) NOT NULL,
    address TEXT,
    city VARCHAR(100),
    country VARCHAR(100),
    phone VARCHAR(50),
    email VARCHAR(255),
    logo_url TEXT,
    
    -- Configurable scheduling defaults per church
    settings JSONB NOT NULL DEFAULT '{
        "default_max_monthly_assignments": 3,
        "default_min_backup_singers": 3,
        "default_max_backup_singers": 5,
        "cooldown_weeks": 1,
        "enable_fairness": true,
        "enable_cooldown": true,
        "enable_leader_rotation": true
    }'::jsonb,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- DEPARTMENTS
-- Sub-organizational units within a church (e.g., Worship, Media, Prayer).
-- Used to group members by ministry area.
-- ============================================================================
CREATE TABLE departments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    church_id UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(church_id, name)
);

-- ============================================================================
-- MINISTRIES
-- Configurable ministry definitions (Worship Team, Sound Team, etc.).
-- Each ministry defines its own roles, member limits, and validation rules.
-- This is the extensibility point — new ministries are added via configuration.
-- ============================================================================
CREATE TABLE ministries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    church_id UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    
    -- Ministry configuration as JSONB for flexibility
    config JSONB NOT NULL DEFAULT '{
        "min_members": 1,
        "max_members": 10,
        "requires_leader": false,
        "allows_dual_role": false,
        "auto_generate": true
    }'::jsonb,
    
    priority INTEGER NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(church_id, name)
);

-- ============================================================================
-- ROLES
-- Specific roles within a ministry (e.g., Worship Leader, Singer, Guitarist).
-- Defines minimum/maximum member requirements per role.
-- ============================================================================
CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ministry_id UUID NOT NULL REFERENCES ministries(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    min_required INTEGER NOT NULL DEFAULT 0,
    max_allowed INTEGER NOT NULL DEFAULT 10,
    priority INTEGER NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(ministry_id, name)
);

-- ============================================================================
-- INSTRUMENTS
-- Specific instruments within a ministry (Piano, Guitar, Drums, etc.).
-- Each instrument has eligible members and fallback rules.
-- ============================================================================
CREATE TABLE instruments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ministry_id UUID NOT NULL REFERENCES ministries(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    is_required BOOLEAN NOT NULL DEFAULT true,
    min_count INTEGER NOT NULL DEFAULT 1,
    max_count INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    UNIQUE(ministry_id, name)
);

-- ============================================================================
-- INDEXES
-- Performance indexes for multi-tenant queries
-- ============================================================================
CREATE INDEX idx_departments_church_id ON departments(church_id);
CREATE INDEX idx_ministries_church_id ON ministries(church_id);
CREATE INDEX idx_ministries_active ON ministries(church_id, is_active);
CREATE INDEX idx_roles_ministry_id ON roles(ministry_id);
CREATE INDEX idx_instruments_ministry_id ON instruments(ministry_id);

-- ============================================================================
-- UPDATED_AT TRIGGER
-- Auto-update updated_at timestamp on any row modification
-- ============================================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_churches_updated_at
    BEFORE UPDATE ON churches
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
