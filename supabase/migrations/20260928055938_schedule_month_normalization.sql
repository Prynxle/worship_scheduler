-- ============================================================================
-- Migration: 019_schedule_month_normalization
-- Created: 2026-09-28
-- Purpose: Make services.month 0-based, backfill existing rows, and remove the
--          duplicate draft services left behind by the failed generations.
--
-- THE DEFECT
--   20260727213800_functions_triggers.sql:51 wrote
--     NEW.month := EXTRACT(MONTH FROM NEW.date)::INTEGER;   -- 1-BASED
--   into a table whose own CHECK (services_month_check, month BETWEEN 0 AND 11)
--   and whose entire application are 0-BASED: schedule/page.tsx:19
--   (new Date().getMonth()), schedule-data.ts:45 (.eq('month', month)),
--   availability.ts:12, date-utils.ts getMonthName. A September service was
--   therefore written as month=9 and could never be read back by the
--   0-based SELECT that renders the month.
--
--   The trigger KEEPS ownership of week_number, month and year:
--     * they are denormalized from date (20260727213200_scheduling.sql:20-21),
--       so a second writer is a drift bug -- idx_services_month_year would
--       silently miss rows;
--     * the DB is the only enforcement point available to EVERY writer (seed,
--       SQL console, a future edge function);
--     * week_number must stay DB-owned: the route sends week_number derived from
--       getWeekDate and the trigger recomputes it from date, which makes an
--       edit to date self-healing today. Keep that.
--   The trigger is BEFORE INSERT OR UPDATE OF date, so the backfill below does
--   NOT re-fire it and the statement order is irrelevant.
--
-- R7: the function is declared with a pinned search_path. Its previous body had
--     none, so it was the one object in the verification matrix that was
--     unhardened.
--
-- ADD CONSTRAINT is deliberately NOT idempotent -- Postgres has no
-- IF NOT EXISTS for constraints -- so the two CHECK constraints below rely on
-- migrations running exactly once. The UPDATE and the DO block are idempotent
-- and safe to re-run.
--
-- SCOPE NOTE: the 18 'Mock unavailability (...)' availability rows are the
-- developer's deliberate test fixtures and are NOT touched here.
-- ============================================================================

-- ============================================================================
-- 2a. 0-BASED MONTH IN THE TRIGGER
-- EXTRACT(MONTH ...) - 1 ranges over 0..11 for every valid date, so
-- services_month_check (month BETWEEN 0 AND 11) still holds. January now
-- correctly yields 0, where the old 1-based trigger wrote 1 and the CHECK
-- passed by accident. services_month_check is NOT modified.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.set_service_week_number()
RETURNS TRIGGER AS $$
BEGIN
    NEW.week_number := get_week_number(NEW.date);
    NEW.month       := EXTRACT(MONTH FROM NEW.date)::INTEGER - 1;  -- 0-based
    NEW.year        := EXTRACT(YEAR FROM NEW.date)::INTEGER;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql
   SET search_path = public, pg_temp;

-- ============================================================================
-- 2b.1 NORMALIZE EVERY ROW (idempotent; does not re-fire the trigger, which is
--      bound to INSERT OR UPDATE OF date only)
-- Run BEFORE 2b.3 so the new CHECK validates against conforming data.
-- ============================================================================
UPDATE public.services
   SET month = EXTRACT(MONTH FROM date)::INTEGER - 1
 WHERE month IS DISTINCT FROM EXTRACT(MONTH FROM date)::INTEGER - 1;

-- ============================================================================
-- 2b.2 REMOVE EXACT-DUPLICATE DRAFT SERVICES
-- This is the debris of the 5 failed generations: 5 identical
-- (church_id, date=2026-09-06, week_number=1, status='draft') rows with zero
-- assignments, one per failed POST /api/schedule.
--
-- Gates, all three required:
--   * status = 'draft' only          -> never touches published/validated
--   * zero assignments only          -> the ON DELETE CASCADE is not exercised
--   * keeps the NEWEST per group     -> the retained row is the most recent
-- The count is reported as a NOTICE and must be quoted in the completion report.
-- Reversible: audit_logs.new_value holds the full deleted rows.
-- ============================================================================
DO $$
DECLARE
    v_removed INTEGER := 0;
BEGIN
    WITH ranked AS (
        SELECT id,
               ROW_NUMBER() OVER (
                   PARTITION BY church_id, date, week_number
                   ORDER BY created_at DESC, id DESC
               ) AS rn
          FROM public.services
         WHERE status = 'draft'
           AND NOT EXISTS (
               SELECT 1 FROM public.schedule_assignments a WHERE a.service_id = services.id
           )
    ), doomed AS (
        DELETE FROM public.services s
         USING ranked r
         WHERE s.id = r.id AND r.rn > 1
        RETURNING s.id
    )
    SELECT count(*) INTO v_removed FROM doomed;

    RAISE NOTICE 'schedule_month_normalization: removed % duplicate draft services (newest per (church_id, date, week_number) retained)', v_removed;
END;
$$;

-- ============================================================================
-- 2b.3 STRUCTURAL GUARD -- THE INVARIANT CAN NEVER BE VIOLATED AGAIN
-- Placed after 2b.1 so validation passes. Strictly stronger than
-- services_month_check and the only thing that makes this bug non-recurring.
-- ============================================================================
ALTER TABLE public.services
  ADD CONSTRAINT services_month_date_consistency_check
  CHECK (month = EXTRACT(MONTH FROM date)::INTEGER - 1);

-- ============================================================================
-- 2b.4 YEAR GUARD
-- Added only after a read-only pre-check confirmed 0 of 11 rows violate it
-- (`SELECT count(*) FROM services WHERE year <> EXTRACT(YEAR FROM date)` = 0).
-- It carries real weight because the trigger is bound to UPDATE OF date, so an
-- UPDATE of year alone would not recompute it.
-- ============================================================================
ALTER TABLE public.services
  ADD CONSTRAINT services_year_date_consistency_check
  CHECK (year = EXTRACT(YEAR FROM date)::INTEGER);
