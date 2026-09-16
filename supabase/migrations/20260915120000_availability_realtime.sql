-- ============================================================================
-- Migration: 012_availability_realtime
-- Created: 2026-09-15
-- Purpose: Enable Supabase Realtime (postgres_changes) for the availability
--          table so the staff availability dashboard updates live when a
--          member submits an unavailability request or a coordinator
--          approves/rejects it.
--
-- Delivery is scoped by the existing RLS SELECT policy on availability
-- (church-scoped), so subscribers only receive rows for their own church.
-- ============================================================================

ALTER PUBLICATION supabase_realtime ADD TABLE public.availability;