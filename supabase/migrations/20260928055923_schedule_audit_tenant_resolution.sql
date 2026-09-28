-- ============================================================================
-- Migration: 018_schedule_audit_tenant_resolution
-- Created: 2026-09-28
-- Purpose: Fix the root cause of the schedule-generation 400.
--
--   POST /api/schedule writes schedule_assignments, a table with NO church_id.
--   Its AFTER INSERT trigger audit_assignments_changes calls log_audit_change(),
--   which fell back to get_user_church_id() = SELECT church_id FROM users
--   WHERE auth_id = auth.uid(). The route writes through the SERVICE ROLE
--   client, so auth.uid() is NULL, so the function invented the all-zeros UUID,
--   and audit_logs.church_id REFERENCES churches(id) rejected it (SQLSTATE
--   23503, "audit_logs_church_id_fkey"). No assignment has ever been written.
--
-- What this migration does:
--   1a. resolve_entity_church_id(table, row): tenant from the row, else from a
--       table-specific back-reference.
--   1b. log_audit_change(): resolve the tenant, never fabricate one.
--   1c. REVOKE/GRANT. REQUIRED, not cosmetic -- see the note below.
--   1d. No CREATE TRIGGER: the three existing audit triggers bind by name and
--       pick up the new body automatically. No DROP TRIGGER window.
--
-- CASCADED DELETES (why the resolution order below is what it is)
-- -------------------------------------------------------------------
-- schedule_assignments.service_id is ON DELETE CASCADE, implemented by Postgres
-- as an AFTER DELETE trigger on the parent. By the time the child audit trigger
-- fires, the parent services row is already invisible to its own SELECT. So a
-- cascaded assignment deletion CANNOT resolve the tenant through service_id, and
-- a cascaded assignment deletion is therefore audited through its PARENT
-- services row instead -- the parent carries its own church_id and writes its
-- own services_deleted audit row. To keep the child auditable as well, the
-- resolver falls back to member_id -> members.church_id; members are never
-- deleted by this path, so that resolution always succeeds.
--
-- search_path
-- -------------------------------------------------------------------
-- R1: log_audit_change pins `public, pg_temp, auth`. `auth` is MANDATORY: the
-- body calls auth.uid() and get_user_church_id(), and get_user_church_id has
-- proconfig = NULL, so it inherits this path. Pinning `public, pg_temp` alone
-- would make every audited write fail with 3F000 schema "auth" does not exist.
-- The auth.uid() lookup is NOT inlined as a workaround: the
-- get_user_church_id() fallback is load-bearing for every writer that runs
-- without a session.
--
-- R3(b): for TG_OP = 'DELETE' with a still-unresolvable audit context, RETURN
-- WITHOUT inserting an audit row and emit a WARNING. RAISE is correct for
-- INSERT/UPDATE and wrong for DELETE: raising there would abort the enclosing
-- transaction, which is what makes the transactional month replace (migration
-- 020) impossible to complete. For INSERT/UPDATE an unresolvable tenant stays a
-- hard RAISE (SQLSTATE 23000) -- fabricating a tenant is what caused this bug.
--
-- ADD CONSTRAINT is deliberately NOT used anywhere in this migration: Postgres
-- has no IF NOT EXISTS for constraints. These objects use CREATE OR REPLACE /
-- CREATE ... IF NOT EXISTS, and migrations run exactly once.
-- ============================================================================

-- ============================================================================
-- 1a. TENANT RESOLVER
-- SECURITY DEFINER so the trigger resolves the tenant even when the writing
-- session's RLS would hide the parent row. STABLE (no side effects, returns
-- only a tenant id, never a data payload). EXECUTE is revoked in 1c, so the
-- only caller is the trigger.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.resolve_entity_church_id(
    p_table_name TEXT,
    p_row        JSONB
) RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_church_id UUID;
    v_ref_id    UUID;
BEGIN
    IF p_row IS NULL THEN
        RETURN NULL;
    END IF;

    -- 1. The row carries the tenant itself (services, members, availability...).
    IF p_row ? 'church_id' AND p_row ->> 'church_id' IS NOT NULL THEN
        BEGIN
            RETURN (p_row ->> 'church_id')::UUID;
        EXCEPTION
            WHEN invalid_text_representation OR datatype_mismatch THEN
                v_church_id := NULL;  -- unparseable: fall through to the back-reference
        END;
    END IF;

    -- 2. Table-specific back-reference for tenant-less tables.
    IF p_table_name = 'schedule_assignments' THEN
        -- service_id first: the assignment is attributed to the tenant of the
        -- service it belongs to, which is the correct owner of the write.
        BEGIN
            v_ref_id := (p_row ->> 'service_id')::UUID;
        EXCEPTION WHEN OTHERS THEN
            v_ref_id := NULL;
        END;
        IF v_ref_id IS NOT NULL THEN
            SELECT s.church_id INTO v_church_id
              FROM public.services s
             WHERE s.id = v_ref_id;
        END IF;

        -- THEN member_id. This is the branch that survives a cascaded delete,
        -- where the parent service row is already invisible. Members are never
        -- deleted on this path, so this always resolves.
        IF v_church_id IS NULL THEN
            BEGIN
                v_ref_id := (p_row ->> 'member_id')::UUID;
            EXCEPTION WHEN OTHERS THEN
                v_ref_id := NULL;
            END;
            IF v_ref_id IS NOT NULL THEN
                SELECT m.church_id INTO v_church_id
                  FROM public.members m
                 WHERE m.id = v_ref_id;
            END IF;
        END IF;

    ELSIF p_table_name IN ('member_roles', 'member_skills') THEN
        BEGIN
            v_ref_id := (p_row ->> 'member_id')::UUID;
        EXCEPTION WHEN OTHERS THEN
            v_ref_id := NULL;
        END;
        IF v_ref_id IS NOT NULL THEN
            SELECT m.church_id INTO v_church_id
              FROM public.members m
             WHERE m.id = v_ref_id;
        END IF;
    END IF;

    -- NULL means "not derivable from the row". The caller decides what that means.
    RETURN v_church_id;
END;
$$;

-- ============================================================================
-- 1b. AUDIT TRIGGER FUNCTION
-- Same signature, same trigger contract, same action_type strings, same columns.
-- Changes: (1) real tenant resolution, (2) the all-zeros church_id sentinel is
-- GONE, (3) the authenticated user fallback is the SYSTEM ACTOR and is not
-- church-coupled, (4) a pinned search_path.
--
-- `user_id` is the ACTOR axis and `church_id` is the TENANT axis. Conflating the
-- two is what produced this bug. users.id is the primary key, so the system
-- actor is necessarily a single row; requiring it to belong to the resolved
-- church would break every second tenant. This is a deliberate design choice,
-- surfaced rather than silent.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.log_audit_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp, auth
AS $$
DECLARE
    old_data   JSONB;
    new_data   JSONB;
    row_data   JSONB;
    action_type VARCHAR(50);
    entity_id  UUID;
    v_church_id UUID;
    v_user_id   UUID;
BEGIN
    IF TG_OP = 'INSERT' THEN
        action_type := TG_TABLE_NAME || '_created';
        new_data := to_jsonb(NEW);
        entity_id := NEW.id;
    ELSIF TG_OP = 'UPDATE' THEN
        action_type := TG_TABLE_NAME || '_updated';
        old_data := to_jsonb(OLD);
        new_data := to_jsonb(NEW);
        entity_id := NEW.id;
    ELSIF TG_OP = 'DELETE' THEN
        action_type := TG_TABLE_NAME || '_deleted';
        old_data := to_jsonb(OLD);
        entity_id := OLD.id;
    END IF;

    -- The row as it stands now for INSERT/UPDATE, the old row for DELETE.
    row_data := CASE WHEN TG_OP = 'DELETE' THEN old_data ELSE new_data END;

    -- Tenant: row -> back-reference -> authenticated user.
    v_church_id := public.resolve_entity_church_id(TG_TABLE_NAME, row_data);
    IF v_church_id IS NULL THEN
        v_church_id := public.get_user_church_id();
    END IF;

    -- Actor: authenticated user -> designated system actor.
    v_user_id := (SELECT u.id FROM public.users u WHERE u.auth_id = auth.uid() LIMIT 1);
    IF v_user_id IS NULL THEN
        v_user_id := (SELECT u.id
                        FROM public.users u
                       WHERE u.id = '00000000-0000-0000-0000-000000000000'::UUID
                       LIMIT 1);
    END IF;

    -- R3(b): a DELETE must never be able to abort its enclosing transaction.
    IF v_church_id IS NULL OR v_user_id IS NULL THEN
        IF TG_OP = 'DELETE' THEN
            RAISE WARNING
                'audit_logs row skipped: audit context unresolvable for %.% id=% (church_id=% user_id=%). The parent row audit, which carries its own church_id, is the authoritative trail for a cascaded delete.',
                TG_TABLE_SCHEMA, TG_TABLE_NAME, entity_id, v_church_id, v_user_id;
            RETURN OLD;
        END IF;
        RAISE EXCEPTION
            'audit_logs audit context is unresolvable for %.% id=% (church_id=% user_id=%): refusing to write an audit row without a tenant. (This is a data-integrity failure, not a client error.)',
            TG_TABLE_SCHEMA, TG_TABLE_NAME, entity_id, v_church_id, v_user_id
            USING ERRCODE = '23000';
    END IF;

    INSERT INTO public.audit_logs (
        church_id, user_id, action, entity_type, entity_id,
        old_value, new_value, ip_address
    ) VALUES (
        v_church_id,
        v_user_id,
        action_type,
        TG_TABLE_NAME,
        entity_id,
        old_data,
        new_data,
        NULL
    );

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$;

-- ============================================================================
-- 1c. PRIVILEGES -- LOAD-BEARING SECURITY CONTROL, NOT COSMETICS
-- 20260727213700_rls_policies.sql:259 ran
--   GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO anon;
-- which is real and was verified live (anon/authenticated both hold EXECUTE on
-- all 7 public functions). Postgres ALSO grants EXECUTE to PUBLIC by default on
-- every new function, so a REVOKE is required regardless.
--
-- Without these REVOKEs:
--   * anon could call resolve_entity_church_id('services', '{"id":"<any uuid>"}')
--     and enumerate tenant church ids ACROSS tenants -- a cross-tenant leak.
--   * anon could invoke the trigger functions directly.
--
-- get_user_church_id() is deliberately NOT revoked: ~20 RLS policies call it,
-- and anon must retain EXECUTE for those policies to evaluate at all.
-- ============================================================================
REVOKE ALL ON FUNCTION public.resolve_entity_church_id(TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.log_audit_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_service_week_number() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.resolve_entity_church_id(TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.log_audit_change() TO service_role;
GRANT EXECUTE ON FUNCTION public.set_service_week_number() TO service_role;
