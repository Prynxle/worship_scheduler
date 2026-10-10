import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Route-level contract tests for the workflow-native mock-unavailability tool.
 *
 * The collaborators are mocked and only observable behaviour is asserted:
 * auth passthrough, body parsing, month/year resolution, tenant scoping, the
 * member/qualification loads, the single RPC call and its arguments, the
 * SQLSTATE -> HTTP mapping, and the response shape. No assertion here reads
 * `route.ts` source text.
 *
 * `@/lib/utils/date-utils` is deliberately NOT mocked. The current-month
 * default is the behaviour under test, so the real clock is the only honest
 * oracle; the date tests pin it with `vi.setSystemTime` and assert the values
 * the route derives from it.
 */

const requireStaff = vi.fn();
const getAdminClient = vi.fn();
const planMockUnavailability = vi.fn();
const soleQualifiedMemberIds = vi.fn();
const buildMockSubmissionEntries = vi.fn();
const from = vi.fn();
const rpc = vi.fn();

vi.mock('@/lib/auth/server', () => ({
  requireStaff: (request: Request) => requireStaff(request),
  getAdminClient: () => getAdminClient(),
}));

vi.mock('@/lib/scheduling/mock-unavailability', () => ({
  planMockUnavailability: (
    members: unknown, month: number, year: number, excluded: ReadonlySet<string>
  ) => planMockUnavailability(members, month, year, excluded),
  soleQualifiedMemberIds: (input: unknown) => soleQualifiedMemberIds(input),
  buildMockSubmissionEntries: (
    members: unknown, month: number, year: number, excluded: ReadonlySet<string>
  ) => buildMockSubmissionEntries(members, month, year, excluded),
}));

const { POST } = await import('./route');

const auth = {
  authId: 'auth-1', userId: 'user-1', memberId: 'member-1', churchId: 'church-1',
  fullName: 'Zed', memberName: 'Zed', phone: null, role: 'admin' as const,
};

const members = [
  { id: 'm-1', full_name: 'A' },
  { id: 'm-2', full_name: 'B' },
];

/** The plan the stubbed planner hands back: one row per member for March 2026. */
const planned = [
  { member_id: 'm-1', month: 2, year: 2026, week_number: 1 },
  { member_id: 'm-2', month: 2, year: 2026, week_number: 2 },
];

/** The entries the stubbed builder hands back for the RPC payload. */
const entries = [
  { member_id: 'm-1', week_number: 1 },
  { member_id: 'm-2', week_number: 2 },
];

/** What the RPC resolves to on success. */
const counts = {
  submissions_created: 2,
  entries_added: 2,
  empty_submissions: 0,
  skipped_members: [] as string[],
  deleted_legacy: 3,
};

type Recorded = { op: string; args: unknown[] };

type Responses = {
  select?: { data?: unknown; error?: unknown };
};

/**
 * The same chainable Supabase query-builder double the previous suite used:
 * each `.from()` call hands back a fresh builder whose terminal op selects
 * the response it resolves to, so one chain's filters can never leak into
 * another's. The `rpc` double sits alongside it on the same client double.
 */
function createTable(name: string, responses: Responses) {
  const calls: Recorded[] = [];
  const chains: Recorded[][] = [];

  function newBuilder(): Record<string, unknown> {
    const chain: Recorded[] = [];
    chains.push(chain);
    const builder: Record<string, unknown> = {};
    const methods = [
      'select', 'insert', 'update', 'upsert', 'delete', 'eq', 'neq', 'in', 'not',
      'like', 'ilike', 'gte', 'lte', 'is', 'or', 'filter', 'order', 'limit',
      'range', 'overrideTypes', 'single', 'maybeSingle',
    ];
    for (const method of methods) {
      builder[method] = (...args: unknown[]) => {
        const record = { op: method, args };
        chain.push(record);
        calls.push(record);
        return builder;
      };
    }
    builder.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (e: unknown) => unknown) => {
      return Promise.resolve(responses.select ?? {}).then(onFulfilled, onRejected);
    };
    return builder;
  }

  return { name, calls, chains, newBuilder };
}

type Table = ReturnType<typeof createTable>;

let tables: Map<string, Table>;

function table(name: string): Table {
  const found = tables.get(name);
  if (!found) throw new Error(`No mock table registered for "${name}"`);
  return found;
}

/** Every call the route made against `name`, across all chains, in order. */
function tableCalls(name: string): Recorded[] {
  return table(name).calls;
}

type RpcResult = { data?: unknown; error?: unknown };

/** `admin.rpc(...)` returns a thenable; the route awaits it directly. */
function resolveRpc(result: RpcResult) {
  rpc.mockReturnValue(Promise.resolve(result));
}

function resetClients() {
  tables = new Map([
    ['members', createTable('members', { select: { data: members, error: null } })],
    ['member_roles', createTable('member_roles', { select: { data: [], error: null } })],
    ['member_skills', createTable('member_skills', { select: { data: [], error: null } })],
  ]);
  from.mockImplementation((name: string) => tables.get(name)?.newBuilder());
  getAdminClient.mockReturnValue({
    from,
    rpc: (name: string, args: unknown) => rpc(name, args),
  });
  resolveRpc({ data: counts, error: null });
}

function post(body: unknown): Request {
  return new Request('https://app.test/api/schedule/mock-unavailability', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetClients();
  requireStaff.mockResolvedValue(auth);
  soleQualifiedMemberIds.mockReturnValue(new Set<string>());
  planMockUnavailability.mockReturnValue(planned);
  buildMockSubmissionEntries.mockReturnValue(entries);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('POST /api/schedule/mock-unavailability — auth', () => {
  it('returns the requireStaff rejection untouched and writes nothing', async () => {
    // requireStaff resolves to a Response for unauthenticated and non-staff
    // callers alike; the route must return that response verbatim and must not
    // reach the admin client.
    const denied = Response.json({ error: 'Forbidden' }, { status: 403 });
    requireStaff.mockResolvedValue(denied);

    const response = await POST(post({ month: 2, year: 2026 }) as never);

    // Identity, not just shape: the route must hand back the auth layer's own
    // Response rather than re-wrapping it into a generic error of its own.
    expect(response).toBe(denied);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' });
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated caller with 401 before any database access', async () => {
    requireStaff.mockResolvedValue(Response.json({ error: 'Unauthorized' }, { status: 401 }));

    const response = await POST(post({}) as never);

    expect(response.status).toBe(401);
    expect(getAdminClient).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('POST /api/schedule/mock-unavailability — tenant and actor scoping', () => {
  it('takes church_id from auth only, never from the request body', async () => {
    const response = await POST(post({ month: 2, year: 2026, church_id: 'attacker-church' }) as never);

    expect(response.status).toBe(201);
    // The member load is scoped to the authenticated church ...
    expect(tableCalls('members')).toContainEqual({ op: 'eq', args: ['church_id', 'church-1'] });
    // ... and so is the RPC; the body-supplied tenant is inert.
    const [, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(args.p_church_id).toBe('church-1');
    expect(JSON.stringify(args)).not.toContain('attacker-church');
  });

  it('takes p_actor_id from the session user id, never from the body', async () => {
    await POST(post({
      month: 2, year: 2026,
      userId: 'attacker-user', actor_id: 'attacker-user', p_actor_id: 'attacker-user', p_church_id: 'attacker-church',
    }) as never);

    const [, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(args.p_actor_id).toBe('user-1');
    expect(args.p_church_id).toBe('church-1');
    expect(JSON.stringify(args)).not.toContain('attacker-user');
  });
});

describe('POST /api/schedule/mock-unavailability — body parsing', () => {
  it.each([
    ['malformed JSON', '{not json', 'Request body must be valid JSON.'],
    ['a JSON array', '[]', 'Request body must be an object.'],
    ['a JSON null', 'null', 'Request body must be an object.'],
    ['a JSON string', '"nope"', 'Request body must be an object.'],
    ['a JSON number', '5', 'Request body must be an object.'],
  ])('returns 400 for %s and never reads the database', async (_label, raw, message) => {
    const response = await POST(post(raw) as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: message });
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('accepts a whitespace-only body as an empty object', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 18, 10, 0, 0));

    const response = await POST(post('   ') as never);

    expect(response.status).toBe(201);
    expect(planMockUnavailability).toHaveBeenCalledWith(members, 2, 2026, new Set());
  });
});

describe('POST /api/schedule/mock-unavailability — month and year validation', () => {
  it.each([
    ['a month above 11', { month: 12, year: 2026 }, 'Month must be between 0 and 11.'],
    ['a negative month', { month: -1, year: 2026 }, 'Month must be between 0 and 11.'],
    ['a non-integer month', { month: 1.5, year: 2026 }, 'Month and year must be whole numbers.'],
    ['a non-numeric month', { month: '3', year: 2026 }, 'Month and year must be whole numbers.'],
    ['a null month', { month: null, year: 2026 }, 'Month and year must be whole numbers.'],
    ['a year below 2000', { month: 2, year: 1999 }, 'Year must be between 2000 and 2100.'],
    ['a year above 2100', { month: 2, year: 2101 }, 'Year must be between 2000 and 2100.'],
    ['a non-integer year', { month: 2, year: 2026.5 }, 'Month and year must be whole numbers.'],
    ['a non-numeric year', { month: 2, year: '2026' }, 'Month and year must be whole numbers.'],
  ])('returns 400 for %s and never reaches the database', async (_label, body, message) => {
    const response = await POST(post(body) as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: message });
    expect(getAdminClient).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['the lower bounds', { month: 0, year: 2000 }],
    ['the upper bounds', { month: 11, year: 2100 }],
  ])('accepts %s inclusively', async (_label, body) => {
    const response = await POST(post(body) as never);

    expect(response.status).toBe(201);
    expect(planMockUnavailability).toHaveBeenCalledWith(members, body.month, body.year, new Set());
    expect(rpc).toHaveBeenCalledWith('mock_month_availability', expect.objectContaining({
      p_month: body.month, p_year: body.year,
    }));
  });
});

describe('POST /api/schedule/mock-unavailability — month resolution', () => {
  it('defaults to the current month from the system clock, not a hardcoded literal', async () => {
    // The regression this guards: the route used to hardcode
    // `DEFAULT_MONTH = 9` / `DEFAULT_YEAR = 2026` (the October 2026 test run).
    // Pinning the clock to March 2026 makes 2/2026 an independent expectation:
    // a re-introduced literal of 9/2026 fails here.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 18, 10, 0, 0));

    const response = await POST(post({}) as never);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ month: 2, year: 2026 });
    // The planner receives the clock-derived month, not the old literal ...
    expect(planMockUnavailability).toHaveBeenCalledWith(members, 2, 2026, new Set());
    // ... and so does the RPC.
    expect(rpc).toHaveBeenCalledWith('mock_month_availability', expect.objectContaining({
      p_month: 2, p_year: 2026,
    }));
  });

  it('tracks the clock across the 0-indexed year boundary', async () => {
    // 0-indexed month: December is 11, not 12. A 1-indexed mix-up would report
    // month 12 here and be rejected by the 0..11 range check.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 11, 25, 9, 0, 0));

    const response = await POST(post({}) as never);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ month: 11, year: 2026 });
  });

  it('tracks the clock into the next year', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2027, 0, 4, 9, 0, 0));

    const response = await POST(post({}) as never);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ month: 0, year: 2027 });
  });

  it('honours an explicit { month, year } override instead of the clock', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 18, 10, 0, 0));

    const response = await POST(post({ month: 6, year: 2027 }) as never);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ month: 6, year: 2027 });
    expect(planMockUnavailability).toHaveBeenCalledWith(members, 6, 2027, new Set());
  });

  it('takes month and year independently when only one is supplied', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 18, 10, 0, 0));

    await POST(post({ month: 7 }) as never);
    expect(planMockUnavailability).toHaveBeenLastCalledWith(members, 7, 2026, new Set());

    await POST(post({ year: 2031 }) as never);
    expect(planMockUnavailability).toHaveBeenLastCalledWith(members, 2, 2031, new Set());
  });
});

describe('POST /api/schedule/mock-unavailability — the single RPC write', () => {
  it('calls mock_month_availability once with session-scoped ids, the month, the reason, and the built entries', async () => {
    const response = await POST(post({ month: 2, year: 2026 }) as never);

    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('mock_month_availability', {
      p_church_id: 'church-1',
      p_actor_id: 'user-1',
      p_month: 2,
      p_year: 2026,
      p_reason: 'Mock unavailability (March 2026 test)',
      p_entries: entries,
    });
  });

  it('never issues a direct availability delete or insert: the RPC owns the write', async () => {
    await POST(post({ month: 2, year: 2026 }) as never);

    // The self-healing DELETE and the per-record insert loop are gone; the
    // only tables the route still reads are the roster and qualifications.
    expect(tables.has('availability')).toBe(false);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('builds p_entries for ALL active members, excluded sole-qualified members included', async () => {
    soleQualifiedMemberIds.mockReturnValue(new Set(['m-1']));

    await POST(post({ month: 2, year: 2026 }) as never);

    // The exclusion set reaches both the planner (for the reported records)
    // and the entries builder (for the RPC payload) ...
    expect(planMockUnavailability).toHaveBeenCalledWith(members, 2, 2026, new Set(['m-1']));
    expect(buildMockSubmissionEntries).toHaveBeenCalledWith(members, 2, 2026, new Set(['m-1']));
    // ... and the builder's output -- not the filtered plan -- is what the RPC
    // receives, so excluded members still get an empty submission.
    const [, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(args.p_entries).toBe(entries);
  });

  it('returns 500 when member qualifications cannot be loaded and never calls the RPC', async () => {
    tables.set('member_roles', createTable('member_roles', { select: { error: { message: 'boom' } } }));

    const response = await POST(post({ month: 2, year: 2026 }) as never);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Could not load member qualifications.' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns 500 when the active member roster cannot be loaded and never calls the RPC', async () => {
    tables.set('members', createTable('members', { select: { error: { message: 'boom' } } }));

    const response = await POST(post({ month: 2, year: 2026 }) as never);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Could not load members.' });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('POST /api/schedule/mock-unavailability — SQLSTATE mapping', () => {
  const leak = 'Coordinator authorization could not be verified at users_pkey on (e1ee) for church 0000';
  const mapped: Array<[string, number, string]> = [
    ['22023', 400, 'invalid_parameter_value'],
    ['42501', 403, 'insufficient_privilege'],
    ['23505', 409, 'unique_violation'],
    ['40P01', 503, 'deadlock_detected'],
  ];

  it.each(mapped)('maps %s to %i %s without disclosing the driver message', async (sqlstate, status, code) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    resolveRpc({ data: null, error: { code: sqlstate, message: leak, details: null, hint: null } });

    const response = await POST(post({ month: 2, year: 2026 }) as never);
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(status);
    expect(body).toMatchObject({ code });
    expect(JSON.stringify(body)).not.toContain(leak);
    expect(JSON.stringify(body)).not.toContain('users_pkey');
  });

  it('fails closed with an opaque 500 and a request id for an unmapped SQLSTATE', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    resolveRpc({ data: null, error: { code: 'P0001', message: 'plpgsql: internal detail about a table' } });

    const response = await POST(post({ month: 2, year: 2026 }) as never);
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(500);
    expect(body).toMatchObject({ code: 'internal_error' });
    expect(typeof body.request_id).toBe('string');
    expect(JSON.stringify(body)).not.toContain('plpgsql');
  });

  it('never reports a success it cannot account for when the RPC returns no result', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    resolveRpc({ data: null, error: null });

    const response = await POST(post({ month: 2, year: 2026 }) as never);

    // The RPC is atomic and always returns one jsonb object, so a missing
    // result is a defect. A silent 201 would let a repeat click read as done.
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ code: 'internal_error' });
  });
});

describe('POST /api/schedule/mock-unavailability — success shape', () => {
  it('maps the RPC counts onto the backward-compatible keys plus the new fields', async () => {
    resolveRpc({
      data: {
        submissions_created: 2,
        entries_added: 2,
        empty_submissions: 1,
        skipped_members: ['m-9'],
        deleted_legacy: 3,
      },
      error: null,
    });

    const response = await POST(post({ month: 2, year: 2026 }) as never);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({
      success: true,
      // Backward-compatible keys, mapped from the RPC result: `skipped` counts
      // the members whose own submission governs the month, and `deleted`
      // counts the legacy rows the RPC stamped 'rejected'.
      added: 2,
      skipped: 1,
      deleted: 3,
      submissions_created: 2,
      empty_submissions: 1,
      skipped_members: ['m-9'],
      excluded_sole_qualified: [],
      total_members: 2,
      month: 2,
      year: 2026,
      records: planned,
    });
  });

  it('defaults non-numeric RPC counts to 0 so the response never carries NaN', async () => {
    resolveRpc({ data: { skipped_members: 'not-an-array' }, error: null });

    const response = await POST(post({ month: 2, year: 2026 }) as never);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      added: 0,
      skipped: 0,
      deleted: 0,
      submissions_created: 0,
      empty_submissions: 0,
      skipped_members: [],
    });
  });

  it('lists the excluded sole-qualified members, sorted for determinism', async () => {
    soleQualifiedMemberIds.mockReturnValue(new Set(['m-2', 'm-1']));

    const response = await POST(post({ month: 2, year: 2026 }) as never);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ excluded_sole_qualified: ['m-1', 'm-2'] });
  });
});
