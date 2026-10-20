-- ============================================================================
-- Migration: church_exports
-- Created: 2026-10-12
-- Purpose: Persist every generated schedule export (PDF) server-side so the
--          Exports page can list real generated files with working downloads.
--          Rows are tenant-scoped by church_id; the route layer enforces the
--          authenticated church via auth.churchId, and RLS below mirrors that
--          for any direct Data API access.
--
-- Storage note: the generated file is stored as base64 TEXT
-- (file_data_base64) rather than bytea. PostgREST does not decode a JSON
-- base64 string into a bytea column without a trigger or a custom data
-- representation, so the encode/decode stays explicit in the route layer --
-- the same base64 pattern the PDF route already uses for church logos.
-- ============================================================================

CREATE TABLE public.church_exports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id UUID NOT NULL REFERENCES public.churches(id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES public.users(id),
  month INTEGER NOT NULL CHECK (month BETWEEN 0 AND 11),
  year INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  week_numbers INTEGER[],
  format TEXT NOT NULL DEFAULT 'pdf' CHECK (format IN ('pdf', 'png')),
  filename TEXT NOT NULL,
  file_size INTEGER NOT NULL CHECK (file_size >= 0),
  file_data_base64 TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX church_exports_church_created_idx
  ON public.church_exports (church_id, created_at DESC);

-- ============================================================================
-- RLS: same tenant boundary as every other table in this schema
-- ============================================================================
ALTER TABLE public.church_exports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their church exports"
  ON public.church_exports FOR SELECT
  USING (church_id = get_user_church_id());

CREATE POLICY "Users can create exports for their church"
  ON public.church_exports FOR INSERT
  WITH CHECK (church_id = get_user_church_id());

-- ============================================================================
-- ROLLBACK (DOCUMENTATION ONLY - NOT EXECUTED HERE)
-- ============================================================================
-- DROP POLICY IF EXISTS "Users can create exports for their church" ON public.church_exports;
-- DROP POLICY IF EXISTS "Users can view their church exports" ON public.church_exports;
-- DROP TABLE IF EXISTS public.church_exports;