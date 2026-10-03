import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests for the member-workspace read model.
 *
 * `getMemberProfile` runs through the service-role client, which BYPASSES RLS, so
 * the scoping that protects a member is entirely in the query built here. These
 * tests assert the query itself: which table, which equality filters, and that the
 * embedded FKs are qualified. A dropped `.eq(...)` is a live cross-church defect,
 * and it is invisible to a route-level test.
 */

const getAdminClient = vi.fn();

vi.mock('@/lib/auth/server', () => ({
  getAdminClient: () => getAdminClient(),
}));

const { getMemberProfile } = await import('./member-workspace');

const context = {
  authId: 'auth-1', userId: 'user-1', memberId: 'member-1', churchId: 'church-1',
  fullName: 'Zed', memberName: 'Zed', phone: null, role: 'member' as const,
};

type Call = { table: string; op: string; arg: unknown[] };

/**
 * A PostgrestBuilder stand-in. The chain is a Promise carrying the builder methods,
 * so `.select().eq().eq()` resolves the same way the real client does -- awaiting a
 * plain object instead would silently yield no `data`.
 *
 * `results` is a queue, one entry per `.from()` call.
 */
function makeClient(results: Array<Record<string, unknown>>) {
  const calls: Call[] = [];
  let index = 0;
  getAdminClient.mockReturnValue({
    from(table: string) {
      const result = results[Math.min(index, results.length - 1)] ?? {};
      index += 1;
      const chain = Promise.resolve(result) as unknown as Record<string, unknown>;
      const methods = ['select', 'eq', 'neq', 'in', 'gte', 'gt', 'lte', 'order', 'limit', 'overrideTypes'];
      for (const op of methods) {
        chain[op] = (...args: unknown[]) => {
          calls.push({ table, op, arg: args });
          return chain;
        };
      }
      chain.maybeSingle = () => Promise.resolve(result);
      chain.single = () => Promise.resolve(result);
      return chain;
    },
  });
  return calls;
}

const eqArg = (calls: Call[], table: string, column: string) => {
  const found = calls.find((call) => call.table === table && call.op === 'eq' && call.arg[0] === column);
  return found ? found.arg[1] : undefined;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getMemberProfile — tenant scoping and truthful fallbacks', () => {
  const PROFILE = { id: 'member-1', full_name: 'Zed', phone: null, roles: [], skills: [] };

  it('scopes the member read to the church as well as the id', async () => {
    // Without this eq a member id from another church resolves, because the
    // service-role client bypasses the members RLS policy.
    const calls = makeClient([{ data: PROFILE }]);

    await getMemberProfile(context, 'member-1');

    expect(eqArg(calls, 'members', 'church_id')).toBe('church-1');
    expect(eqArg(calls, 'members', 'id')).toBe('member-1');
  });

  it('qualifies the member_skills embed because it has two foreign keys to members', async () => {
    // Unqualified, PostgREST fails the whole query with PGRST201 and the profile
    // silently comes back empty.
    const calls = makeClient([{ data: PROFILE }]);

    await getMemberProfile(context, 'member-1');

    const select = String(calls.find((call) => call.op === 'select')?.arg[0]);
    expect(select).toContain('member_skills!member_skills_member_id_fkey');
    expect(select).toContain('member_roles!member_roles_member_id_fkey');
  });

  it('returns null when the member cannot be read', async () => {
    makeClient([{ data: null, error: { message: 'not found' } }]);

    await expect(getMemberProfile(context, 'member-1')).resolves.toBeNull();
  });

  it('keeps the account role separate from the ministry roles', async () => {
    // Issue #38 asked for the real role instead of a hardcoded string. The account
    // role is 'member' for every member, so rendering it as a role would print
    // the word "member".
    makeClient([{
      data: {
        ...PROFILE,
        roles: [{ skill_level: 'advanced', is_preferred: true, role: { name: 'Worship Leader' } }],
        skills: [],
      },
    }]);

    const profile = await getMemberProfile(context, 'member-1');

    expect(profile?.accountRole).toBe('member');
    expect(profile?.ministryRoles).toEqual(['Worship Leader']);
  });

  it('reads instruments from member_skills', async () => {
    makeClient([{
      data: {
        ...PROFILE,
        roles: [],
        skills: [{ skill_level: 'expert', is_primary: true, instrument: { name: 'Guitar 1' } }],
      },
    }]);

    const profile = await getMemberProfile(context, 'member-1');

    expect(profile?.instruments).toEqual(['Guitar 1']);
  });

  it('drops a role row whose role was deleted rather than rendering a blank chip', async () => {
    makeClient([{ data: { ...PROFILE, roles: [{ skill_level: 'beginner', is_preferred: false, role: null }], skills: [] } }]);

    const profile = await getMemberProfile(context, 'member-1');

    expect(profile?.ministryRoles).toEqual([]);
  });

  it('ignores coordination columns without dropping or blanking the row', async () => {
    // The embeds select `*`, so columns arrive that this read model does not read.
    // Unrecognised or unwanted values must not affect the name that IS rendered.
    // skill_level, is_primary and is_preferred are deliberately not exposed: a
    // proficiency rating would have to be invented when unset, is_primary
    // DEFAULT TRUE would badge nearly every instrument, and all three are
    // scheduling inputs rather than self-description.
    makeClient([{
      data: {
        ...PROFILE,
        roles: [{ skill_level: 'godlike', is_preferred: true, role: { name: 'Backup' } }],
        skills: [{ skill_level: null, is_primary: true, instrument: { name: 'Bass' } }],
      },
    }]);

    const profile = await getMemberProfile(context, 'member-1');

    expect(profile?.ministryRoles).toEqual(['Backup']);
    expect(profile?.instruments).toEqual(['Bass']);
  });

  it('never leaks an unread coordination column into the response', async () => {
    makeClient([{
      data: {
        ...PROFILE,
        roles: [{ skill_level: 'advanced', is_preferred: true, role: { name: 'Worship Leader' } }],
        skills: [{ skill_level: 'expert', is_primary: true, instrument: { name: 'Guitar 1' } }],
      },
    }]);

    const profile = await getMemberProfile(context, 'member-1');

    // Names only. A future edit that reintroduces one of these flags fails here.
    expect(profile).toEqual({
      memberId: 'member-1',
      fullName: 'Zed',
      phone: null,
      accountRole: 'member',
      ministryRoles: ['Worship Leader'],
      instruments: ['Guitar 1'],
    });
  });

  it('returns an empty list rather than undefined when the embeds are absent', async () => {
    // PostgREST omits an embed key entirely when there are no child rows, so this
    // is the shape a member with no roles actually returns.
    makeClient([{ data: { id: 'member-1', full_name: 'Zed', phone: null } }]);

    const profile = await getMemberProfile(context, 'member-1');

    expect(profile?.ministryRoles).toEqual([]);
    expect(profile?.instruments).toEqual([]);
  });
});
