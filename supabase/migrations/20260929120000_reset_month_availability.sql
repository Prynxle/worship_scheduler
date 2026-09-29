-- Coordinator-gated, church-wide, month-scoped reset of recorded unavailability.
--
-- Purpose: a coordinator needs to clear the unavailability recorded for a month
-- so the roster can re-declare it (a new month, a corrected brief, an event that
-- moved). No rows are deleted. Every current submission for the month moves to
-- 'revision_required' with the coordinator's note attached, and every absence
-- row for the month leaves the status IN ('pending','approved') set that the
-- scheduling engine reads. `is_current` and `version` are never written, so the
-- submission history is untouched and a reset stays reversible from the review
-- log.
--
-- The action is idempotent. A submission already at 'revision_required' that
-- has no live absence rows left is swept but not re-stamped and not re-logged,
-- so a double-clicked button, a client retry, or a second coordinator running
-- the reset again is a no-op that reports 0 and adds nothing to the audit
-- trail. A submission at 'revision_required' that still owns live rows is
-- stamped, logged and counted, because the sweep genuinely changes it.
--
-- The fourth returned count, remaining_blocking_dates, is a read-only
-- disclosure: date/range rows scoped outside this month are not cleared but can
-- still block it, and a caller that reported "nothing to reset" while one
-- remains would be telling the coordinator something false.

-- 'reset' is a third review action. The existing CHECK admits only the two
-- review_month_availability outcomes, and it is a named table constraint (not an
-- inline per-row one), so it is dropped and re-added rather than altered.
ALTER TABLE public.availability_submission_review_log
  DROP CONSTRAINT availability_submission_review_log_action_check;

ALTER TABLE public.availability_submission_review_log
  ADD CONSTRAINT availability_submission_review_log_action_check
  CHECK (action IN ('approved', 'revision_required', 'reset'));

-- SECURITY INVOKER, matching every sibling in 20260928084433. The only caller is
-- the service-role key, which is the table owner path already; SECURITY DEFINER
-- would grant owner privilege for no additional benefit.
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
  remaining_blocking_dates INTEGER
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

  RETURN QUERY SELECT v_submissions_reset, v_availability_reset, v_unscoped_availability_reset, v_remaining_blocking_dates;
END;
$$;

REVOKE ALL ON FUNCTION public.reset_month_availability(UUID, INTEGER, INTEGER, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reset_month_availability(UUID, INTEGER, INTEGER, UUID, TEXT) TO service_role;
