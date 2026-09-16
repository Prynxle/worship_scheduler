-- ============================================================================
-- Migration: 015_availability_month_year
-- Created: 2026-09-16
-- Purpose: Scope weekly availability requests to a specific month (0-based,
--          matching `services.month`) and year so the same week_number in a
--          different month is a distinct request.
--
-- Existing records without month/year (legacy) keep matching every month so
-- no historical data breaks. The weekly dedup unique index is re-scoped to
-- (member_id, year, month, week_number) and only guards rows that carry the
-- new month/year values.
-- ============================================================================

ALTER TABLE availability
  ADD COLUMN month INTEGER,
  ADD COLUMN year INTEGER;

ALTER TABLE availability
  ADD CONSTRAINT availability_month_check CHECK (month IS NULL OR month BETWEEN 0 AND 11),
  ADD CONSTRAINT availability_year_check CHECK (year IS NULL OR year BETWEEN 2000 AND 2100);

DROP INDEX IF EXISTS availability_active_weekly_member_week_idx;

DELETE FROM availability a
USING availability b
WHERE a.member_id = b.member_id
  AND a.year = b.year
  AND a.month = b.month
  AND a.week_number = b.week_number
  AND a.type = 'weekly'
  AND b.type = 'weekly'
  AND a.status IN ('pending', 'approved')
  AND b.status IN ('pending', 'approved')
  AND a.id <> b.id
  AND a.created_at > b.created_at;

CREATE UNIQUE INDEX availability_active_weekly_member_month_week_idx
  ON availability(member_id, year, month, week_number)
  WHERE type = 'weekly'
    AND status IN ('pending', 'approved')
    AND month IS NOT NULL
    AND year IS NOT NULL;