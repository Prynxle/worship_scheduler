import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Route contract tests for PATCH /api/members/[id].
 *
 * Follows src/app/api/members/route.test.ts: collaborators are mocked and only
 * observable behaviour is asserted. The behaviours that matter here and are not
 * covered by the POST tests are:
 *
 *   - the edit is scoped by church_id, so another church's member is a 404
 *   - a duplicate login name is a 409, not a 500
 *   - a failed child write is rolled back rather than left half-applied
 */

const requireStaff = vi.fn();

vi.mock('@/lib/auth/server', () => ({
  requireStaff: (request: Request) => requireStaff(request),
  getAdminClient: () => buildClient(),
}));

const { PATCH } = await import('./route');

const auth = {
  authId: 'auth-1', userId: 'user-1', memberId: 'member-1', churchId: 'church-1',
  fullName: 'Zed', memberName: 'Zed', phone: null, role: 'coordinator' as const,
};

const MEMBER_ID = '55555555-5555-4555-8555-555555555555';
const ROLE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ROLE_ID = '22222222-2222-4222-8222-222222222222';
const INSTRUMENT_ID = '33333333-3333-4333-8333-333333333333';
const MINISTRY_ID = '44444444-4444-4444-8444-444444444444';

type Call = { op: string; args: unknown[] };
type Result = { data?: unknown; error?: unknown };
type Handler = (calls: Call[]) => Result;

const lastCall = (calls: Call[], op: string) => [...calls].reverse().find((call) => call.op === op);

type Builder = Record<string, unknown> & { calls: Call[] };

function builder(table: string, handler: Handler): Builder {
  const calls: Call[] = [{ op: 'from', args: [table] }];
  const self: Builder = {
    calls,
    select: (...args: unknown[]) => { calls.push({ op: 'select', args }); return self; },
    eq: (...args: unknown[]) => { calls.push({ op: 'eq', args }); return self; },
    in: (...args: unknown[]) => { calls.push({ op: 'in', args }); return self; },
    insert: (...args: unknown[]) => { calls.push({ op: 'insert', args }); return self; },
    update: (...args: unknown[]) => { calls.push({ op: 'update', args }); return self; },
    delete: (...args: unknown[]) => { calls.push({ op: 'delete', args }); return self; },
    maybeSingle: (...args: unknown[]) => { calls.push({ op: 'maybeSingle', args }); return self; },
    single: (...args: unknown[]) => { calls.push({ op: 'single', args }); return self; },
    then: (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(handler(calls)).then(resolve, reject),
  };
  return self;
}

let handlers: Record<string, Handler>;
let clientCalls: Call[][];

function buildClient() {
  return {
    from(table: string) {
      const handler = handlers[table] ?? (() => ({ data: [], error: null }));
      const built = builder(table, handler);
      clientCalls.push(built.calls);
      return built;
    },
  };
}

function spy(table: string, result: Result = { data: [], error: null }) {
  handlers[table] = () => result;
}

/** The args of the last `op` recorded on a builder opened for `table`. */
function lastOpArgs(table: string, op: string) {
  const chains = clientCalls.filter(
    (calls) => calls[0]?.op === 'from' && calls[0].args[0] === table && lastCall(calls, op),
  );
  return lastCall(chains[chains.length - 1] ?? [], op)?.args;
}

function hasOp(table: string, op: string) {
  return clientCalls.some(
    (calls) => calls[0]?.op === 'from' && calls[0].args[0] === table && calls.some((call) => call.op === op),
  );
}

function patch(body: unknown, id: string = MEMBER_ID): never {
  return new Request(`https://app.test/api/members/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as never;
}

const context = (id: string = MEMBER_ID) => ({ params: Promise.resolve({ id }) });

const EXISTING = {
  id: MEMBER_ID,
  church_id: 'church-1',
  full_name: 'Zedrick Paul',
  login_name: 'zedrick',
  nickname: 'Zed',
  phone: null,
  gender: 'male',
  status: 'active',
};

beforeEach(() => {
  vi.clearAllMocks();
  clientCalls = [];
  handlers = {};
  requireStaff.mockResolvedValue(auth);
  spy('ministries', { data: [{ id: MINISTRY_ID }], error: null });
  spy('roles', { data: [{ id: ROLE_ID }], error: null });
  spy('instruments', { data: [{ id: INSTRUMENT_ID }], error: null });
  spy('member_roles', { data: [{ role_id: OTHER_ROLE_ID }], error: null });
  spy('member_skills', { data: [{ instrument_id: INSTRUMENT_ID }], error: null });
  handlers['members'] = (calls) => {
    if (lastCall(calls, 'update')) return { data: null, error: null };
    if (lastCall(calls, 'maybeSingle')) return { data: EXISTING, error: null };
    if (lastCall(calls, 'single')) return { data: { ...EXISTING, full_name: 'Renamed' }, error: null };
    return { data: [], error: null };
  };
});

describe('PATCH /api/members/[id] — auth', () => {
  it('passes an auth rejection through untouched', async () => {
    requireStaff.mockResolvedValue(new Response('nope', { status: 403 }));
    const response = await PATCH(patch({ full_name: 'X', login_name: 'x' }), context());
    expect(response.status).toBe(403);
  });
});

describe('PATCH /api/members/[id] — tenant scoping', () => {
  it('scopes the lookup by church_id so another church is a 404', async () => {
    const response = await PATCH(patch({ full_name: 'X', login_name: 'x' }), context());
    expect(response.status).toBe(200);
    // The scoping must be part of the same chain as the id filter.
    expect(lastOpArgs('members', 'eq')).toEqual([expect.any(String), 'church-1']);
  });

  it('returns 404 when the member is not in this church', async () => {
    handlers['members'] = (calls) =>
      lastCall(calls, 'maybeSingle') ? { data: null, error: null } : { data: null, error: null };
    const response = await PATCH(patch({ full_name: 'X', login_name: 'x' }), context());
    expect(response.status).toBe(404);
  });

  it('rejects an id that is not a uuid before touching the database', async () => {
    const response = await PATCH(patch({ full_name: 'X', login_name: 'x' }), context('not-a-uuid'));
    expect(response.status).toBe(404);
    expect(clientCalls).toHaveLength(0);
  });
});

describe('PATCH /api/members/[id] — validation', () => {
  it.each([
    [{ login_name: 'x' }, 'A member name is required.'],
    [{ full_name: 'X' }, 'A login name is required.'],
    [{ full_name: 'X', login_name: 'x', gender: 'nope' }, 'Choose a valid gender.'],
    [{ full_name: 'X', login_name: 'x', status: 'retired' }, 'Choose a valid status.'],
    [{ full_name: 'X', login_name: 'x', role_ids: 'not-a-list' }, 'Roles must be a list of valid identifiers.'],
    [{ full_name: 'X', login_name: 'x', instrument_ids: ['nope'] }, 'Instruments must be a list of valid identifiers.'],
    [{ full_name: 'X', login_name: 'x'.repeat(101) }, 'The login name must be 100 characters or fewer.'],
  ])('rejects %j', async (body, message) => {
    const response = await PATCH(patch(body), context());
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: message });
  });

  it('rejects a malformed body as invalid JSON', async () => {
    const response = await PATCH(patch('{not json'), context());
    expect(response.status).toBe(400);
  });

  it('refuses a role that belongs to another church before any write', async () => {
    spy('roles', { data: [], error: null });
    const response = await PATCH(patch({ full_name: 'X', login_name: 'x', role_ids: [ROLE_ID] }), context());
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: 'One or more selected roles are not available for this church.',
    });
    // Nothing was written.
    expect(lastOpArgs('members', 'update')).toBeUndefined();
  });

  it('refuses an instrument that belongs to another church before any write', async () => {
    spy('instruments', { data: [], error: null });
    const response = await PATCH(patch({ full_name: 'X', login_name: 'x', instrument_ids: [INSTRUMENT_ID] }), context());
    expect(response.status).toBe(400);
    expect(lastOpArgs('members', 'update')).toBeUndefined();
  });
});

describe('PATCH /api/members/[id] — saving', () => {
  it('lowercases the login name, because the sign-in match is case exact', async () => {
    await PATCH(patch({ full_name: 'Zedrick Paul', login_name: '  ZEDRICK  ' }), context());
    expect(lastOpArgs('members', 'update')?.[0]).toMatchObject({ login_name: 'zedrick' });
  });

  it('replaces roles and instruments with exactly what was sent', async () => {
    const response = await PATCH(
      patch({ full_name: 'Zedrick Paul', login_name: 'zedrick', role_ids: [ROLE_ID], instrument_ids: [INSTRUMENT_ID] }),
      context(),
    );
    expect(response.status).toBe(200);
    expect(lastOpArgs('member_roles', 'insert')?.[0]).toEqual([{ member_id: MEMBER_ID, role_id: ROLE_ID }]);
    expect(lastOpArgs('member_skills', 'insert')?.[0]).toEqual([{ member_id: MEMBER_ID, instrument_id: INSTRUMENT_ID }]);
  });

  it('clears roles and instruments when the edit sends empty lists', async () => {
    const response = await PATCH(
      patch({ full_name: 'Zedrick Paul', login_name: 'zedrick', role_ids: [], instrument_ids: [] }),
      context(),
    );
    expect(response.status).toBe(200);
    // The delete must happen, scoped to this member, and no insert should follow it.
    expect(hasOp('member_roles', 'delete')).toBe(true);
    expect(hasOp('member_skills', 'delete')).toBe(true);
    expect(lastOpArgs('member_roles', 'eq')).toEqual(['member_id', MEMBER_ID]);
    expect(lastOpArgs('member_roles', 'insert')).toBeUndefined();
    expect(lastOpArgs('member_skills', 'insert')).toBeUndefined();
  });

  it('keeps skill levels, preferred flags and fallback chains for roles that are retained', async () => {
    // Without this a plain rename would silently demote an advanced player to
    // the 'intermediate' column default and clear their fallback chain.
    handlers['member_roles'] = (calls) =>
      lastCall(calls, 'insert')
        ? { data: null, error: null }
        : { data: [{ role_id: ROLE_ID, skill_level: 'advanced', is_preferred: true }], error: null };
    handlers['member_skills'] = (calls) =>
      lastCall(calls, 'insert')
        ? { data: null, error: null }
        : {
            data: [
              {
                instrument_id: INSTRUMENT_ID,
                skill_level: 'expert',
                is_primary: false,
                fallback_member_id: MEMBER_ID,
              },
            ],
            error: null,
          };

    await PATCH(
      patch({ full_name: 'Renamed', login_name: 'zedrick', role_ids: [ROLE_ID], instrument_ids: [INSTRUMENT_ID] }),
      context(),
    );

    expect(lastOpArgs('member_roles', 'insert')?.[0]).toEqual([
      { member_id: MEMBER_ID, role_id: ROLE_ID, skill_level: 'advanced', is_preferred: true },
    ]);
    expect(lastOpArgs('member_skills', 'insert')?.[0]).toEqual([
      {
        member_id: MEMBER_ID,
        instrument_id: INSTRUMENT_ID,
        skill_level: 'expert',
        is_primary: false,
        fallback_member_id: MEMBER_ID,
      },
    ]);
  });

  it('lets a newly added role take the column defaults rather than copying another role attributes', async () => {
    // Adding a role must not inherit the skill level of a role it has no
    // relationship to.
    handlers['member_roles'] = (calls) =>
      lastCall(calls, 'insert')
        ? { data: null, error: null }
        : { data: [{ role_id: OTHER_ROLE_ID, skill_level: 'advanced', is_preferred: true }], error: null };

    await PATCH(patch({ full_name: 'Renamed', login_name: 'zedrick', role_ids: [ROLE_ID] }), context());

    expect(lastOpArgs('member_roles', 'insert')?.[0]).toEqual([{ member_id: MEMBER_ID, role_id: ROLE_ID }]);
  });

  it('returns the reloaded member so the card updates in place', async () => {
    const response = await PATCH(patch({ full_name: 'Renamed', login_name: 'zedrick' }), context());
    await expect(response.json()).resolves.toMatchObject({ member: { full_name: 'Renamed' } });
  });

  it('reports a duplicate login name as 409', async () => {
    handlers['members'] = (calls) =>
      lastCall(calls, 'update') ? { data: null, error: { code: '23505' } } : { data: EXISTING, error: null };
    const response = await PATCH(patch({ full_name: 'X', login_name: 'taken' }), context());
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: 'The login name "taken" is already used by another member.',
    });
  });
});

describe('PATCH /api/members/[id] — rollback', () => {
  it('restores the member and the old roles when a child write fails', async () => {
    let inserts = 0;
    handlers['member_roles'] = (calls) => {
      if (lastCall(calls, 'insert')) {
        inserts += 1;
        // Fail only the real write, not the restore that follows it.
        return inserts === 1 ? { data: null, error: { message: 'boom' } } : { data: null, error: null };
      }
      return { data: [{ role_id: OTHER_ROLE_ID }], error: null };
    };

    const response = await PATCH(
      patch({ full_name: 'Renamed', login_name: 'zedrick', role_ids: [ROLE_ID] }),
      context(),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Could not assign the selected roles, so no changes were saved.',
    });

    // The parent must be written back to its pre-edit values...
    const updates = clientCalls
      .filter((calls) => lastCall(calls, 'update'))
      .map((calls) => lastCall(calls, 'update')!.args[0] as Record<string, unknown>);
    expect(updates).toHaveLength(2);
    expect(updates[0]).toMatchObject({ full_name: 'Renamed' });
    expect(updates[1]).toMatchObject({ full_name: 'Zedrick Paul', login_name: 'zedrick', nickname: 'Zed' });

    // ...and the original role reinstated, not the one that failed to insert.
    expect(updates[1]).not.toMatchObject({ full_name: 'Renamed' });
    const roleInserts = clientCalls
      .filter((calls) => lastCall(calls, 'insert'))
      .map((calls) => lastCall(calls, 'insert')!.args[0]);
    expect(roleInserts).toContainEqual([{ member_id: MEMBER_ID, role_id: ROLE_ID }]);
    expect(roleInserts).toContainEqual([{ member_id: MEMBER_ID, role_id: OTHER_ROLE_ID }]);
  });

  it('does not write the parent at all when the scope check fails', async () => {
    spy('roles', { data: [], error: null });
    await PATCH(patch({ full_name: 'Renamed', login_name: 'zedrick', role_ids: [ROLE_ID] }), context());
    expect(lastOpArgs('members', 'update')).toBeUndefined();
  });
});
