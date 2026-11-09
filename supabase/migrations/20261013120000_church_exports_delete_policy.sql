-- ============================================================================
-- Migration: church_exports delete policy
-- Created: 2026-10-13
-- Purpose: Allow tenant-scoped deletion of persisted schedule exports so
--          coordinators can remove a PDF and regenerate it when needed.
-- ============================================================================

CREATE POLICY "Users can delete their church exports"
  ON public.church_exports FOR DELETE
  USING (church_id = get_user_church_id());

-- ============================================================================
-- ROLLBACK (DOCUMENTATION ONLY - NOT EXECUTED HERE)
-- ============================================================================
-- DROP POLICY IF EXISTS "Users can delete their church exports" ON public.church_exports;
