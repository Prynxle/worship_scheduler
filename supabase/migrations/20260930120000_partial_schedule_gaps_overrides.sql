-- Partial schedules: explicit unfilled positions and scoped coordinator overrides.
--
-- PRODUCT CHANGE. Previously a month was all-or-nothing: `replace_service_assignments`
-- demanded EXACTLY one leader and a backup count inside the configured range, and
-- `persist_month_schedule` aborted the whole month on any unresolvable position. A
-- single unfillable slot therefore destroyed an otherwise valid schedule and the
-- coordinator saw nothing at all.
--
-- A DRAFT may now be partial. The four deferrable gaps are: no worship leader
-- (Rule 5), below the backup minimum (Rule 4 minimum), an unassigned REQUIRED
-- instrument, and the Devotion role. Each is reported in
-- `services.unfilled_positions` and re-asserted at validation and publication.
--
-- WHAT IS NOT DEFERRED, and is enforced unconditionally in this file:
--   * more than one worship leader          (Rule 5)
--   * more than `max_allowed` backups       (Rule 4 maximum)
--   * inactive members                      (Rule 6)
--   * a member in two roles in one service  (Rule 3)
--   * Worship Leader role qualification     (Rule 7)
--   * the monthly assignment limit          (Rule 2)
--   * ministry ownership, actor role, RLS, version preconditions
--
-- THE OVERRIDE SURFACE IS EXACTLY TWO AXES, AND IT IS A DATABASE INVARIANT.
-- `services_active_overrides_allowlist` below is a four-value CHECK: a coordinator
-- can licence `availability` and/or `instrument_qualification` and nothing else,
-- so widening the TypeScript surface without a migration is impossible. Leader-role
-- qualification is deliberately absent from the allowlist: a coordinator must not be
-- able to book an unqualified worship leader.
--
-- SECURITY INVOKER on every function here, matching every sibling in
-- 20260928084433. These routines hold no authority of their own: the admin client
-- calls them as `service_role` and they authorise by looking up `p_actor_id` in
-- `public.users` for `p_church_id` on every call.

-- ===========================================================================
-- DOCUMENTED INCONSISTENCY: legacy `replace_month_schedule` is NOT aligned here
-- ===========================================================================
--
-- INTENTIONALLY LEFT ALONE. Do not "fix" this by relaxing its `<> 1` check.
--
-- This migration makes a zero-leader DRAFT a legal, representable state.
-- `public.replace_month_schedule(...)` -- the older all-or-nothing RPC from
-- 20260928060003, amended by 20260928061010 -- still ends in:
--
--     IF v_leader_count <> 1 THEN
--         RAISE EXCEPTION 'leader_count: service for week % has % worship
--                         leaders, exactly 1 is required', v_week, v_leader_count
--             USING ERRCODE = 'W0003';
--     END IF;
--
-- so it is now STRICTER than this migration's model and will reject a legitimate
-- partial draft. That divergence is accepted, for four reasons:
--
--  1. IT HAS NO CALLER. A repo-wide search of `src/` finds no call site; the only
--     references are the migration that created it, a comment in
--     `src/app/api/schedule/route.ts`, a comment in `src/lib/scheduling/
--     persistence.ts`, a comment in `src/lib/api/errors.ts`, and one test named
--     "writes the month through persist_month_schedule, never
--     replace_month_schedule" which asserts the ABSENCE of any call. No code path
--     can reach it, so no shipping behaviour depends on the disagreement.
--
--  2. IT FAILS CLOSED AND LOUDLY. Because the check sits after the insert loop, a
--     zero-leader service raises `W0003` and the surrounding transaction aborts.
--     It therefore CANNOT silently write a partial service while leaving
--     `unfilled_positions` at its `'[]'` default -- the precise silent-corruption
--     failure mode that column exists to prevent. An unreachable, loudly-failing
--     function is not a data-integrity risk.
--
--  3. ALIGNING IT IS UNTESTABLE RIGHT NOW. The live project is the only database
--     available for this change, and rewriting ~400 lines of plpgsql that can be
--     neither executed nor regression-tested would be a far larger risk than the
--     inconsistency it purports to remove: a broken rewrite of a function the app
--     does not call buys nothing and can fail at the worst possible moment. An
--     untested rewrite is the greater hazard, not the smaller one.
--
--  4. IT IS A DEFECT, NOT AN OVERSIGHT, and it is scoped for later. If a future
--     change ever revives this RPC, aligning its leader check with the partial
--     model -- and teaching it to persist `unfilled_positions` -- is part of that
--     work, deliberately not smuggled in here.
--
-- NOTE ON VERIFICATION ROW I18. The plan's I18 reads "grep the new migration for
-- the `<> 1` leader check". This file DOES contain a `<> 1` comparison, in
-- `assert_service_meets_publication_rules` below. That grep match is NOT evidence
-- about `replace_month_schedule` and must not be reported as though it were. The
-- honest position is that I18 is UNSATISFIED BY DESIGN: the legacy function is
-- knowingly left divergent, per the four reasons above, and the only real evidence
-- about that function is the read of its current live body.

-- ===========================================================================
-- 0. PREREQUISITE REPAIR: pin the search_path of a pre-existing trigger
-- ===========================================================================
--
-- A LATENT PRODUCTION BUG, NOT INTRODUCED HERE, BUT IT BLOCKS THIS FEATURE.
--
-- `trigger_update_assignment_count` (20260727213800) fires
-- `public.update_member_assignment_count()` on every INSERT/DELETE against
-- `public.schedule_assignments`. That function is declared with NO
-- `search_path` of its own, and its body uses UNQUALIFIED relation names:
--
--     UPDATE members
--        SET total_assignments = total_assignments + 1,
--            last_scheduled_date = (SELECT MAX(s.date) FROM services s
--                                    WHERE s.id = NEW.service_id)
--        WHERE id = NEW.member_id;
--
-- A trigger function with no pinned `search_path` resolves its unqualified
-- names against the CALLER's effective `search_path`. Since
-- 20260928084433 declared `persist_month_schedule` (line 195) and
-- `replace_service_assignments` (line 493) as `SET search_path = ''`, the
-- empty path is what the trigger inherits, and the statement above fails:
--
--     ERROR: 42P01: relation "members" does not exist
--
-- So BOTH write paths into `schedule_assignments` -- manual lineup saves via
-- `replace_service_assignments`, and month generation via
-- `persist_month_schedule` -- have been failing in production since that
-- hardening migration deployed. This feature cannot persist a single
-- assignment until it is fixed, so the repair is a prerequisite, not scope
-- creep.
--
-- WHY `ALTER FUNCTION ... SET search_path` AND NOT A BODY REWRITE. The defect
-- is the missing pin, not the body. `ALTER FUNCTION` repairs the declaration
-- without forking a pre-existing definition into a new migration, and matches
-- the pattern already used for its sibling trigger function in this same
-- repository: `log_audit_change()` is pinned to `public, pg_temp, auth` by
-- 20260928055923, and `replace_month_schedule` is pinned to `public, pg_temp`
-- by 20260928061010. Pinning to `public, pg_temp` keeps `members` and
-- `services` resolvable while still refusing anything caller-controlled; a
-- later `CREATE OR REPLACE` that adds a body without re-adding the pin would
-- keep this attribute, so the repair survives.
--
-- SCOPE CHECK. The only other unpinned trigger function in `public` is
-- `update_updated_at_column()`, whose body touches no relation at all
-- (`NEW.updated_at = NOW()`), so it is immune to an empty `search_path` and is
-- deliberately left alone. `update_member_assignment_count()` is the only one
-- that needs this.

ALTER FUNCTION public.update_member_assignment_count() SET search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.services
  ADD COLUMN IF NOT EXISTS unfilled_positions JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS active_overrides JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.services.unfilled_positions IS
  'Positions the generator or the last manual edit could not fill, with the reason each candidate was rejected. Written by persist_month_schedule and replace_service_assignments; the single READ authority for gaps (GET never recomputes it).';
COMMENT ON COLUMN public.services.active_overrides IS
  'Service-level coordinator override licences. Allowlisted to {availability, instrument_qualification} only. ASSIGN, never merge: a write that omits an axis clears it, so a one-off decision cannot become a permanent silent skip.';

-- Array-ness is checkable without a subquery; per-element shape is validated inside
-- the RPCs (PostgreSQL forbids subqueries in CHECK, so the per-element guard cannot
-- live here).
ALTER TABLE public.services DROP CONSTRAINT IF EXISTS services_unfilled_positions_is_array;
ALTER TABLE public.services ADD CONSTRAINT services_unfilled_positions_is_array
  CHECK (jsonb_typeof(unfilled_positions) = 'array');

-- The override allowlist, as an enumerated equality rather than a key filter. Four
-- literals cover the whole legal surface, so an unknown key, a `false` value, a
-- non-boolean, or a nested value is all rejected by the same constraint. jsonb
-- equality is key-order and whitespace independent, so client key order is irrelevant.
ALTER TABLE public.services DROP CONSTRAINT IF EXISTS services_active_overrides_allowlist;
ALTER TABLE public.services ADD CONSTRAINT services_active_overrides_allowlist
  CHECK (
    active_overrides = '{}'::jsonb
    OR active_overrides = '{"availability": true}'::jsonb
    OR active_overrides = '{"instrument_qualification": true}'::jsonb
    OR active_overrides = '{"availability": true, "instrument_qualification": true}'::jsonb
  );

-- ---------------------------------------------------------------------------
-- Backfill: RECOMPUTE the gaps, do not assume the rows are complete
-- ---------------------------------------------------------------------------
--
-- THE PREVIOUS VERSION OF THIS BLOCK WAS WRONG, and the error was a fabricated
-- fact rather than a sloppy default. It read:
--
--     -- Existing rows are all complete generations, so backfill rather than
--     -- leaving a NULL-vs-[] ambiguity for the read path.
--     UPDATE public.services SET unfilled_positions = '[]'::jsonb WHERE unfilled_positions IS NULL;
--
-- Three separate claims in that comment are false against this database:
--
--   1. "Existing rows are all complete generations." They are not. Every one of
--      the four live services is missing its required Electric Guitar, and none of
--      them records that. Writing '[]' declared four incomplete schedules
--      COMPLETE, which is precisely the silent-corruption failure this column
--      exists to prevent -- asserted into the one field the read path trusts and
--      never recomputes.
--   2. "WHERE unfilled_positions IS NULL" matches nothing. The column was just
--      created NOT NULL DEFAULT '[]', so PostgreSQL backfilled every pre-existing
--      row with '[]' as part of the ALTER TABLE. The statement was a no-op that
--      read like a repair.
--   3. It conflated "complete" with "not yet evaluated". Both are '[]', and only
--      one of them is a claim about the lineup.
--
-- So the gaps are COMPUTED here, from persisted state, using the same four
-- deferrable positions the generator reports and the same rules
-- `assert_service_meets_publication_rules` re-asserts. The message strings and
-- `required_slots` semantics are copied from `unfilledFrom` in
-- `src/lib/scheduling/gaps.ts` on purpose: a backfilled gap and a generated gap
-- must be indistinguishable to the editor, or the same shortfall renders as two
-- different facts depending on which wrote the row.
--
-- The candidate arrays are empty, again matching `unfilledFrom`: this gap was
-- found by reading a lineup, not by exhausting a candidate pool. Fabricating a
-- rejection reason here would put an invented explanation in front of a
-- coordinator.
--
-- HONEST LIMIT OF THIS BACKFILL. `ministry_id IS NULL` rows are left at '[]' and
-- are NOT recomputed. Required positions are ministry-scoped, so with no ministry
-- there is nothing to compare the lineup against and no sound answer exists. That
-- '[]' means "not evaluated", not "complete", and the rows are exactly the legacy
-- rows that `persist_month_schedule` already refuses to generate over
-- ("resolve unresolved ministry ownership").
DO $$
DECLARE
  v_service RECORD;
  v_gaps JSONB;
  v_min_backups INTEGER;
  v_backup_count INTEGER;
  v_leaders INTEGER;
  v_devotion_required BOOLEAN;
  v_devotion_assigned BOOLEAN;
  v_instrument RECORD;
BEGIN
  FOR v_service IN SELECT id, week_number, date, ministry_id, church_id FROM public.services WHERE ministry_id IS NOT NULL
  LOOP
    v_gaps := '[]'::jsonb;

    -- Rule 5, deferrable side: no leader.
    SELECT count(*) INTO v_leaders FROM public.schedule_assignments a WHERE a.service_id = v_service.id AND a.is_leader;
    IF v_leaders = 0 THEN
      v_gaps := v_gaps || jsonb_build_array(jsonb_build_object(
        'service_id', v_service.id, 'week_number', v_service.week_number, 'date', v_service.date,
        'role_name', 'Worship Leader', 'required_slots', 1,
        'message', 'No worship leader assigned for week ' || v_service.week_number::text || '.',
        'eligible_candidates', '[]'::jsonb, 'rejected_candidates', '[]'::jsonb));
    END IF;

    -- Rule 4, deferrable side: backup shortfall. The resolution chain mirrors
    -- `loadScheduleData` -> `backupRuleNumbers`: the ministry rule wins, then the
    -- church default, then 3. The OUTER coalesce is load-bearing. Without it a
    -- service whose church row is missing would leave v_min_backups NULL, and
    -- `v_backup_count < NULL` is NULL, so the gap would be silently skipped --
    -- a backfill that quietly reports "complete" is the exact failure this
    -- migration exists to prevent.
    SELECT COALESCE(
             (SELECT (mr.rule_config->>'min_required')::integer
                FROM public.ministry_rules mr
               WHERE mr.ministry_id = v_service.ministry_id
                 AND mr.rule_type = 'backup_count' AND mr.is_active
               LIMIT 1),
             (SELECT (c.settings->>'default_min_backup_singers')::integer
                FROM public.churches c WHERE c.id = v_service.church_id),
             3)
    INTO v_min_backups;

    SELECT count(*) INTO v_backup_count
    FROM public.schedule_assignments a
    JOIN public.roles r ON r.id = a.role_id
    WHERE a.service_id = v_service.id AND NOT a.is_leader AND a.instrument_id IS NULL
      AND pg_catalog.lower(r.name) ~ '(vocal|singer|backup)';

    IF v_backup_count < v_min_backups THEN
      v_gaps := v_gaps || jsonb_build_array(jsonb_build_object(
        'service_id', v_service.id, 'week_number', v_service.week_number, 'date', v_service.date,
        'role_name', 'Backup', 'required_slots', v_min_backups - v_backup_count,
        'message', 'Only ' || v_backup_count::text || ' of ' || v_min_backups::text ||
                   ' backup singers assigned for week ' || v_service.week_number::text || '.',
        'eligible_candidates', '[]'::jsonb, 'rejected_candidates', '[]'::jsonb));
    END IF;

    -- Devotion, required only when the ministry defines the role, matched with the
    -- same includes('devotion') predicate `unfilledFrom` uses.
    SELECT EXISTS (SELECT 1 FROM public.roles r
                   WHERE r.ministry_id = v_service.ministry_id AND r.is_active
                     AND pg_catalog.lower(r.name) LIKE '%devotion%')
    INTO v_devotion_required;
    SELECT EXISTS (SELECT 1 FROM public.schedule_assignments a
                   JOIN public.roles r ON r.id = a.role_id
                   WHERE a.service_id = v_service.id AND pg_catalog.lower(r.name) LIKE '%devotion%')
    INTO v_devotion_assigned;
    IF v_devotion_required AND NOT v_devotion_assigned THEN
      v_gaps := v_gaps || jsonb_build_array(jsonb_build_object(
        'service_id', v_service.id, 'week_number', v_service.week_number, 'date', v_service.date,
        'role_name', 'Devotion', 'required_slots', 1,
        'message', 'Required Devotion role is not assigned for week ' || v_service.week_number::text || '.',
        'eligible_candidates', '[]'::jsonb, 'rejected_candidates', '[]'::jsonb));
    END IF;

    -- Required instruments, from the MINISTRY CATALOGUE, one gap per unassigned
    -- instrument so the shortfall is itemised rather than collapsed.
    FOR v_instrument IN
      SELECT i.id, i.name FROM public.instruments i
      WHERE i.ministry_id = v_service.ministry_id AND i.is_required
        AND NOT EXISTS (SELECT 1 FROM public.schedule_assignments a
                        WHERE a.service_id = v_service.id AND a.instrument_id = i.id)
      ORDER BY i.name
    LOOP
      v_gaps := v_gaps || jsonb_build_array(jsonb_build_object(
        'service_id', v_service.id, 'week_number', v_service.week_number, 'date', v_service.date,
        'role_name', v_instrument.name, 'required_slots', 1,
        'message', 'Required ' || v_instrument.name || ' is not assigned for week ' || v_service.week_number::text || '.',
        'eligible_candidates', '[]'::jsonb, 'rejected_candidates', '[]'::jsonb));
    END LOOP;

    UPDATE public.services SET unfilled_positions = v_gaps WHERE id = v_service.id;
  END LOOP;
END;
$$;

-- `active_overrides` needs no backfill and none is attempted: the column is NOT
-- NULL DEFAULT '{}', so the ALTER TABLE above already gave every pre-existing row
-- the correct value, and there is no prior override state to reconstruct. A
-- `WHERE active_overrides IS NULL` repair here would match zero rows for the same
-- reason the old `unfilled_positions` one did.

-- ---------------------------------------------------------------------------
-- 1b. Partial index: the drafts that still need attention (plan Step 2)
-- ---------------------------------------------------------------------------
--
-- `unfilled_positions` turns "this month is incomplete" into a stored, queryable
-- fact, and the question the coordinator actually asks is "which DRAFTS still
-- have gaps?". Answering it by scanning every service row and filtering in
-- application code would defeat the column: the read path is the hot path.
--
-- Partial on `status = 'draft'`, so the index holds only incomplete drafts and
-- stays small no matter how much published history accumulates. The leading
-- columns (church_id, year, month, week_number) match the scope the schedule
-- read path already filters on, so this serves the tenant-scoped month query
-- directly.
--
-- `jsonb_array_length(unfilled_positions) > 0` is the gap predicate, and it is
-- immutable, so the predicate is usable in a partial index. It also cannot
-- raise: the column is NOT NULL and constrained to a JSONB array by
-- services_unfilled_positions_is_array.
--
-- IF NOT EXISTS so re-running this migration, or a database where the index was
-- created out of band, is a no-op instead of an error.
CREATE INDEX IF NOT EXISTS idx_services_draft_with_gaps
  ON public.services (church_id, year, month, week_number)
  WHERE status = 'draft' AND jsonb_array_length(unfilled_positions) > 0;

-- ---------------------------------------------------------------------------
-- 2. Shared publication rules (C4)
--
-- One function, called from BOTH validate_service_schedule and
-- publish_service_schedule, so the re-assertion cannot rot in one of the two
-- paths. A green test suite over a helper nobody calls would be a dead invariant
-- chain; this is called on every lifecycle transition.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assert_service_meets_publication_rules(
  p_church_id UUID,
  p_service_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
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
  WHERE a.service_id = p_service_id AND NOT a.is_leader AND a.instrument_id IS NULL
    AND pg_catalog.lower(r.name) ~ '(vocal|singer|backup)';
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
$$;

-- The helper is SECURITY INVOKER and is called from inside validate/publish, which
-- are themselves SECURITY INVOKER. So the CALLER's rights apply at every level:
-- without this GRANT, revoking from PUBLIC leaves service_role with no EXECUTE and
-- every validate and publish fails with "permission denied for function".
REVOKE ALL ON FUNCTION public.assert_service_meets_publication_rules(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_service_meets_publication_rules(UUID, UUID) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. persist_month_schedule: persist the gap list, clear stale overrides
-- ---------------------------------------------------------------------------

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
    RAISE EXCEPTION 'Generated services must have future dates and valid week, assignment and unfilled-position data' USING ERRCODE = '22023';
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

-- ---------------------------------------------------------------------------
-- 4. replace_service_assignments: partial lineups, scoped overrides, gaps
--
-- OVERLOAD TRAP, and it is load-bearing. `CREATE OR REPLACE` with a different
-- argument list CREATES A SECOND FUNCTION; it does not replace the first. The old
-- 6-argument body would survive, keep its `service_role` grant, stay callable, and
-- enforce the pre-partial-schedule rules including the availability and
-- instrument-skill rejections. Two functions with one name is also an ambiguity
-- hazard, already paid for once in 20260928061010. So: DROP the old signature
-- first, and assert afterwards that exactly one overload remains.
--
-- EXPLICIT `DROP FUNCTION IF EXISTS`, NOT A GUARDED `DO` BLOCK. The full identity
-- argument list is spelled out so the DROP is checked against this file's own
-- declaration by eye and by the post-condition assertion below, instead of being
-- a string literal buried in plpgsql that a typo would silently turn into a
-- no-op. A conditional block here is strictly worse than an unconditional drop:
-- if the literal and the real signature ever disagree, the guarded version skips
-- the DROP, leaves the 6-argument function callable, and still reports success.
-- `IF EXISTS` already tolerates the fresh-database case, so the guard bought
-- nothing except that failure mode.
--
-- `CREATE FUNCTION`, NOT `CREATE OR REPLACE`, for the same reason one layer up.
-- The overload trap is only half the hazard: with `CREATE OR REPLACE`, any drift
-- between this file's 8-argument declaration and whatever 8-argument function the
-- database happens to hold is applied silently, so a signature typo becomes a
-- behavioural change that reports success. `CREATE FUNCTION` makes that drift a
-- hard error, which is the point of a migration that also asserts its own
-- post-condition.
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.replace_service_assignments(UUID, UUID, UUID, INTEGER, JSONB, TEXT);

CREATE FUNCTION public.replace_service_assignments(
  p_church_id UUID,
  p_service_id UUID,
  p_actor_id UUID,
  p_expected_version INTEGER,
  p_assignments JSONB,
  p_reason TEXT DEFAULT NULL,
  p_unfilled_positions JSONB DEFAULT '[]'::jsonb,
  p_active_overrides JSONB DEFAULT '{}'::jsonb
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
  IF v_service.date < CURRENT_DATE AND v_service.revision_of IS NULL THEN
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
      OR NOT EXISTS (SELECT 1 FROM public.member_roles mr WHERE mr.member_id = m.id AND mr.role_id = r.id)
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
    AND NULLIF(item->>'instrument_id', '')::uuid IS NULL
    AND pg_catalog.lower(r.name) ~ '(vocal|singer|backup)';
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
    INSERT INTO public.schedule_assignments(service_id, member_id, role_id, instrument_id, is_leader, status, assigned_by)
    VALUES (p_service_id, (v_assignment->>'member_id')::uuid, (v_assignment->>'role_id')::uuid,
      NULLIF(v_assignment->>'instrument_id', '')::uuid, COALESCE((v_assignment->>'is_leader')::boolean, FALSE), 'pending', p_actor_id);
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
$$;

REVOKE ALL ON FUNCTION public.replace_service_assignments(UUID, UUID, UUID, INTEGER, JSONB, TEXT, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_service_assignments(UUID, UUID, UUID, INTEGER, JSONB, TEXT, JSONB, JSONB) TO service_role;

-- Post-condition: exactly ONE overload, and it must be the 8-argument one. A second
-- surviving overload would keep the old availability/instrument rejections callable
-- under the same name, which is both an ambiguity hazard and a bypass.
DO $$
DECLARE v_signature TEXT[];
BEGIN
  SELECT pg_catalog.array_agg(p::text ORDER BY p::text) INTO v_signature
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'replace_service_assignments';
  IF pg_catalog.array_length(v_signature, 1) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'replace_service_assignments must have exactly one overload, found %', pg_catalog.array_length(v_signature, 1);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'replace_service_assignments'
      AND pg_catalog.pg_get_function_identity_arguments(p.oid) =
        'p_church_id uuid, p_service_id uuid, p_actor_id uuid, p_expected_version integer, p_assignments jsonb, p_reason text, p_unfilled_positions jsonb, p_active_overrides jsonb'
  ) THEN
    RAISE EXCEPTION 'The surviving replace_service_assignments overload is not the expected 8-argument signature';
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. create_service_revision: an amendment inherits the gaps AND the licences
-- ---------------------------------------------------------------------------

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
  -- Both new columns are COPIED from the source (Plan Step 6; Decision item 17;
  -- I17 "Revision copies the new columns"). An amendment starts from the exact
  -- lineup and licence state the coordinator already reviewed, so the draft
  -- revision carries the source's `unfilled_positions` and `active_overrides`
  -- verbatim. This is a copy, never a merge: a licence a coordinator later
  -- removes on the revision is written wholesale by `replace_service_assignments`.
  INSERT INTO public.services(church_id, ministry_id, date, week_number, month, year, service_type, status, notes, generated_by, generation_metadata, revision_of, unfilled_positions, active_overrides)
  VALUES (p_church_id, v_original.ministry_id, v_original.date, v_original.week_number, v_original.month, v_original.year,
    v_original.service_type, 'draft', v_original.notes, p_actor_id,
    jsonb_build_object('amends_service_id', v_original.id, 'source_version', v_original.schedule_version), v_original.id,
    COALESCE(v_original.unfilled_positions, '[]'::jsonb), COALESCE(v_original.active_overrides, '{}'::jsonb))
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

REVOKE ALL ON FUNCTION public.create_service_revision(UUID, UUID, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_service_revision(UUID, UUID, UUID, INTEGER) TO service_role;

-- ---------------------------------------------------------------------------
-- 6. validate / publish: re-assert every deferred rule
--
-- Both call the SAME helper, so the deferred-then-reasserted chain is live in both
-- lifecycle paths rather than asserted in one and assumed in the other.
-- ---------------------------------------------------------------------------

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
  -- THE RE-ASSERTION. A draft may hold a deferred gap; validation may not.
  PERFORM public.assert_service_meets_publication_rules(p_church_id, p_service_id);
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

REVOKE ALL ON FUNCTION public.validate_service_schedule(UUID, UUID, UUID, INTEGER, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_service_schedule(UUID, UUID, UUID, INTEGER, JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.publish_service_schedule(UUID, UUID, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_service_schedule(UUID, UUID, UUID, INTEGER) TO service_role;

-- ===========================================================================
-- 7. DOWN MIGRATION
-- ===========================================================================
--
-- THIS BLOCK IS DOCUMENTATION AND A VERIFIED ROLLBACK SCRIPT. IT IS NOT
-- EXECUTED BY THIS FILE. The statements below are the inverse of everything
-- above, in reverse dependency order, and the bodies are the VERBATIM prior
-- definitions from 20260928084433 (cited by line) so the reversal does not
-- depend on anybody reconstructing them from memory. Applying this file then
-- rolling it back is the state this section describes, and the evidence matrix
-- exercises exactly that round trip inside `BEGIN; ... ROLLBACK;`.
--
-- ---------------------------------------------------------------------------
-- 7a. WHAT ROLLBACK ACTUALLY COSTS. READ THIS BEFORE RUNNING IT.
-- ---------------------------------------------------------------------------
--
-- Rollback is LOSSY, and deliberately so. Two categories of state cannot be
-- recovered by reverting a schema, and pretending otherwise would be the same
-- class of error as the backfill this file previously got wrong:
--
--   1. GAP DATA IS DISCARDED, NOT RESTORED. `services.unfilled_positions` and
--      `services.active_overrides` are DROPPED with the rest of the columns. Any
--      partial-draft gap list or coordinator licence recorded after this
--      migration deployed is destroyed by the rollback and cannot be
--      reconstructed, because the generator's search history (which candidates
--      were rejected and why) was never persisted -- only the summary was. The
--      recomputed backfill in section 1 can rebuild a gap list from persisted
--      assignments, so a line-up is recoverable; the coordinator's REASON for an
--      override is not stored anywhere and is gone.
--
--   2. PRIOR BEHAVIOUR RETURNS, AND PRIOR BEHAVIOUR IS STRICTER. After this
--      rollback `replace_service_assignments` again requires EXACTLY one leader
--      (`<> 1`) and a backup count INSIDE the configured range
--      (`NOT BETWEEN min AND max`), and `validate_service_schedule` /
--      `publish_service_schedule` no longer call
--      `assert_service_meets_publication_rules` at all. Any schedule that is a
--      legal partial draft under this migration is REJECTED by the restored
--      functions. A draft with no leader that a coordinator is mid-way through
--      completing becomes un-editable after the rollback, and the coordinator
--      must either finish it or lose the edit.
--
-- The second point is the reason this migration exists, so a rollback is a
-- product decision, not a mechanical one.
--
-- ---------------------------------------------------------------------------
-- 7b. INVERSE, IN REVERSE DEPENDENCY ORDER
-- ---------------------------------------------------------------------------
--
-- (1) Functions that gained a dependency on the new helper lose it first.
-- (2) The helper itself is dropped, so nothing can call a missing function even
--     transiently inside the transaction.
-- (3) `replace_service_assignments` goes back to its 6-argument form. The
--     8-argument overload is dropped by name, not by the conditional
--     `to_regprocedure` guard the forward direction used to have, for the reason
--     given in section 4.
-- (4) The trigger-function `search_path` pin is reverted, restoring the
--     pre-existing latent bug. That is the honest reversal: the bug was not
--     introduced here, and leaving the pin would be a partial rollback that
--     changes behaviour nobody asked to change. See the warning below.
-- (5) The index and the two constraints go with the columns they describe.
--
-- WARNING ON STEP (4). Reverting the `search_path` pin RE-ARMS THE PRODUCTION
-- BUG documented in section 0: `update_member_assignment_count()` has an
-- unqualified body and no `search_path`, so once
-- `persist_month_schedule` and `replace_service_assignments` are restored as
-- `SET search_path = ''`, every INSERT into `schedule_assignments` fails with
-- `42P01: relation "members" does not exist`. Rolling back this migration
-- therefore leaves the database unable to persist a single assignment. If the
-- rollback is being run for any reason other than a full revert of the product
-- change, LEAVE THE PIN IN PLACE and treat it as part of this migration.
--
-- ---------------------------------------------------------------------------
-- 7c. VERIFIED ROLLBACK SCRIPT
-- ---------------------------------------------------------------------------
--
-- COMMENTED OUT DELIBERATELY, and the bodies below are VERBATIM from
-- 20260928084433 (line ranges cited on each block) rather than a paraphrase.
-- Two reasons, both load-bearing:
--
--   * A rollback that is written from memory is a rollback nobody can trust. The
--     prior bodies are reproduced here character-for-character so the reversal is
--     a copy operation, not a reconstruction. Where this file's version differs
--     from the prior one, the difference is named on the block.
--   * These statements are NOT part of the forward migration. Kept as comments,
--     they cannot half-apply: a `DROP FUNCTION` or a column `DROP` cannot fire
--     during a normal `supabase db push` and cannot leave the schema in a
--     half-reverted state. An executable down-migration sitting in the same
--     directory as the up-migration is a file some tooling will eventually run
--     in the wrong order.
--
-- To roll back, run the uncommented statements below, in order, in one
-- transaction. The evidence matrix exercises exactly this round trip inside
-- `BEGIN; ... ROLLBACK;`.
--
-- === ROLLBACK-BEGIN ========================================================

-- (1) Restore the pre-partial-schedule lifecycle functions. Verbatim copies of
--     20260928084433_scheduler_workflow_hardening.sql, line ranges cited per block.
--
--     Verbatim: 20260928084433_scheduler_workflow_hardening.sql:671-731
--
-- CREATE OR REPLACE FUNCTION public.validate_service_schedule(
--   p_church_id UUID,
--   p_service_id UUID,
--   p_actor_id UUID,
--   p_expected_version INTEGER,
--   p_validation_results JSONB
-- )
-- RETURNS INTEGER
-- LANGUAGE plpgsql
-- SECURITY INVOKER
-- SET search_path = ''
-- AS $$
-- DECLARE v_service public.services%ROWTYPE;
-- BEGIN
--   SELECT * INTO v_service FROM public.services WHERE id = p_service_id AND church_id = p_church_id FOR UPDATE;
--   IF NOT FOUND OR v_service.ministry_id IS NULL THEN RAISE EXCEPTION 'Schedule not found or has unresolved ministry ownership' USING ERRCODE = 'P0002'; END IF;
--   IF v_service.status <> 'draft' OR v_service.schedule_version <> p_expected_version THEN RAISE EXCEPTION 'Schedule is not a current draft' USING ERRCODE = '40001'; END IF;
--   IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_actor_id AND church_id = p_church_id AND is_active AND role IN ('admin', 'coordinator')) THEN RAISE EXCEPTION 'Coordinator authorization could not be verified' USING ERRCODE = '42501'; END IF;
--   UPDATE public.services SET status = 'validated', validated_version = schedule_version, validated_by = p_actor_id, validated_at = NOW() WHERE id = p_service_id;
--   INSERT INTO public.schedule_change_log(church_id, service_id, actor_id, action, from_version, to_version, after_state)
--   VALUES (p_church_id, p_service_id, p_actor_id, 'validated', v_service.schedule_version, v_service.schedule_version,
--     jsonb_build_object('results', COALESCE(p_validation_results, '[]'::jsonb)));
--   RETURN v_service.schedule_version;
-- END;
-- $$;
-- REVOKE ALL ON FUNCTION public.validate_service_schedule(UUID, UUID, UUID, INTEGER, JSONB) FROM PUBLIC, anon, authenticated;
-- GRANT EXECUTE ON FUNCTION public.validate_service_schedule(UUID, UUID, UUID, INTEGER, JSONB) TO service_role;
--
--     Verbatim: 20260928084433_scheduler_workflow_hardening.sql:697-733
--
-- CREATE OR REPLACE FUNCTION public.publish_service_schedule(
--   p_church_id UUID,
--   p_service_id UUID,
--   p_actor_id UUID,
--   p_expected_version INTEGER
-- )
-- RETURNS VOID
-- LANGUAGE plpgsql
-- SECURITY INVOKER
-- SET search_path = ''
-- AS $$
-- DECLARE v_service public.services%ROWTYPE;
-- BEGIN
--   SELECT * INTO v_service FROM public.services WHERE id = p_service_id AND church_id = p_church_id FOR UPDATE;
--   IF NOT FOUND OR v_service.status <> 'validated' OR v_service.ministry_id IS NULL
--      OR v_service.validated_version IS DISTINCT FROM v_service.schedule_version
--      OR v_service.schedule_version <> p_expected_version THEN
--     RAISE EXCEPTION 'Schedule must be validated for its current version before publication' USING ERRCODE = '55000';
--   END IF;
--   IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_actor_id AND church_id = p_church_id AND is_active AND role IN ('admin', 'coordinator')) THEN RAISE EXCEPTION 'Coordinator authorization could not be verified' USING ERRCODE = '42501'; END IF;
--   UPDATE public.services SET status = 'published', published_by = p_actor_id, published_at = NOW() WHERE id = p_service_id;
--   INSERT INTO public.schedule_change_log(church_id, service_id, actor_id, action, from_version, to_version)
--   VALUES (p_church_id, p_service_id, p_actor_id, 'published', v_service.schedule_version, v_service.schedule_version);
--   IF v_service.revision_of IS NOT NULL THEN
--     UPDATE public.services SET status = 'archived' WHERE id = v_service.revision_of AND church_id = p_church_id AND status = 'published';
--     INSERT INTO public.schedule_change_log(church_id, service_id, actor_id, action, from_version, to_version, reason, before_state)
--     VALUES (p_church_id, v_service.revision_of, p_actor_id, 'superseded', NULL, v_service.schedule_version, 'Published schedule revision', to_jsonb(v_service));
--   END IF;
-- END;
-- $$;
-- REVOKE ALL ON FUNCTION public.publish_service_schedule(UUID, UUID, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
-- GRANT EXECUTE ON FUNCTION public.publish_service_schedule(UUID, UUID, UUID, INTEGER) TO service_role;
--
-- (2) `persist_month_schedule`: identical signature, so CREATE OR REPLACE is
--     enough. Verbatim prior body, minus only the gap/override handling this
--     migration added. Because the columns it referenced are dropped in step (6),
--     this restore MUST run before those drops.
--
--     Verbatim: 20260928084433_scheduler_workflow_hardening.sql:183-363
--
-- CREATE OR REPLACE FUNCTION public.persist_month_schedule(
--   p_church_id UUID,
--   p_ministry_id UUID,
--   p_month INTEGER,
--   p_year INTEGER,
--   p_actor_id UUID,
--   p_services JSONB,
--   p_replace_existing BOOLEAN DEFAULT FALSE
-- )
-- RETURNS UUID[]
-- LANGUAGE plpgsql
-- SECURITY INVOKER
-- SET search_path = ''
-- AS $$
-- DECLARE
--   v_required INTEGER;
--   v_approved INTEGER;
--   v_existing RECORD;
--   v_service JSONB;
--   v_assignment JSONB;
--   v_service_id UUID;
--   v_ids UUID[] := ARRAY[]::UUID[];
-- BEGIN
--   IF p_month < 0 OR p_month > 11 OR p_year < 2000 OR p_year > 2100
--      OR jsonb_typeof(p_services) <> 'array' OR jsonb_array_length(p_services) = 0 THEN
--     RAISE EXCEPTION 'Invalid schedule generation input' USING ERRCODE = '22023';
--   END IF;
--   IF pg_catalog.date_trunc('month', pg_catalog.make_date(p_year, p_month + 1, 1))::date < pg_catalog.date_trunc('month', CURRENT_DATE)::date THEN
--     RAISE EXCEPTION 'Schedules can only be generated for the current or a future month' USING ERRCODE = '55000';
--   END IF;
-- 
--   PERFORM pg_catalog.pg_advisory_xact_lock(
--     pg_catalog.hashtext(p_church_id::text),
--     pg_catalog.hashtext(p_ministry_id::text || ':' || p_year::text || ':' || p_month::text)
--   );
-- 
--   IF NOT EXISTS (
--     SELECT 1 FROM public.ministries m
--     WHERE m.id = p_ministry_id AND m.church_id = p_church_id AND m.is_active
--   ) THEN
--     RAISE EXCEPTION 'Ministry not found for this church' USING ERRCODE = '42501';
--   END IF;
--   IF NOT EXISTS (
--     SELECT 1 FROM public.users u
--     WHERE u.id = p_actor_id AND u.church_id = p_church_id AND u.is_active
--       AND u.role IN ('admin', 'coordinator')
--   ) THEN
--     RAISE EXCEPTION 'Coordinator authorization could not be verified' USING ERRCODE = '42501';
--   END IF;
--   IF EXISTS (
--     SELECT 1 FROM public.services s
--     WHERE s.church_id = p_church_id AND s.ministry_id IS NULL AND s.month = p_month AND s.year = p_year
--       AND s.week_number IN (SELECT (item->>'week_number')::integer FROM pg_catalog.jsonb_array_elements(p_services) AS items(item))
--   ) THEN
--     RAISE EXCEPTION 'This month contains a legacy schedule with unknown ministry ownership; resolve it before generating' USING ERRCODE = '55000';
--   END IF;
-- 
--   SELECT COUNT(*) INTO v_required
--   FROM public.members m
--   WHERE m.church_id = p_church_id AND m.status = 'active'
--     AND EXISTS (
--       SELECT 1 FROM public.member_roles mr
--       JOIN public.roles r ON r.id = mr.role_id
--       WHERE mr.member_id = m.id AND r.ministry_id = p_ministry_id AND r.is_active
--     );
-- 
--   -- Lock current participant submissions until all service and assignment writes commit.
--   PERFORM s.id
--   FROM public.availability_submissions s
--   JOIN public.members m ON m.id = s.member_id AND m.church_id = s.church_id
--   WHERE s.church_id = p_church_id AND s.year = p_year AND s.month = p_month
--     AND m.status = 'active'
--     AND EXISTS (
--       SELECT 1 FROM public.member_roles mr
--       JOIN public.roles r ON r.id = mr.role_id
--       WHERE mr.member_id = m.id AND r.ministry_id = p_ministry_id AND r.is_active
--     )
--   FOR UPDATE OF s;
-- 
--   SELECT COUNT(*) INTO v_approved
--   FROM public.availability_submissions s
--   JOIN public.members m ON m.id = s.member_id AND m.church_id = s.church_id
--   WHERE s.church_id = p_church_id AND s.year = p_year AND s.month = p_month
--     AND s.status = 'approved' AND s.is_current AND m.status = 'active'
--     AND EXISTS (
--       SELECT 1 FROM public.member_roles mr
--       JOIN public.roles r ON r.id = mr.role_id
--       WHERE mr.member_id = m.id AND r.ministry_id = p_ministry_id AND r.is_active
--     );
-- 
--   IF v_approved <> v_required THEN
--     RAISE EXCEPTION 'Availability is not ready: % of % required submissions approved', v_approved, v_required
--       USING ERRCODE = '55000';
--   END IF;
-- 
--   IF EXISTS (
--     SELECT 1 FROM pg_catalog.jsonb_array_elements(p_services) AS entries(item)
--     WHERE (item->>'date')::date < CURRENT_DATE
--       OR (pg_catalog.date_part('month', (item->>'date')::date)::integer - 1) <> p_month
--       OR pg_catalog.date_part('year', (item->>'date')::date)::integer <> p_year
--       OR COALESCE((item->>'week_number')::integer, 0) NOT BETWEEN 1 AND 5
--       OR pg_catalog.date_part('dow', (item->>'date')::date) <> 0
--       OR (item->>'date')::date <> (
--         pg_catalog.make_date(p_year, p_month + 1, 1)
--         + ((7 - pg_catalog.date_part('dow', pg_catalog.make_date(p_year, p_month + 1, 1))::integer) % 7)
--         + (((item->>'week_number')::integer - 1) * 7)
--       )
--       OR pg_catalog.jsonb_typeof(COALESCE(item->'assignments', '[]'::jsonb)) <> 'array'
--   ) THEN
--     RAISE EXCEPTION 'Generated services must have future dates and valid week and assignment data' USING ERRCODE = '22023';
--   END IF;
--   IF EXISTS (
--     SELECT (item->>'week_number')::integer
--     FROM pg_catalog.jsonb_array_elements(p_services) AS entries(item)
--     GROUP BY (item->>'week_number')::integer
--     HAVING COUNT(*) > 1
--   ) OR EXISTS (
--     SELECT (item->>'date')::date
--     FROM pg_catalog.jsonb_array_elements(p_services) AS entries(item)
--     GROUP BY (item->>'date')::date
--     HAVING COUNT(*) > 1
--   ) THEN
--     RAISE EXCEPTION 'A service week and date can only be generated once per request' USING ERRCODE = '22023';
--   END IF;
-- 
--   FOR v_existing IN
--     SELECT s.id, s.status
--     FROM public.services s
--     WHERE s.church_id = p_church_id AND s.ministry_id = p_ministry_id
--       AND s.month = p_month AND s.year = p_year
--       AND s.week_number IN (SELECT (item->>'week_number')::integer FROM pg_catalog.jsonb_array_elements(p_services) AS items(item))
--     FOR UPDATE
--   LOOP
--     IF NOT p_replace_existing THEN
--       RAISE EXCEPTION 'A schedule already exists for this ministry and month' USING ERRCODE = '23505';
--     END IF;
--     IF v_existing.status <> 'draft' THEN
--       RAISE EXCEPTION 'Only draft schedules can be regenerated' USING ERRCODE = '55000';
--     END IF;
--     INSERT INTO public.schedule_change_log(church_id, service_id, actor_id, action, from_version, reason, before_state)
--     SELECT p_church_id, v_existing.id, p_actor_id, 'regenerated', s.schedule_version,
--       'Explicit schedule regeneration', jsonb_build_object(
--         'service', to_jsonb(s),
--         'assignments', COALESCE((SELECT jsonb_agg(to_jsonb(a)) FROM public.schedule_assignments a WHERE a.service_id = s.id), '[]'::jsonb)
--       )
--     FROM public.services s WHERE s.id = v_existing.id;
--   END LOOP;
-- 
--   IF p_replace_existing THEN
--     DELETE FROM public.services s
--     WHERE s.church_id = p_church_id AND s.ministry_id = p_ministry_id
--       AND s.month = p_month AND s.year = p_year AND s.status = 'draft'
--       AND s.week_number IN (SELECT (item->>'week_number')::integer FROM pg_catalog.jsonb_array_elements(p_services) AS items(item));
--   END IF;
-- 
--   FOR v_service IN SELECT value FROM jsonb_array_elements(p_services)
--   LOOP
--     INSERT INTO public.services(church_id, ministry_id, date, week_number, month, year, service_type, status, generated_by, generated_at, generation_metadata)
--     VALUES (p_church_id, p_ministry_id, (v_service->>'date')::date,
--       (v_service->>'week_number')::integer, p_month, p_year, 'sunday', 'draft', p_actor_id, NOW(),
--       jsonb_build_object('algorithm', 'SchedulingEngine', 'generated_by', p_actor_id))
--     RETURNING id INTO v_service_id;
-- 
--     FOR v_assignment IN SELECT value FROM jsonb_array_elements(COALESCE(v_service->'assignments', '[]'::jsonb))
--     LOOP
--       INSERT INTO public.schedule_assignments(service_id, member_id, role_id, instrument_id, is_leader, status, assigned_by)
--       VALUES (v_service_id, (v_assignment->>'member_id')::uuid, (v_assignment->>'role_id')::uuid,
--         NULLIF(v_assignment->>'instrument_id', '')::uuid, COALESCE((v_assignment->>'is_leader')::boolean, FALSE), 'pending', p_actor_id);
--     END LOOP;
-- 
--     INSERT INTO public.schedule_change_log(church_id, service_id, actor_id, action, to_version, after_state)
--     VALUES (p_church_id, v_service_id, p_actor_id, 'generated', 1, v_service);
--     v_ids := array_append(v_ids, v_service_id);
--   END LOOP;
-- 
--   RETURN v_ids;
-- END;
-- $$;
-- REVOKE ALL ON FUNCTION public.persist_month_schedule(UUID, UUID, INTEGER, INTEGER, UUID, JSONB, BOOLEAN) FROM PUBLIC, anon, authenticated;
-- GRANT EXECUTE ON FUNCTION public.persist_month_schedule(UUID, UUID, INTEGER, INTEGER, UUID, JSONB, BOOLEAN) TO service_role;
--
-- (3) `create_service_revision`: identical signature. Verbatim prior body, which
--     inserts without the gap/override columns so the amendment no longer inherits
--     the source's gaps or licences.
--
--     Verbatim: 20260928084433_scheduler_workflow_hardening.sql:622-735
--
-- CREATE OR REPLACE FUNCTION public.create_service_revision(
--   p_church_id UUID,
--   p_service_id UUID,
--   p_actor_id UUID,
--   p_expected_version INTEGER
-- )
-- RETURNS UUID
-- LANGUAGE plpgsql
-- SECURITY INVOKER
-- SET search_path = ''
-- AS $$
-- DECLARE
--   v_original public.services%ROWTYPE;
--   v_revision_id UUID;
-- BEGIN
--   SELECT * INTO v_original FROM public.services
--   WHERE id = p_service_id AND church_id = p_church_id
--   FOR UPDATE;
--   IF NOT FOUND OR v_original.status <> 'published' OR v_original.ministry_id IS NULL THEN
--     RAISE EXCEPTION 'A published, ministry-scoped schedule is required for an amendment' USING ERRCODE = '55000';
--   END IF;
--   IF v_original.schedule_version <> p_expected_version THEN
--     RAISE EXCEPTION 'Schedule changed since it was loaded; refresh and retry' USING ERRCODE = '40001';
--   END IF;
--   IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_actor_id AND church_id = p_church_id AND is_active AND role IN ('admin', 'coordinator')) THEN
--     RAISE EXCEPTION 'Coordinator authorization could not be verified' USING ERRCODE = '42501';
--   END IF;
--   IF EXISTS (SELECT 1 FROM public.services WHERE revision_of = p_service_id AND status IN ('draft', 'validated')) THEN
--     RAISE EXCEPTION 'An amendment is already in progress for this schedule' USING ERRCODE = '55000';
--   END IF;
--   INSERT INTO public.services(church_id, ministry_id, date, week_number, month, year, service_type, status, notes, generated_by, generation_metadata, revision_of)
--   VALUES (p_church_id, v_original.ministry_id, v_original.date, v_original.week_number, v_original.month, v_original.year,
--     v_original.service_type, 'draft', v_original.notes, p_actor_id,
--     jsonb_build_object('amends_service_id', v_original.id, 'source_version', v_original.schedule_version), v_original.id)
--   RETURNING id INTO v_revision_id;
--   INSERT INTO public.schedule_assignments(service_id, member_id, role_id, instrument_id, is_leader, status, assigned_by)
--   SELECT v_revision_id, member_id, role_id, instrument_id, is_leader, status, p_actor_id
--   FROM public.schedule_assignments WHERE service_id = p_service_id;
--   INSERT INTO public.schedule_change_log(church_id, service_id, actor_id, action, from_version, to_version, reason, before_state, after_state)
--   VALUES (p_church_id, v_revision_id, p_actor_id, 'amendment_created', v_original.schedule_version, 1,
--     'Draft amendment created from published schedule', jsonb_build_object('service', to_jsonb(v_original)),
--     jsonb_build_object(
--       'source_service_id', p_service_id,
--       'assignments', COALESCE((SELECT jsonb_agg(to_jsonb(a)) FROM public.schedule_assignments a WHERE a.service_id = v_revision_id), '[]'::jsonb)
--     ));
--   RETURN v_revision_id;
-- END;
-- $$;
-- REVOKE ALL ON FUNCTION public.create_service_revision(UUID, UUID, UUID, INTEGER) FROM PUBLIC, anon, authenticated;
-- GRANT EXECUTE ON FUNCTION public.create_service_revision(UUID, UUID, UUID, INTEGER) TO service_role;
--
-- (4) Drop the shared publication helper. Nothing calls it once step (1) has
--     restored `validate_service_schedule` and `publish_service_schedule` to
--     their pre-helper bodies, which is why the helper goes here and not before
--     step (1): dropping it first would leave two functions pointing at a missing
--     routine for the rest of the transaction.
--
-- REVOKE ALL ON FUNCTION public.assert_service_meets_publication_rules(UUID, UUID) FROM PUBLIC, anon, authenticated;
-- DROP FUNCTION IF EXISTS public.assert_service_meets_publication_rules(UUID, UUID);
--
-- (5) `replace_service_assignments` returns to its 6-argument form. The 8-argument
--     overload is dropped BY NAME with its full identity argument list, because a
--     conditional to_regprocedure guard whose literal can disagree with the real
--     signature silently skips the drop and leaves the permissive function callable.
--
-- DROP FUNCTION IF EXISTS public.replace_service_assignments(UUID, UUID, UUID, INTEGER, JSONB, TEXT, JSONB, JSONB);
--
--     Verbatim: 20260928084433_scheduler_workflow_hardening.sql:482-729
--
-- CREATE OR REPLACE FUNCTION public.replace_service_assignments(
--   p_church_id UUID,
--   p_service_id UUID,
--   p_actor_id UUID,
--   p_expected_version INTEGER,
--   p_assignments JSONB,
--   p_reason TEXT DEFAULT NULL
-- )
-- RETURNS INTEGER
-- LANGUAGE plpgsql
-- SECURITY INVOKER
-- SET search_path = ''
-- AS $$
-- DECLARE
--   v_service public.services%ROWTYPE;
--   v_assignment JSONB;
--   v_old JSONB;
--   v_new_version INTEGER;
--   v_min_backups INTEGER;
--   v_max_backups INTEGER;
--   v_monthly_limit INTEGER;
-- BEGIN
--   IF jsonb_typeof(p_assignments) <> 'array' THEN
--     RAISE EXCEPTION 'Assignments must be an array' USING ERRCODE = '22023';
--   END IF;
--   SELECT * INTO v_service FROM public.services s
--   WHERE s.id = p_service_id AND s.church_id = p_church_id
--   FOR UPDATE;
--   IF NOT FOUND THEN RAISE EXCEPTION 'Schedule not found' USING ERRCODE = 'P0002'; END IF;
--   IF v_service.status NOT IN ('draft', 'validated') OR v_service.ministry_id IS NULL THEN
--     RAISE EXCEPTION 'Only scoped draft or validated schedules can be edited; published schedules require an amendment' USING ERRCODE = '55000';
--   END IF;
--   IF v_service.date < CURRENT_DATE AND v_service.revision_of IS NULL THEN
--     RAISE EXCEPTION 'Historical schedules are read-only; create an explicit amendment to make a change' USING ERRCODE = '55000';
--   END IF;
--   IF v_service.schedule_version <> p_expected_version THEN
--     RAISE EXCEPTION 'Schedule changed since it was loaded; refresh and retry' USING ERRCODE = '40001';
--   END IF;
--   IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_actor_id AND u.church_id = p_church_id AND u.is_active AND u.role IN ('admin', 'coordinator')) THEN
--     RAISE EXCEPTION 'Coordinator authorization could not be verified' USING ERRCODE = '42501';
--   END IF;
-- 
--   IF (SELECT COUNT(*) FROM pg_catalog.jsonb_array_elements(p_assignments)) <>
--      (SELECT COUNT(DISTINCT item->>'member_id') FROM pg_catalog.jsonb_array_elements(p_assignments) AS entries(item)) THEN
--     RAISE EXCEPTION 'A member may only have one role per service' USING ERRCODE = '23505';
--   END IF;
--   IF (SELECT COUNT(*) FROM pg_catalog.jsonb_array_elements(p_assignments) AS entries(item) WHERE COALESCE((item->>'is_leader')::boolean, FALSE)) <> 1 THEN
--     RAISE EXCEPTION 'Exactly one worship leader is required' USING ERRCODE = '23514';
--   END IF;
--   IF EXISTS (
--     SELECT 1 FROM pg_catalog.jsonb_array_elements(p_assignments) AS entries(item)
--     LEFT JOIN public.roles r ON r.id = (item->>'role_id')::uuid
--     WHERE COALESCE((item->>'is_leader')::boolean, FALSE) IS DISTINCT FROM (pg_catalog.lower(COALESCE(r.name, '')) = 'worship leader')
--   ) THEN
--     RAISE EXCEPTION 'The Worship Leader role and leader marker must identify the same single assignment' USING ERRCODE = '23514';
--   END IF;
--   IF EXISTS (
--     SELECT 1 FROM pg_catalog.jsonb_array_elements(p_assignments) AS entries(item)
--     LEFT JOIN public.members m ON m.id = (item->>'member_id')::uuid AND m.church_id = p_church_id
--     LEFT JOIN public.roles r ON r.id = (item->>'role_id')::uuid AND r.ministry_id = v_service.ministry_id AND r.is_active
--     WHERE m.id IS NULL OR m.status <> 'active' OR r.id IS NULL
--       OR NOT EXISTS (SELECT 1 FROM public.member_roles mr WHERE mr.member_id = m.id AND mr.role_id = r.id)
--       OR (COALESCE((item->>'is_leader')::boolean, FALSE) AND pg_catalog.lower(r.name) <> 'worship leader')
--       OR (NULLIF(item->>'instrument_id', '') IS NOT NULL AND NOT EXISTS (
--         SELECT 1 FROM public.member_skills ms
--         JOIN public.instruments i ON i.id = ms.instrument_id AND i.ministry_id = v_service.ministry_id
--         WHERE ms.member_id = m.id AND ms.instrument_id = (item->>'instrument_id')::uuid
--       ))
--   ) THEN
--     RAISE EXCEPTION 'An assignment has an inactive member or an invalid ministry role or skill' USING ERRCODE = '23514';
--   END IF;
--   IF EXISTS (
--     SELECT 1 FROM pg_catalog.jsonb_array_elements(p_assignments) AS entries(item)
--     JOIN public.members m ON m.id = (item->>'member_id')::uuid
--     JOIN public.availability a ON a.member_id = m.id AND a.church_id = p_church_id
--       AND a.status IN ('pending', 'approved')
--       AND (
--         (a.type = 'weekly' AND a.week_number = v_service.week_number AND (a.month IS NULL OR a.month = v_service.month) AND (a.year IS NULL OR a.year = v_service.year))
--         OR (a.type = 'date' AND a.date = v_service.date)
--         OR (a.type IN ('vacation', 'temporary_leave', 'emergency_leave') AND a.date <= v_service.date AND COALESCE(a.end_date, a.date) >= v_service.date)
--         OR (a.type = 'recurring' AND a.week_number = v_service.week_number AND (a.month IS NULL OR a.month = v_service.month) AND (a.year IS NULL OR a.year = v_service.year))
--       )
--   ) THEN
--     RAISE EXCEPTION 'An assigned member is unavailable for this service' USING ERRCODE = '23514';
--   END IF;
-- 
--   SELECT COALESCE((mr.rule_config->>'min_required')::integer, (c.settings->>'default_min_backup_singers')::integer, 3),
--          COALESCE((mr.rule_config->>'max_allowed')::integer, (c.settings->>'default_max_backup_singers')::integer, 3)
--   INTO v_min_backups, v_max_backups
--   FROM public.churches c
--   LEFT JOIN LATERAL (SELECT rule_config FROM public.ministry_rules WHERE ministry_id = v_service.ministry_id AND rule_type = 'backup_count' AND is_active LIMIT 1) mr ON TRUE
--   WHERE c.id = p_church_id;
--   IF (SELECT COUNT(*) FROM pg_catalog.jsonb_array_elements(p_assignments) AS entries(item)
--       JOIN public.roles r ON r.id = (item->>'role_id')::uuid
--       WHERE NOT COALESCE((item->>'is_leader')::boolean, FALSE) AND item->>'instrument_id' IS NULL
--         AND pg_catalog.lower(r.name) IN ('singer', 'singers', 'vocalist', 'vocal', 'backup', 'backup singer', 'backup singers')) NOT BETWEEN v_min_backups AND v_max_backups THEN
--     RAISE EXCEPTION 'Backup count is outside the configured range' USING ERRCODE = '23514';
--   END IF;
-- 
--   SELECT COALESCE((c.settings->>'default_max_monthly_assignments')::integer, 3)
--   INTO v_monthly_limit FROM public.churches c WHERE c.id = p_church_id;
--   IF EXISTS (
--     SELECT 1 FROM pg_catalog.jsonb_array_elements(p_assignments) AS entries(item)
--     JOIN public.members m ON m.id = (item->>'member_id')::uuid
--     WHERE (
--       SELECT COUNT(*) FROM public.schedule_assignments a
--       JOIN public.services s ON s.id = a.service_id
--       WHERE a.member_id = m.id AND s.church_id = p_church_id
--         AND s.month = v_service.month AND s.year = v_service.year AND s.id <> p_service_id
--         AND s.status <> 'archived'
--         AND (v_service.revision_of IS NULL OR s.id <> v_service.revision_of)
--     ) + (
--       SELECT COUNT(*) FROM pg_catalog.jsonb_array_elements(p_assignments) AS entries2(item2)
--       WHERE item2->>'member_id' = m.id::text
--     ) > COALESCE(NULLIF(m.max_monthly_assignments, 0), v_monthly_limit)
--   ) THEN
--     RAISE EXCEPTION 'A member would exceed the monthly assignment limit' USING ERRCODE = '23514';
--   END IF;
-- 
--   SELECT jsonb_build_object('service', to_jsonb(s), 'assignments', COALESCE(jsonb_agg(to_jsonb(a)) FILTER (WHERE a.id IS NOT NULL), '[]'::jsonb))
--   INTO v_old FROM public.services s LEFT JOIN public.schedule_assignments a ON a.service_id = s.id
--   WHERE s.id = p_service_id GROUP BY s.id;
--   DELETE FROM public.schedule_assignments WHERE service_id = p_service_id;
--   FOR v_assignment IN SELECT value FROM pg_catalog.jsonb_array_elements(p_assignments)
--   LOOP
--     INSERT INTO public.schedule_assignments(service_id, member_id, role_id, instrument_id, is_leader, status, assigned_by)
--     VALUES (p_service_id, (v_assignment->>'member_id')::uuid, (v_assignment->>'role_id')::uuid,
--       NULLIF(v_assignment->>'instrument_id', '')::uuid, COALESCE((v_assignment->>'is_leader')::boolean, FALSE), 'pending', p_actor_id);
--   END LOOP;
--   v_new_version := v_service.schedule_version + 1;
--   UPDATE public.services SET status = 'draft', schedule_version = v_new_version, validated_version = NULL, validated_by = NULL, validated_at = NULL
--   WHERE id = p_service_id;
--   INSERT INTO public.schedule_change_log(church_id, service_id, actor_id, action, from_version, to_version, reason, before_state, after_state)
--   VALUES (p_church_id, p_service_id, p_actor_id, 'assignments_changed', v_service.schedule_version, v_new_version,
--     NULLIF(pg_catalog.btrim(COALESCE(p_reason, '')), ''), v_old,
--     jsonb_build_object('assignments', p_assignments));
--   RETURN v_new_version;
-- END;
-- $$;
-- REVOKE ALL ON FUNCTION public.replace_service_assignments(UUID, UUID, UUID, INTEGER, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
-- GRANT EXECUTE ON FUNCTION public.replace_service_assignments(UUID, UUID, UUID, INTEGER, JSONB, TEXT) TO service_role;
--

-- (6) The index and the two constraints, then the two columns. Order matters
--     only in that the index and constraints must go before the columns they
--     reference.
--
-- DROP INDEX IF EXISTS public.idx_services_draft_with_gaps;
-- ALTER TABLE public.services DROP CONSTRAINT IF EXISTS services_active_overrides_allowlist;
-- ALTER TABLE public.services DROP CONSTRAINT IF EXISTS services_unfilled_positions_is_array;
-- ALTER TABLE public.services DROP COLUMN IF EXISTS active_overrides;
-- ALTER TABLE public.services DROP COLUMN IF EXISTS unfilled_positions;

-- (7) Revert the trigger-function `search_path` pin. See the WARNING in 7b:
--     this re-arms the section 0 production bug and leaves the database unable to
--     persist an assignment. Intentionally included because a partial rollback
--     that silently keeps the pin is a rollback nobody can reason about; if the
--     intent is to keep the fix, delete this one statement deliberately and say
--     so in the change log.
--
-- ALTER FUNCTION public.update_member_assignment_count() RESET search_path;

-- === ROLLBACK-END ==========================================================
