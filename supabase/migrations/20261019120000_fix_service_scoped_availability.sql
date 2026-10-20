-- Fix: scope the availability gate to the service being published/validated.
--
-- The availability EXISTS in public.assert_service_meets_publication_rules
-- previously joined availability for assignments ANYWHERE in the church, so an
-- approved/pending availability belonging to a member assigned to an unrelated
-- service could block this one. This adds `AND a.service_id = p_service_id` and
-- nothing else, preserving the tenant/member predicates, the weekly/date/
-- leave/recurring arms, and the hard-failure behaviour for a member who really
-- is unavailable for THIS service.
--
-- Regenerated from the LIVE function definition (which already differs from
-- migration 20260930120000: the backup rule now excludes devotion rows via
-- NOT a.is_devotion and the name regex includes the 'back up' spelling) so that
-- no unrelated rule is regressed by this replacement.
CREATE OR REPLACE FUNCTION public.assert_service_meets_publication_rules(p_church_id uuid, p_service_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
DECLARE
  v_ministry_id UUID;
  v_month INTEGER;
  v_year INTEGER;
  v_revision_of UUID;
  v_leaders INTEGER;
  v_backups INTEGER;
  v_min_backups INTEGER;
  v_max_backups INTEGER;
  v_monthly_limit INTEGER;
  v_missing_instruments TEXT;
  v_override_availability BOOLEAN;
  v_override_instrument_qualification BOOLEAN;
  v_week_number INTEGER;
  v_date DATE;
BEGIN
  SELECT s.ministry_id, s.month, s.year, s.revision_of, s.week_number, s.date,
         COALESCE((s.active_overrides->>'availability')::boolean, FALSE),
         COALESCE((s.active_overrides->>'instrument_qualification')::boolean, FALSE)
  INTO v_ministry_id, v_month, v_year, v_revision_of, v_week_number, v_date,
       v_override_availability, v_override_instrument_qualification
  FROM public.services s
  WHERE s.id = p_service_id AND s.church_id = p_church_id;
  IF v_ministry_id IS NULL THEN
    RAISE EXCEPTION 'Schedule not found or has unresolved ministry ownership' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE((mr.rule_config->>'min_required')::integer, (c.settings->>'default_min_backup_singers')::integer, 3),
         COALESCE((mr.rule_config->>'max_allowed')::integer, (c.settings->>'default_max_backup_singers')::integer, 3)
  INTO v_min_backups, v_max_backups
  FROM public.churches c
  LEFT JOIN LATERAL (SELECT rule_config FROM public.ministry_rules WHERE ministry_id = v_ministry_id AND rule_type = 'backup_count' AND is_active LIMIT 1) mr ON TRUE
  WHERE c.id = p_church_id;

  SELECT COUNT(*) INTO v_leaders
  FROM public.schedule_assignments a WHERE a.service_id = p_service_id AND a.is_leader;
  -- Rule 5. Re-asserted as EXACTLY one, the deferred draft being zero.
  IF v_leaders <> 1 THEN
    RAISE EXCEPTION 'Exactly one worship leader is required to validate or publish this schedule (found %)', v_leaders
      USING ERRCODE = '23514';
  END IF;

  -- Rule 7. The single leader MUST hold the ministry's Worship Leader role. The
  -- leader marker alone is not authority: `persist_month_schedule` inserts
  -- whatever the generator hands it, so a draft can reach this gate carrying a
  -- leader who was never qualified. Re-asserting the ROLE on the leader row (not
  -- just "some assignment somewhere") also pins the marker/role identity that
  -- `replace_service_assignments` enforces at draft time. No override axis
  -- reaches this: an unqualified worship leader is never licensable.
  IF NOT EXISTS (
    SELECT 1 FROM public.schedule_assignments a
    JOIN public.roles r ON r.id = a.role_id
    JOIN public.member_roles mr ON mr.member_id = a.member_id AND mr.role_id = r.id
    WHERE a.service_id = p_service_id AND a.is_leader
      AND r.ministry_id = v_ministry_id AND r.is_active
      AND pg_catalog.lower(pg_catalog.btrim(r.name)) = 'worship leader'
  ) THEN
    RAISE EXCEPTION 'The assigned worship leader does not hold the Worship Leader role for this ministry' USING ERRCODE = '23514';
  END IF;

  -- Rule 3. One role per member per service. Structurally guaranteed by
  -- schedule_assignments_service_id_member_id_key UNIQUE (service_id, member_id),
  -- which is the table-level backstop for every write path. Re-asserted here so a
  -- duplicate surfaces as a domain error at the gate rather than only as a raw
  -- constraint violation at insert time.
  IF EXISTS (
    SELECT 1 FROM public.schedule_assignments a
    WHERE a.service_id = p_service_id
    GROUP BY a.member_id HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'A member may only have one role per service' USING ERRCODE = '23505';
  END IF;

  -- Rule 6. Active members only. UNCONDITIONAL, and re-asserted rather than
  -- trusted from draft time: a member can be deactivated AFTER the lineup was
  -- saved and BEFORE validation, which is precisely the window a staged draft
  -- opens up. No override axis reaches this.
  IF EXISTS (
    SELECT 1 FROM public.schedule_assignments a
    JOIN public.members m ON m.id = a.member_id
    WHERE a.service_id = p_service_id AND m.status <> 'active'
  ) THEN
    RAISE EXCEPTION 'An assigned member is no longer active' USING ERRCODE = '23514';
  END IF;

  -- Rule 1 (availability). RE-ASSERTED HERE, from persisted rows, rather than
  -- trusted from draft time. The availability check in
  -- `replace_service_assignments` only ever saw the assignments in the caller's
  -- JSONB payload, so it cannot cover a member whose availability was approved or
  -- changed AFTER the lineup was saved and BEFORE validation -- and a staged draft
  -- is exactly the window in which that happens. Without this block, validating
  -- a lineup whose leader has since marked themselves unavailable would succeed.
  --
  -- Skippable ONLY under an explicit availability licence, the same axis, read
  -- from the same `active_overrides` column, under the same allowlist CHECK that
  -- bounds it to two keys. Note the licence is read from the STORED column rather
  -- than a parameter, so it cannot be widened by a caller at this gate.
  --
  -- The predicate is a line-for-line mirror of `ScheduleValidator.checkAvailability`
  -- (validator.ts). It must never be WEAKER than the TypeScript layer: this gate
  -- is the last thing standing between a staged draft and a published schedule,
  -- so a type handled by the validator but missed here would be a type the
  -- database waves through. `recurring` therefore appears in BOTH branches below,
  -- exactly as it does at validator.ts:97 and :105 -- it carries a week-number
  -- match AND, when it has dates, a range match.
  IF NOT v_override_availability AND EXISTS (
    SELECT 1 FROM public.schedule_assignments a
    JOIN public.members m ON m.id = a.member_id
    JOIN public.availability av ON av.member_id = m.id AND av.church_id = p_church_id
      AND av.status IN ('pending', 'approved')
      AND a.service_id = p_service_id
      AND (
        (av.type = 'weekly' AND av.week_number = v_week_number AND (av.month IS NULL OR av.month = v_month) AND (av.year IS NULL OR av.year = v_year))
        OR (av.type = 'date' AND av.date = v_date)
        OR (av.type IN ('vacation', 'temporary_leave', 'emergency_leave', 'recurring') AND av.date <= v_date AND COALESCE(av.end_date, av.date) >= v_date)
        OR (av.type = 'recurring' AND av.week_number = v_week_number AND (av.month IS NULL OR av.month = v_month) AND (av.year IS NULL OR av.year = v_year))
      )
  ) THEN
    RAISE EXCEPTION 'An assigned member is unavailable for this service' USING ERRCODE = '23514';
  END IF;

  -- Rule 4. Matches the shared TypeScript classifier BACKUP_ROLE_NAME_PATTERN
  -- (/vocal|singer|backup/) rather than the stale exact-name list this file's
  -- siblings used: a narrower SQL predicate would UNDER-count backups and fail a
  -- lineup the reader and the validator both consider complete.
  SELECT COUNT(*) INTO v_backups
  FROM public.schedule_assignments a
  JOIN public.roles r ON r.id = a.role_id
  WHERE a.service_id = p_service_id AND NOT a.is_leader AND NOT a.is_devotion AND a.instrument_id IS NULL
    AND pg_catalog.lower(r.name) ~ '(vocal|singer|backup|back up)';
  IF v_backups NOT BETWEEN v_min_backups AND v_max_backups THEN
    RAISE EXCEPTION 'Backup count % is outside the required range %-% to validate or publish this schedule', v_backups, v_min_backups, v_max_backups
      USING ERRCODE = '23514';
  END IF;

  -- Rule 2 (monthly limit). UNCONDITIONAL: no override axis reaches it, and it is
  -- re-asserted from PERSISTED rows rather than trusted from draft time. The count
  -- is the member's whole non-archived load in this church's month/year, this
  -- service included, mirroring the `:583-599` subquery shape used at draft time
  -- (with the draft's own assignments already in the table rather than supplied
  -- as a JSONB parameter). Excludes the superseded original when this service is
  -- an amendment, so an amendment does not count its own parent twice.
  SELECT COALESCE((c.settings->>'default_max_monthly_assignments')::integer, 3)
  INTO v_monthly_limit FROM public.churches c WHERE c.id = p_church_id;
  IF EXISTS (
    SELECT 1 FROM public.schedule_assignments a
    JOIN public.members m ON m.id = a.member_id
    WHERE a.service_id = p_service_id
      AND (
        SELECT COUNT(*) FROM public.schedule_assignments a2
        JOIN public.services s2 ON s2.id = a2.service_id
        WHERE a2.member_id = m.id AND s2.church_id = p_church_id
          AND s2.month = v_month AND s2.year = v_year
          AND s2.status <> 'archived'
          AND (v_revision_of IS NULL OR s2.id <> v_revision_of)
      ) > COALESCE(NULLIF(m.max_monthly_assignments, 0), v_monthly_limit)
  ) THEN
    RAISE EXCEPTION 'A member exceeds the monthly assignment limit for this service' USING ERRCODE = '23514';
  END IF;

  -- Required instruments, from the MINISTRY CATALOGUE. This is the C1/H1 fix at
  -- the database level: deriving "required" from member_skills cannot see an
  -- instrument nobody holds, so that gap used to be unrepresentable.
  --
  -- Skippable ONLY under an explicit, reason-bearing instrument_qualification
  -- override (plan Step 7 item 7). Without that carve-out the check is
  -- unsatisfiable rather than merely strict: `replace_service_assignments`
  -- refuses any instrument the member has no skill for, so a required
  -- instrument with zero skill-holders could never be staffed and NO schedule
  -- for such a ministry could ever validate or publish.
  IF NOT v_override_instrument_qualification THEN
    SELECT string_agg(i.name, ', ' ORDER BY i.name) INTO v_missing_instruments
    FROM public.instruments i
    WHERE i.ministry_id = v_ministry_id AND i.is_required
      AND NOT EXISTS (
        SELECT 1 FROM public.schedule_assignments a
        WHERE a.service_id = p_service_id AND a.instrument_id = i.id
      );
    IF v_missing_instruments IS NOT NULL THEN
      RAISE EXCEPTION 'Required instrument(s) not assigned: %', v_missing_instruments USING ERRCODE = '23514';
    END IF;
  END IF;

  -- Devotion, required only when the ministry actually defines the role, and
  -- matched with the same includes('devotion') predicate the classifier uses so a
  -- church-defined 'Devotion Leader' name is not silently skipped.
  IF EXISTS (SELECT 1 FROM public.roles r WHERE r.ministry_id = v_ministry_id AND r.is_active AND pg_catalog.lower(r.name) LIKE '%devotion%')
     AND NOT EXISTS (
       SELECT 1 FROM public.schedule_assignments a
       JOIN public.roles r ON r.id = a.role_id
       WHERE a.service_id = p_service_id AND pg_catalog.lower(r.name) LIKE '%devotion%'
     ) THEN
    RAISE EXCEPTION 'Required Devotion role is not assigned' USING ERRCODE = '23514';
  END IF;
END;
$function$

REVOKE ALL ON FUNCTION public.assert_service_meets_publication_rules(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_service_meets_publication_rules(UUID, UUID) TO service_role;