-- Mock unavailability becomes workflow-native: source-tagged submissions.
--
-- Purpose: the mock-unavailability tool used to write pre-approved availability
-- rows directly (submission_id IS NULL, status 'approved'), bypassing the
-- submissions/approval workflow entirely, so the readiness gate never saw mock
-- data. This migration tags every submission with its origin and adds one
-- transactional RPC that runs the whole mock write through the same submission
-- lifecycle as a real member response:
--
--   - availability_submissions.source is 'member' for every existing row and
--     'mock' only for rows this function creates. A current MEMBER submission
--     is never touched: the member's entry is skipped and reported.
--   - A current MOCK submission is superseded the same way
--     submit_month_availability supersedes a revision: the old version is kept
--     with is_current = FALSE, its availability rows move to 'rejected', and a
--     new version (max(version) + 1) is inserted at status 'submitted'. The
--     submission status itself is NEVER set to 'rejected' -- that value does
--     not exist in the submission status CHECK; only availability rows are
--     rejected.
--   - The new submission's weekly rows are linked (submission_id) at status
--     'pending', so a coordinator must approve them before the scheduling
--     engine treats them as active and before the readiness gate goes green.
--   - Entries with a NULL week_number create an EMPTY submission (a declared
--     "no unavailability" response). The route sends one for every member it
--     must not mock into unavailability (sole-qualified holders), so the month
--     can still reach full readiness.
--   - Legacy unlinked mock rows (reason LIKE 'Mock unavailability (%',
--     submission_id IS NULL) for this church/month/year are stamped 'rejected'
--     rather than hard-deleted, and reported as deleted_legacy.
--
-- The function is SECURITY INVOKER with an empty search_path, matching every
-- sibling in 20260928084433. The only caller is the service-role key, which is
-- the table owner path already.

ALTER TABLE public.availability_submissions
  ADD COLUMN source VARCHAR(16) NOT NULL DEFAULT 'member'
    CHECK (source IN ('member', 'mock'));

CREATE OR REPLACE FUNCTION public.mock_month_availability(
  p_church_id UUID,
  p_actor_id UUID,
  p_month INTEGER,
  p_year INTEGER,
  p_reason TEXT,
  p_entries JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_entry JSONB;
  v_member_id UUID;
  v_week_number INTEGER;
  v_current public.availability_submissions%ROWTYPE;
  v_submission_id UUID;
  v_version INTEGER;
  v_rows INTEGER;
  v_submissions_created INTEGER := 0;
  v_entries_added INTEGER := 0;
  v_empty_submissions INTEGER := 0;
  v_skipped_members JSONB := '[]'::jsonb;
  v_deleted_legacy INTEGER := 0;
BEGIN
  -- 22023. Every entry is { member_id: uuid, week_number: 1..5 | null }. A
  -- NULL week_number is a deliberate empty submission, not missing data. The
  -- week_number CASE guards the cast order: jsonb_typeof runs before any
  -- numeric cast, so a non-number can never reach ::numeric.
  IF p_month < 0 OR p_month > 11 OR p_year < 2000 OR p_year > 2100
     OR pg_catalog.btrim(COALESCE(p_reason, '')) = ''
     OR pg_catalog.jsonb_typeof(p_entries) <> 'array' THEN
    RAISE EXCEPTION 'A month between 0 and 11, a year between 2000 and 2100, a non-empty reason, and a list of member entries are required' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(p_entries) AS items(item)
    WHERE pg_catalog.jsonb_typeof(item) <> 'object'
      OR item->>'member_id' IS NULL
      OR (item->>'member_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR CASE
           WHEN pg_catalog.jsonb_typeof(item->'week_number') IS NULL THEN FALSE
           WHEN pg_catalog.jsonb_typeof(item->'week_number') = 'null' THEN FALSE
           WHEN pg_catalog.jsonb_typeof(item->'week_number') <> 'number' THEN TRUE
           ELSE (item->>'week_number')::numeric <> pg_catalog.floor((item->>'week_number')::numeric)
             OR (item->>'week_number')::numeric NOT BETWEEN 1 AND 5
         END
  ) THEN
    RAISE EXCEPTION 'Every entry must be an object with a member id and a week number between 1 and 5 or null' USING ERRCODE = '22023';
  END IF;
  IF (SELECT COUNT(*) FROM pg_catalog.jsonb_array_elements(p_entries)) <>
     (SELECT COUNT(DISTINCT item->>'member_id') FROM pg_catalog.jsonb_array_elements(p_entries) AS items(item)) THEN
    RAISE EXCEPTION 'Each member may appear only once in the entry list' USING ERRCODE = '22023';
  END IF;

  -- Serialise concurrent mock runs for the same church and month. The second
  -- key deliberately does not collide with persist_month_schedule's
  -- ministry-keyed lock: a mock run must not block or be blocked by schedule
  -- generation, only by another mock run of the same month.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_church_id::text),
    pg_catalog.hashtext(p_year::text || ':' || p_month::text)
  );

  -- 42501. The caller supplies p_actor_id, so this read of public.users is the
  -- only place the coordinator boundary is enforced, mirroring
  -- persist_month_schedule and reset_month_availability.
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_actor_id AND u.church_id = p_church_id AND u.is_active
      AND u.role IN ('admin', 'coordinator')
  ) THEN
    RAISE EXCEPTION 'Coordinator authorization could not be verified' USING ERRCODE = '42501';
  END IF;

  -- 22023. The route resolves entries from the church's own active roster;
  -- this re-check is the DB-side enforcement that no entry names a member
  -- outside the tenant or an inactive one.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(p_entries) AS items(item)
    LEFT JOIN public.members m
      ON m.id = (item->>'member_id')::uuid AND m.church_id = p_church_id
    WHERE m.id IS NULL OR m.status <> 'active'
  ) THEN
    RAISE EXCEPTION 'Every entry must name an active member of this church' USING ERRCODE = '22023';
  END IF;

  -- Lock every current submission for the month before reading or superseding
  -- any of them, ordered so concurrent writers take the rows in the same
  -- order. Non-current submissions are history and are left alone.
  PERFORM s.id
  FROM public.availability_submissions s
  WHERE s.church_id = p_church_id AND s.year = p_year AND s.month = p_month
    AND s.is_current
  ORDER BY s.id
  FOR UPDATE OF s;

  -- Legacy cleanup, BEFORE the per-member writes so the stamped rows leave the
  -- partial unique index (availability_active_weekly_member_month_week_idx)
  -- and cannot collide with the inserts below. These are the pre-workflow
  -- rows the old route wrote with no submission behind them; they are stamped
  -- 'rejected', never deleted, and only the live ones move.
  UPDATE public.availability a
  SET status = 'rejected'
  WHERE a.church_id = p_church_id AND a.type = 'weekly'
    AND a.month = p_month AND a.year = p_year
    AND a.reason LIKE 'Mock unavailability (%'
    AND a.submission_id IS NULL
    AND a.status IN ('pending', 'approved');
  GET DIAGNOSTICS v_deleted_legacy = ROW_COUNT;

  FOR v_entry IN SELECT value FROM pg_catalog.jsonb_array_elements(p_entries)
  LOOP
    v_member_id := (v_entry->>'member_id')::uuid;
    v_week_number := CASE
      WHEN pg_catalog.jsonb_typeof(v_entry->'week_number') = 'number'
      THEN (v_entry->>'week_number')::integer
      ELSE NULL
    END;

    SELECT * INTO v_current
    FROM public.availability_submissions s
    WHERE s.church_id = p_church_id AND s.member_id = v_member_id
      AND s.year = p_year AND s.month = p_month AND s.is_current;

    -- A member's own response always wins over a mock fixture. It is reported
    -- so the caller can disclose exactly who was left alone.
    IF FOUND AND v_current.source = 'member' THEN
      v_skipped_members := v_skipped_members || pg_catalog.jsonb_build_array(v_member_id::text);
      CONTINUE;
    END IF;

    -- Supersede the previous mock version: the old submission row is kept for
    -- history with is_current = FALSE and its availability rows are rejected.
    -- The submission status is NEVER written to 'rejected' (it is not a valid
    -- submission status); only availability rows carry that value.
    IF FOUND THEN
      UPDATE public.availability_submissions SET is_current = FALSE WHERE id = v_current.id;
      UPDATE public.availability SET status = 'rejected' WHERE submission_id = v_current.id;
    END IF;

    SELECT COALESCE(pg_catalog.max(s.version), 0) + 1 INTO v_version
    FROM public.availability_submissions s
    WHERE s.church_id = p_church_id AND s.member_id = v_member_id
      AND s.year = p_year AND s.month = p_month;

    INSERT INTO public.availability_submissions(church_id, member_id, month, year, status, version, is_current, source)
    VALUES (p_church_id, v_member_id, p_month, p_year, 'submitted', v_version, TRUE, 'mock')
    RETURNING id INTO v_submission_id;
    v_submissions_created := v_submissions_created + 1;

    IF v_week_number IS NULL THEN
      -- Empty submission: the member declares no unavailability. This is how
      -- sole-qualified members still complete the readiness gate without being
      -- mocked out of a week.
      v_empty_submissions := v_empty_submissions + 1;
    ELSE
      -- Linked at 'pending': the row only becomes active for scheduling when a
      -- coordinator approves the submission. The ON CONFLICT target mirrors
      -- submit_month_availability exactly (the partial unique index
      -- availability_active_weekly_member_month_week_idx): a live weekly row
      -- that survived the cleanup above (e.g. an unlinked real declaration) is
      -- adopted into the mock submission rather than colliding.
      INSERT INTO public.availability(member_id, church_id, type, week_number, month, year, reason, status, submission_id)
      VALUES (v_member_id, p_church_id, 'weekly', v_week_number, p_month, p_year, p_reason, 'pending', v_submission_id)
      ON CONFLICT (member_id, year, month, week_number)
        WHERE type = 'weekly' AND status IN ('pending', 'approved') AND month IS NOT NULL AND year IS NOT NULL
      DO UPDATE SET status = 'pending', submission_id = EXCLUDED.submission_id, reason = EXCLUDED.reason;
      GET DIAGNOSTICS v_rows = ROW_COUNT;
      v_entries_added := v_entries_added + v_rows;
    END IF;
  END LOOP;

  RETURN pg_catalog.jsonb_build_object(
    'submissions_created', v_submissions_created,
    'entries_added', v_entries_added,
    'empty_submissions', v_empty_submissions,
    'skipped_members', v_skipped_members,
    'deleted_legacy', v_deleted_legacy
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mock_month_availability(UUID, UUID, INTEGER, INTEGER, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mock_month_availability(UUID, UUID, INTEGER, INTEGER, TEXT, JSONB) TO service_role;
