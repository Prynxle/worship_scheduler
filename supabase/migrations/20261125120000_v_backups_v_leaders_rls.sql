-- ============================================================================
-- Migration: 20261125120000_v_backups_v_leaders_rls
-- Created: 2026-11-25
-- Purpose: Close PostgREST exposure of the orphan count tables
--          public.v_backups and public.v_leaders.
--
-- WHY
--
-- Both relations are ordinary tables (pg_class.relkind = 'r'), not views despite
-- the v_ prefix. Each holds a single `count` bigint and one row. Neither is
-- referenced by application code, tests, docs, or committed migrations; they
-- were created outside the migration history. The blanket grant in
-- 20260727213700_rls_policies.sql left anon and authenticated with ALL
-- privileges on every public table, and RLS was never enabled on these two.
-- The Security Advisor reports both under rls_disabled_in_public.
--
-- There is no church_id column and no tenant meaning to preserve, so adding a
-- church-scoped policy would invent data. Least privilege is to enable RLS,
-- withdraw all API-role privileges, and leave an explicit deny policy so a
-- future replayed GRANT ALL cannot reopen the boundary. Postgres already
-- denies by default when no permissive policy matches; the policy documents
-- that intent.
--
-- Idempotent and safe on a fresh database where the tables do not exist.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.v_leaders') IS NOT NULL THEN
    ALTER TABLE public.v_leaders ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.v_leaders FROM PUBLIC, anon, authenticated;
    DROP POLICY IF EXISTS "No client access" ON public.v_leaders;
    CREATE POLICY "No client access" ON public.v_leaders
      FOR ALL TO anon, authenticated
      USING (false)
      WITH CHECK (false);
  END IF;

  IF to_regclass('public.v_backups') IS NOT NULL THEN
    ALTER TABLE public.v_backups ENABLE ROW LEVEL SECURITY;
    REVOKE ALL ON TABLE public.v_backups FROM PUBLIC, anon, authenticated;
    DROP POLICY IF EXISTS "No client access" ON public.v_backups;
    CREATE POLICY "No client access" ON public.v_backups
      FOR ALL TO anon, authenticated
      USING (false)
      WITH CHECK (false);
  END IF;
END $$;
