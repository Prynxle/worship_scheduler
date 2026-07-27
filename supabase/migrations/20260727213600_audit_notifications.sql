-- ============================================================================
-- Migration: 007_audit_notifications
-- Created: 2026-07-27
-- Purpose: Create audit logging and notification tables
--          Audit logs track every change to the system for accountability.
--          Notifications alert users about assignments, conflicts, and updates.
--          Both tables use church_id for multi-tenant isolation.
-- ============================================================================

-- ============================================================================
-- AUDIT_LOGS
-- Immutable audit trail. Every modification records who, what, when, and why.
-- old_value/new_value store JSONB snapshots for change comparison.
-- ============================================================================
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    church_id UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    
    -- What happened
    action VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID NOT NULL,
    
    -- Change details (JSONB for flexible schemas)
    old_value JSONB,
    new_value JSONB,
    
    -- Request context
    ip_address INET,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- NOTIFICATIONS
-- User-facing notifications for assignments, conflicts, and schedule updates.
-- is_read tracks whether the user has seen the notification.
-- ============================================================================
CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    church_id UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
    
    -- Notification content
    type VARCHAR(50) NOT NULL CHECK (type IN (
        'assignment', 'conflict', 'reminder', 
        'schedule_published', 'availability_reminder'
    )),
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    
    -- Read status
    is_read BOOLEAN NOT NULL DEFAULT false,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- INDEXES
-- ============================================================================
CREATE INDEX idx_audit_logs_church_id ON audit_logs(church_id);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_created ON audit_logs(church_id, created_at DESC);
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_unread ON notifications(user_id, is_read) WHERE is_read = false;
CREATE INDEX idx_notifications_church_id ON notifications(church_id);
