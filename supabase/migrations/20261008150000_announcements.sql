-- ============================================================================
-- Migration: 20261008150000_announcements
-- Created: 2026-10-08
-- Purpose: Coordinator announcements (issue #45).
--
-- WHAT THIS CHANGES
--
-- 1. `notifications.type` gains 'announcement'. The original CHECK is inline on
--    the column, so Postgres named it `notifications_type_check`; the DO block
--    drops whatever check constraint owns the `type` column rather than
--    trusting that name, then one named constraint is added with the widened
--    list. Re-running this file reaches the same end state.
--
-- 2. Four columns. `created_by` records who broadcast the announcement;
--    `audience_type` records which audience selector (church / ministry /
--    role / members) produced the recipient set. A broadcast is one row per
--    recipient, so the audience metadata is duplicated on each row --
--    informational only, the recipient set itself is not reconstructable
--    from it. Both columns are nullable because every pre-existing
--    notification type predates them.
--
--    `announcement_id` is the shared key of one broadcast's fan-out: the
--    publish route generates one uuid and stamps it on every recipient row,
--    so a staff delete can remove the whole announcement instead of one
--    recipient's copy. `dismissed_at` is the per-recipient soft remove: it
--    hides the row from that one user's feed while keeping the row (and the
--    announcement for everyone else) in the database. Both are added by this
--    same, still-unapplied migration, so no backfill is needed.
--
-- 3. The insert policy `WITH CHECK (true)` from 20260727213700 is replaced.
--    That policy let ANY caller insert a notification row for ANY church. The
--    replacement requires an active admin or coordinator of the row's church.
--    Broadcast inserts themselves run through the service-role client
--    (RLS-bypassing) inside a `requireStaff` route, so this policy is the
--    bound that survives a replay of the blanket
--    `GRANT ALL ON ALL TABLES TO authenticated` from 20260727213700 -- the
--    same residue 20261002130000 closed on schedule_assignments.
--
-- 4. The SELECT and UPDATE policies are restated with an explicit church
--    scope beside the user_id check. `user_id = caller` already implies the
--    caller's own rows; the church conjunct makes the tenant boundary
--    visible in the policy instead of depending on that implication.
--
-- 5. Privilege hygiene, mirroring 20261002130000: REVOKE ALL rather than
--    naming individual privileges (TRUNCATE is not subject to RLS), then
--    grant back exactly SELECT + UPDATE to authenticated. Application reads
--    and writes go through service-role routes; SELECT/UPDATE remain for a
--    future direct browser read path, which RLS already bounds to own rows.
--
-- Rollback: this migration is not automatically reversible. To revert, drop
-- the four new columns, narrow the type CHECK back to the original five
-- values, and re-run the notification policy block from
-- 20260727213700_rls_policies.sql -- noting that doing so re-introduces the
-- unconditional insert policy on purpose. Prefer fixing forward in a new
-- migration.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Widen the type CHECK.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    constraint_name TEXT;
BEGIN
    SELECT c.conname INTO constraint_name
    FROM pg_constraint c
    JOIN pg_attribute a
        ON a.attrelid = c.conrelid
       AND a.attnum = ANY (c.conkey)
    WHERE c.conrelid = 'public.notifications'::regclass
      AND c.contype = 'c'
      AND a.attname = 'type'
    LIMIT 1;

    IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.notifications DROP CONSTRAINT %I', constraint_name);
    END IF;
END;
$$;

ALTER TABLE public.notifications
    ADD CONSTRAINT notifications_type_check
    CHECK (type IN (
        'assignment', 'conflict', 'reminder',
        'schedule_published', 'availability_reminder', 'announcement'
    ));

-- ---------------------------------------------------------------------------
-- 2. Announcement metadata columns.
-- ---------------------------------------------------------------------------
ALTER TABLE public.notifications
    ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.notifications
    ADD COLUMN IF NOT EXISTS audience_type VARCHAR(20);

ALTER TABLE public.notifications
    ADD COLUMN IF NOT EXISTS announcement_id UUID NOT NULL DEFAULT gen_random_uuid();

ALTER TABLE public.notifications
    ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ;

-- Guarded via pg_constraint because ADD CONSTRAINT has no IF NOT EXISTS.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'notifications_audience_type_check'
          AND conrelid = 'public.notifications'::regclass
    ) THEN
        ALTER TABLE public.notifications
            ADD CONSTRAINT notifications_audience_type_check
            CHECK (audience_type IS NULL OR audience_type IN ('church', 'ministry', 'role', 'members'));
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. Indexes: the notification panel reads one user's rows newest-first, and
--    a staff delete removes a broadcast by its shared announcement_id.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_notifications_user_feed
    ON public.notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_announcement
    ON public.notifications (announcement_id);

-- ---------------------------------------------------------------------------
-- 4. Policies.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "System can insert notifications" ON public.notifications;
DROP POLICY IF EXISTS "Staff can insert church notifications" ON public.notifications;
CREATE POLICY "Staff can insert church notifications"
    ON public.notifications FOR INSERT
    WITH CHECK (
        church_id = get_user_church_id()
        AND EXISTS (
            SELECT 1 FROM public.users u
            WHERE u.auth_id = (SELECT auth.uid())
              AND u.role IN ('admin', 'coordinator')
              AND u.is_active
        )
    );

DROP POLICY IF EXISTS "Users can view their own notifications" ON public.notifications;
CREATE POLICY "Users can view their own notifications"
    ON public.notifications FOR SELECT
    USING (
        user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
        AND church_id = get_user_church_id()
    );

DROP POLICY IF EXISTS "Users can update their own notifications" ON public.notifications;
CREATE POLICY "Users can update their own notifications"
    ON public.notifications FOR UPDATE
    USING (
        user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
        AND church_id = get_user_church_id()
    )
    WITH CHECK (
        user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
        AND church_id = get_user_church_id()
    );

-- ---------------------------------------------------------------------------
-- 5. Privilege hygiene.
-- ---------------------------------------------------------------------------
REVOKE ALL ON public.notifications FROM anon, authenticated;
GRANT SELECT, UPDATE ON public.notifications TO authenticated;
