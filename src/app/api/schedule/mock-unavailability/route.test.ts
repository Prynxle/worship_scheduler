import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Route-level contract tests for the mock-unavailability self-healing tool.
 *
 * These mock the collaborators and assert observable behaviour: auth, body
 * parsing, month/year resolution, tenant scoping, the self-healing DELETE
 * predicate, and the per-record insert loop. No assertion here reads
 * `route.ts` source text.
 *
 * `@/lib/utils/date-utils` is deliberately NOT mocked. The current-month
 * default is the behaviour under test, so the real clock is the only honest
 * oracle; the two date tests pin it with `vi.setSystemTime` and assert the
 * values the route derives from it.
 */

const requireStaff = vi.fn();
const getAdminClient = vi.fn();
const planMockUnavailability = vi.fn();
const soleQualifiedMemberIds = vi.fn();
const from = vi.fn();

vi.mock('@/lib/auth/server', () => ({
  requireStaff: (request: Request) => requireStaff(request),
  getAdminClient: () => getAdminClient(),
}));

vi.mock('@/lib/scheduling/mock-unavailability', () => ({
  planMockUnavailability: (
    members: unknown, month: number, year: number, excluded: ReadonlySet<string>
  ) => planMockUnavailability(members, month, year, excluded),
  soleQualifiedMemberIds: (input: unknown) => soleQualifiedMemberIds(input),
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

type Recorded = { op: string; args: unknown[] };

type Responses = {
  select?: { data?: unknown; error?: unknown };
  delete?: { count?: number | null; error?: unknown };
  insert?: { error?: unknown };
};

/**
 * A chainable Supabase query-builder double. Each `.from()` call hands back a
 * fresh builder, exactly as the real client does, so a chain's terminal op
 * (`select` | `delete` | `insert`) selects the response it resolves to and one
 * chain's filters can never leak into another's. Every builder method records
 * its call and returns the same builder; the builder is thenable.
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
      const terminal = chain.some((call) => call.op === 'delete')
        ? responses.delete
        : chain.some((call) => call.op === 'insert')
          ? responses.insert
          : responses.select;
      return Promise.resolve(terminal ?? {}).then(onFulfilled, onRejected);
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

/** The calls belonging to the chains that terminate in `terminal` (e.g. 'delete'). */
function chainCalls(name: string, terminal: 'select' | 'delete' | 'insert'): Recorded[] {
  return table(name).chains
    .filter((chain) => chain.some((call) => call.op === terminal))
    .flat();
}

/** Every filter applied to `name` within the given terminal chain, as `op:args`. */
function filters(terminal: 'select' | 'delete' | 'insert', op: string): unknown[][] {
  return chainCalls('availability', terminal)
    .filter((call) => call.op === op)
    .map((call) => call.args);
}

function insertArgs(): unknown[] {
  return filters('insert', 'insert').map((args) => args[0]);
}

function resetTables() {
  tables = new Map([
    ['members', createTable('members', { select: { data: members, error: null } })],
    ['member_roles', createTable('member_roles', { select: { data: [], error: null } })],
    ['member_skills', createTable('member_skills', { select: { data: [], error: null } })],
    ['availability', createTable('availability', {
      delete: { count: 2, error: null },
      select: { data: [], error: null },
      insert: { error: null },
    })],
  ]);
  from.mockImplementation((name: string) => tables.get(name)?.newBuilder());
  getAdminClient.mockReturnValue({ from });
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
  resetTables();
  requireStaff.mockResolvedValue(auth);
  soleQualifiedMemberIds.mockReturnValue(new Set<string>());
  planMockUnavailability.mockReturnValue(planned);
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
  });

  it('rejects an unauthenticated caller with 401 before any database access', async () => {
    requireStaff.mockResolvedValue(Response.json({ error: 'Unauthorized' }, { status: 401 }));

    const response = await POST(post({}) as never);

    expect(response.status).toBe(401);
    expect(getAdminClient).not.toHaveBeenCalled();
  });

  it('takes church_id from auth only, never from the request body', async () => {
    await POST(post({ month: 2, year: 2026, church_id: 'attacker-church' }) as never);

    // Every tenant-scoped chain, including the self-healing DELETE, must carry
    // the authenticated church and must never echo the body-supplied one.
    const scoped = ['members', 'availability'].flatMap((name) => (
      table(name).chains.flat().filter((call) => call.op === 'eq').map((call) => call.args)
    ));
    expect(scoped).toContainEqual(['church_id', 'church-1']);
    expect(JSON.stringify(scoped)).not.toContain('attacker-church');
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
  });

  it.each([
    ['the lower bounds', { month: 0, year: 2000 }],
    ['the upper bounds', { month: 11, year: 2100 }],
  ])('accepts %s inclusively', async (_label, body) => {
    const response = await POST(post(body) as never);

    expect(response.status).toBe(201);
    expect(planMockUnavailability).toHaveBeenCalledWith(members, body.month, body.year, new Set());
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
    // The planner receives the clock-derived month, not the old literal.
    expect(planMockUnavailability).toHaveBeenCalledWith(members, 2, 2026, new Set());
    // The self-healing DELETE is scoped to the same derived month.
    expect(filters('delete', 'eq')).toEqual(
      expect.arrayContaining([['month', 2], ['year', 2026]]),
    );
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

describe('POST /api/schedule/mock-unavailability — self-healing DELETE scope', () => {
  it('deletes only this route\'s own weekly mock rows for the authenticated church and month', async () => {
    const response = await POST(post({ month: 2, year: 2026 }) as never);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ deleted: 2 });

    const deletes = filters('delete', 'delete');
    expect(deletes).toEqual([[{ count: 'exact' }]]);

    // Exact-count delete; every scope column; and the reason LIKE that makes a
    // real availability row (NULL or free-text reason) unmatchable.
    expect(filters('delete', 'eq')).toEqual([
      ['church_id', 'church-1'],
      ['type', 'weekly'],
      ['month', 2],
      ['year', 2026],
    ]);
    expect(filters('delete', 'like')).toEqual([
      ['reason', 'Mock unavailability (%'],
    ]);
  });

  it('never issues an availability delete without a church and reason scope', async () => {
    await POST(post({ month: 2, year: 2026 }) as never);

    const availability = tableCalls('availability');
    expect(availability[0]).toEqual({ op: 'delete', args: [{ count: 'exact' }] });
    // The reason predicate is what makes this safe: without it the route would
    // wipe real availability for the month, and without the church_id filter
    // it would wipe another tenant's.
    expect(availability).toContainEqual({ op: 'eq', args: ['church_id', 'church-1'] });
    expect(availability).toContainEqual({ op: 'like', args: ['reason', 'Mock unavailability (%'] });
  });

  it('reports zero deleted when the client returns a null count', async () => {
    // The `count: 'exact'` request can come back null; the response must not
    // leak a null where the contract promises a number.
    const availability = createTable('availability', {
      delete: { count: null, error: null },
      select: { data: [], error: null },
      insert: { error: null },
    });
    tables.set('availability', availability);

    const response = await POST(post({ month: 2, year: 2026 }) as never);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.deleted).toBe(0);
    // The exact-count request is still made; only the response is defaulted.
    expect(filters('delete', 'delete')).toEqual([[{ count: 'exact' }]]);
  });

  it('stops with 500 when the self-healing delete fails, before inserting anything', async () => {
    // Proceeding after a failed delete would double-write mock rows until the
    // partial unique index rejected them.
    const availability = createTable('availability', { delete: { error: { message: 'permission denied' } } });
    tables.set('availability', availability);

    const response = await POST(post({ month: 2, year: 2026 }) as never);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'Could not replace existing mock unavailability.',
    });
    expect(availability.calls.some((call) => call.op === 'insert')).toBe(false);
  });
});

describe('POST /api/schedule/mock-unavailability — inserts', () => {
  it('writes one weekly row per planned record, scoped to auth and the reason prefix', async () => {
    const response = await POST(post({ month: 2, year: 2026 }) as never);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ success: true, added: 2, skipped: 0, total_members: 2 });

    const inserts = insertArgs();
    expect(inserts).toEqual([
      {
        member_id: 'm-1', church_id: 'church-1', type: 'weekly', week_number: 1,
        month: 2, year: 2026, reason: 'Mock unavailability (March 2026 test)', status: 'approved',
      },
      {
        member_id: 'm-2', church_id: 'church-1', type: 'weekly', week_number: 2,
        month: 2, year: 2026, reason: 'Mock unavailability (March 2026 test)', status: 'approved',
      },
    ]);
  });

  it('skips records that collide with an existing active weekly row', async () => {
    // Mirrors the partial unique index predicate
    // (availability_active_weekly_member_month_week_idx).
    const availability = createTable('availability', {
      delete: { count: 0, error: null },
      select: { data: [{ member_id: 'm-1', week_number: 1 }], error: null },
      insert: { error: null },
    });
    tables.set('availability', availability);

    const response = await POST(post({ month: 2, year: 2026 }) as never);
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ added: 1, skipped: 1 });
    // Only the non-colliding member is written.
    expect(insertArgs()).toHaveLength(1);
    expect(insertArgs()[0]).toMatchObject({ member_id: 'm-2' });
    // The pre-check itself is tenant- and month-scoped.
    expect(filters('select', 'eq')).toEqual([
      ['church_id', 'church-1'],
      ['type', 'weekly'],
      ['month', 2],
      ['year', 2026],
    ]);
    expect(filters('select', 'in')).toEqual([['status', ['pending', 'approved']]]);
  });

  it('treats a concurrent unique-violation as a skip, not a failure', async () => {
    const availability = createTable('availability', {
      delete: { count: 0, error: null },
      select: { data: [], error: null },
      insert: { error: { code: '23505' } },
    });
    tables.set('availability', availability);

    const response = await POST(post({ month: 2, year: 2026 }) as never);

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ added: 0, skipped: 2 });
  });

  it('fails closed with 500 on any non-unique insert error', async () => {
    const availability = createTable('availability', {
      delete: { count: 0, error: null },
      select: { data: [], error: null },
      insert: { error: { code: '23503' } },
    });
    tables.set('availability', availability);

    const response = await POST(post({ month: 2, year: 2026 }) as never);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Could not save mock unavailability.' });
  });
});

describe('POST /api/schedule/mock-unavailability — sole-qualified exclusion', () => {
  it('never mocks the only active holder of a required slot into unavailability', async () => {
    soleQualifiedMemberIds.mockReturnValue(new Set(['m-1']));
    planMockUnavailability.mockReturnValue([planned[1]]);

    const response = await POST(post({ month: 2, year: 2026 }) as never);

    // The exclusion set reaches the planner, so the sole Drums holder (Simone)
    // keeps their availability and routine generation cannot fail on them.
    expect(soleQualifiedMemberIds).toHaveBeenCalledWith({
      memberIds: ['m-1', 'm-2'],
      roles: [],
      skills: [],
    });
    expect(planMockUnavailability).toHaveBeenCalledWith(members, 2, 2026, new Set(['m-1']));
    expect(insertArgs()).toEqual([
      expect.objectContaining({ member_id: 'm-2' }),
    ]);
    await expect(response.json()).resolves.toMatchObject({ added: 1 });
  });

  it('returns 500 when member qualifications cannot be loaded', async () => {
    tables.set('member_roles', createTable('member_roles', { select: { error: { message: 'boom' } } }));

    const response = await POST(post({ month: 2, year: 2026 }) as never);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Could not load member qualifications.' });
    // Fails before the self-healing delete touches anything.
    expect(tableCalls('availability')).toHaveLength(0);
  });

  it('returns 500 when the active member roster cannot be loaded', async () => {
    tables.set('members', createTable('members', { select: { error: { message: 'boom' } } }));

    const response = await POST(post({ month: 2, year: 2026 }) as never);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Could not load members.' });
    expect(tableCalls('availability')).toHaveLength(0);
  });
});
