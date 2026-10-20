-- ===========================================================================
-- Migration: revalidate_drifted_schedule
-- Created: 2026-10-12
--
-- PROBLEM
-- -------
-- `validate_service_schedule` only accepted `services.status = 'draft'`. A row
-- that is `validated` but whose `validated_version` does not match its current
-- `schedule_version` was therefore in a dead end:
--
--   * `publish_service_schedule` refuses it -- publishing requires the versions
--     to match, which is exactly what forces a fresh validation pass.
--   * `validate_service_schedule` refused it too -- the raw status was not
--     'draft'.
--
-- The client-side month derivation (`lib/scheduling/month-workflow.ts`) already
-- reads such a row as 'draft' (the auto-downshift), so the UI badge and the SQL
-- gates disagreed: the month read as a draft while the service card could only
-- ever offer Publish, and Publish always 409'd with "Only a schedule validated
-- for its current version can be published."
--
-- The drifted state is reachable without an edit: any write that sets
-- `status = 'validated'` without stamping `validated_version` (e.g. a seed or a
-- manual SQL promotion) produces it. A `validated_version IS NULL` row is the
-- same drift with nothing to compare against.
--
-- FIX
-- ---
-- Accept the drifted `validated` row as (re)validatable, so the three layers --
-- UI buttons, `POST /api/validation`, and this SQL function -- agree. A freshly
-- validated row (stamp matches the current version) is still refused: there is
-- nothing to re-validate.
-- ===========================================================================

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

REVOKE ALL ON FUNCTION public.validate_service_schedule(UUID, UUID, UUID, INTEGER, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_service_schedule(UUID, UUID, UUID, INTEGER, JSONB) TO service_role;

-- ===========================================================================
-- DOWN MIGRATION (documentation only -- not executed)
-- ===========================================================================
--
-- Restore the prior guard from 20260930120000_partial_schedule_gaps_overrides.sql
-- (line 1149), verbatim:
--
--   IF v_service.status <> 'draft' OR v_service.schedule_version <> p_expected_version THEN RAISE EXCEPTION 'Schedule is not a current draft' USING ERRCODE = '40001'; END IF;
--
-- Rolling back restores the dead end for drifted `validated` rows. It does NOT
-- change any row's state: the `validated_version` stamps written while this
-- migration was live remain valid, because the UPDATE below is unchanged.
