-- ============================================================================
-- Migration: 009_functions_triggers
-- Created: 2026-07-27
-- Purpose: Create utility functions and triggers for the scheduling system
--          - Week number calculation for scheduling
--          - Audit logging triggers
--          - Assignment counter updates
--          - Devotion rotation advancement
-- ============================================================================

-- ============================================================================
-- WEEK NUMBER CALCULATOR
-- Given a date, returns which week of the month it falls in (1-5)
-- Week 1 = first Sunday of the month, etc.
-- ============================================================================
CREATE OR REPLACE FUNCTION get_week_number(target_date DATE)
RETURNS INTEGER AS $$
DECLARE
    first_day_of_month DATE;
    first_sunday DATE;
    days_between INTEGER;
BEGIN
    first_day_of_month := DATE_TRUNC('month', target_date);
    
    -- Find the first Sunday of the month
    IF EXTRACT(DOW FROM first_day_of_month) = 0 THEN
        first_sunday := first_day_of_month;
    ELSE
        first_sunday := first_day_of_month + ((7 - EXTRACT(DOW FROM first_day_of_month))::INTEGER);
    END IF;
    
    -- If the target date is before the first Sunday, it's week 0 (pre-month)
    IF target_date < first_sunday THEN
        RETURN 0;
    END IF;
    
    -- Calculate week number (1-indexed)
    days_between := target_date - first_sunday;
    RETURN (days_between / 7) + 1;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ============================================================================
-- AUTO-SET WEEK NUMBER ON SERVICES
-- When a service is inserted, automatically calculate its week_number
-- ============================================================================
CREATE OR REPLACE FUNCTION set_service_week_number()
RETURNS TRIGGER AS $$
BEGIN
    NEW.week_number := get_week_number(NEW.date);
    NEW.month := EXTRACT(MONTH FROM NEW.date)::INTEGER;
    NEW.year := EXTRACT(YEAR FROM NEW.date)::INTEGER;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER auto_set_service_week_number
    BEFORE INSERT OR UPDATE OF date ON services
    FOR EACH ROW
    EXECUTE FUNCTION set_service_week_number();

-- ============================================================================
-- AUDIT LOG TRIGGER
-- Automatically log changes to critical tables
-- ============================================================================
CREATE OR REPLACE FUNCTION log_audit_change()
RETURNS TRIGGER AS $$
DECLARE
    old_data JSONB;
    new_data JSONB;
    action_type VARCHAR(50);
    entity_id UUID;
    user_church_id UUID;
BEGIN
    -- Determine action type
    IF TG_OP = 'INSERT' THEN
        action_type := TG_TABLE_NAME || '_created';
        new_data := to_jsonb(NEW);
        entity_id := NEW.id;
    ELSIF TG_OP = 'UPDATE' THEN
        action_type := TG_TABLE_NAME || '_updated';
        old_data := to_jsonb(OLD);
        new_data := to_jsonb(NEW);
        entity_id := NEW.id;
    ELSIF TG_OP = 'DELETE' THEN
        action_type := TG_TABLE_NAME || '_deleted';
        old_data := to_jsonb(OLD);
        entity_id := OLD.id;
    END IF;

    -- Get church_id from the record
    IF TG_OP = 'DELETE' THEN
        -- Try to get church_id from the old record
        IF (old_data ? 'church_id') THEN
            user_church_id := (old_data->>'church_id')::UUID;
        ELSE
            -- Fallback: try to find it via related tables
            user_church_id := get_user_church_id();
        END IF;
    ELSE
        IF (new_data ? 'church_id') THEN
            user_church_id := (new_data->>'church_id')::UUID;
        ELSE
            user_church_id := get_user_church_id();
        END IF;
    END IF;

    -- Insert audit log (use NULL for user_id if we can't determine it)
    INSERT INTO audit_logs (
        church_id, user_id, action, entity_type, entity_id,
        old_value, new_value, ip_address
    ) VALUES (
        COALESCE(user_church_id, '00000000-0000-0000-0000-000000000000'::UUID),
        COALESCE(
            (SELECT id FROM users WHERE auth_id = auth.uid() LIMIT 1),
            '00000000-0000-0000-0000-000000000000'::UUID
        ),
        action_type,
        TG_TABLE_NAME,
        entity_id,
        old_data,
        new_data,
        NULL
    );

    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Apply audit trigger to key tables
CREATE TRIGGER audit_services_changes
    AFTER INSERT OR UPDATE OR DELETE ON services
    FOR EACH ROW EXECUTE FUNCTION log_audit_change();

CREATE TRIGGER audit_members_changes
    AFTER INSERT OR UPDATE OR DELETE ON members
    FOR EACH ROW EXECUTE FUNCTION log_audit_change();

CREATE TRIGGER audit_assignments_changes
    AFTER INSERT OR UPDATE OR DELETE ON schedule_assignments
    FOR EACH ROW EXECUTE FUNCTION log_audit_change();

-- ============================================================================
-- UPDATE MEMBER ASSIGNMENT COUNT
-- When assignments are added/removed, update the member's total_assignments count
-- ============================================================================
CREATE OR REPLACE FUNCTION update_member_assignment_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE members
        SET total_assignments = total_assignments + 1,
            last_scheduled_date = (
                SELECT MAX(s.date)
                FROM services s
                WHERE s.id = NEW.service_id
            )
        WHERE id = NEW.member_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE members
        SET total_assignments = GREATEST(total_assignments - 1, 0)
        WHERE id = OLD.member_id;
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_assignment_count
    AFTER INSERT OR DELETE ON schedule_assignments
    FOR EACH ROW EXECUTE FUNCTION update_member_assignment_count();

-- ============================================================================
-- DEVOTION ROTATION ADVANCEMENT
-- After a devotion is assigned, advance the rotation position
-- ============================================================================
CREATE OR REPLACE FUNCTION advance_devotion_rotation()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE devotion_rotation
        SET last_used_at = NOW()
        WHERE member_id = NEW.member_id
        AND church_id = (
            SELECT church_id FROM members WHERE id = NEW.member_id
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Note: This trigger would need to be applied to the services table
-- with a check for devotion assignments, but since devotion is
-- managed through the devotion_rotation table, we'll handle
-- this in the application layer for now.
