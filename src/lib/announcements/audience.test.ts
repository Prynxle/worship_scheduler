import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AudienceError, parseAudienceSpec, resolveAudience, type AudienceSpec } from './audience';

const CHURCH_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const MINISTRY_ID = '44444444-4444-4444-8444-444444444444';
const MEMBER_ID_A = '11111111-1111-4111-8111-111111111111';
const MEMBER_ID_B = '22222222-2222-4222-8222-222222222222';

type Call = { op: string; args: unknown[] };
type Result = { data?: unknown; error?: { message: string } | null; count?: number | null };
type TableHandler = (calls: Call[]) => Result;

/**
 * Chainable PostgREST double. Every query method records its call and returns
 * the same builder; awaiting the builder resolves the table handler, which
 * lets tests assert on the exact chain a lookup built.
 */
function client(handlers: Record<string, TableHandler>): SupabaseClient {
  const from = (table: string) => {
    const calls: Call[] = [{ op: 'from', args: [table] }];
    const self: Record<string, unknown> = {
      calls,
      select: (...args: unknown[]) => { calls.push({ op: 'select', args }); return self; },
      eq: (...args: unknown[]) => { calls.push({ op: 'eq', args }); return self; },
      in: (...args: unknown[]) => { calls.push({ op: 'in', args }); return self; },
      not: (...args: unknown[]) => { calls.push({ op: 'not', args }); return self; },
      maybeSingle: () => { calls.push({ op: 'maybeSingle', args: [] }); return self; },
      then: (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) => {
        const handler = handlers[table] ?? (() => ({ data: [], error: null }));
        return Promise.resolve(handler(calls)).then(resolve, reject);
      },
    };
    return self;
  };
  return { from } as unknown as SupabaseClient;
}

const opsOf = (calls: Call[], op: string) => calls.filter((call) => call.op === op);
const lastEq = (calls: Call[], column: string) =>
  [...calls].reverse().find((call) => call.op === 'eq' && call.args[0] === column);

describe('parseAudienceSpec', () => {
  it('accepts the bare church audience', () => {
    expect(parseAudienceSpec({ type: 'church' })).toEqual({ type: 'church' });
  });

  it('accepts a ministry audience with a uuid ministry id', () => {
    expect(parseAudienceSpec({ type: 'ministry', ministry_id: MINISTRY_ID }))
      .toEqual({ type: 'ministry', ministry_id: MINISTRY_ID });
  });

  it('rejects a ministry audience without a uuid', () => {
    expect(parseAudienceSpec({ type: 'ministry', ministry_id: 'not-a-uuid' })).toBeNull();
    expect(parseAudienceSpec({ type: 'ministry' })).toBeNull();
  });

  it('accepts only the three app roles', () => {
    expect(parseAudienceSpec({ type: 'role', role: 'coordinator' })).toEqual({ type: 'role', role: 'coordinator' });
    expect(parseAudienceSpec({ type: 'role', role: 'worship-leader' })).toBeNull();
    expect(parseAudienceSpec({ type: 'role' })).toBeNull();
  });

  it('deduplicates named member ids', () => {
    expect(parseAudienceSpec({ type: 'members', member_ids: [MEMBER_ID_A, MEMBER_ID_A, MEMBER_ID_B] }))
      .toEqual({ type: 'members', member_ids: [MEMBER_ID_A, MEMBER_ID_B] });
  });

  it('rejects an empty, non-array, or malformed member list', () => {
    expect(parseAudienceSpec({ type: 'members', member_ids: [] })).toBeNull();
    expect(parseAudienceSpec({ type: 'members', member_ids: MEMBER_ID_A })).toBeNull();
    expect(parseAudienceSpec({ type: 'members', member_ids: [42] })).toBeNull();
  });

  it('rejects unknown audiences and non-object payloads', () => {
    expect(parseAudienceSpec({ type: 'everyone' })).toBeNull();
    expect(parseAudienceSpec('church')).toBeNull();
    expect(parseAudienceSpec(null)).toBeNull();
    expect(parseAudienceSpec([{ type: 'church' }])).toBeNull();
  });
});

describe('resolveAudience — church audience', () => {
  it('unions active members with every coordinator, then filters to active users in this church', async () => {
    const calls: Record<string, Call[]> = {};
    const admin = client({
      members: (chain) => {
        calls.members = chain;
        return { data: [{ user_id: 'user-2' }, { user_id: 'user-3' }, { user_id: 'user-2' }] };
      },
      users: (chain) => {
        if (lastEq(chain, 'role')) {
          calls.roleQuery = chain;
          // A coordinator with no members row must still receive the broadcast.
          return { data: [{ id: 'user-9' }] };
        }
        calls.users = chain;
        return { data: [{ id: 'user-2' }, { id: 'user-3' }, { id: 'user-9' }] };
      },
    });

    const recipients = await resolveAudience(admin, CHURCH_ID, { type: 'church' });

    expect(recipients).toEqual(['user-2', 'user-3', 'user-9']);
    expect(lastEq(calls.members, 'church_id')?.args).toEqual(['church_id', CHURCH_ID]);
    expect(lastEq(calls.members, 'status')?.args).toEqual(['status', 'active']);
    expect(opsOf(calls.members, 'not')[0]?.args).toEqual(['user_id', 'is', null]);

    // The coordinator lookup is scoped like every other account query: this
    // church, active accounts, exactly the coordinator role.
    expect(lastEq(calls.roleQuery, 'role')?.args).toEqual(['role', 'coordinator']);
    expect(lastEq(calls.roleQuery, 'church_id')?.args).toEqual(['church_id', CHURCH_ID]);
    expect(lastEq(calls.roleQuery, 'is_active')?.args).toEqual(['is_active', true]);

    // The final filter is the tenant boundary: nothing survives it without an
    // active account in the caller's own church -- coordinator ids included.
    expect(lastEq(calls.users, 'church_id')?.args).toEqual(['church_id', CHURCH_ID]);
    expect(lastEq(calls.users, 'is_active')?.args).toEqual(['is_active', true]);
    const inCall = opsOf(calls.users, 'in')[0];
    expect(inCall?.args[0]).toBe('id');
    expect(inCall?.args[1]).toEqual(['user-2', 'user-3', 'user-9']);
  });

  it('still reaches coordinators when the roster has no active members', async () => {
    const admin = client({
      members: () => ({ data: [] }),
      users: () => ({ data: [{ id: 'user-9' }] }),
    });

    await expect(resolveAudience(admin, CHURCH_ID, { type: 'church' }))
      .resolves.toEqual(['user-9']);
  });

  it('throws a 400 when the church has no active members and no coordinators', async () => {
    const admin = client({ members: () => ({ data: [] }) });

    await expect(resolveAudience(admin, CHURCH_ID, { type: 'church' }))
      .rejects.toMatchObject({ name: 'AudienceError', status: 400 });
  });

  it('surfaces a failed lookup as a 500, not as an empty broadcast', async () => {
    const admin = client({ members: () => ({ data: null, error: { message: 'boom' } }) });

    await expect(resolveAudience(admin, CHURCH_ID, { type: 'church' }))
      .rejects.toMatchObject({ status: 500 });
  });

  it('returns nobody when every candidate user has been deactivated', async () => {
    const admin = client({
      members: () => ({ data: [{ user_id: 'user-2' }] }),
      users: () => ({ data: [] }),
    });

    await expect(resolveAudience(admin, CHURCH_ID, { type: 'church' }))
      .rejects.toMatchObject({ status: 400, message: 'The selected audience has no recipients.' });
  });
});

describe('resolveAudience — ministry audience', () => {
  const spec: AudienceSpec = { type: 'ministry', ministry_id: MINISTRY_ID };

  it('rejects a ministry that belongs to another church before touching any role data', async () => {
    const opened: string[] = [];
    const admin = client({
      ministries: (chain) => {
        opened.push('ministries');
        expect(lastEq(chain, 'church_id')?.args).toEqual(['church_id', CHURCH_ID]);
        // The ministry exists, but not in this church, so the scoped lookup
        // returns nothing and resolution stops here.
        return { data: null, error: null };
      },
      roles: () => { opened.push('roles'); return { data: [] }; },
    });

    await expect(resolveAudience(admin, CHURCH_ID, spec))
      .rejects.toMatchObject({ name: 'AudienceError', status: 400 });
    expect(opened).toEqual(['ministries']);
  });

  it('walks roles → member_roles → members, re-scoping members to this church', async () => {
    const calls: Record<string, Call[]> = {};
    const admin = client({
      ministries: () => ({ data: { id: MINISTRY_ID } }),
      roles: (chain) => {
        calls.roles = chain;
        return { data: [{ id: 'role-1' }, { id: 'role-2' }] };
      },
      member_roles: (chain) => {
        calls.member_roles = chain;
        return { data: [{ member_id: MEMBER_ID_A }, { member_id: MEMBER_ID_B }, { member_id: MEMBER_ID_A }] };
      },
      members: (chain) => {
        calls.members = chain;
        return { data: [{ user_id: 'user-9' }] };
      },
      users: () => ({ data: [{ id: 'user-9' }] }),
    });

    const recipients = await resolveAudience(admin, CHURCH_ID, spec);

    expect(recipients).toEqual(['user-9']);
    expect(opsOf(calls.roles, 'eq').some((call) => call.args[1] === true)).toBe(true);
    expect(opsOf(calls.member_roles, 'in')[0]?.args).toEqual(['role_id', ['role-1', 'role-2']]);
    expect(lastEq(calls.members, 'church_id')?.args).toEqual(['church_id', CHURCH_ID]);
    expect(opsOf(calls.members, 'in')[0]?.args).toEqual(['id', [MEMBER_ID_A, MEMBER_ID_B]]);
  });

  it('rejects a ministry with no active roles instead of broadcasting to nobody', async () => {
    const admin = client({
      ministries: () => ({ data: { id: MINISTRY_ID } }),
      roles: () => ({ data: [] }),
    });

    await expect(resolveAudience(admin, CHURCH_ID, spec))
      .rejects.toMatchObject({ status: 400, message: 'That ministry has no active roles, so no one would receive this.' });
  });

  it('rejects a ministry nobody is assigned to', async () => {
    const admin = client({
      ministries: () => ({ data: { id: MINISTRY_ID } }),
      roles: () => ({ data: [{ id: 'role-1' }] }),
      member_roles: () => ({ data: [] }),
    });

    await expect(resolveAudience(admin, CHURCH_ID, spec))
      .rejects.toMatchObject({ status: 400 });
  });
});

describe('resolveAudience — role audience', () => {
  it('selects active accounts of that app role within the church', async () => {
    const chains: Call[][] = [];
    const admin = client({
      users: (chain) => {
        chains.push(chain);
        return { data: [{ id: 'user-7' }] };
      },
    });

    const recipients = await resolveAudience(admin, CHURCH_ID, { type: 'role', role: 'coordinator' });

    expect(recipients).toEqual(['user-7']);
    expect(chains).toHaveLength(2);
    expect(lastEq(chains[0], 'role')?.args).toEqual(['role', 'coordinator']);
    expect(lastEq(chains[0], 'is_active')?.args).toEqual(['is_active', true]);
    expect(lastEq(chains[0], 'church_id')?.args).toEqual(['church_id', CHURCH_ID]);
    // The second query is the shared active-account filter every audience
    // passes through, scoped to the same church; it never carries the
    // whole-church coordinator union.
    expect(opsOf(chains[1], 'in')[0]?.args[0]).toBe('id');
    expect(lastEq(chains[1], 'church_id')?.args).toEqual(['church_id', CHURCH_ID]);
    expect(lastEq(chains[1], 'role')).toBeUndefined();
  });
});

describe('resolveAudience — named members audience', () => {
  it('rejects a non-uuid member id without opening a client', async () => {
    let opened = false;
    const admin = client({
      members: () => { opened = true; return { data: [] }; },
    });

    await expect(resolveAudience(admin, CHURCH_ID, { type: 'members', member_ids: ['not-a-uuid'] }))
      .rejects.toMatchObject({ status: 400 });
    expect(opened).toBe(false);
  });

  it('rejects when any named member is missing, inactive, or from another church', async () => {
    const admin = client({
      // Only one of the two requested members comes back: the other is either
      // inactive, unknown, or in a different tenant. All three are the same
      // rejection from the caller's point of view.
      members: () => ({ data: [{ id: MEMBER_ID_A, user_id: 'user-1' }] }),
    });

    await expect(resolveAudience(admin, CHURCH_ID, { type: 'members', member_ids: [MEMBER_ID_A, MEMBER_ID_B] }))
      .rejects.toMatchObject({ status: 400 });
  });

  it('scopes the membership lookup to the caller church', async () => {
    const calls: Record<string, Call[]> = {};
    const admin = client({
      members: (chain) => {
        calls.members = chain;
        return { data: [{ id: MEMBER_ID_A, user_id: 'user-1' }] };
      },
      users: () => ({ data: [{ id: 'user-1' }] }),
    });

    await expect(resolveAudience(admin, CHURCH_ID, { type: 'members', member_ids: [MEMBER_ID_A] }))
      .resolves.toEqual(['user-1']);

    expect(lastEq(calls.members, 'church_id')?.args).toEqual(['church_id', CHURCH_ID]);
    expect(lastEq(calls.members, 'status')?.args).toEqual(['status', 'active']);
  });

  it('drops members with no linked user account and reports an empty audience', async () => {
    const admin = client({
      members: () => ({ data: [{ id: MEMBER_ID_A, user_id: null }] }),
    });

    await expect(resolveAudience(admin, CHURCH_ID, { type: 'members', member_ids: [MEMBER_ID_A] }))
      .rejects.toMatchObject({ status: 400, message: 'The selected audience has no recipients.' });
  });
});

describe('AudienceError', () => {
  it('defaults to a 400 so route validation never answers 500 by accident', () => {
    expect(new AudienceError('nope').status).toBe(400);
    expect(new AudienceError('boom', 500).status).toBe(500);
  });
});
