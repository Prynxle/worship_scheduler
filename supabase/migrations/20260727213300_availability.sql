-- ============================================================================
-- Migration: 004_availability
-- Created: 2026-07-27
-- Purpose: Create availability management tables
--          Members submit unavailability which the scheduler converts to week numbers.
--          Supports multiple unavailability types: weekly, date-specific, vacation,
--          temporary leave, emergency leave, and recurring patterns.
--          The scheduler reads this table to filter out unavailable members.
-- ============================================================================

-- ============================================================================
-- AVAILABILITY
-- Member unavailability records. The scheduling engine checks this table
-- before assigning any member to a service.
--
-- type breakdown:
--   'weekly'        - Unavailable every week N (e.g., Week 1 every month)
--   'date'          - Unavailable on specific date(s)
--   'vacation'      - Extended absence (date range)
--   'temporary_leave' - Short-term absence (date range)
--   'emergency_leave' - Unplanned absence (date range)
--   'recurring'     - Recurring weekly pattern (e.g., every Tuesday)
--
-- status flow: pending -> approved | rejected
-- ============================================================================
CREATE TABLE availability (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    church_id UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
    
    -- Unavailability type
    type VARCHAR(30) NOT NULL CHECK (type IN (
        'weekly', 'date', 'vacation', 'temporary_leave', 
        'emergency_leave', 'recurring'
    )),
    
    -- For 'weekly' type: which week number (1-5)
    week_number INTEGER CHECK (week_number BETWEEN 1 AND 5),
    
    -- For 'date' type: specific date
    date DATE,
    
    -- For range-based types (vacation, temporary_leave, emergency_leave)
    end_date DATE,
    
    -- Reason for unavailability (optional, helps coordinators)
    reason TEXT,
    
    -- Approval workflow
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'approved', 'rejected')),
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- INDEXES
-- ============================================================================
CREATE INDEX idx_availability_member_id ON availability(member_id);
CREATE INDEX idx_availability_church_id ON availability(church_id);
CREATE INDEX idx_availability_type ON availability(member_id, type);
CREATE INDEX idx_availability_week ON availability(week_number) WHERE type = 'weekly';
CREATE INDEX idx_availability_date ON availability(date) WHERE type = 'date';
CREATE INDEX idx_availability_status ON availability(member_id, status);
