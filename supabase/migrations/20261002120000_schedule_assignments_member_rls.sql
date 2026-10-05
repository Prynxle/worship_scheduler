-- ============================================================================
-- Migration: 20261002120000_schedule_assignments_member_rls
-- Created: 2026-10-02
-- Purpose: Scope schedule_assignments reads to published services for members.
--          Issue #38 requires that a member see only their own assignments and
--          only on published services. The member-facing read path is a browser
--          client using the anon/authenticated key, so RLS -- not the app's
--          requireStaff routes -- is the only enforcement point.
--
-- Scope of blast radius
--
-- No file under src/ references schedule_assignments. The table is reached only
-- through service-role server routes and service_role RPCs, both of which BYPASS
-- RLS, so this migration cannot change application behaviour. It changes only
-- what a hand-rolled client query can read.
--
-- Rollback
--
-- Three distinct failures, three distinct responses. Prefer 2 over 1; revert
-- only as a deliberate, disclosed act.
--
-- 1. THE FILE DID NOT APPLY, OR PARTLY APPLIED (most likely).
--    Symptoms: this file errored, or statements were run one at a time outside a
--    transaction and it stopped between a DROP and its CREATE. That leaves the
--    table with RLS enabled and NO permissive SELECT policy, so every client
--    reads zero rows. Staff route behaviour is unaffected, so the app can look
--    healthy while a browser read returns nothing -- check the browser network
--    tab, not the UI.
--    Response: re-run this file. Every CREATE POLICY is immediately preceded by a
--    DROP POLICY IF EXISTS for the same name, so the whole file is re-runnable and
--    reaches the same end state. No cleanup statement is needed first. This
--    re-runnability is pinned in
--    src/lib/supabase/schedule-assignments-rls.test.ts.
--
-- 2. A LEGITIMATE READ IS NOW DENIED (policy too narrow).
--    Symptoms: a tool outside src/ -- Supabase Studio, a saved report, a
--    PostgREST call, a realtime subscription -- reads schedule_assignments and
--    gets empty or partial rows where it used to get data.
--    Response: do NOT revert. Widen the member branch in a new forward migration
--    to the narrowest predicate that restores the read, e.g. "any assignment on a
--    published service this member is assigned to" rather than "this member's own
--    row". A revert here re-opens the disclosure for no benefit, because the fix
--    is additive.
--
-- 3. FULL REVERT (security trade-off accepted and disclosed).
--    Only if a genuine regression remains after 2, or the tightening must be
--    backed out immediately while it is diagnosed. Apply the compensating
--    statements below AS A NEW TIMESTAMPED MIGRATION -- never by deleting this
--    file, and never by editing it once applied. AGENTS.md forbids editing an
--    applied migration.
--
--    WARNING: this re-introduces two live defects on purpose. Any member of a
--    church can read every assignment in it again, including rows on draft and
--    validated services, and the FOR ALL policy that this migration role-gates
--    goes back to checking no role at all. It is a disclosure regression, not a
--    cosmetic one. Record the decision and the follow-up.
--
--      DROP POLICY IF EXISTS "Staff can view church assignments and members can view their own published assignments" ON schedule_assignments;
--      CREATE POLICY "Users can view assignments in their church"
--          ON schedule_assignments FOR SELECT
--          USING (service_id IN (
--            SELECT id FROM services WHERE church_id = get_user_church_id()
--          ));
--      DROP POLICY IF EXISTS "Staff can manage assignments in their church" ON schedule_assignments;
--      CREATE POLICY "Admins can manage assignments in their church"
--          ON schedule_assignments FOR ALL
--          USING (service_id IN (
--            SELECT id FROM services WHERE church_id = get_user_church_id()
--          ));
--      GRANT SELECT ON schedule_assignments TO authenticated;
--
--    Note what the compensating statements deliberately do NOT undo: the write
--    boundary. Do not re-issue GRANT ALL, and leave these in place, because
--    granting writes back while the read is church-wide would let a member
--    INSERT their own row and read it. The prior revoke lives at
--    20260928084433_scheduler_workflow_hardening.sql:147-148 and this migration
--    re-asserted it; a revert of the read policies must not undo it.
-- ============================================================================
--
-- WHY THIS IS NEEDED
--
-- 20260727213700_rls_policies.sql:169-173 scoped schedule_assignments reads by
-- church alone:
--
--     USING (service_id IN (
--       SELECT id FROM services WHERE church_id = get_user_church_id()
--     ));
--
-- Two holes followed from that.
--
-- 1. No publication gate. The sibling `services` policy was later tightened in
--    20260928084433_scheduler_workflow_hardening.sql:168-181 to published-only
--    for members, but schedule_assignments never received the matching policy.
--    So a member could read assignments belonging to draft, validated and
--    archived services, defeating the services gate entirely: hiding the service
--    row does nothing when the assignment row is still readable.
--
-- 2. No member identity. The policy is church-wide, so any member could read
--    every other member's assignments -- who is leading, who is on keys, and who
--    is unavailable -- for any month in the church.
--
-- BOTH policies on this table are replaced here, not just the SELECT one.S
-- PostgreSQL combines permissive policies with OR, and
-- 20260727213700_rls_policies.sql:175-179 created a FOR ALL policy whose USING
-- clause is the same church-wide predicate. FOR ALL covers SELECT as well as
-- INSERT/UPDATE/DELETE, so replacing only the SELECT policy would leave that
-- second policy granting church-wide SELECT to every member and silently
-- defeat this fix. Narrowing only one of the two is a no-op.
--
-- The FOR ALL policy is additionally role-gated here. It was named "Admins can
-- manage assignments in their church" but never actually checked any role, so
-- it admitted every authenticated member of the church. Writes are separately
-- denied at the privilege level by
-- 20260928084433_scheduler_workflow_hardening.sql:147-148, but SELECT is not, so
-- the missing role check was reachable. admin/coordinator is the correct
-- boundary: it is exactly what src/lib/auth/server.ts requireStaff enforces, and
-- every staff route in this application writes through the service-role client,
-- which bypasses RLS. This change therefore cannot alter server-route
-- behaviour -- it only narrows what a direct client query can read.
--
-- WHERE THE SERVICE'S OWN POLICY IS NOT REPEATED
--
-- The published gate reads services.status directly rather than trusting the
-- services SELECT policy. RLS policies on `services` do not apply to a subquery
-- inside another table's policy expression, so relying on them would be
-- incorrect; the status is re-tested here on purpose.

-- ============================================================================
-- READ POLICY
-- Staff keep full read access to their own church's drafts. Members read only
-- their own rows, and only once the service has been published.
-- ============================================================================
DROP POLICY IF EXISTS "Users can view assignments in their church" ON schedule_assignments;
DROP POLICY IF EXISTS "Staff can view church assignments and members can view their own published assignments" ON schedule_assignments;
DROP POLICY IF EXISTS "members can view their own published assignments" ON schedule_assignments;

CREATE POLICY "members can view their own published assignments"
  ON schedule_assignments FOR SELECT
  USING (
    service_id IN (
      SELECT id FROM services WHERE church_id = get_user_church_id()
    )
    AND (
      EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.auth_id = (SELECT auth.uid()) AND u.church_id = get_user_church_id()
          AND u.role IN ('admin', 'coordinator') AND u.is_active
      )
      OR (
        EXISTS (
          SELECT 1 FROM public.users u JOIN public.members m ON m.user_id = u.id
          WHERE u.auth_id = (SELECT auth.uid()) AND m.id = schedule_assignments.member_id
        )
        AND EXISTS (
          SELECT 1 FROM public.services s
          WHERE s.id = schedule_assignments.service_id AND s.status = 'published'
        )
      )
    )
  );

-- ============================================================================
-- WRITE POLICY
-- Role-gated for the first time. The name always said "Admins"; the predicate
-- never checked. Mirrors the staff predicate above so a coordinator and an admin
-- are treated identically, consistent with requireStaff.
-- ============================================================================
DROP POLICY IF EXISTS "Admins can manage assignments in their church" ON schedule_assignments;
DROP POLICY IF EXISTS "Staff can manage assignments in their church" ON schedule_assignments;

CREATE POLICY "Staff can manage assignments in their church"
  ON schedule_assignments FOR ALL
  USING (
    service_id IN (
      SELECT id FROM services WHERE church_id = get_user_church_id()
    )
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.auth_id = (SELECT auth.uid()) AND u.church_id = get_user_church_id()
        AND u.role IN ('admin', 'coordinator') AND u.is_active
    )
  )
  WITH CHECK (
    service_id IN (
      SELECT id FROM services WHERE church_id = get_user_church_id()
    )
    AND EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.auth_id = (SELECT auth.uid()) AND u.church_id = get_user_church_id()
        AND u.role IN ('admin', 'coordinator') AND u.is_active
    )
  );

-- ============================================================================
-- RE-ASSERT THE PRIVILEGE BOUNDARY
-- 20260928084433_scheduler_workflow_hardening.sql:147-148 revoked direct
-- INSERT/UPDATE/DELETE from anon and authenticated so ordinary clients cannot
-- forge assignments. GRANT ALL ON ALL TABLES in 20260727213700_rls_policies.sql
-- ran earlier in the sequence, and a replayed grant would restore write access,
-- so the denial is re-asserted here rather than assumed to still hold.
-- ============================================================================
REVOKE INSERT, UPDATE, DELETE ON schedule_assignments FROM anon, authenticated;
GRANT SELECT ON schedule_assignments TO authenticated;

-- Members must not be able to probe the table at all while signed out.
REVOKE ALL ON schedule_assignments FROM anon;