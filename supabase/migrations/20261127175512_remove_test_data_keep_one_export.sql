-- Remove the application data used while exercising the UI and scheduling
-- workflow. Roster and configuration rows are intentionally preserved.
-- Keep the newest export so the Exports page continues to demonstrate a real
-- persisted download after cleanup.

BEGIN;

-- Clear schedule history generated during testing and all persisted schedules.
DELETE FROM public.schedule_change_log;
ALTER TABLE public.schedule_assignments DISABLE TRIGGER audit_assignments_changes;
ALTER TABLE public.services DISABLE TRIGGER audit_services_changes;
ALTER TABLE public.members DISABLE TRIGGER audit_members_changes;
DELETE FROM public.services;
ALTER TABLE public.services ENABLE TRIGGER audit_services_changes;
ALTER TABLE public.schedule_assignments ENABLE TRIGGER audit_assignments_changes;
ALTER TABLE public.members ENABLE TRIGGER audit_members_changes;

-- The assignment counter trigger runs during the cascaded deletes. Normalize
-- the cached member totals as a final guard for databases with prior drift.
UPDATE public.members
SET total_assignments = 0,
    last_scheduled_date = NULL
WHERE total_assignments <> 0 OR last_scheduled_date IS NOT NULL;

-- Availability requests are user-facing test data and can affect schedule
-- readiness, member pages, and analytics. Remove both detail and submission
-- history so no mock/pending state remains for any member.
DELETE FROM public.availability;
DELETE FROM public.availability_submission_review_log;
DELETE FROM public.availability_submissions;

-- Announcement fan-out stores one notification per recipient.
DELETE FROM public.notifications WHERE type = 'announcement';

-- Exactly one generated export remains across the installation: the newest.
DELETE FROM public.church_exports
WHERE id NOT IN (
  SELECT id
  FROM public.church_exports
  ORDER BY created_at DESC, id DESC
  LIMIT 1
);

-- Mock availability was a test-only workflow. Remove its RPC and provenance
-- column after deleting all its possible rows.
DROP FUNCTION IF EXISTS public.mock_month_availability(UUID, UUID, INTEGER, INTEGER, TEXT, JSONB);
ALTER TABLE public.availability_submissions DROP COLUMN IF EXISTS source;

COMMIT;
