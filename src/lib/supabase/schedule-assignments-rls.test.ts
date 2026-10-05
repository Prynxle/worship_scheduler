import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Pins for 20261002120000_schedule_assignments_member_rls.
 *
 * `schedule_assignments` is read by a BROWSER client on the member path, using the
 * anon/authenticated key, so RLS is the only enforcement point -- the application's
 * `requireStaff` route guards do not apply to a direct PostgREST query. These pins
 * therefore assert on the SQL text itself; no unit test in `src` can execute a
 * policy.
 *
 * Assertions are on PROPERTIES rather than on incidental spelling wherever the
 * regression is a dropped conjunct or a widened scope. Each pin below is
 * mutation-confirmed: reverting the named statement, weakening the predicate, or
 * widening the scope fails exactly the corresponding test.
 *
 * The pins that matter most are the OR-leak ones. PostgreSQL combines permissive
 * policies with OR, so a correct-looking new SELECT policy is worthless if a
 * church-wide FOR ALL policy survives beside it. A fix that touches only the
 * SELECT policy fails "no unguarded policy can admit SELECT" below.
 */

type Policy = {
  name: string;
  command: string;
  using: string;
  withCheck: string;
};

function readMigration(): string {
  return readFileSync(
    fileURLToPath(new URL('../../../supabase/migrations/20261002120000_schedule_assignments_member_rls.sql', import.meta.url)),
    'utf8',
  );
}

/**
 * Drops SQL comments. Required before parsing: this migration documents its own
 * compensating SQL in the header, and a commented-out CREATE POLICY would
 * otherwise be counted as a live policy -- which is how the OR-leak pin came to
 * depend on a parser that cannot tell prose from DDL.
 *
 * The migration contains no `--` inside a string literal, so cutting each line at
 * its first `--` is safe here and is pinned by the two-policy count below.
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

/** The migration's header comment, as prose with the `--` markers removed. */
function headerComment(): string {
  const sql = readMigration();
  return sql
    .slice(0, sql.indexOf('-- WHY THIS IS NEEDED'))
    .split('\n')
    .map((line) => line.replace(/^\s*--\s?/, ''))
    .join('\n');
}

/** Every CREATE POLICY statement this migration adds against schedule_assignments. */
function policies(sql: string): Policy[] {
  const statements = stripComments(sql).match(/CREATE POLICY[\s\S]*?;/g) ?? [];
  return statements.map((statement) => {
    const normalized = statement.replace(/\s+/g, ' ');
    const name = statement.match(/CREATE POLICY\s+"([^"]+)"/)?.[1] ?? '';
    const command = statement.match(/ON\s+schedule_assignments\s+FOR\s+([A-Z]+)/)?.[1] ?? '';
    const usingAt = statement.indexOf('USING (');
    const checkAt = statement.indexOf('WITH CHECK (');
    const using = usingAt === -1
      ? ''
      : statement.slice(usingAt, checkAt === -1 ? statement.lastIndexOf(';') : checkAt).replace(/\s+/g, ' ');
    const withCheck = checkAt === -1 ? '' : statement.slice(checkAt, statement.lastIndexOf(';')).replace(/\s+/g, ' ');
    return { name, command, using, withCheck, text: normalized } as Policy & { text: string };
  });
}

const selectPolicy = () => policies(readMigration()).find((policy) => policy.command === 'SELECT');
const managePolicy = () => policies(readMigration()).find((policy) => policy.command === 'ALL');

/**
 * The church scope every policy on this table must carry. A policy without it is
 * a cross-tenant read regardless of what its role branch says.
 */
const CHURCH_SCOPE = /service_id IN \( SELECT id FROM services WHERE church_id = get_user_church_id\(\) \)/;

/** The staff predicate, matching requireStaff (admin | coordinator, active only). */
const STAFF_PREDICATE = /u\.auth_id = \(SELECT auth\.uid\(\)\) AND u\.church_id = get_user_church_id\(\) AND u\.role IN \('admin', 'coordinator'\) AND u\.is_active/;

describe('schedule_assignments member RLS migration — policy set', () => {
  it('creates exactly two policies, and drops the two it replaces', () => {
    const sql = readMigration();
    const created = policies(sql);

    expect(created).toHaveLength(2);
    expect(created.map((policy) => policy.command).sort()).toEqual(['ALL', 'SELECT']);

    // Both originals are dropped by name. A DROP IF EXISTS that silently matched
    // nothing would leave the old church-wide predicate live and selectable.
    expect(sql).toContain('DROP POLICY IF EXISTS "Users can view assignments in their church" ON schedule_assignments;');
    expect(sql).toContain('DROP POLICY IF EXISTS "Admins can manage assignments in their church" ON schedule_assignments;');
  });

  it('leaves no policy on the table that can admit SELECT without a role or an identity check', () => {
    // THE OR-LEAK PIN. Permissive policies combine with OR, and FOR ALL covers
    // SELECT. Before this migration the FOR ALL policy named "Admins can manage
    // assignments in their church" carried the same church-wide predicate as the
    // SELECT policy and checked no role at all, so every member of a church could
    // read every assignment in it. Replacing only the SELECT policy leaves that
    // one in place and this fix does nothing.
    for (const policy of policies(readMigration())) {
      expect(policy.using, `${policy.name} admits SELECT with no role or identity gate`).toMatch(STAFF_PREDICATE);
    }
  });

  it('keeps every policy scoped to the caller church', () => {
    for (const policy of policies(readMigration())) {
      expect(policy.using, `${policy.name} is not church-scoped`).toMatch(CHURCH_SCOPE);
      // WITH CHECK governs the row being written, so it needs the same scope as USING.
      if (policy.command === 'ALL') expect(policy.withCheck).toMatch(CHURCH_SCOPE);
    }
  });

  it('never opens the table to anon or writes to authenticated', () => {
    const sql = readMigration();

    // GRANT ALL ON ALL TABLES TO anon ran in 20260727213700_rls_policies.sql, and
    // a later replay of the same grant would undo any narrowing. The signed-out
    // path and the direct-write path are pinned separately because they are
    // separate mistakes.
    expect(sql).toContain('REVOKE INSERT, UPDATE, DELETE ON schedule_assignments FROM anon, authenticated;');
    expect(sql).toContain('GRANT SELECT ON schedule_assignments TO authenticated;');
    expect(sql).toContain('REVOKE ALL ON schedule_assignments FROM anon;');

    // The FOR ALL policy would otherwise be a complete privilege escalation for a
    // member: with INSERT granted, a member could write their own assignment onto
    // a published service and read it back through the member branch.
    expect(sql).not.toMatch(/GRANT\s+(?:ALL|INSERT|UPDATE|DELETE)[^;]*schedule_assignments[^;]*TO\s+(?:anon|authenticated)/);
  });

  it('uses an explicit WITH CHECK, never an unconditional one', () => {
    // `WITH CHECK (true)` is what the notifications insert policy still carries in
    // 20260727213700_rls_policies.sql:244-246. On a FOR ALL policy that grants
    // write access it would let a caller insert a row for any church.
    for (const policy of policies(readMigration())) {
      expect(policy.withCheck).not.toMatch(/WITH CHECK \(true\)/i);
    }
  });
});

describe('schedule_assignments member RLS migration — the member read branch', () => {
  it('scopes the member branch to the caller own rows', () => {
    // Without the member_id conjunct a member reads the whole church's lineup:
    // who leads, who is on keys, and who is unavailable.
    const policy = selectPolicy();
    expect(policy).toBeDefined();
    expect(policy!.using).toMatch(/JOIN public\.members m ON m\.user_id = u\.id WHERE u\.auth_id = \(SELECT auth\.uid\(\)\) AND m\.id = schedule_assignments\.member_id/);
  });

  it('gates the member branch on the service being published', () => {
    // The `services` SELECT policy was already narrowed to published-only in
    // 20260928084433_scheduler_workflow_hardening.sql:168-181, but a policy on one
    // table does not constrain a subquery in another table's policy. Hiding the
    // service row achieves nothing while the assignment row stays readable, so
    // the status is re-tested here against the assignment's own service_id.
    const policy = selectPolicy();
    expect(policy!.using).toMatch(/SELECT 1 FROM public\.services s WHERE s\.id = schedule_assignments\.service_id AND s\.status = 'published'/);
  });

  it('does not trust the services policy for the publication gate', () => {
    // If this regresses to reading visibility through services alone, the gate
    // silently depends on a policy that does not apply in this scope.
    const memberBranch = selectPolicy()!.using.slice(selectPolicy()!.using.indexOf('JOIN public.members'));
    expect(memberBranch).toContain("s.status = 'published'");
    expect(memberBranch).not.toMatch(/EXISTS \( SELECT 1 FROM services WHERE id = schedule_assignments\.service_id \)/);
  });
});

describe('schedule_assignments member RLS migration — the staff read branch', () => {
  it('does not publication-gate staff, so drafts stay reachable', () => {
    // The converse regression. Copying the published conjunct onto the staff
    // branch would lock coordinators out of the very drafts they are about to
    // validate and publish, and would do it silently: the page would simply render
    // as though the month had nothing scheduled.
    const policy = selectPolicy();
    const staffBranch = policy!.using.slice(policy!.using.indexOf('SELECT 1 FROM public.users u'), policy!.using.indexOf('OR ('));
    expect(staffBranch).toMatch(STAFF_PREDICATE);
    expect(staffBranch).not.toContain("status = 'published'");
  });

  it('gates the manage policy on the same staff predicate as the read policy', () => {
    // The manage policy was originally named "Admins can manage assignments in
    // their church" and checked no role whatsoever. It is the same predicate as
    // the read branch so a coordinator is not silently demoted by one policy and
    // promoted by the other.
    const policy = managePolicy();
    expect(policy).toBeDefined();
    expect(policy!.using).toMatch(STAFF_PREDICATE);
    expect(policy!.withCheck).toMatch(STAFF_PREDICATE);
  });

  it('excludes inactive staff from the manage policy', () => {
    // Deactivating a user is a revocation in every other policy on this schema;
    // omitting `is_active` here would make a deactivated coordinator the single
    // account that could still write assignments.
    expect(managePolicy()!.using).toContain('u.is_active');
    expect(managePolicy()!.withCheck).toContain('u.is_active');
  });
});

/**
 * The truth table these pins encode, modelled in JS because SQL cannot run here.
 * The live equivalent is exercised against the database inside BEGIN/ROLLBACK.
 *
 * The two rows marked (*) are the defects this migration exists to close.
 */
describe('schedule_assignments member RLS migration — intended read matrix', () => {
  const canRead = (actor: 'member' | 'coordinator' | 'admin' | 'inactive_staff' | 'anon', callerMemberId: string | null, rowMemberId: string, serviceStatus: string, sameChurch = true) => {
    if (!sameChurch) return false;
    if (actor === 'admin') return true;
    if (actor === 'coordinator') return true;
    if (actor === 'inactive_staff') return false;
    if (actor === 'anon') return false;
    return callerMemberId === rowMemberId && serviceStatus === 'published';
  };

  it.each([
    ['a member reading their own assignment on a published service', 'member', 'm1', 'm1', 'published', true],
    ['(*) a member reading ANOTHER member assignment on a published service', 'member', 'm1', 'm2', 'published', false],
    ['(*) a member reading their own assignment on a DRAFT service', 'member', 'm1', 'm1', 'draft', false],
    ['(*) a member reading their own assignment on a VALIDATED service', 'member', 'm1', 'm1', 'validated', false],
    ['a member reading their own assignment on an ARCHIVED service', 'member', 'm1', 'm1', 'archived', false],
    ['a coordinator reading any assignment on a draft service', 'coordinator', 'm1', 'm2', 'draft', true],
    ['an admin reading any assignment on a validated service', 'admin', 'm1', 'm2', 'validated', true],
  ])('%s', (_label, actor, callerMemberId, rowMemberId, status, expected) => {
    expect(canRead(actor as never, callerMemberId, rowMemberId, status)).toBe(expected);
  });

  it('a member or a signed-out caller is denied across every church boundary', () => {
    for (const status of ['draft', 'validated', 'published', 'archived']) {
      expect(canRead('member', 'm1', 'm1', status, false)).toBe(false);
      expect(canRead('anon', null, 'm1', status, false)).toBe(false);
    }
  });
});

/**
 * The documented recovery for a failed or half-applied run is "re-run the file".
 * That advice is only safe if the file is genuinely re-runnable, so it is pinned
 * rather than asserted in prose.
 */
describe('schedule_assignments member RLS migration — re-runnability', () => {
  it('precedes every CREATE POLICY with a DROP IF EXISTS for that same name', () => {
    // The partial-apply failure mode: statements run one at a time outside a
    // transaction, stopping between a DROP and its CREATE, leaves the table with
    // RLS on and no permissive SELECT policy, so every client reads zero rows.
    // "Just re-run it" is the recovery, and it is only true if each CREATE drops
    // its OWN name first -- not merely the legacy name it replaces. Dropping only
    // the old name leaves a second run failing on "policy already exists", which
    // is exactly the moment the operator is under pressure.
    const sql = stripComments(readMigration());
    for (const policy of policies(sql)) {
      const at = sql.indexOf(`CREATE POLICY "${policy.name}"`);
      expect(at, `${policy.name} has no CREATE statement`).toBeGreaterThan(-1);
      const preceding = sql.slice(0, at);
      expect(preceding).toContain(`DROP POLICY IF EXISTS "${policy.name}" ON schedule_assignments;`);
      // The legacy name must still be dropped, or the policy being replaced
      // survives and the permissive OR defeats this migration.
      expect(preceding).toMatch(/DROP POLICY IF EXISTS "(?:Users can view assignments in their church|Admins can manage assignments in their church)" ON schedule_assignments;/);
    }
  });

  it('counts only executable statements, so the header\'s SQL is never treated as policy', () => {
    // The compensating statements in the header are two more CREATE POLICY
    // bodies. A parser that counted them would report four live policies and the
    // OR-leak pin would be asserting against prose.
    expect(policies(readMigration())).toHaveLength(2);
  });

  it('contains no data or schema DDL, only policy and privilege statements', () => {
    // Re-running the file must not duplicate rows or drop anything. If a future
    // edit adds a DELETE or a DROP TABLE, "just re-run it" stops being advice and
    // becomes a second data-loss event. GRANT/REVOKE lines are excluded first
    // because REVOKE INSERT, UPDATE, DELETE is privilege DDL and is required here.
    const executable = stripComments(readMigration())
      .split('\n')
      .filter((line) => !/^\s*(?:GRANT|REVOKE)\b/i.test(line))
      .join('\n');
    expect(executable).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP\s+TABLE|ALTER\s+TABLE|CREATE\s+TABLE)\b/i);
  });

  it('states the three recovery paths in the header so the operator has them', () => {
    // A rollback note nobody can find is not a rollback note.
    const header = headerComment();
    expect(header).toContain('Rollback');
    expect(header).toContain('re-run this file');
    expect(header).toContain('Widen the member branch in a new forward migration');
    expect(header).toContain('FULL REVERT');
  });

  it('warns that the full revert re-opens the disclosure', () => {
    // The compensating SQL restores a policy that lets every member of a church
    // read every assignment in it. Presenting that without the warning would make
    // a security regression look like a clean undo.
    const header = headerComment();
    expect(header).toMatch(/re-introduces two live defects on purpose/i);
    expect(header).toMatch(/draft and\s+validated services/i);
  });

  it('keeps the compensating SQL from re-granting writes', () => {
    // A revert of the read policies must not undo the write boundary: with writes
    // granted and reads church-wide, a member could INSERT their own row and read
    // it back. The header says so; this pins that the SQL it hands the operator
    // does not itself contain a write-granting statement.
    expect(headerComment()).not.toMatch(/GRANT\s+(?:ALL|INSERT|UPDATE|DELETE)[^;]*schedule_assignments[^;]*TO\s+(?:anon|authenticated)/);
  });
});