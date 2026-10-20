-- Fix: make the editable window month-granular so the current month stays editable.
--
-- Two write paths compared a service's DATE against CURRENT_DATE:
--
--   public.replace_service_assignments  -> refused ANY service whose date had
--                                          passed, with a 55000 mapping to 409;
--   public.persist_month_schedule      -> refused to persist any service whose
--                                          date had passed, with a 22023.
--
-- The application's own gate is month-granular: the schedule page computes
-- `monthIsPast` (now `isMonthBefore` in date-utils.ts) and only locks the
-- controls once the ENTIRE month is behind us. It therefore kept offering
-- "Edit lineup" for a service earlier in the current month, and every save was
-- then refused by the database — the coordinator saw a red "Historical schedules
-- are read-only" on an edit the UI had presented as allowed.
--
-- The two authorities now agree on the SAME boundary:
--   date_trunc('month', service.date) < date_trunc('month', CURRENT_DATE)
-- i.e. only a WHOLE past month is read-only. A service earlier in the current
-- month stays editable, which is also what the publication gate already assumes:
-- `assert_service_meets_publication_rules` carries no date guard at all, so a
-- past-dated service could be validated and published but never corrected.
--
-- This relaxes a WORKFLOW guard, not a scheduling rule. Rules 1-10 are untouched:
-- every availability, active-member, role, instrument, dual-role, leader, backup
-- and monthly-limit check above/below this block is preserved verbatim, and
-- `revision_of IS NULL` still keeps amendment semantics unchanged.
--
-- Regenerated from the LIVE definitions (which already differ from the older
-- migrations) so no unrelated rule is regressed by these replacements; only the
-- guard lines and the now-inaccurate "future dates" message differ.
CREATE OR REPLACE FUNCTION public.replace_service_assignments(p_church_id uuid, p_service_id uuid, p_actor_id uuid, p_expected_version integer, p_assignments jsonb, p_reason text DEFAULT NULL::text, p_unfilled_positions jsonb DEFAULT '[]'::jsonb, p_active_overrides jsonb DEFAULT '{}'::jsonb)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_service public.services%ROWTYPE;
  v_assignment JSONB;
  v_old JSONB;
  v_new_version INTEGER;
  v_min_backups INTEGER;
  v_max_backups INTEGER;
  v_monthly_limit INTEGER;
  v_backup_count INTEGER;
  v_leader_count INTEGER;
  v_override_availability BOOLEAN;
  v_override_instrument BOOLEAN;
BEGIN
  IF jsonb_typeof(p_assignments) <> 'array' THEN
    RAISE EXCEPTION 'Assignments must be an array' USING ERRCODE = '22023';
  END IF;
  -- Reject a malformed override payload with a 22023 rather than letting the
  -- table CHECK constraint surface it later as a 23514 the client cannot interpret.
  IF jsonb_typeof(p_active_overrides) <> 'object'
     OR NOT (p_active_overrides = '{}'::jsonb
             OR p_active_overrides = '{"availability": true}'::jsonb
             OR p_active_overrides = '{"instrument_qualification": true}'::jsonb
             OR p_active_overrides = '{"availability": true, "instrument_qualification": true}'::jsonb) THEN
    RAISE EXCEPTION 'Overrides may only license availability and instrument_qualification' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_unfilled_positions) <> 'array' OR EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(p_unfilled_positions) AS gaps(gap)
    WHERE jsonb_typeof(gaps.gap) <> 'object'
      OR jsonb_typeof(gaps.gap->'week_number') <> 'number'
      OR jsonb_typeof(gaps.gap->'role_name') <> 'string'
      OR jsonb_typeof(gaps.gap->'required_slots') <> 'number'
      OR jsonb_typeof(gaps.gap->'message') <> 'string'
  ) THEN
    RAISE EXCEPTION 'Unfilled positions must be an array of gap objects' USING ERRCODE = '22023';
  END IF;

  v_override_availability := COALESCE((p_active_overrides->>'availability')::boolean, FALSE);
  v_override_instrument := COALESCE((p_active_overrides->>'instrument_qualification')::boolean, FALSE);

  SELECT * INTO v_service FROM public.services s
  WHERE s.id = p_service_id AND s.church_id = p_church_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Schedule not found' USING ERRCODE = 'P0002'; END IF;
  IF v_service.status NOT IN ('draft', 'validated') OR v_service.ministry_id IS NULL THEN
    RAISE EXCEPTION 'Only scoped draft or validated schedules can be edited; published schedules require an amendment' USING ERRCODE = '55000';
  END IF;
  -- CHANGED: month-granular (was `v_service.date < CURRENT_DATE`). A service
  -- earlier in the current month is still editable; only a whole past month is
  -- read-only. Must stay in lockstep with `isMonthBefore` in date-utils.ts.
  IF pg_catalog.date_trunc('month', v_service.date)::date < pg_catalog.date_trunc('month', CURRENT_DATE)::date AND v_service.revision_of IS NULL THEN
    RAISE EXCEPTION 'Historical schedules are read-only; create an explicit amendment to make a change' USING ERRCODE = '55000';
  END IF;
  IF v_service.schedule_version <> p_expected_version THEN
    RAISE EXCEPTION 'Schedule changed since it was loaded; refresh and retry' USING ERRCODE = '40001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_actor_id AND u.church_id = p_church_id AND u.is_active AND u.role IN ('admin', 'coordinator')) THEN
    RAISE EXCEPTION 'Coordinator authorization could not be verified' USING ERRCODE = '42501';
  END IF;
  -- AUDIT REQUIREMENT: an override licence is not a silent state change. A licence
  -- without a non-empty reason is refused here, before any write.
  IF p_active_overrides <> '{}'::jsonb AND pg_catalog.btrim(COALESCE(p_reason, '')) = '' THEN
    RAISE EXCEPTION 'A reason is required to record a coordinator override' USING ERRCODE = '22023';
  END IF;

  -- Rule 3. Unconditional.
  IF (SELECT COUNT(*) FROM pg_catalog.jsonb_array_elements(p_assignments)) <>
     (SELECT COUNT(DISTINCT item->>'member_id') FROM pg_catalog.jsonb_array_elements(p_assignments) AS entries(item)) THEN
    RAISE EXCEPTION 'A member may only have one role per service' USING ERRCODE = '23505';
  END IF;
  -- Rule 5. CHANGED FROM `= 1` to `<= 1`: a draft may have no leader, and the
  -- gap is recorded in unfilled_positions. Two or more is still refused, because
  -- an over-assigned month is a double-booking, not a gap. Exactly-one is
  -- re-asserted by assert_service_meets_publication_rules at validate and publish.
  SELECT COUNT(*) INTO v_leader_count
  FROM pg_catalog.jsonb_array_elements(p_assignments) AS entries(item)
  WHERE COALESCE((item->>'is_leader')::boolean, FALSE);
  IF v_leader_count > 1 THEN
    RAISE EXCEPTION 'At most one worship leader may be assigned' USING ERRCODE = '23514';
  END IF;
  -- `lower(btrim(...))`, not `lower(...)`: the shared TypeScript predicate is
  -- `normalizeRoleName` = `name.trim().toLowerCase()`. A role stored as
  -- ' Worship Leader ' is leader-qualified for the validator but would be rejected
  -- here, so the two authorities would disagree on the same row. Trimming only
  -- WIDENS the match, which is the direction the role-classifier guard rail allows.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(p_assignments) AS entries(item)
    LEFT JOIN public.roles r ON r.id = (item->>'role_id')::uuid
    WHERE COALESCE((item->>'is_leader')::boolean, FALSE) IS DISTINCT FROM (pg_catalog.lower(pg_catalog.btrim(COALESCE(r.name, ''))) = 'worship leader')
  ) THEN
    RAISE EXCEPTION 'The Worship Leader role and leader marker must identify the same single assignment' USING ERRCODE = '23514';
  END IF;
  -- Rule 6 (inactive), Rule 7 (leader-role qualification), ministry scoping, and the
  -- instrument-skill check. UNCONDITIONAL except the skill clause, which is the one
  -- overridable qualification axis. Note what is NOT in the exempt list: the
  -- leader-role check on the next line is never exempted, so a coordinator cannot
  -- book an unqualified worship leader.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(p_assignments) AS entries(item)
    LEFT JOIN public.members m ON m.id = (item->>'member_id')::uuid AND m.church_id = p_church_id
    LEFT JOIN public.roles r ON r.id = (item->>'role_id')::uuid AND r.ministry_id = v_service.ministry_id AND r.is_active
    WHERE m.id IS NULL OR m.status <> 'active' OR r.id IS NULL
      OR (NOT COALESCE((item->>'is_devotion')::boolean, FALSE) AND NOT EXISTS (SELECT 1 FROM public.member_roles mr WHERE mr.member_id = m.id AND mr.role_id = r.id))
      OR (COALESCE((item->>'is_leader')::boolean, FALSE) AND pg_catalog.lower(pg_catalog.btrim(r.name)) <> 'worship leader')
      OR (NOT v_override_instrument AND NULLIF(item->>'instrument_id', '') IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.member_skills ms
        JOIN public.instruments i ON i.id = ms.instrument_id AND i.ministry_id = v_service.ministry_id
        WHERE ms.member_id = m.id AND ms.instrument_id = (item->>'instrument_id')::uuid
      ))
  ) THEN
    RAISE EXCEPTION 'An assignment has an inactive member or an invalid ministry role or skill' USING ERRCODE = '23514';
  END IF;
  -- Rule 1 (availability). UNCONDITIONAL unless the coordinator holds an explicit
  -- availability licence for this service.
  IF NOT v_override_availability AND EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(p_assignments) AS entries(item)
    JOIN public.members m ON m.id = (item->>'member_id')::uuid
    JOIN public.availability a ON a.member_id = m.id AND a.church_id = p_church_id
      AND a.status IN ('pending', 'approved')
      AND (
        (a.type = 'weekly' AND a.week_number = v_service.week_number AND (a.month IS NULL OR a.month = v_service.month) AND (a.year IS NULL OR a.year = v_service.year))
        OR (a.type = 'date' AND a.date = v_service.date)
        OR (a.type IN ('vacation', 'temporary_leave', 'emergency_leave', 'recurring') AND a.date <= v_service.date AND COALESCE(a.end_date, a.date) >= v_service.date)
        OR (a.type = 'recurring' AND a.week_number = v_service.week_number AND (a.month IS NULL OR a.month = v_service.month) AND (a.year IS NULL OR a.year = v_service.year))
      )
  ) THEN
    RAISE EXCEPTION 'An assigned member is unavailable for this service' USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE((mr.rule_config->>'min_required')::integer, (c.settings->>'default_min_backup_singers')::integer, 3),
         COALESCE((mr.rule_config->>'max_allowed')::integer, (c.settings->>'default_max_backup_singers')::integer, 3)
  INTO v_min_backups, v_max_backups
  FROM public.churches c
  LEFT JOIN LATERAL (SELECT rule_config FROM public.ministry_rules WHERE ministry_id = v_service.ministry_id AND rule_type = 'backup_count' AND is_active LIMIT 1) mr ON TRUE
  WHERE c.id = p_church_id;
  -- Rule 4. CHANGED FROM `NOT BETWEEN min AND max` to `> max` only: the maximum is
  -- still hard, the minimum is a deferrable gap. The minimum is re-asserted at
  -- validate and publish.
  SELECT COUNT(*) INTO v_backup_count
  FROM pg_catalog.jsonb_array_elements(p_assignments) AS entries(item)
  JOIN public.roles r ON r.id = (item->>'role_id')::uuid
  WHERE NOT COALESCE((item->>'is_leader')::boolean, FALSE)
    AND NOT COALESCE((item->>'is_devotion')::boolean, FALSE) AND NULLIF(item->>'instrument_id', '')::uuid IS NULL
    AND pg_catalog.lower(r.name) ~ '(vocal|singer|backup|back up)';
  IF v_backup_count > v_max_backups THEN
    RAISE EXCEPTION 'Backup count % exceeds the configured maximum %', v_backup_count, v_max_backups USING ERRCODE = '23514';
  END IF;

  -- Rule 2 (monthly limit). UNCONDITIONAL: no override axis reaches it.
  SELECT COALESCE((c.settings->>'default_max_monthly_assignments')::integer, 3)
  INTO v_monthly_limit FROM public.churches c WHERE c.id = p_church_id;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(p_assignments) AS entries(item)
    JOIN public.members m ON m.id = (item->>'member_id')::uuid
    WHERE (
      SELECT COUNT(*) FROM public.schedule_assignments a
      JOIN public.services s ON s.id = a.service_id
      WHERE a.member_id = m.id AND s.church_id = p_church_id
        AND s.month = v_service.month AND s.year = v_service.year AND s.id <> p_service_id
        AND s.status <> 'archived'
        AND (v_service.revision_of IS NULL OR s.id <> v_service.revision_of)
    ) + (
      SELECT COUNT(*) FROM pg_catalog.jsonb_array_elements(p_assignments) AS entries2(item2)
      WHERE item2->>'member_id' = m.id::text
    ) > COALESCE(NULLIF(m.max_monthly_assignments, 0), v_monthly_limit)
  ) THEN
    RAISE EXCEPTION 'A member would exceed the monthly assignment limit' USING ERRCODE = '23514';
  END IF;

  SELECT jsonb_build_object('service', to_jsonb(s), 'assignments', COALESCE(jsonb_agg(to_jsonb(a)) FILTER (WHERE a.id IS NOT NULL), '[]'::jsonb))
  INTO v_old FROM public.services s LEFT JOIN public.schedule_assignments a ON a.service_id = s.id
  WHERE s.id = p_service_id GROUP BY s.id;
  DELETE FROM public.schedule_assignments WHERE service_id = p_service_id;
  FOR v_assignment IN SELECT value FROM pg_catalog.jsonb_array_elements(p_assignments)
  LOOP
    INSERT INTO public.schedule_assignments(service_id, member_id, role_id, instrument_id, is_leader, is_devotion, status, assigned_by)
    VALUES (p_service_id, (v_assignment->>'member_id')::uuid, (v_assignment->>'role_id')::uuid,
      NULLIF(v_assignment->>'instrument_id', '')::uuid, COALESCE((v_assignment->>'is_leader')::boolean, FALSE), COALESCE((v_assignment->>'is_devotion')::boolean, FALSE), 'pending', p_actor_id);
  END LOOP;
  v_new_version := v_service.schedule_version + 1;
  -- ASSIGN, never merge: `active_overrides` is written wholesale. A PUT that omits
  -- an axis clears it, so a one-off coordinator decision cannot become a permanent
  -- skip that later edits never surface.
  UPDATE public.services
  SET status = 'draft', schedule_version = v_new_version,
      validated_version = NULL, validated_by = NULL, validated_at = NULL,
      unfilled_positions = COALESCE(p_unfilled_positions, '[]'::jsonb),
      active_overrides = COALESCE(p_active_overrides, '{}'::jsonb)
  WHERE id = p_service_id;
  INSERT INTO public.schedule_change_log(church_id, service_id, actor_id, action, from_version, to_version, reason, before_state, after_state)
  VALUES (p_church_id, p_service_id, p_actor_id, 'assignments_changed', v_service.schedule_version, v_new_version,
    NULLIF(pg_catalog.btrim(COALESCE(p_reason, '')), ''), v_old,
    jsonb_build_object('assignments', p_assignments, 'active_overrides', COALESCE(p_active_overrides, '{}'::jsonb)));
  RETURN v_new_version;
END;
$function$;

CREATE OR REPLACE FUNCTION public.persist_month_schedule(p_church_id uuid, p_ministry_id uuid, p_month integer, p_year integer, p_actor_id uuid, p_services jsonb, p_replace_existing boolean DEFAULT false)
 RETURNS uuid[]
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_required INTEGER;
  v_approved INTEGER;
  v_existing RECORD;
  v_service JSONB;
  v_assignment JSONB;
  v_service_id UUID;
  v_ids UUID[] := ARRAY[]::UUID[];
BEGIN
  IF p_month < 0 OR p_month > 11 OR p_year < 2000 OR p_year > 2100
     OR jsonb_typeof(p_services) <> 'array' OR jsonb_array_length(p_services) = 0 THEN
    RAISE EXCEPTION 'Invalid schedule generation input' USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.date_trunc('month', pg_catalog.make_date(p_year, p_month + 1, 1))::date < pg_catalog.date_trunc('month', CURRENT_DATE)::date THEN
    RAISE EXCEPTION 'Schedules can only be generated for the current or a future month' USING ERRCODE = '55000';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_church_id::text),
    pg_catalog.hashtext(p_ministry_id::text || ':' || p_year::text || ':' || p_month::text)
  );

  IF NOT EXISTS (
    SELECT 1 FROM public.ministries m
    WHERE m.id = p_ministry_id AND m.church_id = p_church_id AND m.is_active
  ) THEN
    RAISE EXCEPTION 'Ministry not found for this church' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = p_actor_id AND u.church_id = p_church_id AND u.is_active
      AND u.role IN ('admin', 'coordinator')
  ) THEN
    RAISE EXCEPTION 'Coordinator authorization could not be verified' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.services s
    WHERE s.church_id = p_church_id AND s.ministry_id IS NULL AND s.month = p_month AND s.year = p_year
      AND s.week_number IN (SELECT (item->>'week_number')::integer FROM pg_catalog.jsonb_array_elements(p_services) AS items(item))
  ) THEN
    RAISE EXCEPTION 'This month contains a legacy schedule with unknown ministry ownership; resolve it before generating' USING ERRCODE = '55000';
  END IF;

  SELECT COUNT(*) INTO v_required
  FROM public.members m
  WHERE m.church_id = p_church_id AND m.status = 'active'
    AND EXISTS (
      SELECT 1 FROM public.member_roles mr
      JOIN public.roles r ON r.id = mr.role_id
      WHERE mr.member_id = m.id AND r.ministry_id = p_ministry_id AND r.is_active
    );

  PERFORM s.id
  FROM public.availability_submissions s
  JOIN public.members m ON m.id = s.member_id AND m.church_id = s.church_id
  WHERE s.church_id = p_church_id AND s.year = p_year AND s.month = p_month
    AND m.status = 'active'
    AND EXISTS (
      SELECT 1 FROM public.member_roles mr
      JOIN public.roles r ON r.id = mr.role_id
      WHERE mr.member_id = m.id AND r.ministry_id = p_ministry_id AND r.is_active
    )
  FOR UPDATE OF s;

  SELECT COUNT(*) INTO v_approved
  FROM public.availability_submissions s
  JOIN public.members m ON m.id = s.member_id AND m.church_id = s.church_id
  WHERE s.church_id = p_church_id AND s.year = p_year AND s.month = p_month
    AND s.status = 'approved' AND s.is_current AND m.status = 'active'
    AND EXISTS (
      SELECT 1 FROM public.member_roles mr
      JOIN public.roles r ON r.id = mr.role_id
      WHERE mr.member_id = m.id AND r.ministry_id = p_ministry_id AND r.is_active
    );

  IF v_approved <> v_required THEN
    RAISE EXCEPTION 'Availability is not ready: % of % required submissions approved', v_approved, v_required
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(p_services) AS entries(item)
    -- CHANGED: month-granular (was `(item->>'date')::date < CURRENT_DATE`), so a
    -- Sunday earlier in the current month can still be (re)generated. The
    -- month-level guard above already refuses a whole past month.
    WHERE pg_catalog.date_trunc('month', (item->>'date')::date)::date < pg_catalog.date_trunc('month', CURRENT_DATE)::date
      OR (pg_catalog.date_part('month', (item->>'date')::date)::integer - 1) <> p_month
      OR pg_catalog.date_part('year', (item->>'date')::date)::integer <> p_year
      OR COALESCE((item->>'week_number')::integer, 0) NOT BETWEEN 1 AND 5
      OR pg_catalog.date_part('dow', (item->>'date')::date) <> 0
      OR (item->>'date')::date <> (
        pg_catalog.make_date(p_year, p_month + 1, 1)
        + ((7 - pg_catalog.date_part('dow', pg_catalog.make_date(p_year, p_month + 1, 1))::integer) % 7)
        + (((item->>'week_number')::integer - 1) * 7)
      )
      OR jsonb_typeof(COALESCE(item->'assignments', '[]'::jsonb)) <> 'array'
      -- NEW: per-element gap shape. An untyped gap would be persisted and served
      -- straight to the editor, so a malformed entry is rejected at the trust
      -- boundary rather than rendered as garbage.
      -- C4: the key must be PRESENT, not merely array-typed. `->` yields SQL NULL for
      -- an absent key, so the COALESCE at the INSERT would otherwise turn a caller
      -- that forgot the field into a schedule that looks COMPLETE with zero gaps.
      -- That is the exact silent-discard failure this column exists to prevent, so
      -- an absent key is refused here rather than defaulted away.
      OR NOT (item ? 'unfilled_positions')
      OR jsonb_typeof(COALESCE(item->'unfilled_positions', '[]'::jsonb)) <> 'array'
      OR EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_array_elements(COALESCE(item->'unfilled_positions', '[]'::jsonb)) AS gaps(gap)
        WHERE jsonb_typeof(gaps.gap) <> 'object'
          OR jsonb_typeof(gaps.gap->'week_number') <> 'number'
          OR jsonb_typeof(gaps.gap->'role_name') <> 'string'
          OR jsonb_typeof(gaps.gap->'required_slots') <> 'number'
          OR jsonb_typeof(gaps.gap->'message') <> 'string'
          -- The two candidate arrays are OPTIONAL and default permissive: an
          -- absent key is legal (a gap need not carry search history), but a
          -- present non-array is not. COALESCE defaults to 'array' rather than
          -- 'null' so "absent" is accepted; defaulting to 'null' here would reject
          -- every gap that omits the field.
          OR COALESCE(jsonb_typeof(gaps.gap->'eligible_candidates'), 'array') <> 'array'
          OR COALESCE(jsonb_typeof(gaps.gap->'rejected_candidates'), 'array') <> 'array'
      )
  ) THEN
    -- Message no longer claims "future dates": the boundary is now the requested
    -- (current or future) month, so a past day within that month is valid input.
    RAISE EXCEPTION 'Generated services must fall within the requested month with valid week, assignment and unfilled-position data' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT (item->>'week_number')::integer
    FROM pg_catalog.jsonb_array_elements(p_services) AS entries(item)
    GROUP BY (item->>'week_number')::integer
    HAVING COUNT(*) > 1
  ) OR EXISTS (
    SELECT (item->>'date')::date
    FROM pg_catalog.jsonb_array_elements(p_services) AS entries(item)
    GROUP BY (item->>'date')::date
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'A service week and date can only be generated once per request' USING ERRCODE = '22023';
  END IF;

  FOR v_existing IN
    SELECT s.id, s.status
    FROM public.services s
    WHERE s.church_id = p_church_id AND s.ministry_id = p_ministry_id
      AND s.month = p_month AND s.year = p_year
      AND s.week_number IN (SELECT (item->>'week_number')::integer FROM pg_catalog.jsonb_array_elements(p_services) AS items(item))
    FOR UPDATE
  LOOP
    IF NOT p_replace_existing THEN
      RAISE EXCEPTION 'A schedule already exists for this ministry and month' USING ERRCODE = '23505';
    END IF;
    IF v_existing.status <> 'draft' THEN
      RAISE EXCEPTION 'Only draft schedules can be regenerated' USING ERRCODE = '55000';
    END IF;
    INSERT INTO public.schedule_change_log(church_id, service_id, actor_id, action, from_version, reason, before_state)
    SELECT p_church_id, v_existing.id, p_actor_id, 'regenerated', s.schedule_version,
      'Explicit schedule regeneration', jsonb_build_object(
        'service', to_jsonb(s),
        'assignments', COALESCE((SELECT jsonb_agg(to_jsonb(a)) FROM public.schedule_assignments a WHERE a.service_id = s.id), '[]'::jsonb)
      )
    FROM public.services s WHERE s.id = v_existing.id;
  END LOOP;

  IF p_replace_existing THEN
    DELETE FROM public.services s
    WHERE s.church_id = p_church_id AND s.ministry_id = p_ministry_id
      AND s.month = p_month AND s.year = p_year AND s.status = 'draft'
      AND s.week_number IN (SELECT (item->>'week_number')::integer FROM pg_catalog.jsonb_array_elements(p_services) AS items(item));
  END IF;

  FOR v_service IN SELECT value FROM pg_catalog.jsonb_array_elements(p_services)
  LOOP
    -- `active_overrides` is deliberately NOT copied from the replaced draft: a
    -- regeneration produces a fresh lineup, and carrying a coordinator's override
    -- licence onto it would silently authorise violations the coordinator never
    -- reviewed. It is always '{}'.
    INSERT INTO public.services(church_id, ministry_id, date, week_number, month, year, service_type, status, generated_by, generated_at, generation_metadata, unfilled_positions, active_overrides)
    VALUES (p_church_id, p_ministry_id, (v_service->>'date')::date,
      (v_service->>'week_number')::integer, p_month, p_year, 'sunday', 'draft', p_actor_id, NOW(),
      jsonb_build_object('algorithm', 'SchedulingEngine', 'generated_by', p_actor_id),
      COALESCE(v_service->'unfilled_positions', '[]'::jsonb), '{}'::jsonb)
    RETURNING id INTO v_service_id;

    -- Stamp the real service id onto every gap in one ordered pass, so a stored gap
    -- is self-describing and the editor can match a row to its service without
    -- relying on array position. The COALESCE keeps the column non-NULL for a
    -- complete week, since jsonb_agg over an empty array yields NULL.
    UPDATE public.services
    SET unfilled_positions = COALESCE((
      SELECT pg_catalog.jsonb_agg(entry.value || jsonb_build_object('service_id', v_service_id) ORDER BY entry.ordinality)
      FROM pg_catalog.jsonb_array_elements(COALESCE(v_service->'unfilled_positions', '[]'::jsonb))
        WITH ORDINALITY AS entry(value, ordinality)
    ), '[]'::jsonb)
    WHERE id = v_service_id;

    FOR v_assignment IN SELECT value FROM pg_catalog.jsonb_array_elements(COALESCE(v_service->'assignments', '[]'::jsonb))
    LOOP
      INSERT INTO public.schedule_assignments(service_id, member_id, role_id, instrument_id, is_leader, is_devotion, status, assigned_by)
      VALUES (v_service_id, (v_assignment->>'member_id')::uuid, (v_assignment->>'role_id')::uuid,
        NULLIF(v_assignment->>'instrument_id', '')::uuid, COALESCE((v_assignment->>'is_leader')::boolean, FALSE), COALESCE((v_assignment->>'is_devotion')::boolean, FALSE), 'pending', p_actor_id);
    END LOOP;

    INSERT INTO public.schedule_change_log(church_id, service_id, actor_id, action, to_version, after_state)
    VALUES (p_church_id, v_service_id, p_actor_id, 'generated', 1, v_service);
    v_ids := array_append(v_ids, v_service_id);
  END LOOP;

  RETURN v_ids;
END;
$function$;

-- These are service_role-only entry points; re-assert the privilege posture that
-- CREATE OR REPLACE preserves but which a fresh environment must not lose.
REVOKE ALL ON FUNCTION public.replace_service_assignments(UUID, UUID, UUID, INTEGER, JSONB, TEXT, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_service_assignments(UUID, UUID, UUID, INTEGER, JSONB, TEXT, JSONB, JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.persist_month_schedule(UUID, UUID, INTEGER, INTEGER, UUID, JSONB, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_month_schedule(UUID, UUID, INTEGER, INTEGER, UUID, JSONB, BOOLEAN) TO service_role;
