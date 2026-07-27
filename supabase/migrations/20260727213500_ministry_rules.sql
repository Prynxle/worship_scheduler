-- ============================================================================
-- Migration: 006_ministry_rules
-- Created: 2026-07-27
-- Purpose: Create the configurable rules engine
--          Ministry rules define validation constraints for scheduling.
--          Each rule has a type, configuration (JSONB), and severity level.
--          The validator reads these rules dynamically — no code changes needed
--          when adding new rules or modifying existing ones.
--
--          Rule types:
--          - availability_check: Members must be available
--          - assignment_limit: Monthly assignment cap
--          - role_validation: Members must have required qualifications
--          - backup_count: Required number of backup singers
--          - leader_count: Exactly one worship leader per service
--          - instrument_constraint: Instrument-specific requirements
--          - cooldown: Avoid consecutive week assignments
--          - fairness: Distribute assignments evenly
--          - leader_rotation: Rotate worship leaders
--          - devotion_sequence: Sequential devotion assignment
--          - dual_role_check: One member, one role per service
-- ============================================================================

-- ============================================================================
-- MINISTRY_RULES
-- Configurable validation rules per ministry.
-- rule_config is JSONB so each rule type can have its own schema.
-- severity determines if the rule blocks publication (critical),
-- shows a warning (warning), or suggests optimization (suggestion).
-- ============================================================================
CREATE TABLE ministry_rules (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ministry_id UUID NOT NULL REFERENCES ministries(id) ON DELETE CASCADE,
    
    -- Rule type identifier (matches engine rule executors)
    rule_type VARCHAR(50) NOT NULL,
    
    -- Rule configuration as JSONB (type-specific schema)
    rule_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    
    -- Severity determines scheduling impact
    severity VARCHAR(20) NOT NULL DEFAULT 'critical'
        CHECK (severity IN ('critical', 'warning', 'suggestion')),
    
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Each ministry can only have one rule of each type
    UNIQUE(ministry_id, rule_type)
);

-- ============================================================================
-- INDEXES
-- ============================================================================
CREATE INDEX idx_ministry_rules_ministry_id ON ministry_rules(ministry_id);
CREATE INDEX idx_ministry_rules_active ON ministry_rules(ministry_id, is_active) WHERE is_active = true;
CREATE INDEX idx_ministry_rules_type ON ministry_rules(rule_type);

-- ============================================================================
-- UPDATED_AT TRIGGER
-- ============================================================================
CREATE TRIGGER update_ministry_rules_updated_at
    BEFORE UPDATE ON ministry_rules
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
