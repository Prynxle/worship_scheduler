-- ===========================================================================
-- Migration: availability reset invalidates the month's FUTURE drafts
-- Created: 2026-10-26
--
-- PROBLEM (GH #97)
-- ----------------
-- `reset_month_availability` was availability-only: it released the month's
-- unavailability but never touched `services` or `schedule_assignments`, and
-- `GET /api/song-lineups` reads `services` (status <> 'archived') plus their
-- assignments without joining availability at all. The Line Up Songs tab
-- therefore kept rendering the month's draft lineups after a reset, and those
-- drafts still claimed to be built from availability the coordinator had just
-- withdrawn.
--
-- FIX (invalidate, never delete)
-- ------------------------------
-- A new nullable column, `services.availability_reset_at`, marks a draft as
-- stale. The reset stamps every FUTURE-DATED draft of the month and writes one
-- `schedule_change_log` row per stamped service in the SAME statement, so the
-- reported count, the audit rows and the stamped rows are provably one set.
-- Nothing is deleted: assignments, songs, versions and history all survive.
--
-- DATE SCOPE, and why it is required
-- ----------------------------------
-- Only drafts with `date >= CURRENT_DATE` are stamped, and every guard ignores
-- a stamp whose service date has passed. `POST /api/schedule` regenerates only
-- `futureWeeks` (src/app/api/schedule/route.ts:104-132), so a stamp on a past
-- week could never be cleared by regenerating the month: a mid-month reset
-- would permanently brick that month. Past weeks keep the lineups they were
-- actually played with, and they are left exactly as they are.
--
-- LOCK ORDER
-- ----------
-- Submissions first (the `FOR UPDATE OF s` loop, id order), then `services`
-- (the stamp). `persist_month_schedule` takes the same two tables in the same
-- order, so this stays compatible; the pre-checks are deliberately plain,
-- non-locking EXISTS reads and take no lock on `services` at all.
--
-- `updated_at`
-- ------------
-- `update_services_updated_at` (20260727213200_scheduling.sql:85) is a BEFORE
-- UPDATE trigger that bumps `services.updated_at` when the stamp runs. That is
-- accepted: the column is informational, nothing in this repository reads it
-- to decide staleness, and `availability_reset_at` is the only marker any guard
-- consults. `updated_at` is deliberately not written explicitly here.
--
-- GRANTS
-- ------
-- `reset_month_availability` changes its `RETURNS TABLE` arity, which
-- `CREATE OR REPLACE` cannot do, so the function is DROPped first. A DROP
-- discards the function's ACL, so the REVOKE/GRANT pair at the end of this file
-- is re-issued verbatim -- without it the RPC would fall back to the PUBLIC
-- EXECUTE default and the route (service role) would lose its own access.
--
-- The other four functions keep their signatures, so they are redefined with
-- CREATE OR REPLACE and their existing grants survive untouched.
--
-- SCHEMA RELOAD
-- -------------
-- The new column has to be visible to PostgREST's cached schema, and the four
-- redefined function bodies are resolved through that cache. `NOTIFY pgrst,
-- 'reload schema';` is therefore the LAST statement, so it is not swallowed by
-- a later failure in this migration.
-- ===========================================================================

ALTER TABLE public.services ADD COLUMN availability_reset_at TIMESTAMPTZ;

-- Arity change: DROP, then recreate. See GRANTS above.
DROP FUNCTION IF EXISTS public.reset_month_availability(UUID, INTEGER, INTEGER, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.reset_month_availability(
  p_church_id UUID,
  p_month INTEGER,
  p_year INTEGER,
  p_actor_id UUID,
  p_note TEXT
)
RETURNS TABLE (
  submissions_reset INTEGER,
  availability_reset INTEGER,
  unscoped_availability_reset INTEGER,
  remaining_blocking_dates INTEGER,
  draft_services_invalidated INTEGER
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_submission RECORD;
  v_affected JSONB;
  v_submissions_reset INTEGER := 0;
  v_availability_reset INTEGER := 0;
  v_unscoped_availability_reset INTEGER := 0;
  v_remaining_blocking_dates INTEGER := 0;
  v_draft_services_invalidated INTEGER := 0;
BEGIN
  -- 22023. The blank-note check matches review_month_availability: a null
  -- revision_note would leave the member-facing "Revision requested: ..." label
  -- on the availability page with nothing after it.
  IF p_month < 0 OR p_month > 11 OR p_year < 2000 OR p_year > 2100
     OR pg_catalog.btrim(COALESCE(p_note, '')) = '' THEN
    RAISE EXCEPTION 'A month between 0 and 11, a year between 2000 and 2100, and a non-empty reset note are required' USING ERRCODE = '22023';
  END IF;

  -- 42501. The same actor re-verification persist_month_schedule performs, so a
  -- revoked or cross-tenant coordinator is refused here too and not only there.
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_actor_id AND u.church_id = p_church_id AND u.is_active
      AND u.role IN ('admin', 'coordinator')
  ) THEN
    RAISE EXCEPTION 'Coordinator authorization could not be verified' USING ERRCODE = '42501';
  END IF;

  -- 55000. `draft` and `archived` are deliberately resettable: a draft is not a
  -- published lineup and an archived service is superseded history, so neither
  -- is a reason to block a coordinator clearing a month. `validated` and
  -- `published` are refused because a reset silently invalidates the
  -- availability a coordinator already signed off on.
  --
  -- DELIBERATELY a plain, non-locking EXISTS read. persist_month_schedule locks
  -- availability_submissions (FOR UPDATE OF s) and only later locks `services`;
  -- taking a row lock on `services` here would invert that order and create a
  -- deadlock cycle. There is no advisory lock either: this action is serialised
  -- by the submission locks below, and a church+month advisory key would not
  -- collide with persist's ministry-keyed lock, so it would only look like
  -- serialization without providing any.
  IF EXISTS (
    SELECT 1 FROM public.services s
    WHERE s.church_id = p_church_id AND s.month = p_month AND s.year = p_year
      AND s.status IN ('validated', 'published')
  ) THEN
    RAISE EXCEPTION 'This month has a validated or published schedule; archive it before resetting availability' USING ERRCODE = '55000';
  END IF;

  -- W0005, pre-loop, plain non-locking EXISTS. Same predicate as the stamp CTE
  -- so the refusal and the stamp cannot disagree about which weeks are in play.
  -- A future draft that already owns a submitted song lineup cannot be
  -- regenerated, because regeneration deletes the draft services and
  -- `prevent_service_delete_with_song_lineup` refuses that. Stamping it would
  -- hide a week that the app can neither regenerate nor edit, so the reset is
  -- refused while there is still a coordinator in front of it to see why.
  IF EXISTS (
    SELECT 1 FROM public.services s
     WHERE s.church_id = p_church_id AND s.month = p_month AND s.year = p_year
       AND s.status = 'draft' AND s.date >= CURRENT_DATE
       AND EXISTS (SELECT 1 FROM public.song_lineups sl
                    WHERE sl.service_id = s.id AND sl.church_id = s.church_id)
  ) THEN
    RAISE EXCEPTION 'This month has draft weeks with submitted song lineups; regenerating them would erase the songs, so availability cannot be reset'
      USING ERRCODE = 'W0005';
  END IF;

  -- FOR UPDATE OF s, ordered by id so concurrent resets take the rows in the
  -- same order. Non-current submissions are history and are left alone.
  FOR v_submission IN
    SELECT s.id, s.status
    FROM public.availability_submissions s
    WHERE s.church_id = p_church_id AND s.year = p_year AND s.month = p_month
      AND s.is_current
    ORDER BY s.id
    FOR UPDATE OF s
  LOOP
    -- Snapshot the rows this step is about to change, BEFORE changing them, so
    -- the log row records the prior status of each one and the reset can be
    -- reversed from the log alone. Rows already 'rejected' are unaffected and
    -- are excluded, which also keeps the reported count equal to the number of
    -- rows the sweep below actually updates. A submission with no recorded
    -- unavailability yields '[]' rather than NULL. This MUST stay above the
    -- sweep: the sweep sets every one of these rows to 'rejected', so
    -- snapshotting after it would always find none.
    SELECT COALESCE(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('id', a.id, 'status', a.status) ORDER BY a.id
      ),
      '[]'::jsonb
    )
    INTO v_affected
    FROM public.availability a
    WHERE a.submission_id = v_submission.id
      AND a.status IN ('pending', 'approved');

    -- Rejecting is what actually takes the month out of scheduling: the engine
    -- and loadScheduleData (schedule-data.ts) read status IN
    -- ('pending','approved'). 'rejected' is an existing value of the
    -- availability status CHECK; the row and its reasons are kept.
    --
    -- This runs for every current submission, including one an earlier reset
    -- already moved to 'revision_required', so no live row can survive behind a
    -- current submission whatever state that submission is in. It is a no-op
    -- when the rows are already 'rejected'.
    UPDATE public.availability
    SET status = 'rejected'
    WHERE submission_id = v_submission.id
      AND status IN ('pending', 'approved');

    -- Idempotence guard, applied after the snapshot and the sweep above.
    --
    -- `is_current` must stay true (see the SET list below), so it cannot be
    -- the marker that this submission was already reset; 'revision_required' is
    -- the marker. A submission in that state is already asking the member to
    -- re-declare and its rows are already released, so there is nothing left to
    -- change. Without this guard a double-clicked button, a client retry, or a
    -- second coordinator running the reset again would overwrite
    -- reviewed_by/reviewed_at/revision_note and append a SECOND 'reset' row for
    -- the same submission, corrupting the very audit trail the log exists to
    -- provide, while still reporting the submission as reset a second time.
    --
    -- The `jsonb_array_length(v_affected) = 0` conjunct is load-bearing, not
    -- belt-and-braces. review_month_availability sets 'revision_required' and
    -- never touches availability rows, so a submission that reached
    -- revision_required through the ordinary review path can still own live
    -- 'pending'/'approved' rows. Under the bare status test this step would
    -- skip the stamp AND the log, while the sweep above had already flipped
    -- those rows to 'rejected': real data changed with no audit record of the
    -- prior statuses, and the call reported `reset: false` as if nothing had
    -- happened. Requiring an empty snapshot means a repeat that really did clear
    -- something is always stamped, logged, and counted; a genuine repeat still
    -- finds '[]' and stays a 0/0/0 no-op.
    --
    -- `pg_catalog.` is required: search_path is ''.
    CONTINUE WHEN v_submission.status = 'revision_required'
             AND pg_catalog.jsonb_array_length(v_affected) = 0;

    -- `is_current` and `version` are deliberately absent from this SET list.
    -- Unsetting `is_current` would break the partial unique index
    -- availability_submissions_one_current and would contradict the
    -- `availability_submission_review_log` row this step writes; bumping
    -- `version` would claim a resubmission that never happened.
    -- submit_month_availability remains the only writer of either column.
    UPDATE public.availability_submissions
    SET status = 'revision_required',
        reviewed_by = p_actor_id,
        reviewed_at = NOW(),
        revision_note = pg_catalog.btrim(p_note)
    WHERE id = v_submission.id;

    -- One log row per affected submission, carrying the prior submission status
    -- and the prior status of every availability row it released. The action is
    -- recorded as data, not inferred from the absence of rows.
    INSERT INTO public.availability_submission_review_log(church_id, submission_id, reviewer_id, action, note)
    VALUES (
      p_church_id, v_submission.id, p_actor_id, 'reset',
      pg_catalog.jsonb_build_object(
        'note', pg_catalog.btrim(p_note),
        'prior_submission_status', v_submission.status,
        'month', p_month,
        'year', p_year,
        'availability', v_affected
      )::text
    );

    v_submissions_reset := v_submissions_reset + 1;
    v_availability_reset := v_availability_reset + pg_catalog.jsonb_array_length(v_affected);
  END LOOP;

  -- Absence rows with no live submission behind them. That is the legacy set
  -- written by POST /api/availability (submission_id IS NULL), which
  -- loadScheduleData reads with no month filter at all and which therefore
  -- blocks scheduling; it also covers the defensive case of a row still left
  -- pending on a superseded submission, which would keep blocking after the
  -- loop above. Rows behind a current submission were already handled and are
  -- no longer 'pending'/'approved', so this cannot double count them.
  --
  -- These rows have no submission to log against (the review log's submission_id
  -- is NOT NULL), so they are reported as their own count rather than being
  -- folded into the per-submission log.
  --
  -- The name is `unscoped_`, not `legacy_`, because the predicate is literally
  -- `a.year = p_year AND a.month = p_month`: the rows it counts are precisely
  -- those stamped with this month that have no current submission behind them
  -- and no submission at all.
  UPDATE public.availability a
  SET status = 'rejected'
  WHERE a.church_id = p_church_id AND a.year = p_year AND a.month = p_month
    AND a.status IN ('pending', 'approved')
    AND NOT EXISTS (
      SELECT 1 FROM public.availability_submissions s
      WHERE s.id = a.submission_id AND s.is_current
    );
  GET DIAGNOSTICS v_unscoped_availability_reset = ROW_COUNT;

  -- Stamp + audit rows in ONE statement so the count, the log and the rows are
  -- provably the same set. RETURNING yields NEW values; week_number, date and
  -- schedule_version are not in SET, so NEW == OLD for them. status is
  -- hardcoded 'draft' because the WHERE clause requires it.
  --
  -- `availability_reset_at IS NULL` keeps this idempotent: a second reset of the
  -- same month re-stamps nothing and logs nothing, so a repeat click reads as
  -- `draft_services_invalidated: 0` instead of appending duplicate audit rows.
  --
  -- `date >= CURRENT_DATE` is the scope: see the header. Regeneration can only
  -- reach future weeks, so a stamp on a past week would be permanent.
  WITH stamped AS (
    UPDATE public.services s
       SET availability_reset_at = pg_catalog.now()
     WHERE s.church_id = p_church_id AND s.month = p_month AND s.year = p_year
       AND s.status = 'draft' AND s.date >= CURRENT_DATE
       AND s.availability_reset_at IS NULL
    RETURNING s.id, s.church_id, s.week_number, s.date, s.schedule_version, s.availability_reset_at
  )
  INSERT INTO public.schedule_change_log(church_id, service_id, actor_id, action, reason, before_state, after_state)
  SELECT stamped.church_id, stamped.id, p_actor_id, 'availability_reset',
         'Month availability was reset; this draft was built from unavailability that has been withdrawn',
         pg_catalog.jsonb_build_object('status', 'draft', 'schedule_version', stamped.schedule_version,
                                       'week_number', stamped.week_number, 'date', stamped.date),
         pg_catalog.jsonb_build_object('availability_reset_at', stamped.availability_reset_at)
    FROM stamped;
  GET DIAGNOSTICS v_draft_services_invalidated = ROW_COUNT;

  -- Re-assert W0005 after the stamp, verbatim. A concurrent `save_song_lineup`
  -- can pass its own W0004 guard while this transaction's stamp is not yet
  -- visible to it, so a lineup can land between the pre-check and here. This
  -- re-read NARROWS but does not CLOSE that window: the stamp above is an
  -- `UPDATE services` taking FOR NO KEY UPDATE, while `save_song_lineup`'s FK
  -- check on `song_lineups.service_id` takes FOR KEY SHARE, and those lock modes
  -- do not conflict, so no ordering is established. The residual failure
  -- direction is safe: the later regeneration `DELETE` is refused by
  -- `prevent_service_delete_with_song_lineup`, so no song is ever erased and the
  -- coordinator sees an error instead.
  IF EXISTS (
    SELECT 1 FROM public.services s
     WHERE s.church_id = p_church_id AND s.month = p_month AND s.year = p_year
       AND s.status = 'draft' AND s.date >= CURRENT_DATE
       AND EXISTS (SELECT 1 FROM public.song_lineups sl
                    WHERE sl.service_id = s.id AND sl.church_id = s.church_id)
  ) THEN
    RAISE EXCEPTION 'This month has draft weeks with submitted song lineups; regenerating them would erase the songs, so availability cannot be reset'
      USING ERRCODE = 'W0005';
  END IF;

  -- Re-assert 55000 after the stamp: a concurrent validate_month_schedule can
  -- promote one of these drafts between the pre-check and the stamp.
  IF EXISTS (
    SELECT 1 FROM public.services s
     WHERE s.church_id = p_church_id AND s.month = p_month AND s.year = p_year
       AND s.status IN ('validated', 'published')
  ) THEN
    RAISE EXCEPTION 'This month has a validated or published schedule; archive it before resetting availability' USING ERRCODE = '55000';
  END IF;

  -- Read-only disclosure. Date/range rows are matched by the engine purely on
  -- the service date (engine.ts isUnavailable, validator.ts checkAvailability),
  -- so they can still block this month after the reset. They are deliberately
  -- NOT cleared: a month-scoped reset must not silently destroy a date range
  -- that was never scoped to this month. Counted so the UI can disclose the
  -- limitation instead of reporting "nothing to reset" while a blocker remains.
  --
  -- Weekly rows are excluded on purpose: isWeeklyUnavailable gates on
  -- `record.month === undefined || record.month === month`, and a SQL NULL
  -- arrives as JSON null, so `null === undefined` is false and such a row can
  -- never match any month. Clearing one would erase a real declaration to fix
  -- a non-problem.
  --
  -- IS DISTINCT FROM, never NOT (... = ...): three-valued logic returns NULL
  -- for a NULL month and would silently drop exactly the rows counted here.
  SELECT count(*)::int
  INTO v_remaining_blocking_dates
  FROM public.availability a
  WHERE a.church_id = p_church_id
    AND a.status IN ('pending','approved')
    AND (a.month IS DISTINCT FROM p_month OR a.year IS DISTINCT FROM p_year)
    AND a.type IN ('date','vacation','temporary_leave','emergency_leave','recurring')
    AND a.date IS NOT NULL
    AND a.date < (pg_catalog.make_date(p_year, p_month + 1, 1) + interval '1 month')::date
    AND COALESCE(a.end_date, a.date) >= pg_catalog.make_date(p_year, p_month + 1, 1);

  RETURN QUERY SELECT v_submissions_reset, v_availability_reset, v_unscoped_availability_reset, v_remaining_blocking_dates, v_draft_services_invalidated;
END;
$$;

-- W0004: a stamped, future-dated draft is not validatable. This is defence in
-- depth: `POST /api/validation` refuses it by route pre-check before the RPC is
-- ever called, and the SQLSTATE travels with the refusal so both layers report
-- the same code.
CREATE OR REPLACE FUNCTION public.validate_service_schedule(
  p_church_id UUID,
  p_service_id UUID,
  p_actor_id UUID,
  p_expected_version INTEGER,
  p_validation_results JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE v_service public.services%ROWTYPE;
BEGIN
  SELECT * INTO v_service FROM public.services WHERE id = p_service_id AND church_id = p_church_id FOR UPDATE;
  IF NOT FOUND OR v_service.ministry_id IS NULL THEN RAISE EXCEPTION 'Schedule not found or has unresolved ministry ownership' USING ERRCODE = 'P0002'; END IF;
  IF v_service.availability_reset_at IS NOT NULL AND v_service.date >= CURRENT_DATE THEN
    RAISE EXCEPTION 'Availability for this month was reset; regenerate the schedule before validating it' USING ERRCODE = 'W0004';
  END IF;
  -- A draft, OR a `validated` row whose stamp no longer matches the current
  -- version (an edit re-opens validation; a stamp-less `validated` row is the
  -- same drifted state). A freshly validated row is NOT re-validatable.
  IF (v_service.status <> 'draft'
      AND NOT (v_service.status = 'validated' AND v_service.validated_version IS DISTINCT FROM v_service.schedule_version))
     OR v_service.schedule_version <> p_expected_version THEN
    RAISE EXCEPTION 'Schedule is not a current draft' USING ERRCODE = '40001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_actor_id AND church_id = p_church_id AND is_active AND role IN ('admin', 'coordinator')) THEN RAISE EXCEPTION 'Coordinator authorization could not be verified' USING ERRCODE = '42501'; END IF;
  -- THE RE-ASSERTION. A draft may hold a deferred gap; validation may not.
  PERFORM public.assert_service_meets_publication_rules(p_church_id, p_service_id);
  UPDATE public.services SET status = 'validated', validated_version = schedule_version, validated_by = p_actor_id, validated_at = NOW() WHERE id = p_service_id;
  INSERT INTO public.schedule_change_log(church_id, service_id, actor_id, action, from_version, to_version, after_state)
  VALUES (p_church_id, p_service_id, p_actor_id, 'validated', v_service.schedule_version, v_service.schedule_version,
    jsonb_build_object('results', COALESCE(p_validation_results, '[]'::jsonb)));
  RETURN v_service.schedule_version;
END;
$$;

-- W0004: a stamped service is not publishable either. The existing 55000 guard
-- runs first and a stamped row is still a draft, so this branch is only
-- reachable for a row that reached 'validated' before the stamp; it is kept as
-- defence in depth because `POST .../publish` refuses by route pre-check.
CREATE OR REPLACE FUNCTION public.publish_service_schedule(
  p_church_id UUID,
  p_service_id UUID,
  p_actor_id UUID,
  p_expected_version INTEGER
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE v_service public.services%ROWTYPE;
BEGIN
  SELECT * INTO v_service FROM public.services WHERE id = p_service_id AND church_id = p_church_id FOR UPDATE;
  IF NOT FOUND OR v_service.status <> 'validated' OR v_service.ministry_id IS NULL
     OR v_service.validated_version IS DISTINCT FROM v_service.schedule_version
     OR v_service.schedule_version <> p_expected_version THEN
    RAISE EXCEPTION 'Schedule must be validated for its current version before publication' USING ERRCODE = '55000';
  END IF;
  IF v_service.availability_reset_at IS NOT NULL AND v_service.date >= CURRENT_DATE THEN
    RAISE EXCEPTION 'Availability for this month was reset; regenerate the schedule before publishing it' USING ERRCODE = 'W0004';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_actor_id AND church_id = p_church_id AND is_active AND role IN ('admin', 'coordinator')) THEN RAISE EXCEPTION 'Coordinator authorization could not be verified' USING ERRCODE = '42501'; END IF;
  -- Re-asserted here too, not merely inherited from validate: publishing must not
  -- depend on a prior call having happened to be the thing that enforced it.
  PERFORM public.assert_service_meets_publication_rules(p_church_id, p_service_id);
  UPDATE public.services SET status = 'published', published_by = p_actor_id, published_at = NOW() WHERE id = p_service_id;
  INSERT INTO public.schedule_change_log(church_id, service_id, actor_id, action, from_version, to_version)
  VALUES (p_church_id, p_service_id, p_actor_id, 'published', v_service.schedule_version, v_service.schedule_version);
  IF v_service.revision_of IS NOT NULL THEN
    UPDATE public.services SET status = 'archived' WHERE id = v_service.revision_of AND church_id = p_church_id AND status = 'published';
    INSERT INTO public.schedule_change_log(church_id, service_id, actor_id, action, from_version, to_version, reason, before_state)
    VALUES (p_church_id, v_service.revision_of, p_actor_id, 'superseded', NULL, v_service.schedule_version, 'Published schedule revision', to_jsonb(v_service));
  END IF;
END;
$$;

-- W0004: the month pipeline refuses to validate a month containing a stamped
-- future draft. The lock-order note matters here: this check is a plain read
-- placed BEFORE the `FOR UPDATE` candidate lock, so it cannot invert the
-- submissions-then-services order that `persist_month_schedule` and
-- `reset_month_availability` share.
CREATE OR REPLACE FUNCTION public.validate_month_schedule(
  p_church_id UUID,
  p_ministry_id UUID,
  p_month INTEGER,
  p_year INTEGER,
  p_actor_id UUID,
  p_validation_summary JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_candidate_ids UUID[];
  v_ids UUID[];
  v_draft_count INTEGER;
  v_service public.services%ROWTYPE;
  v_validated UUID[] := ARRAY[]::UUID[];
  v_already UUID[] := ARRAY[]::UUID[];
  v_published UUID[] := ARRAY[]::UUID[];
  v_month_status TEXT;
  v_version INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_actor_id AND church_id = p_church_id AND is_active AND role IN ('admin', 'coordinator')) THEN
    RAISE EXCEPTION 'Coordinator authorization could not be verified' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.services s
     WHERE s.church_id = p_church_id AND s.month = p_month AND s.year = p_year
       AND s.status <> 'archived'
       AND s.availability_reset_at IS NOT NULL AND s.date >= CURRENT_DATE
       AND (p_ministry_id IS NULL OR s.ministry_id = p_ministry_id)
  ) THEN
    RAISE EXCEPTION 'Availability for this month was reset; regenerate the schedule before validating it' USING ERRCODE = 'W0004';
  END IF;

  -- Lock the candidate superset so the ranked read below is stable, then read
  -- the active (ranked) set among the locked rows.
  SELECT ARRAY(
    SELECT s.id FROM public.services s
    WHERE s.church_id = p_church_id AND s.month = p_month AND s.year = p_year
      AND s.status <> 'archived'
      AND (p_ministry_id IS NULL OR s.ministry_id = p_ministry_id)
    FOR UPDATE
  ) INTO v_candidate_ids;

  v_ids := public.month_active_service_ids(p_church_id, p_ministry_id, p_month, p_year);
  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'No schedules exist for this month' USING ERRCODE = 'P0002';
  END IF;

  SELECT COUNT(*) INTO v_draft_count
  FROM public.services WHERE id = ANY(v_ids) AND status = 'draft';
  IF v_draft_count = 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'nothing_to_validate',
      'month_status', public.month_derive_status(p_church_id, p_ministry_id, p_month, p_year)
    );
  END IF;

  FOR v_service IN
    SELECT active.* FROM public.services active
    WHERE active.id = ANY(v_ids)
    ORDER BY active.date
  LOOP
    IF v_service.status = 'published' THEN
      v_published := array_append(v_published, v_service.id);
      CONTINUE;
    END IF;
    IF v_service.status = 'validated' AND v_service.validated_version IS NOT DISTINCT FROM v_service.schedule_version THEN
      v_already := array_append(v_already, v_service.id);
      CONTINUE;
    END IF;
    -- A validated service whose version drifted after an edit is re-validated
    -- like a draft: it must pass the publication rules again for its CURRENT
    -- version, or the reported 'validated' month would contradict the derived
    -- status (which requires version match on every service).
    IF v_service.status NOT IN ('draft', 'validated') THEN
      CONTINUE;
    END IF;

    -- THE RE-ASSERTION, per draft, identical to `validate_service_schedule`.
    PERFORM public.assert_service_meets_publication_rules(p_church_id, v_service.id);

    v_version := COALESCE(v_service.schedule_version, 1);
    UPDATE public.services
       SET status = 'validated',
           validated_version = v_version,
           validated_by = p_actor_id,
           validated_at = NOW()
     WHERE id = v_service.id;
    INSERT INTO public.schedule_change_log(church_id, service_id, actor_id, action, from_version, to_version, after_state)
    VALUES (p_church_id, v_service.id, p_actor_id, 'validated', v_service.schedule_version, v_version,
      jsonb_build_object('scope', 'month', 'results', COALESCE(p_validation_summary, '[]'::jsonb)));
    v_validated := array_append(v_validated, v_service.id);
  END LOOP;

  v_month_status := 'validated';

  INSERT INTO public.month_schedules(church_id, ministry_id, month, year, status, updated_by, updated_at)
  VALUES (p_church_id, p_ministry_id, p_month, p_year, v_month_status, p_actor_id, NOW())
  ON CONFLICT (church_id, ministry_id, month, year)
  DO UPDATE SET status = EXCLUDED.status, updated_by = EXCLUDED.updated_by, updated_at = NOW();

  INSERT INTO public.schedule_change_log(church_id, service_id, actor_id, action, from_version, to_version, after_state)
  VALUES (p_church_id, NULL, p_actor_id, 'month_validated', NULL, NULL,
    jsonb_build_object(
      'ministry_id', p_ministry_id,
      'month', p_month,
      'year', p_year,
      'validated', v_validated,
      'already_validated', v_already,
      'skipped_published', v_published,
      'summary', COALESCE(p_validation_summary, '[]'::jsonb)
    ));

  RETURN jsonb_build_object(
    'ok', true,
    'month_status', v_month_status,
    'validated', v_validated,
    'already_validated', v_already,
    'skipped_published', v_published
  );
END;
$$;

-- W0004: songs cannot be submitted against a schedule built from withdrawn
-- availability. `SET search_path = public` is preserved exactly from
-- 20261013040915 so the unqualified names in the body keep resolving.
CREATE OR REPLACE FUNCTION public.save_song_lineup(
  p_church_id UUID, p_service_id UUID, p_member_id UUID, p_songs JSONB
) RETURNS UUID LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE v_lineup_id UUID; v_song JSONB; v_position INTEGER := 0;
BEGIN
  IF p_songs IS NULL OR jsonb_typeof(p_songs) <> 'array' THEN
    RAISE EXCEPTION 'Song details are invalid' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_songs) < 2 OR jsonb_array_length(p_songs) > 30 THEN
    RAISE EXCEPTION 'A lineup must contain between 2 and 30 songs' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.services s JOIN public.schedule_assignments a ON a.service_id = s.id
    JOIN public.members m ON m.id = a.member_id
    WHERE s.id = p_service_id AND s.church_id = p_church_id AND a.member_id = p_member_id
      AND a.is_leader AND m.church_id = p_church_id AND m.status = 'active'
  ) THEN RAISE EXCEPTION 'Leader assignment is not valid' USING ERRCODE = '42501'; END IF;

  IF EXISTS (
    SELECT 1 FROM public.services s
     WHERE s.id = p_service_id AND s.church_id = p_church_id
       AND s.availability_reset_at IS NOT NULL AND s.date >= CURRENT_DATE
  ) THEN
    RAISE EXCEPTION 'Availability for this month was reset; songs cannot be submitted for a stale schedule' USING ERRCODE = 'W0004';
  END IF;

  INSERT INTO public.song_lineups(church_id, service_id, submitted_by_member_id, status)
    VALUES (p_church_id, p_service_id, p_member_id, 'submitted')
    ON CONFLICT (service_id) DO UPDATE SET submitted_by_member_id = p_member_id,
      status = 'submitted', submitted_at = now(), confirmed_at = NULL,
      withdrawn_at = NULL, updated_at = now()
      WHERE song_lineups.church_id = p_church_id
    RETURNING id INTO v_lineup_id;
  IF v_lineup_id IS NULL THEN RAISE EXCEPTION 'Lineup cannot be edited by this leader' USING ERRCODE = '42501'; END IF;

  DELETE FROM public.song_lineup_songs WHERE lineup_id = v_lineup_id;
  FOR v_song IN SELECT value FROM jsonb_array_elements(p_songs) LOOP
    IF length(btrim(coalesce(v_song->>'title', ''))) NOT BETWEEN 1 AND 200
      OR length(coalesce(v_song->>'song_url', '')) > 2048
      OR coalesce(v_song->>'song_url', '') !~* '^https?://'
      OR length(coalesce(v_song->>'musical_key', '')) > 32
      OR length(coalesce(v_song->>'chords_url', '')) > 2048
      OR (coalesce(v_song->>'chords_url', '') <> '' AND v_song->>'chords_url' !~* '^https?://') THEN
      RAISE EXCEPTION 'Song details are invalid' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.song_lineup_songs(lineup_id, title, song_url, musical_key, chords_url, position)
      VALUES (v_lineup_id, btrim(v_song->>'title'), v_song->>'song_url',
        nullif(btrim(v_song->>'musical_key'), ''), nullif(btrim(v_song->>'chords_url'), ''), v_position);
    v_position := v_position + 1;
  END LOOP;
  RETURN v_lineup_id;
END; $$;

-- Re-issued verbatim: the DROP above discarded the ACL, so without these the
-- function would fall back to PUBLIC EXECUTE and the service role would have no
-- grant of its own.
REVOKE ALL ON FUNCTION public.reset_month_availability(UUID, INTEGER, INTEGER, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_month_availability(UUID, INTEGER, INTEGER, UUID, TEXT) TO service_role;

-- Last statement: makes the new column and the redefined bodies visible to
-- PostgREST's schema cache in one reload.
NOTIFY pgrst, 'reload schema';
