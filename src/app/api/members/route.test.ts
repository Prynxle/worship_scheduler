import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Route contract tests for /api/members.
 *
 * Modelled on src/app/api/availability/reset/route.test.ts: collaborators are
 * mocked and only observable behaviour is asserted -- auth passthrough, tenant
 * scoping, input validation, the unique-login-name conflict, and the
 * compensating delete that prevents a half-created member.
 */

const requireStaff = vi.fn();

vi.mock('@/lib/auth/server', () => ({
  requireStaff: (request: Request) => requireStaff(request),
  getAdminClient: () => buildClient(),
}));

const { GET, POST } = await import('./route');

const auth = {
  authId: 'auth-1', userId: 'user-1', memberId: 'member-1', churchId: 'church-1',
  fullName: 'Zed', memberName: 'Zed', phone: null, role: 'coordinator' as const,
};

const ROLE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ROLE_ID = '22222222-2222-4222-8222-222222222222';
const INSTRUMENT_ID = '33333333-3333-4333-8333-333333333333';
const MINISTRY_ID = '44444444-4444-4444-8444-444444444444';

type Call = { op: string; args: unknown[] };
type Result = { data?: unknown; error?: unknown };
type Handler = (calls: Call[]) => Result;

const lastCall = (calls: Call[], op: string) => [...calls].reverse().find((call) => call.op === op);

/**
 * Chainable PostgREST double. `then` makes the builder awaitable so the route
 * can `await query`, and `single()` resolves the same result for `.insert()
 * .select().single()` chains.
 */
function builder(table: string, handler: Handler) {
  const calls: Call[] = [{ op: 'from', args: [table] }];
  const self: Record<string, unknown> = {
    calls,
    select: (...args: unknown[]) => { calls.push({ op: 'select', args }); return self; },
    eq: (...args: unknown[]) => { calls.push({ op: 'eq', args }); return self; },
    in: (...args: unknown[]) => { calls.push({ op: 'in', args }); return self; },
    order: (...args: unknown[]) => { calls.push({ op: 'order', args }); return self; },
    insert: (...args: unknown[]) => { calls.push({ op: 'insert', args }); return self; },
    delete: (...args: unknown[]) => { calls.push({ op: 'delete', args }); return self; },
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
      return builder(table, handler);
    },
  };
}

function track(table: string, result: Result) {
  handlers[table] = () => result;
}

/** Records every builder the route opens so tests can assert on the chain. */
function spyTable(table: string, result: Result = { data: [], error: null }) {
  handlers[table] = (calls) => {
    clientCalls.push(calls);
    return result;
  };
}

function get(url: string): never {
  return { url: new URL(url).toString() } as never;
}

function post(body: unknown): never {
  return new Request('https://app.test/api/members', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as never;
}

/** Every call recorded on the builders opened for one table. */
function flattened(table: string): Call[] {
  return clientCalls
    .filter((calls) => calls[0]?.op === 'from' && calls[0].args[0] === table)
    .flat();
}

beforeEach(() => {
  vi.clearAllMocks();
  clientCalls = [];
  handlers = {};
  requireStaff.mockResolvedValue(auth);
  spyTable('ministries', { data: [{ id: MINISTRY_ID }], error: null });
  spyTable('roles', { data: [{ id: ROLE_ID }], error: null });
  spyTable('instruments', { data: [{ id: INSTRUMENT_ID }], error: null });
  spyTable('member_roles');
  spyTable('member_skills');
  // The members table serves three shapes: the awaited list from GET, the
  // single inserted row, and the joined single row re-read after the children
  // are written. Distinguish them by the terminal op on the chain.
  handlers['members'] = (calls) => {
    clientCalls.push(calls);
    if (lastCall(calls, 'insert')) return { data: { id: 'member-99', full_name: 'New Person' }, error: null };
    if (lastCall(calls, 'single')) return { data: { id: 'member-1', full_name: 'Existing Person' }, error: null };
    return { data: [{ id: 'member-1', full_name: 'Existing Person' }], error: null };
  };
});

describe('GET /api/members — auth and tenant scope', () => {
  it('returns the requireStaff rejection untouched and never opens a client', async () => {
    const denied = Response.json({ error: 'Forbidden' }, { status: 403 });
    requireStaff.mockResolvedValue(denied);

    const response = await GET(get('https://app.test/api/members'));

    expect(response).toBe(denied);
    expect(clientCalls).toHaveLength(0);
  });

  it('scopes the query to the authenticated church', async () => {
    await GET(get('https://app.test/api/members'));

    const members = flattened('members');
    expect(lastCall(members, 'eq')?.args).toEqual(['church_id', 'church-1']);
  });

  it('never reads a client-provided tenant id', async () => {
    await GET(get('https://app.test/api/members?church_id=church-evil'));

    const members = flattened('members');
    expect(members.filter((call) => call.op === 'eq' && call.args[0] === 'church_id')).toHaveLength(1);
    expect(JSON.stringify(members)).not.toContain('church-evil');
  });

  it('embeds roles and instruments so the member cards can render them', async () => {
    await GET(get('https://app.test/api/members'));

    const select = lastCall(flattened('members'), 'select')?.args[0] as string;
    expect(select).toContain('role:roles(');
    expect(select).toContain('instrument:instruments(');
  });

  it('pins the foreign key on both embeds', async () => {
    // `member_skills` references `members` twice (member_id and
    // fallback_member_id). Dropping the hint makes PostgREST reject the query
    // with PGRST201, which the page shows as an empty roster with no way to
    // tell a schema error from a church with no members.
    await GET(get('https://app.test/api/members'));

    const select = lastCall(flattened('members'), 'select')?.args[0] as string;
    expect(select).toContain('roles:member_roles!member_roles_member_id_fkey(');
    expect(select).toContain('skills:member_skills!member_skills_member_id_fkey(');
  });

  it('orders by full name', async () => {
    await GET(get('https://app.test/api/members'));

    expect(lastCall(flattened('members'), 'order')?.args).toEqual(['full_name']);
  });

  it.each(['active', 'inactive'])('applies the %s status filter', async (status) => {
    await GET(get(`https://app.test/api/members?status=${status}`));

    expect(lastCall(flattened('members'), 'eq')?.args).toEqual(['status', status]);
  });

  it('ignores an unsupported status value instead of forwarding it', async () => {
    await GET(get('https://app.test/api/members?status=deleted'));

    const members = flattened('members');
    expect(members.some((call) => call.op === 'eq' && call.args[0] === 'status')).toBe(false);
  });

  it('returns 500 when the query fails', async () => {
    track('members', { data: null, error: { message: 'boom' } });

    const response = await GET(get('https://app.test/api/members'));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Could not load members.' });
  });
});

describe('POST /api/members — auth', () => {
  it('returns the requireStaff rejection untouched and never opens a client', async () => {
    const denied = Response.json({ error: 'Forbidden' }, { status: 403 });
    requireStaff.mockResolvedValue(denied);

    const response = await POST(post({ full_name: 'A', login_name: 'a' }));

    expect(response).toBe(denied);
    expect(clientCalls).toHaveLength(0);
  });
});

describe('POST /api/members — validation', () => {
  it('rejects a missing full name before touching the database', async () => {
    const response = await POST(post({ login_name: 'zed' }));

    expect(response.status).toBe(400);
    expect(clientCalls).toHaveLength(0);
  });

  it('rejects a missing login name before touching the database', async () => {
    const response = await POST(post({ full_name: 'Zedrick Paul' }));

    expect(response.status).toBe(400);
    expect(clientCalls).toHaveLength(0);
  });

  it('rejects a whitespace-only login name', async () => {
    const response = await POST(post({ full_name: 'Zedrick Paul', login_name: '   ' }));

    expect(response.status).toBe(400);
  });

  it('rejects an over-long login name', async () => {
    const response = await POST(post({ full_name: 'Zed', login_name: 'a'.repeat(101) }));

    expect(response.status).toBe(400);
  });

  it('rejects malformed JSON with a 400 rather than a 500', async () => {
    const response = await POST(post('{not json'));

    expect(response.status).toBe(400);
  });

  it('rejects a gender outside the allowed set', async () => {
    const response = await POST(post({ full_name: 'Zed', login_name: 'zed', gender: 'other-ish' }));

    expect(response.status).toBe(400);
  });

  it('accepts an omitted gender and stores it as null', async () => {
    const response = await POST(post({ full_name: 'Zed', login_name: 'zed' }));

    expect(response.status).toBe(201);
    const insert = lastCall(flattened('members'), 'insert')?.args[0] as Record<string, unknown>;
    expect(insert.gender).toBeNull();
  });

  it('rejects role ids that are not UUIDs', async () => {
    const response = await POST(post({ full_name: 'Zed', login_name: 'zed', role_ids: ['not-a-uuid'] }));

    expect(response.status).toBe(400);
  });

  it('rejects a non-array roles payload', async () => {
    const response = await POST(post({ full_name: 'Zed', login_name: 'zed', role_ids: ROLE_ID }));

    expect(response.status).toBe(400);
  });
});

describe('POST /api/members — login name', () => {
  it('lowercases and trims the login name before storing it', async () => {
    await POST(post({ full_name: 'Zedrick Paul', login_name: '  ZedRICK  ' }));

    const insert = lastCall(flattened('members'), 'insert')?.args[0] as Record<string, unknown>;
    expect(insert.login_name).toBe('zedrick');
  });

  it('takes the church from the auth context, never from the body', async () => {
    await POST(post({ full_name: 'Zed', login_name: 'zed', church_id: 'church-evil' }));

    const insert = lastCall(flattened('members'), 'insert')?.args[0] as Record<string, unknown>;
    expect(insert.church_id).toBe('church-1');
  });

  it('returns 409 naming the login name on a unique violation', async () => {
    handlers['members'] = (calls) =>
      lastCall(calls, 'insert') ? { data: null, error: { code: '23505' } } : { data: [], error: null };

    const response = await POST(post({ full_name: 'Zed', login_name: 'Zed' }));

    expect(response.status).toBe(409);
    const payload = (await response.json()) as { error: string };
    expect(payload.error).toContain('zed');
  });

  it('does not attempt a compensating delete when the member insert itself failed', async () => {
    handlers['members'] = (calls) =>
      lastCall(calls, 'insert') ? { data: null, error: { code: '23505' } } : { data: [], error: null };

    await POST(post({ full_name: 'Zed', login_name: 'zed' }));

    expect(lastCall(flattened('members'), 'delete')).toBeUndefined();
  });
});

describe('POST /api/members — cross-tenant protection', () => {
  it('rejects a role that belongs to another church before writing anything', async () => {
    track('roles', { data: [], error: null });

    const response = await POST(post({ full_name: 'Zed', login_name: 'zed', role_ids: [ROLE_ID] }));

    expect(response.status).toBe(400);
    expect(lastCall(flattened('members'), 'insert')).toBeUndefined();
  });

  it('rejects an instrument that belongs to another church before writing anything', async () => {
    track('instruments', { data: [], error: null });

    const response = await POST(post({ full_name: 'Zed', login_name: 'zed', instrument_ids: [INSTRUMENT_ID] }));

    expect(response.status).toBe(400);
    expect(lastCall(flattened('members'), 'insert')).toBeUndefined();
  });

  it('restricts the role lookup to this church’s ministries', async () => {
    await POST(post({ full_name: 'Zed', login_name: 'zed', role_ids: [ROLE_ID] }));

    const roles = flattened('roles');
    expect(lastCall(roles, 'in')?.args).toEqual(['ministry_id', [MINISTRY_ID]]);
    expect(lastCall(roles, 'eq')?.args).toEqual(['is_active', true]);
  });

  it('rejects the request when the church has no ministries at all', async () => {
    track('ministries', { data: [], error: null });

    const response = await POST(post({ full_name: 'Zed', login_name: 'zed', role_ids: [ROLE_ID] }));

    expect(response.status).toBe(400);
    expect(lastCall(flattened('members'), 'insert')).toBeUndefined();
  });
});

describe('POST /api/members — role and instrument persistence', () => {
  it('writes one member_roles row per selected role', async () => {
    handlers['roles'] = () => ({ data: [{ id: ROLE_ID }, { id: OTHER_ROLE_ID }], error: null });

    const response = await POST(post({ full_name: 'Zed', login_name: 'zed', role_ids: [ROLE_ID, OTHER_ROLE_ID] }));

    expect(response.status).toBe(201);
    expect(lastCall(flattened('member_roles'), 'insert')?.args[0]).toEqual([
      { member_id: 'member-99', role_id: ROLE_ID },
      { member_id: 'member-99', role_id: OTHER_ROLE_ID },
    ]);
  });

  it('writes one member_skills row per selected instrument', async () => {
    const response = await POST(post({ full_name: 'Zed', login_name: 'zed', instrument_ids: [INSTRUMENT_ID] }));

    expect(response.status).toBe(201);
    expect(lastCall(flattened('member_skills'), 'insert')?.args[0]).toEqual([
      { member_id: 'member-99', instrument_id: INSTRUMENT_ID },
    ]);
  });

  it('skips both child inserts when nothing is selected', async () => {
    const response = await POST(post({ full_name: 'Zed', login_name: 'zed' }));

    expect(response.status).toBe(201);
    expect(flattened('member_roles')).toHaveLength(0);
    expect(flattened('member_skills')).toHaveLength(0);
  });

  it('collapses duplicate selections instead of violating the child unique key', async () => {
    handlers['roles'] = () => ({ data: [{ id: ROLE_ID }], error: null });

    const response = await POST(post({ full_name: 'Zed', login_name: 'zed', role_ids: [ROLE_ID, ROLE_ID] }));

    expect(response.status).toBe(201);
    expect(lastCall(flattened('member_roles'), 'insert')?.args[0]).toEqual([
      { member_id: 'member-99', role_id: ROLE_ID },
    ]);
  });

  it('returns the new member through the same joined select the list route uses', async () => {
    const response = await POST(post({ full_name: 'Zed', login_name: 'zed' }));

    expect(response.status).toBe(201);
    const payload = (await response.json()) as { member: { id: string } };
    expect(payload.member.id).toBe('member-1');
    const select = lastCall(flattened('members'), 'select')?.args[0] as string;
    expect(select).toContain('roles:member_roles!member_roles_member_id_fkey(');
    expect(select).toContain('skills:member_skills!member_skills_member_id_fkey(');
  });
});

describe('POST /api/members — compensating delete', () => {
  it('deletes the member row when the role insert fails', async () => {
    track('member_roles', { data: null, error: { message: 'boom' } });

    const response = await POST(post({ full_name: 'Zed', login_name: 'zed', role_ids: [ROLE_ID] }));

    expect(response.status).toBe(500);
    expect(lastCall(flattened('members'), 'eq')?.args).toEqual(['id', 'member-99']);
  });

  it('deletes the member row when the instrument insert fails', async () => {
    track('member_skills', { data: null, error: { message: 'boom' } });

    const response = await POST(post({ full_name: 'Zed', login_name: 'zed', instrument_ids: [INSTRUMENT_ID] }));

    expect(response.status).toBe(500);
    expect(lastCall(flattened('members'), 'eq')?.args).toEqual(['id', 'member-99']);
  });

  it('does not write member_skills after the role insert already failed', async () => {
    track('member_roles', { data: null, error: { message: 'boom' } });

    await POST(post({
      full_name: 'Zed', login_name: 'zed',
      role_ids: [ROLE_ID], instrument_ids: [INSTRUMENT_ID],
    }));

    expect(flattened('member_skills')).toHaveLength(0);
  });
});
