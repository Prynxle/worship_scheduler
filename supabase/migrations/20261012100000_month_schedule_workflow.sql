-- ============================================================================
-- Migration: month_schedule_workflow
-- Created: 2026-10-12
--
-- Purpose: A monthly pipeline on top of the per-service lifecycle
--          (draft -> validated -> published). The per-service RPCs
--          (`validate_service_schedule`, `publish_service_schedule`,
--          `create_service_revision`) are untouched and remain the authority
--          for single-service transitions. This migration adds the month-level
--          gates a coordinator can act on once, in one transaction:
--
--            validate_month_schedule  - runs every draft service through the
--                                       same final-stage publication rules and
--                                       marks the month validated.
--            publish_month_schedule   - only from a validated month; blocks on
--                                       drifted/unvalidated lineups (409) and
--                                       on unfilled positions (422), then
--                                       publishes the month atomically.
--
-- Derived status. The month has no hidden state-machine: `month_derive_status`
-- recomputes the truthful status from its services at read time, so any edit
-- that bumps a service's schedule_version automatically drops the month back
-- to 'draft' (auto-downshift) without a trigger. `month_schedules` stores only
-- the audit facts (who published, when) plus the last known transition.
--
-- Tenant scope. Every function re-derives the actor's church from
-- `public.users` exactly like the existing lifecycle RPCs; church_id is never
-- taken from the caller. `month_schedules` is RLS-scoped to the church and all
-- mutations go through the service-role RPCs below.
-- ============================================================================

-- ============================================================================
-- 1. MONTH SCHEDULES (audit/publish facts; status is derived, not stored truth)
-- ============================================================================
CREATE TABLE public.month_schedules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  church_id UUID NOT NULL REFERENCES public.churches(id) ON DELETE CASCADE,
  ministry_id UUID NOT NULL REFERENCES public.ministries(id) ON DELETE CASCADE,
  month INTEGER NOT NULL CHECK (month BETWEEN 0 AND 11),
  year INTEGER NOT NULL,
  -- Derived from services at read time; this column records the last transition
  -- for audit display only.
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'validated', 'published')),
  published_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  published_at TIMESTAMPTZ,
  updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT month_schedules_unique_church_ministry_month
    UNIQUE (church_id, ministry_id, month, year)
);

CREATE INDEX idx_month_schedules_church_month
  ON public.month_schedules(church_id, ministry_id, month, year);

ALTER TABLE public.month_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their church's month schedules"
  ON public.month_schedules FOR SELECT
  USING (church_id = get_user_church_id());

CREATE POLICY "Admins manage their church's month schedules"
  ON public.month_schedules FOR ALL
  USING (church_id = get_user_church_id());

REVOKE ALL ON public.month_schedules FROM anon, authenticated;
GRANT SELECT ON public.month_schedules TO authenticated;

-- ============================================================================
-- 2. READ-ONLY HELPERS (shared by both transitions, and by parity with the
--    client-side derivation in src/lib/scheduling/month-workflow.ts)
-- ============================================================================

-- The active service set for a month: non-archived services, one per logical
-- week. When an original and its draft amendment both exist, the amendment is
-- the current intent; a published amendment has already archived its original,
-- so only the published revision row remains. The TS side (`activeMonthServices`)
-- must implement IDENTICAL ordering or the UI badge and the RPC disagree.
CREATE OR REPLACE FUNCTION public.month_active_service_ids(
  p_church_id UUID,
  p_ministry_id UUID,
  p_month INTEGER,
  p_year INTEGER
)
RETURNS UUID[]
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT ARRAY(
    SELECT ranked.id
    FROM (
      SELECT c.id,
             ROW_NUMBER() OVER (
               PARTITION BY COALESCE(c.revision_of, c.id)
               ORDER BY (CASE WHEN c.revision_of IS NOT NULL THEN 1 ELSE 0 END) DESC,
                        c.created_at DESC
             ) AS rn
      FROM public.services c
      WHERE c.church_id = p_church_id
        AND c.month = p_month
        AND c.year = p_year
        AND c.status <> 'archived'
        AND (p_ministry_id IS NULL OR c.ministry_id = p_ministry_id)
    ) ranked
    WHERE ranked.rn = 1
  )
$$;

-- The truthful month status, recomputed from the active services:
--   NULL        - no services exist for the month
--   'published' - every active service is published
--   'validated' - every active service is published OR validated for its
--                 current schedule_version (nothing left to validate)
--   'draft'     - any draft, or any validated service whose version drifted
-- This IS the auto-downshift: an edit bumps schedule_version, the
-- validated_version comparison goes stale, and the month reads 'draft' again.
CREATE OR REPLACE FUNCTION public.month_derive_status(
  p_church_id UUID,
  p_ministry_id UUID,
  p_month INTEGER,
  p_year INTEGER
)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN COUNT(*) = 0 THEN NULL
    WHEN BOOL_AND(active.status = 'published') THEN 'published'
    WHEN BOOL_AND(
      active.status = 'published'
      OR (active.status = 'validated' AND active.validated_version IS NOT DISTINCT FROM active.schedule_version)
    ) THEN 'validated'
    ELSE 'draft'
  END
  FROM public.services active
  WHERE active.id = ANY(public.month_active_service_ids(p_church_id, p_ministry_id, p_month, p_year))
$$;

REVOKE ALL ON FUNCTION public.month_active_service_ids(UUID, UUID, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.month_active_service_ids(UUID, UUID, INTEGER, INTEGER) TO service_role;
REVOKE ALL ON FUNCTION public.month_derive_status(UUID, UUID, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.month_derive_status(UUID, UUID, INTEGER, INTEGER) TO service_role;

-- ============================================================================
-- 3. VALIDATE MONTH
--
-- The TypeScript route runs the full `ScheduleValidator` at final stage per
-- draft (the same surface as the single-service validate route) and refuses to
-- call this RPC when any critical remains. This RPC is the second line of
-- defence: it re-asserts `assert_service_meets_publication_rules` for every
-- draft, exactly like the single-service RPCs, and performs all month rows in
-- one transaction.
-- ============================================================================
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

REVOKE ALL ON FUNCTION public.validate_month_schedule(UUID, UUID, INTEGER, INTEGER, UUID, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_month_schedule(UUID, UUID, INTEGER, INTEGER, UUID, JSONB) TO service_role;

-- ============================================================================
-- 4. PUBLISH MONTH
--
-- Only reachable from a validated month (the client hides the button until
-- `month_derive_status` = 'validated'; this RPC re-asserts it inside the
-- transaction). Two gates, both returned as documents so the HTTP route can
-- map them to distinct statuses instead of one generic failure:
--   'unvalidated' -> 409: a service is drafted, or a validated service's
--                    version drifted since validation, so the month would
--                    publish work the coordinator has not approved.
--   'incomplete'  -> 422: a validated lineup still carries unfilled positions.
--                    `services.unfilled_positions` is the deferrable-gap list
--                    publication consults: gaps are legal at validation (a
--                    coordinator-overridden or deferred gap), never at
--                    publication.
-- Then every active service is published in the same transaction, the month
-- row records who published and when, and 'month_published' is audited.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.publish_month_schedule(
  p_church_id UUID,
  p_ministry_id UUID,
  p_month INTEGER,
  p_year INTEGER,
  p_actor_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_candidate_ids UUID[];
  v_ids UUID[];
  v_month_status TEXT;
  v_service public.services%ROWTYPE;
  v_incomplete jsonb := '[]'::jsonb;
  v_unvalidated jsonb := '[]'::jsonb;
  v_published UUID[] := ARRAY[]::UUID[];
  v_already UUID[] := ARRAY[]::UUID[];
  v_version INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_actor_id AND church_id = p_church_id AND is_active AND role IN ('admin', 'coordinator')) THEN
    RAISE EXCEPTION 'Coordinator authorization could not be verified' USING ERRCODE = '42501';
  END IF;

  -- Lock the candidate superset so the ranked read below is stable, then read
  -- the active (ranked) set among the locked rows (same pattern as validate).
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

  v_month_status := public.month_derive_status(p_church_id, p_ministry_id, p_month, p_year);

  -- Gate 1: the month must be validated. Report every service that is not, so
  -- the coordinator sees exactly what to re-validate (409 on the route).
  IF v_month_status <> 'validated' THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'service_id', s.id,
             'week_number', s.week_number,
             'status', s.status,
             'reason', CASE
               WHEN s.status = 'draft' THEN 'not_validated'
               WHEN s.status = 'validated' AND s.validated_version IS DISTINCT FROM s.schedule_version THEN 'version_drifted'
               ELSE 'unexpected_state'
             END
           ) ORDER BY s.date), '[]'::jsonb)
      INTO v_unvalidated
      FROM public.services s
     WHERE s.id = ANY(v_ids);

    RETURN jsonb_build_object(
      'ok', false,
      'code', 'unvalidated',
      'month_status', v_month_status,
      'services', v_unvalidated
    );
  END IF;

  -- Gate 2: no active service may carry an unfilled position. A validated
  -- lineup can carry deferred/overridden gaps; a published one cannot (422).
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'service_id', s.id,
           'week_number', s.week_number,
           'unfilled_count', jsonb_array_length(COALESCE(s.unfilled_positions, '[]'::jsonb))
         ) ORDER BY s.date), '[]'::jsonb)
    INTO v_incomplete
    FROM public.services s
   WHERE s.id = ANY(v_ids)
     AND jsonb_array_length(COALESCE(s.unfilled_positions, '[]'::jsonb)) > 0;

  IF jsonb_array_length(v_incomplete) > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'incomplete',
      'services', v_incomplete
    );
  END IF;

  -- Publish pass: every active service is validated for its current version at
  -- this point, so nothing below can hit an unvalidated lineup.
  FOR v_service IN
    SELECT active.* FROM public.services active
    WHERE active.id = ANY(v_ids)
    ORDER BY active.date
  LOOP
    IF v_service.status = 'published' THEN
      v_already := array_append(v_already, v_service.id);
      CONTINUE;
    END IF;

    v_version := COALESCE(v_service.schedule_version, 1);
    UPDATE public.services
       SET status = 'published',
           published_by = p_actor_id,
           published_at = NOW()
     WHERE id = v_service.id;
    INSERT INTO public.schedule_change_log(church_id, service_id, actor_id, action, from_version, to_version, after_state)
    VALUES (p_church_id, v_service.id, p_actor_id, 'published', v_service.schedule_version, v_version,
      jsonb_build_object('scope', 'month'));
    v_published := array_append(v_published, v_service.id);
  END LOOP;

  INSERT INTO public.month_schedules(church_id, ministry_id, month, year, status, published_by, published_at, updated_by, updated_at)
  VALUES (p_church_id, p_ministry_id, p_month, p_year, 'published', p_actor_id, NOW(), p_actor_id, NOW())
  ON CONFLICT (church_id, ministry_id, month, year)
  DO UPDATE SET status = EXCLUDED.status, published_by = EXCLUDED.published_by, published_at = NOW(),
                updated_by = EXCLUDED.updated_by, updated_at = NOW();

  INSERT INTO public.schedule_change_log(church_id, service_id, actor_id, action, from_version, to_version, after_state)
  VALUES (p_church_id, NULL, p_actor_id, 'month_published', NULL, NULL,
    jsonb_build_object(
      'ministry_id', p_ministry_id,
      'month', p_month,
      'year', p_year,
      'published', v_published,
      'already_published', v_already
    ));

  RETURN jsonb_build_object(
    'ok', true,
    'month_status', 'published',
    'published', v_published,
    'already_published', v_already
  );
END;
$$;

REVOKE ALL ON FUNCTION public.publish_month_schedule(UUID, UUID, INTEGER, INTEGER, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_month_schedule(UUID, UUID, INTEGER, INTEGER, UUID) TO service_role;

-- ============================================================================
-- 5. ROLLBACK (DOCUMENTATION ONLY - NOT EXECUTED HERE)
--
-- Reverse order, verified against the definitions above:
--
--   REVOKE ALL ON FUNCTION public.publish_month_schedule(UUID, UUID, INTEGER, INTEGER, UUID) FROM PUBLIC, anon, authenticated;
--   DROP FUNCTION public.publish_month_schedule(UUID, UUID, INTEGER, INTEGER, UUID);
--   REVOKE ALL ON FUNCTION public.validate_month_schedule(UUID, UUID, INTEGER, INTEGER, UUID, JSONB) FROM PUBLIC, anon, authenticated;
--   DROP FUNCTION public.validate_month_schedule(UUID, UUID, INTEGER, INTEGER, UUID, JSONB);
--   REVOKE ALL ON FUNCTION public.month_derive_status(UUID, UUID, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
--   DROP FUNCTION public.month_derive_status(UUID, UUID, INTEGER, INTEGER);
--   REVOKE ALL ON FUNCTION public.month_active_service_ids(UUID, UUID, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
--   DROP FUNCTION public.month_active_service_ids(UUID, UUID, INTEGER, INTEGER);
--   DROP POLICY "Admins manage their church's month schedules" ON public.month_schedules;
--   DROP POLICY "Users can view their church's month schedules" ON public.month_schedules;
--   ALTER TABLE public.month_schedules DISABLE ROW LEVEL SECURITY;
--   DROP TABLE public.month_schedules;
--
-- Cost notes: `month_schedules` rows and the 'month_validated' / 'month_published'
-- audit rows are discarded, and any service published ONLY through
-- `publish_month_schedule` retains its 'published' status (it is real data, not
-- derived); rolling the schema back does not un-publish it. Single-service
-- lifecycle functions are unaffected by this rollback.
-- ============================================================================