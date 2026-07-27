-- ============================================================================
-- Migration: 003_scheduling
-- Created: 2026-07-27
-- Purpose: Create scheduling tables (services, schedule_assignments)
--          Services represent worship dates. Each service has multiple assignments
--          where members are assigned to specific roles and instruments.
--          The scheduling engine generates and validates these assignments.
-- ============================================================================

-- ============================================================================
-- SERVICES
-- A worship service (typically Sunday). Contains metadata about the service
-- and links to all member assignments for that date.
-- status flow: draft -> validated -> published -> archived
-- ============================================================================
CREATE TABLE services (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    church_id UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
    
    -- Date information (denormalized for fast queries)
    date DATE NOT NULL,
    week_number INTEGER NOT NULL CHECK (week_number BETWEEN 1 AND 5),
    month INTEGER NOT NULL CHECK (month BETWEEN 0 AND 11),
    year INTEGER NOT NULL,
    
    -- Service metadata
    service_type VARCHAR(50) NOT NULL DEFAULT 'sunday',
    status VARCHAR(20) NOT NULL DEFAULT 'draft' 
        CHECK (status IN ('draft', 'validated', 'published', 'archived')),
    notes TEXT,
    
    -- Publication tracking
    published_at TIMESTAMPTZ,
    generated_by UUID REFERENCES users(id) ON DELETE SET NULL,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- SCHEDULE_ASSIGNMENTS
-- Individual member assignments within a service.
-- Each row = one member assigned to one role in one service.
-- is_leader flag identifies the worship leader specifically.
-- status tracks whether the member has confirmed their assignment.
-- ============================================================================
CREATE TABLE schedule_assignments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    instrument_id UUID REFERENCES instruments(id) ON DELETE SET NULL,
    
    -- Assignment metadata
    is_leader BOOLEAN NOT NULL DEFAULT false,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'confirmed', 'declined', 'swapped')),
    
    -- Audit trail
    assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- A member can only have one role per service (enforced by application too)
    UNIQUE(service_id, member_id)
);

-- ============================================================================
-- INDEXES
-- ============================================================================
CREATE INDEX idx_services_church_id ON services(church_id);
CREATE INDEX idx_services_date ON services(church_id, date);
CREATE INDEX idx_services_month_year ON services(church_id, month, year);
CREATE INDEX idx_services_status ON services(church_id, status);
CREATE INDEX idx_services_week_number ON services(church_id, week_number);
CREATE INDEX idx_assignments_service_id ON schedule_assignments(service_id);
CREATE INDEX idx_assignments_member_id ON schedule_assignments(member_id);
CREATE INDEX idx_assignments_role_id ON schedule_assignments(role_id);
CREATE INDEX idx_assignments_instrument_id ON schedule_assignments(instrument_id);

-- ============================================================================
-- UPDATED_AT TRIGGERS
-- ============================================================================
CREATE TRIGGER update_services_updated_at
    BEFORE UPDATE ON services
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_assignments_updated_at
    BEFORE UPDATE ON schedule_assignments
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
