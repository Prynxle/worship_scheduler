-- ============================================================================
-- Migration: 020_replace_month_schedule_rpc
-- Created: 2026-09-28
-- Purpose: Replace the non-transactional delete-then-insert writer in
--          POST /api/schedule with ONE transaction.
--
-- THE DEFECT
--   src/app/api/schedule/route.ts ran
--     DELETE FROM services ...;  then, in a loop, INSERT service / INSERT assignments
--   with no transaction and no rollback. A failure anywhere after the DELETE
--   left the month partially written. That is the direct cause of the duplicate
--   draft services cleaned up in migration 019. A Postgres function body is a
--   single statement: any RAISE aborts it and rolls the DELETE back, so the
--   month is either fully old or fully new. The partial-month bug class is
--   structurally eliminated.
--
-- 3a. A partial UNIQUE INDEX so "duplicate/orphan service rows accumulate on
--     every regenerate" can no longer be REPRESENTED, regardless of client
--     behaviour. Partial on status <> 'archived' so archived history never
--     blocks. Created after 019's dedupe, so it cannot fail on the debris.
--     Rec3: IF NOT EXISTS is used because it exists for indexes.
--
-- 3b. The RPC. R2: p_services is declared BEFORE p_service_type, because
--     Postgres rejects a defaulted parameter followed by a non-defaulted one.
--     Every REVOKE/GRANT signature string below matches this exact order.
--
-- 3c. Privileges. R2: signature is (UUID, INTEGER, INTEGER, UUID, INTEGER[],
--     JSONB, TEXT).
--
-- TENANT SCOPE
--   The RPC re-derives the replace set from (p_church_id, p_month, p_year,
--   p_week_numbers) and re-verifies p_user_id. The route's fast 409 pre-check is
--   retained for the immediate service_ids-bearing response but is NOT trusted:
--   the RPC is authoritative and closes the TOCTOU gap. R10: the check also
--   requires the staff role, so the function independently enforces the role the
--   route enforces. The function is SECURITY DEFINER owned by postgres, which
--   owns public.users and holds BYPASSRLS (verified), so the users read below
--   is not filtered out by RLS.
--
-- CASCADED DELETES
--   Step 5's DELETE cascades to schedule_assignments. The child audit trigger
--   fires after the parent services row is already invisible, so the audit
--   resolver falls back to member_id -> members.church_id. See migration 018.
--   That is why the tenant path must remain a WARNING-and-skip on DELETE: a
--   RAISE there would abort this transaction and make a replace impossible.
--
-- ERROR CODE -> HTTP CONTRACT (mirrored exactly in src/lib/api/errors.ts)
--   22023 invalid_parameter_value -> 400
--   W0001 protected_service       -> 409
--   W0002 tenant_mismatch         -> 403
--   W0003 leader_count / duplicate_member -> 422
--   23P01 exclusion_violation     -> 422
--   23505 unique_violation        -> 500
--   23503 foreign_key_violation   -> 500   <- the original bug, by code
--   23514 check_violation         -> 500
--   40001 serialization_failure   -> 503
--   anything else                 -> 500
--
--   R5 corrections to the original plan: a duplicate member in one service
--   violates UNIQUE, so the raw code is 23505 (not 23P01, which is
--   exclusion_violation), and the audit FK failure is 23503 (not 23000). Both
--   are therefore DATA-INTEGRITY defects and correctly map to 500 -- that is
--   the point of adding them. The RPC additionally raises its OWN code for a
--   duplicate member BEFORE the insert, so the mapping stays unambiguous
--   (422, a scheduling-domain violation) instead of surfacing as a raw 23505.
--   It reuses W0003 with a distinct `duplicate_member:` message prefix rather
--   than inventing an unmapped SQLSTATE, which would fall through to 500.
-- ============================================================================

-- ============================================================================
-- 3a. UNIQUENESS GUARD
-- One worship service per Sunday per church is the domain rule.
-- ============================================================================
CREATE UNIQUE INDEX IF NOT EXISTS services_church_date_week_unique
    ON public.services (church_id, date, week_number)
 WHERE status <> 'archived';

-- ============================================================================
-- 3b. THE TRANSACTIONAL REPLACE
-- Rec2: the OUT column is named service_date, not date, so it does not shadow
-- the `date` type name used by (v_entry ->> 'date')::DATE in the body below.
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

    -- (2) Input shape. R4: `p_services IS NULL` must be tested explicitly --
    -- without it, `jsonb_typeof(NULL) <> 'array'` evaluates to NULL, the guard
    -- is skipped, the DELETE below has already run, and the function "succeeds"
    -- having wiped the month.
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

    -- (3) Tenant + actor + role must agree. R10: staff role is part of the
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

        -- R5: raise the RPC's OWN code for a duplicate member BEFORE the insert,
        -- so the mapping is a 422 and never a raw 23505 (which maps to 500).
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

        -- R6: Rule 5 is EXACTLY one worship leader. The check is here, AFTER the
        -- inner loop, so it also rejects a service with ZERO leaders -- a check
        -- inside the loop can only ever see "more than one".
        SELECT count(*) INTO v_leader_count
          FROM public.schedule_assignments
         WHERE service_id = v_service_id
           AND is_leader;
        IF v_leader_count <> 1 THEN
            RAISE EXCEPTION 'leader_count: service for week % has % worship leaders, exactly 1 is required', v_week, v_leader_count
                USING ERRCODE = 'W0003';
        END IF;

        service_id       := v_service_id;
        week_number      := v_week;
        service_date     := v_service_date;
        assignment_count := (
            SELECT count(*)::INTEGER
              FROM public.schedule_assignments
             WHERE service_id = v_service_id
        );
        RETURN NEXT;
    END LOOP;

    RETURN;
END;
$$;

-- ============================================================================
-- 3c. PRIVILEGES -- THE SINGLE HIGHEST-SEVERITY STATEMENT IN THIS MIGRATION
-- 20260727213700_rls_policies.sql:259 granted anon EXECUTE on every function in
-- public, and Postgres grants EXECUTE to PUBLIC by default anyway. Without this
-- REVOKE, an unauthenticated caller could drive arbitrary service/assignment
-- writes for ANY p_church_id through replace_month_schedule.
-- The signature string is (UUID, INTEGER, INTEGER, UUID, INTEGER[], JSONB, TEXT)
-- and MUST match the declaration above exactly.
-- ============================================================================
REVOKE ALL ON FUNCTION public.replace_month_schedule(UUID, INTEGER, INTEGER, UUID, INTEGER[], JSONB, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.replace_month_schedule(UUID, INTEGER, INTEGER, UUID, INTEGER[], JSONB, TEXT)
    TO service_role;
