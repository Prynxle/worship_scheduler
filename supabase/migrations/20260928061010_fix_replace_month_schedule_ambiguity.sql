-- ============================================================================
-- 20260928061010_fix_replace_month_schedule_ambiguity.sql
--
-- PURPOSE
--   Fixes a latent defect in public.replace_month_schedule() that made the
--   function fail with SQLSTATE 42702 ("column reference "service_id" is
--   ambiguous") for EVERY successful replacement, on every week.
--
-- THE DEFECT
--   The function is declared RETURNS TABLE (service_id UUID, week_number
--   INTEGER, service_date DATE, assignment_count INTEGER). In PL/pgSQL those
--   OUT parameter names become variables in function scope. Two statements in
--   the body then read:
--
--       SELECT count(*) INTO v_leader_count
--         FROM public.schedule_assignments
--        WHERE service_id = v_service_id      -- (1)
--
--       assignment_count := (
--           SELECT count(*)::INTEGER
--             FROM public.schedule_assignments
--            WHERE service_id = v_service_id  -- (2)
--       );
--
--   `service_id` is BOTH an OUT parameter and a real column of
--   schedule_assignments. Under the default plpgsql.variable_conflict = error,
--   an unqualified name that could be either is rejected, so BOTH statements
--   raise 42702. The service row and its assignment rows were already inserted
--   by that point, so the caller got a hard failure for a month that was in fact
--   correctly generated -- and, because the failure aborted the statement, the
--   preceding DELETE rolled back too, leaving the month untouched.
--
--   Net effect: the RPC could never succeed. This was not caught by the
--   migration's own existence, nor by the TypeScript suite, because the failure
--   only occurs once a real assignment reaches the INSERT loop. It was found by
--   a live rollback-safe probe of the leader-count path.
--
-- WHY A NEW MIGRATION
--   20260928060003_replace_month_schedule_rpc.sql is already applied to the
--   database. Editing an applied migration would desynchronise the file from
--   the live schema and break migration-checksum verification on replay, so the
--   function is redefined here instead. The fix is the two-line qualification
--   below; everything else is byte-identical to the applied version.
--
-- THE FIX
--   Alias the table and qualify the column as sa.service_id in both places, so
--   the reference can only resolve to the column and never to the OUT
--   parameter. No behaviour changes: same deletes, same inserts, same guards,
--   same error codes, same advisory lock, same search_path pinning.
--
--   Note this is the same class of bug Rec2 addressed for the `date` type name
--   in the original declaration; the remaining OUT names are checked against
--   the real column set of services/schedule_assignments and do not collide.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.replace_month_schedule(
    p_church_id    UUID,
    p_month        INTEGER,
    p_year         INTEGER,
    p_user_id      UUID,
    p_week_numbers INTEGER[],
    p_services     JSONB,
    p_service_type TEXT DEFAULT 'sunday'
) RETURNS TABLE (
    service_id       UUID,
    week_number      INTEGER,
    service_date     DATE,
    assignment_count INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_entry        JSONB;
    v_assn         JSONB;
    v_service_id   UUID;
    v_week         INTEGER;
    v_service_date DATE;
    v_leader_count INTEGER;
    v_now          TIMESTAMPTZ := now();
BEGIN
    -- (1) Concurrency: serialize concurrent generates of the SAME month. The
    --     lock is transaction-scoped, so it is auto-released on commit or
    --     rollback, takes no table lock, and different months never block.
    PERFORM pg_advisory_xact_lock(
        hashtextextended(p_church_id::text || ':' || p_month::text || ':' || p_year::text, 0)
    );

    -- (2) Input shape. A NULL p_services must be tested explicitly: without it,
    --     `jsonb_typeof(NULL) <> 'array'` evaluates to NULL, the guard is
    --     skipped, the DELETE below has already run, and the function
    --     "succeeds" having wiped the month.
    IF p_month IS NULL OR p_month < 0 OR p_month > 11
       OR p_year IS NULL OR p_year < 2000 OR p_year > 2100 THEN
        RAISE EXCEPTION 'invalid_parameter_value: month must be 0-11 and year 2000-2100'
            USING ERRCODE = '22023';
    END IF;
    IF p_week_numbers IS NULL OR cardinality(p_week_numbers) = 0 THEN
        RAISE EXCEPTION 'invalid_parameter_value: week_numbers must not be empty'
            USING ERRCODE = '22023';
    END IF;
    IF p_services IS NULL OR jsonb_typeof(p_services) <> 'array' THEN
        RAISE EXCEPTION 'invalid_parameter_value: p_services must be a JSON array'
            USING ERRCODE = '22023';
    END IF;

    -- (3) Tenant + actor + role must agree. The staff role is part of the
    --     check, so the DB enforces it independently of the route.
    IF NOT EXISTS (
        SELECT 1
          FROM public.users u
         WHERE u.id = p_user_id
           AND u.church_id = p_church_id
           AND u.is_active
           AND u.role IN ('admin', 'coordinator')
    ) THEN
        RAISE EXCEPTION 'tenant_mismatch: p_user_id is not an active staff user of p_church_id'
            USING ERRCODE = 'W0002';
    END IF;

    -- (4) Protected services. Checked INSIDE the transaction so it cannot race
    --     the route's pre-check.
    IF EXISTS (
        SELECT 1
          FROM public.services s
         WHERE s.church_id = p_church_id
           AND s.month = p_month
           AND s.year = p_year
           AND s.week_number = ANY (p_week_numbers)
           AND s.status IN ('published', 'validated')
    ) THEN
        RAISE EXCEPTION 'protected_service: published or validated services cannot be regenerated'
            USING ERRCODE = 'W0001';
    END IF;

    -- (5) Replace: drafts in scope only. Assignments go with them via CASCADE.
    DELETE FROM public.services s
     WHERE s.church_id = p_church_id
       AND s.month = p_month
       AND s.year = p_year
       AND s.week_number = ANY (p_week_numbers)
       AND s.status = 'draft';

    -- (6) Insert services + assignments. Any failure aborts the whole statement,
    --     which rolls (5) back too.
    FOR v_entry IN SELECT * FROM jsonb_array_elements(p_services) LOOP
        v_week         := (v_entry ->> 'week_number')::INTEGER;
        v_service_date := (v_entry ->> 'date')::DATE;

        -- Re-derive week/month/year from the date with the SAME get_week_number
        -- the trigger uses, so an app-side payload drift is a 400 and never an
        -- inconsistent row.
        IF v_week IS NULL OR v_week < 1 OR v_week > 5
           OR v_service_date IS NULL
           OR EXTRACT(MONTH FROM v_service_date)::INTEGER - 1 <> p_month
           OR EXTRACT(YEAR FROM v_service_date)::INTEGER <> p_year
           OR get_week_number(v_service_date) <> v_week THEN
            RAISE EXCEPTION 'invalid_parameter_value: service entry % does not match the requested month/week', v_entry
                USING ERRCODE = '22023';
        END IF;
        IF jsonb_typeof(v_entry -> 'assignments') <> 'array' THEN
            RAISE EXCEPTION 'invalid_parameter_value: assignments must be a JSON array for week %', v_week
                USING ERRCODE = '22023';
        END IF;

        -- A duplicate member is raised with the RPC's OWN code BEFORE the
        -- insert, so it maps to 422 and never surfaces as a raw 23505.
        IF EXISTS (
            SELECT 1
              FROM jsonb_array_elements(v_entry -> 'assignments') a
             GROUP BY (a ->> 'member_id')
            HAVING count(*) > 1
        ) THEN
            RAISE EXCEPTION 'duplicate_member: service entry for week % assigns the same member more than once', v_week
                USING ERRCODE = 'W0003';
        END IF;

        INSERT INTO public.services (
            church_id, date, week_number, month, year,
            service_type, status, generated_by, created_at, updated_at
        ) VALUES (
            p_church_id, v_service_date, v_week, p_month, p_year,
            COALESCE(p_service_type, 'sunday'), 'draft', p_user_id, v_now, v_now
        ) RETURNING id INTO v_service_id;

        FOR v_assn IN SELECT * FROM jsonb_array_elements(v_entry -> 'assignments') LOOP
            INSERT INTO public.schedule_assignments (
                service_id, member_id, role_id, instrument_id,
                is_leader, status, assigned_by, created_at, updated_at
            ) VALUES (
                v_service_id,
                (v_assn ->> 'member_id')::UUID,
                (v_assn ->> 'role_id')::UUID,
                NULLIF(v_assn ->> 'instrument_id', '')::UUID,
                COALESCE((v_assn ->> 'is_leader')::BOOLEAN, false),
                'pending',
                p_user_id, v_now, v_now
            );
        END LOOP;

        -- Exactly one worship leader. The check is here, AFTER the inner loop,
        -- so it also rejects a service with ZERO leaders -- a check inside the
        -- loop can only ever see "more than one".
        --
        -- FIX: `sa.service_id` is qualified. Unqualified, it resolved against
        -- BOTH this function's OUT parameter `service_id` and the column of the
        -- same name, and PL/pgSQL rejected it with 42702.
        SELECT count(*) INTO v_leader_count
          FROM public.schedule_assignments sa
         WHERE sa.service_id = v_service_id
           AND sa.is_leader;
        IF v_leader_count <> 1 THEN
            RAISE EXCEPTION 'leader_count: service for week % has % worship leaders, exactly 1 is required', v_week, v_leader_count
                USING ERRCODE = 'W0003';
        END IF;

        service_id       := v_service_id;
        week_number      := v_week;
        service_date     := v_service_date;
        assignment_count := (
            SELECT count(*)::INTEGER
              FROM public.schedule_assignments sa
             WHERE sa.service_id = v_service_id
        );
        RETURN NEXT;
    END LOOP;

    RETURN;
END;
$$;

-- The signature is unchanged, so EXECUTE is still revoked from PUBLIC/anon/
-- authenticated and granted only to service_role. Re-asserted because
-- CREATE OR REPLACE preserves privileges but the revoke is the security
-- boundary for this function and must not depend on that behaviour.
REVOKE ALL ON FUNCTION public.replace_month_schedule(UUID, INTEGER, INTEGER, UUID, INTEGER[], JSONB, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.replace_month_schedule(UUID, INTEGER, INTEGER, UUID, INTEGER[], JSONB, TEXT)
    TO service_role;
