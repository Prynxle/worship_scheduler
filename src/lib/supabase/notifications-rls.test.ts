import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Pins for 20261008150000_announcements.
 *
 * The notifications table is read by RLS-bounded direct clients and written by
 * service-role routes, and 20260727213700 left an unconditional
 * `WITH CHECK (true)` insert policy on it that 20261002130000's own test file
 * (schedule-assignments-rls.test.ts:149-156) cites as the standing example of
 * a bad policy. Assertions are on PROPERTIES of the SQL text: a dropped
 * conjunct, a widened scope, or a replayed grant must fail the corresponding
 * test, not slip through as prose.
 */

type Policy = {
  name: string;
  command: string;
  using: string;
  withCheck: string;
};

function readMigration(): string {
  return readFileSync(
    fileURLToPath(new URL('../../../supabase/migrations/20261008150000_announcements.sql', import.meta.url)),
    'utf8',
  );
}

/**
 * Drops SQL comments before parsing: the header documents the migration's own
 * compensating SQL in prose, and a commented-out CREATE POLICY would otherwise
 * count as a live one. Lines contain no `--` inside string literals, so
 * cutting at the first `--` is safe.
 */
function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const at = line.indexOf('--');
      return at === -1 ? line : line.slice(0, at);
    })
    .join('\n');
}

/** Every CREATE POLICY statement this migration adds against notifications. */
function policies(sql: string): Policy[] {
  const statements = stripComments(sql).match(/CREATE POLICY[\s\S]*?;/g) ?? [];
  return statements.map((statement) => {
    const name = statement.match(/CREATE POLICY\s+"([^"]+)"/)?.[1] ?? '';
    const command = statement.match(/ON\s+(?:public\.)?notifications\s+FOR\s+([A-Z]+)/)?.[1] ?? '';
    const usingAt = statement.indexOf('USING (');
    const checkAt = statement.indexOf('WITH CHECK (');
    const using = usingAt === -1
      ? ''
      : statement.slice(usingAt, checkAt === -1 ? statement.lastIndexOf(';') : checkAt).replace(/\s+/g, ' ');
    const withCheck = checkAt === -1 ? '' : statement.slice(checkAt, statement.lastIndexOf(';')).replace(/\s+/g, ' ');
    return { name, command, using, withCheck };
  });
}

const policyByName = (name: string) => policies(readMigration()).find((policy) => policy.name === name);

describe('announcements migration — policy set', () => {
  it('creates exactly three policies: INSERT, SELECT, UPDATE on notifications', () => {
    const created = policies(readMigration());
    expect(created).toHaveLength(3);
    expect(created.map((policy) => policy.command).sort()).toEqual(['INSERT', 'SELECT', 'UPDATE']);
    expect(created.every((policy) => policy.name.length > 0)).toBe(true);
  });

  it('drops the unconditional insert policy it replaces', () => {
    // A DROP that silently matched nothing would leave the permissive policy
    // live beside the new one, and permissive policies combine with OR.
    expect(readMigration()).toContain('DROP POLICY IF EXISTS "System can insert notifications" ON public.notifications;');
  });

  it('precedes every CREATE POLICY with a DROP IF EXISTS of its own name', () => {
    // "Just re-run it" is the documented recovery for a partial apply; it is
    // only true when each CREATE drops its OWN name first.
    const sql = stripComments(readMigration());
    for (const policy of policies(sql)) {
      const at = sql.indexOf(`CREATE POLICY "${policy.name}"`);
      expect(at, `${policy.name} has no CREATE statement`).toBeGreaterThan(-1);
      expect(sql.slice(0, at)).toContain(`DROP POLICY IF EXISTS "${policy.name}" ON public.notifications;`);
    }
  });
});

describe('announcements migration — the insert policy', () => {
  it('never uses an unconditional WITH CHECK', () => {
    for (const policy of policies(readMigration())) {
      expect(policy.withCheck, `${policy.name}`).not.toMatch(/WITH CHECK \(true\)/i);
    }
  });

  it('scopes the insert to the caller church', () => {
    const policy = policyByName('Staff can insert church notifications');
    expect(policy).toBeDefined();
    expect(policy!.withCheck).toMatch(/church_id = get_user_church_id\(\)/);
  });

  it('gates the insert on an active admin or coordinator', () => {
    // The staff predicate, matching requireStaff (admin | coordinator) and the
    // is_active convention every other hardened policy carries.
    const policy = policyByName('Staff can insert church notifications');
    expect(policy!.withCheck).toMatch(/u\.role IN \('admin', 'coordinator'\)/);
    expect(policy!.withCheck).toContain('u.is_active');
    expect(policy!.withCheck).toMatch(/u\.auth_id = \(SELECT auth\.uid\(\)\)/);
  });
});

describe('announcements migration — the read and update policies', () => {
  it('scopes SELECT to the caller own rows in the caller church', () => {
    const policy = policyByName('Users can view their own notifications');
    expect(policy).toBeDefined();
    expect(policy!.using).toMatch(/user_id = \(SELECT id FROM public\.users WHERE auth_id = auth\.uid\(\)\)/);
    expect(policy!.using).toMatch(/church_id = get_user_church_id\(\)/);
  });

  it('gates UPDATE with the same predicate in both USING and WITH CHECK', () => {
    const policy = policyByName('Users can update their own notifications');
    expect(policy).toBeDefined();
    expect(policy!.using).toMatch(/user_id = \(SELECT id FROM public\.users WHERE auth_id = auth\.uid\(\)\)/);
    expect(policy!.using).toMatch(/church_id = get_user_church_id\(\)/);
    expect(policy!.withCheck).toMatch(/user_id = \(SELECT id FROM public\.users WHERE auth_id = auth\.uid\(\)\)/);
    expect(policy!.withCheck).toMatch(/church_id = get_user_church_id\(\)/);
  });
});

describe('announcements migration — schema changes', () => {
  it("widens the type CHECK to include 'announcement'", () => {
    const sql = stripComments(readMigration());
    const constraint = sql.match(/ADD CONSTRAINT notifications_type_check\s+CHECK \(([^;]*?)\);/);
    expect(constraint, 'notifications_type_check is not re-added').not.toBeNull();
    expect(constraint![1]).toContain("'announcement'");
    // The original five values must survive the rewrite.
    for (const type of ['assignment', 'conflict', 'reminder', 'schedule_published', 'availability_reminder']) {
      expect(constraint![1]).toContain(`'${type}'`);
    }
  });

  it('drops whatever check constraint owns the type column, not just the default name', () => {
    // Postgres names an inline column CHECK `notifications_type_check`, but a
    // differently-named constraint would survive a bare DROP IF EXISTS and the
    // narrow check would keep rejecting announcements at insert time.
    const sql = stripComments(readMigration());
    expect(sql).toMatch(/a\.attname = 'type'/);
    expect(sql).toMatch(/c\.contype = 'c'/);
  });

  it('constrains audience_type to the four audience values', () => {
    const sql = stripComments(readMigration());
    const constraint = sql.match(/ADD CONSTRAINT notifications_audience_type_check\s+CHECK \(([^;]*?)\);/);
    expect(constraint, 'notifications_audience_type_check is not added').not.toBeNull();
    for (const value of ['church', 'ministry', 'role', 'members']) {
      expect(constraint![1]).toContain(`'${value}'`);
    }
    // NULL stays legal so pre-announcement rows (and non-announcement types)
    // are not forced to invent an audience.
    expect(constraint![1]).toContain('audience_type IS NULL');
  });

  it('records the author as a soft reference, not a cascading one', () => {
    // created_by must survive the deletion of the author's account: an
    // announcement history that loses its attribution on user cleanup is worse
    // than NULL.
    expect(stripComments(readMigration())).toMatch(
      /ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public\.users\(id\) ON DELETE SET NULL/,
    );
  });

  it('adds the shared announcement_id and the per-recipient dismissed_at', () => {
    // announcement_id is one uuid per broadcast fan-out: the staff DELETE
    // targets it, so it must be NOT NULL and shared, never per-recipient.
    // dismissed_at is the soft remove: a timestamp, never a row deletion.
    const sql = stripComments(readMigration());
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS announcement_id UUID NOT NULL DEFAULT gen_random_uuid\(\)/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ/);
    // The delete fans out on announcement_id, so it needs its own index or a
    // broadcast delete degrades to a sequential scan.
    expect(sql).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_notifications_announcement\s+ON public\.notifications \(announcement_id\)/,
    );
    // Removal must stay possible through the granted UPDATE privilege.
    expect(sql).toContain('GRANT SELECT, UPDATE ON public.notifications TO authenticated;');
  });
});

describe('announcements migration — privilege hygiene', () => {
  it('revokes everything from anon and authenticated, then grants back only read and update', () => {
    const sql = stripComments(readMigration());
    expect(sql).toContain('REVOKE ALL ON public.notifications FROM anon, authenticated;');
    expect(sql).toContain('GRANT SELECT, UPDATE ON public.notifications TO authenticated;');
    expect(sql).not.toMatch(/GRANT\s+(?:ALL|INSERT|DELETE|TRUNCATE)[^;]*notifications[^;]*TO\s+(?:anon|authenticated)/);
  });

  it('keeps the feed index on the shape the panel actually queries', () => {
    expect(stripComments(readMigration())).toMatch(
      /CREATE INDEX IF NOT EXISTS idx_notifications_user_feed\s+ON public\.notifications \(user_id, created_at DESC\)/,
    );
  });
});
