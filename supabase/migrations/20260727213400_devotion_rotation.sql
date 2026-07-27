-- ============================================================================
-- Migration: 005_devotion_rotation
-- Created: 2026-07-27
-- Purpose: Create devotion rotation tracking
--          Devotion uses sequential (not random) assignment.
--          The rotation table tracks the order and last-used date for each member.
--          The scheduler resumes where the previous month ended,
--          skips unavailable members, and prevents immediate repetition.
-- ============================================================================

-- ============================================================================
-- DEVOTION_ROTATION
-- Sequential rotation order for devotion assignments.
-- position determines the order: member with lowest position goes first.
-- last_used_at tracks when the member last led devotion.
-- is_active allows temporarily removing members from rotation without deleting.
-- ============================================================================
CREATE TABLE devotion_rotation (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    church_id UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    
    -- Sequential position in the rotation (lower = goes first)
    position INTEGER NOT NULL,
    
    -- When this member last led devotion (null = never)
    last_used_at TIMESTAMPTZ,
    
    -- Active status (false = temporarily skipped)
    is_active BOOLEAN NOT NULL DEFAULT true,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Each member can only have one position in the rotation
    UNIQUE(church_id, member_id),
    -- Positions must be unique within a church
    UNIQUE(church_id, position)
);

-- ============================================================================
-- INDEXES
-- ============================================================================
CREATE INDEX idx_devotion_rotation_church ON devotion_rotation(church_id);
CREATE INDEX idx_devotion_rotation_position ON devotion_rotation(church_id, position);
CREATE INDEX idx_devotion_rotation_active ON devotion_rotation(church_id, is_active) WHERE is_active = true;
