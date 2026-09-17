-- ============================================================================
-- Migration: 014_availability_weekly_dedup
-- Created: 2026-09-16
-- Purpose: Prevent duplicate active weekly availability requests.
--          A member may only have one pending or approved record per
--          week_number. Rejected records do not block a resubmission so a
--          coordinator can reject a mistaken request and the member can
--          re-request the same week.
--
-- Two layers of protection:
--   1. Deduplicate any existing active weekly rows (keeps the earliest).
--   2. Partial unique index as the hard guarantee for every write path.
-- ============================================================================

DELETE FROM availability a
USING availability b
WHERE a.member_id = b.member_id
  AND a.week_number = b.week_number
  AND a.type = 'weekly'
  AND b.type = 'weekly'
  AND a.status IN ('pending', 'approved')
  AND b.status IN ('pending', 'approved')
  AND a.id <> b.id
  AND a.created_at > b.created_at;

CREATE UNIQUE INDEX availability_active_weekly_member_week_idx
  ON availability(member_id, week_number)
  WHERE type = 'weekly' AND status IN ('pending', 'approved');