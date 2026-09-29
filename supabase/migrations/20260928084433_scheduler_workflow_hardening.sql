-- Monthly availability review and ministry-scoped schedule lifecycle metadata.
-- Existing absence rows remain intact and do not imply a complete monthly response.

CREATE TABLE availability_submissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  church_id UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  month INTEGER NOT NULL CHECK (month BETWEEN 0 AND 11),
  year INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
  status VARCHAR(24) NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'approved', 'revision_required')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  is_current BOOLEAN NOT NULL DEFAULT TRUE,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  revision_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (church_id, member_id, year, month, version),
  UNIQUE (id, church_id, member_id, year, month)
);

CREATE UNIQUE INDEX availability_submissions_one_current
  ON availability_submissions(church_id, member_id, year, month)
  WHERE is_current;

CREATE INDEX idx_availability_submissions_readiness
  ON availability_submissions(church_id, year, month, status);

CREATE TRIGGER update_availability_submissions_updated_at
  BEFORE UPDATE ON availability_submissions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE availability
  ADD COLUMN submission_id UUID REFERENCES availability_submissions(id) ON DELETE SET NULL;

CREATE INDEX idx_availability_submission_id ON availability(submission_id);

ALTER TABLE services
  ADD COLUMN ministry_id UUID REFERENCES ministries(id) ON DELETE SET NULL,
  ADD COLUMN schedule_version INTEGER NOT NULL DEFAULT 1 CHECK (schedule_version > 0),
  ADD COLUMN validated_version INTEGER,
  ADD COLUMN validated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN validated_at TIMESTAMPTZ,
  ADD COLUMN published_by UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN generated_at TIMESTAMPTZ,
  ADD COLUMN generation_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN revision_of UUID REFERENCES services(id) ON DELETE SET NULL;

-- Attribute history only where every existing assignment role belongs to one ministry.
WITH service_ministries AS (
  SELECT a.service_id, MIN(r.ministry_id::text)::uuid AS ministry_id
  FROM schedule_assignments a
  JOIN roles r ON r.id = a.role_id
  GROUP BY a.service_id
  HAVING COUNT(DISTINCT r.ministry_id) = 1
)
UPDATE services s
SET ministry_id = service_ministries.ministry_id
FROM service_ministries
WHERE s.id = service_ministries.service_id;

CREATE INDEX idx_services_ministry_month
  ON services(church_id, ministry_id, year, month, status);

CREATE TABLE schedule_change_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  church_id UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  service_id UUID REFERENCES services(id) ON DELETE SET NULL,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(40) NOT NULL,
  from_version INTEGER,
  to_version INTEGER,
  reason TEXT,
  before_state JSONB,
  after_state JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE availability_submission_review_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  church_id UUID NOT NULL REFERENCES churches(id) ON DELETE CASCADE,
  submission_id UUID NOT NULL REFERENCES availability_submissions(id) ON DELETE CASCADE,
  reviewer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(24) NOT NULL CHECK (action IN ('approved', 'revision_required')),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_schedule_change_log_service
  ON schedule_change_log(church_id, service_id, created_at DESC);

CREATE INDEX idx_availability_submission_review_log
  ON availability_submission_review_log(church_id, submission_id, created_at DESC);

ALTER TABLE availability_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_change_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE availability_submission_review_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members and staff can view scoped availability submissions"
  ON availability_submissions FOR SELECT
  USING (
    church_id = get_user_church_id()
    AND (
      EXISTS (
        SELECT 1 FROM public.users u JOIN public.members m ON m.user_id = u.id
        WHERE u.auth_id = (SELECT auth.uid()) AND m.id = availability_submissions.member_id
      )
      OR EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.auth_id = (SELECT auth.uid()) AND u.church_id = availability_submissions.church_id
          AND u.role IN ('admin', 'coordinator') AND u.is_active
      )
    )
  );

CREATE POLICY "Users can view church schedule change history"
  ON schedule_change_log FOR SELECT
  USING (
    church_id = get_user_church_id()
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.auth_id = (SELECT auth.uid()) AND u.church_id = schedule_change_log.church_id
        AND u.role IN ('admin', 'coordinator') AND u.is_active
    )
  );

CREATE POLICY "Users can view church availability review history"
  ON availability_submission_review_log FOR SELECT
  USING (
    church_id = get_user_church_id()
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.auth_id = (SELECT auth.uid()) AND u.church_id = availability_submission_review_log.church_id
        AND u.role IN ('admin', 'coordinator') AND u.is_active
    )
  );

-- Mutations are performed by server routes after authentication/role checks.
-- These tables are intentionally not granted direct write policies.
REVOKE ALL ON availability_submissions, schedule_change_log, availability_submission_review_log FROM anon, authenticated;
GRANT SELECT ON availability_submissions, schedule_change_log, availability_submission_review_log TO authenticated;

-- All application mutations go through authenticated server routes. In particular,
-- ordinary clients must not forge approvals by writing status or lifecycle columns.
REVOKE INSERT, UPDATE, DELETE ON availability, services, schedule_assignments
  FROM anon, authenticated;

DROP POLICY IF EXISTS "Users can view availability in their church" ON availability;
CREATE POLICY "Members and staff can view scoped availability"
  ON availability FOR SELECT
  USING (
    church_id = get_user_church_id()
    AND (
      EXISTS (
        SELECT 1 FROM public.users u JOIN public.members m ON m.user_id = u.id
        WHERE u.auth_id = (SELECT auth.uid()) AND m.id = availability.member_id
      )
      OR EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.auth_id = (SELECT auth.uid()) AND u.church_id = availability.church_id
          AND u.role IN ('admin', 'coordinator') AND u.is_active
      )
    )
  );

DROP POLICY IF EXISTS "Users can view services in their church" ON services;
CREATE POLICY "Staff can view church schedules and members can view published schedules"
  ON services FOR SELECT
  USING (
    church_id = get_user_church_id()
    AND (
      status = 'published'
      OR EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.auth_id = (SELECT auth.uid()) AND u.church_id = services.church_id
          AND u.role IN ('admin', 'coordinator') AND u.is_active
      )
    )
  );

CREATE OR REPLACE FUNCTION public.persist_month_schedule(
  p_church_id UUID,
  p_ministry_id UUID,
  p_month INTEGER,
  p_year INTEGER,
  p_actor_id UUID,
  p_services JSONB,
  p_replace_existing BOOLEAN DEFAULT FALSE
)
RETURNS UUID[]
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
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

  -- Lock current participant submissions until all service and assignment writes commit.
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
    WHERE (item->>'date')::date < CURRENT_DATE
      OR (pg_catalog.date_part('month', (item->>'date')::date)::integer - 1) <> p_month
      OR pg_catalog.date_part('year', (item->>'date')::date)::integer <> p_year
      OR COALESCE((item->>'week_number')::integer, 0) NOT BETWEEN 1 AND 5
      OR pg_catalog.date_part('dow', (item->>'date')::date) <> 0
      OR (item->>'date')::date <> (
        pg_catalog.make_date(p_year, p_month + 1, 1)
        + ((7 - pg_catalog.date_part('dow', pg_catalog.make_date(p_year, p_month + 1, 1))::integer) % 7)
        + (((item->>'week_number')::integer - 1) * 7)
      )
      OR pg_catalog.jsonb_typeof(COALESCE(item->'assignments', '[]'::jsonb)) <> 'array'
  ) THEN
    RAISE EXCEPTION 'Generated services must have future dates and valid week and assignment data' USING ERRCODE = '22023';
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

  FOR v_service IN SELECT value FROM jsonb_array_elements(p_services)
  LOOP
    INSERT INTO public.services(church_id, ministry_id, date, week_number, month, year, service_type, status, generated_by, generated_at, generation_metadata)
    VALUES (p_church_id, p_ministry_id, (v_service->>'date')::date,
      (v_service->>'week_number')::integer, p_month, p_year, 'sunday', 'draft', p_actor_id, NOW(),
      jsonb_build_object('algorithm', 'SchedulingEngine', 'generated_by', p_actor_id))
    RETURNING id INTO v_service_id;

    FOR v_assignment IN SELECT value FROM jsonb_array_elements(COALESCE(v_service->'assignments', '[]'::jsonb))
    LOOP
      INSERT INTO public.schedule_assignments(service_id, member_id, role_id, instrument_id, is_leader, status, assigned_by)
      VALUES (v_service_id, (v_assignment->>'member_id')::uuid, (v_assignment->>'role_id')::uuid,
        NULLIF(v_assignment->>'instrument_id', '')::uuid, COALESCE((v_assignment->>'is_leader')::boolean, FALSE), 'pending', p_actor_id);
    END LOOP;

    INSERT INTO public.schedule_change_log(church_id, service_id, actor_id, action, to_version, after_state)
    VALUES (p_church_id, v_service_id, p_actor_id, 'generated', 1, v_service);
    v_ids := array_append(v_ids, v_service_id);
  END LOOP;

  RETURN v_ids;
END;
$$;

REVOKE ALL ON FUNCTION public.persist_month_schedule(UUID, UUID, INTEGER, INTEGER, UUID, JSONB, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_month_schedule(UUID, UUID, INTEGER, INTEGER, UUID, JSONB, BOOLEAN) TO service_role;

CREATE OR REPLACE FUNCTION public.submit_month_availability(
  p_church_id UUID,
  p_member_id UUID,
  p_actor_id UUID,
  p_month INTEGER,
  p_year INTEGER,
  p_entries JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_submission public.availability_submissions%ROWTYPE;
  v_version INTEGER := 1;
  v_entry JSONB;
BEGIN
  IF p_month < 0 OR p_month > 11 OR p_year < 2000 OR p_year > 2100
     OR jsonb_typeof(p_entries) <> 'array' THEN
    RAISE EXCEPTION 'Invalid availability submission input' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(p_church_id::text),
    pg_catalog.hashtext(p_member_id::text || ':' || p_year::text || ':' || p_month::text)
  );
  IF NOT EXISTS (
    SELECT 1 FROM public.members m
    JOIN public.users u ON u.id = m.user_id
    WHERE m.id = p_member_id AND m.church_id = p_church_id AND m.status = 'active'
      AND u.id = p_actor_id AND u.church_id = p_church_id AND u.is_active
  ) THEN
    RAISE EXCEPTION 'Active member ownership could not be verified' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_submission FROM public.availability_submissions s
  WHERE s.church_id = p_church_id AND s.member_id = p_member_id
    AND s.year = p_year AND s.month = p_month AND s.is_current
  FOR UPDATE;
  IF FOUND THEN
    IF v_submission.status <> 'revision_required' THEN
      RAISE EXCEPTION 'Availability has already been submitted for this month' USING ERRCODE = '23505';
    END IF;
    UPDATE public.availability_submissions SET is_current = FALSE WHERE id = v_submission.id;
    UPDATE public.availability SET status = 'rejected' WHERE submission_id = v_submission.id;
    v_version := v_submission.version + 1;
  END IF;

  INSERT INTO public.availability_submissions(church_id, member_id, month, year, status, version, is_current)
  VALUES (p_church_id, p_member_id, p_month, p_year, 'submitted', v_version, TRUE)
  RETURNING id INTO v_submission.id;

  FOR v_entry IN SELECT value FROM pg_catalog.jsonb_array_elements(p_entries)
  LOOP
    INSERT INTO public.availability(
      member_id, church_id, type, week_number, month, year, date, end_date, reason, status, submission_id
    ) VALUES (
      p_member_id, p_church_id, v_entry->>'type', NULLIF(v_entry->>'week_number', '')::integer,
      p_month, p_year, NULLIF(v_entry->>'date', '')::date, NULLIF(v_entry->>'end_date', '')::date,
      NULLIF(v_entry->>'reason', ''), 'pending', v_submission.id
    )
    ON CONFLICT (member_id, year, month, week_number)
      WHERE type = 'weekly' AND status IN ('pending', 'approved') AND month IS NOT NULL AND year IS NOT NULL
    DO UPDATE SET status = 'pending', submission_id = EXCLUDED.submission_id, reason = EXCLUDED.reason;
  END LOOP;
  RETURN v_submission.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.review_month_availability(
  p_church_id UUID,
  p_submission_id UUID,
  p_reviewer_id UUID,
  p_action TEXT,
  p_note TEXT DEFAULT NULL
)
RETURNS public.availability_submissions
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_submission public.availability_submissions%ROWTYPE;
BEGIN
  IF p_action NOT IN ('approved', 'revision_required')
     OR (p_action = 'revision_required' AND pg_catalog.btrim(COALESCE(p_note, '')) = '') THEN
    RAISE EXCEPTION 'A valid review action and revision note are required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_submission FROM public.availability_submissions s
  WHERE s.id = p_submission_id AND s.church_id = p_church_id AND s.is_current
  FOR UPDATE;
  IF NOT FOUND OR v_submission.status <> 'submitted' THEN
    RAISE EXCEPTION 'Submitted availability was not found' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.users u WHERE u.id = p_reviewer_id
      AND u.church_id = p_church_id AND u.is_active AND u.role IN ('admin', 'coordinator')
  ) THEN
    RAISE EXCEPTION 'Coordinator authorization could not be verified' USING ERRCODE = '42501';
  END IF;
  UPDATE public.availability_submissions
  SET status = p_action, reviewed_by = p_reviewer_id, reviewed_at = NOW(), revision_note = NULLIF(p_note, '')
  WHERE id = p_submission_id RETURNING * INTO v_submission;
  IF p_action = 'approved' THEN
    UPDATE public.availability SET status = 'approved' WHERE submission_id = p_submission_id;
  END IF;
  INSERT INTO public.availability_submission_review_log(church_id, submission_id, reviewer_id, action, note)
  VALUES (p_church_id, p_submission_id, p_reviewer_id, p_action, NULLIF(p_note, ''));
  RETURN v_submission;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_month_availability(UUID, UUID, UUID, INTEGER, INTEGER, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_month_availability(UUID, UUID, UUID, INTEGER, INTEGER, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.review_month_availability(UUID, UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.review_month_availability(UUID, UUID, UUID, TEXT, TEXT) TO service_role;

CREATE OR REPLACE FUNCTION public.replace_service_assignments(
  p_church_id UUID,
  p_service_id UUID,
  p_actor_id UUID,
  p_expected_version INTEGER,
  p_assignments JSONB,
  p_reason TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_service public.services%ROWTYPE;
  v_assignment JSONB;
  v_old JSONB;
  v_new_version INTEGER;
  v_min_backups INTEGER;
  v_max_backups INTEGER;
  v_monthly_limit INTEGER;
BEGIN
  IF jsonb_typeof(p_assignments) <> 'array' THEN
    RAISE EXCEPTION 'Assignments must be an array' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_service FROM public.services s
  WHERE s.id = p_service_id AND s.church_id = p_church_id
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Schedule not found' USING ERRCODE = 'P0002'; END IF;
  IF v_service.status NOT IN ('draft', 'validated') OR v_service.ministry_id IS NULL THEN
    RAISE EXCEPTION 'Only scoped draft or validated schedules can be edited; published schedules require an amendment' USING ERRCODE = '55000';
  END IF;
  IF v_service.date < CURRENT_DATE AND v_service.revision_of IS NULL THEN
    RAISE EXCEPTION 'Historical schedules are read-only; create an explicit amendment to make a change' USING ERRCODE = '55000';
  END IF;
  IF v_service.schedule_version <> p_expected_version THEN
    RAISE EXCEPTION 'Schedule changed since it was loaded; refresh and retry' USING ERRCODE = '40001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_actor_id AND u.church_id = p_church_id AND u.is_active AND u.role IN ('admin', 'coordinator')) THEN
    RAISE EXCEPTION 'Coordinator authorization could not be verified' USING ERRCODE = '42501';
  END IF;

  IF (SELECT COUNT(*) FROM pg_catalog.jsonb_array_elements(p_assignments)) <>
     (SELECT COUNT(DISTINCT item->>'member_id') FROM pg_catalog.jsonb_array_elements(p_assignments) AS entries(item)) THEN
    RAISE EXCEPTION 'A member may only have one role per service' USING ERRCODE = '23505';
  END IF;
  IF (SELECT COUNT(*) FROM pg_catalog.jsonb_array_elements(p_assignments) AS entries(item) WHERE COALESCE((item->>'is_leader')::boolean, FALSE)) <> 1 THEN
    RAISE EXCEPTION 'Exactly one worship leader is required' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(p_assignments) AS entries(item)
    LEFT JOIN public.roles r ON r.id = (item->>'role_id')::uuid
    WHERE COALESCE((item->>'is_leader')::boolean, FALSE) IS DISTINCT FROM (pg_catalog.lower(COALESCE(r.name, '')) = 'worship leader')
  ) THEN
    RAISE EXCEPTION 'The Worship Leader role and leader marker must identify the same single assignment' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(p_assignments) AS entries(item)
    LEFT JOIN public.members m ON m.id = (item->>'member_id')::uuid AND m.church_id = p_church_id
    LEFT JOIN public.roles r ON r.id = (item->>'role_id')::uuid AND r.ministry_id = v_service.ministry_id AND r.is_active
    WHERE m.id IS NULL OR m.status <> 'active' OR r.id IS NULL
      OR NOT EXISTS (SELECT 1 FROM public.member_roles mr WHERE mr.member_id = m.id AND mr.role_id = r.id)
      OR (COALESCE((item->>'is_leader')::boolean, FALSE) AND pg_catalog.lower(r.name) <> 'worship leader')
      OR (NULLIF(item->>'instrument_id', '') IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.member_skills ms
        JOIN public.instruments i ON i.id = ms.instrument_id AND i.ministry_id = v_service.ministry_id
        WHERE ms.member_id = m.id AND ms.instrument_id = (item->>'instrument_id')::uuid
      ))
  ) THEN
    RAISE EXCEPTION 'An assignment has an inactive member or an invalid ministry role or skill' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.jsonb_array_elements(p_assignments) AS entries(item)
    JOIN public.members m ON m.id = (item->>'member_id')::uuid
    JOIN public.availability a ON a.member_id = m.id AND a.church_id = p_church_id
      AND a.status IN ('pending', 'approved')
      AND (
        (a.type = 'weekly' AND a.week_number = v_service.week_number AND (a.month IS NULL OR a.month = v_service.month) AND (a.year IS NULL OR a.year = v_service.year))
        OR (a.type = 'date' AND a.date = v_service.date)
        OR (a.type IN ('vacation', 'temporary_leave', 'emergency_leave') AND a.date <= v_service.date AND COALESCE(a.end_date, a.date) >= v_service.date)
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
  IF (SELECT COUNT(*) FROM pg_catalog.jsonb_array_elements(p_assignments) AS entries(item)
      JOIN public.roles r ON r.id = (item->>'role_id')::uuid
      WHERE NOT COALESCE((item->>'is_leader')::boolean, FALSE) AND item->>'instrument_id' IS NULL
        AND pg_catalog.lower(r.name) IN ('singer', 'singers', 'vocalist', 'vocal', 'backup', 'backup singer', 'backup singers')) NOT BETWEEN v_min_backups AND v_max_backups THEN
    RAISE EXCEPTION 'Backup count is outside the configured range' USING ERRCODE = '23514';
  END IF;

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
    INSERT INTO public.schedule_assignments(service_id, member_id, role_id, instrument_id, is_leader, status, assigned_by)
    VALUES (p_service_id, (v_assignment->>'member_id')::uuid, (v_assignment->>'role_id')::uuid,
      NULLIF(v_assignment->>'instrument_id', '')::uuid, COALESCE((v_assignment->>'is_leader')::boolean, FALSE), 'pending', p_actor_id);
  END LOOP;
  v_new_version := v_service.schedule_version + 1;
  UPDATE public.services SET status = 'draft', schedule_version = v_new_version, validated_version = NULL, validated_by = NULL, validated_at = NULL
  WHERE id = p_service_id;
  INSERT INTO public.schedule_change_log(church_id, service_id, actor_id, action, from_version, to_version, reason, before_state, after_state)
  VALUES (p_church_id, p_service_id, p_actor_id, 'assignments_changed', v_service.schedule_version, v_new_version,
    NULLIF(pg_catalog.btrim(COALESCE(p_reason, '')), ''), v_old,
    jsonb_build_object('assignments', p_assignments));
  RETURN v_new_version;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_service_revision(
  p_church_id UUID,
  p_service_id UUID,
  p_actor_id UUID,
  p_expected_version INTEGER
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_original public.services%ROWTYPE;
  v_revision_id UUID;
BEGIN
  SELECT * INTO v_original FROM public.services
  WHERE id = p_service_id AND church_id = p_church_id
  FOR UPDATE;
  IF NOT FOUND OR v_original.status <> 'published' OR v_original.ministry_id IS NULL THEN
    RAISE EXCEPTION 'A published, ministry-scoped schedule is required for an amendment' USING ERRCODE = '55000';
  END IF;
  IF v_original.schedule_version <> p_expected_version THEN
    RAISE EXCEPTION 'Schedule changed since it was loaded; refresh and retry' USING ERRCODE = '40001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_actor_id AND church_id = p_church_id AND is_active AND role IN ('admin', 'coordinator')) THEN
    RAISE EXCEPTION 'Coordinator authorization could not be verified' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM public.services WHERE revision_of = p_service_id AND status IN ('draft', 'validated')) THEN
    RAISE EXCEPTION 'An amendment is already in progress for this schedule' USING ERRCODE = '55000';
  END IF;
  INSERT INTO public.services(church_id, ministry_id, date, week_number, month, year, service_type, status, notes, generated_by, generation_metadata, revision_of)
  VALUES (p_church_id, v_original.ministry_id, v_original.date, v_original.week_number, v_original.month, v_original.year,
    v_original.service_type, 'draft', v_original.notes, p_actor_id,
    jsonb_build_object('amends_service_id', v_original.id, 'source_version', v_original.schedule_version), v_original.id)
  RETURNING id INTO v_revision_id;
  INSERT INTO public.schedule_assignments(service_id, member_id, role_id, instrument_id, is_leader, status, assigned_by)
  SELECT v_revision_id, member_id, role_id, instrument_id, is_leader, status, p_actor_id
  FROM public.schedule_assignments WHERE service_id = p_service_id;
  INSERT INTO public.schedule_change_log(church_id, service_id, actor_id, action, from_version, to_version, reason, before_state, after_state)
  VALUES (p_church_id, v_revision_id, p_actor_id, 'amendment_created', v_original.schedule_version, 1,
    'Draft amendment created from published schedule', jsonb_build_object('service', to_jsonb(v_original)),
    jsonb_build_object(
      'source_service_id', p_service_id,
      'assignments', COALESCE((SELECT jsonb_agg(to_jsonb(a)) FROM public.schedule_assignments a WHERE a.service_id = v_revision_id), '[]'::jsonb)
    ));
  RETURN v_revision_id;
END;
$$;

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
  IF v_service.status <> 'draft' OR v_service.schedule_version <> p_expected_version THEN RAISE EXCEPTION 'Schedule is not a current draft' USING ERRCODE = '40001'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_actor_id AND church_id = p_church_id AND is_active AND role IN ('admin', 'coordinator')) THEN RAISE EXCEPTION 'Coordinator authorization could not be verified' USING ERRCODE = '42501'; END IF;
  UPDATE public.services SET status = 'validated', validated_version = schedule_version, validated_by = p_actor_id, validated_at = NOW() WHERE id = p_service_id;
  INSERT INTO public.schedule_change_log(church_id, service_id, actor_id, action, from_version, to_version, after_state)
  VALUES (p_church_id, p_service_id, p_actor_id, 'validated', v_service.schedule_version, v_service.schedule_version,
    jsonb_build_object('results', COALESCE(p_validation_results, '[]'::jsonb)));
  RETURN v_service.schedule_version;
END;
$$;

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
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_actor_id AND church_id = p_church_id AND is_active AND role IN ('admin', 'coordinator')) THEN RAISE EXCEPTION 'Coordinator authorization could not be verified' USING ERRCODE = '42501'; END IF;
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

REVOKE ALL ON FUNCTION public.replace_service_assignments(UUID, UUID, UUID, INTEGER, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_service_assignments(UUID, UUID, UUID, INTEGER, JSONB, TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.validate_service_schedule(UUID, UUID, UUID, INTEGER, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_service_schedule(UUID, UUID, UUID, INTEGER, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.publish_service_schedule(UUID, UUID, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_service_schedule(UUID, UUID, UUID, INTEGER) TO service_role;
REVOKE ALL ON FUNCTION public.create_service_revision(UUID, UUID, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_service_revision(UUID, UUID, UUID, INTEGER) TO service_role;
