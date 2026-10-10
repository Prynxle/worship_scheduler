import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Contract tests for PUT /api/availability — the staff status-update guard.
 *
 * The guard under test: when the target row's (member, month, year) — derived
 * from the row's stamped month/year first and then from its own date, exactly
 * like POST derives them — already has a CURRENT monthly submission, the
 * direct status flip is refused with 409. Only the legacy path (no current
 * submission for the row's month) may proceed.
 *
 * The collaborators are mocked and only observable behaviour is asserted. No
 * assertion reads route.ts source text.
 */

const getAuthContext = vi.fn();
const getAdminClient = vi.fn();
const from = vi.fn();

vi.mock('@/lib/auth/server', () => ({
  getAuthContext: (request: Request) => getAuthContext(request),
  getAdminClient: () => getAdminClient(),
  // Mirrors the real helper: admin and coordinator are staff.
  isStaff: (role: string) => role === 'admin' || role === 'coordinator',
}));

const { PUT } = await import('./route');

const staff = {
  authId: 'auth-1', userId: 'user-1', memberId: null, churchId: 'church-1',
  fullName: 'Zed', memberName: null, phone: null, role: 'coordinator' as const,
};

/** The legacy row the guard resolves before writing. */
const target = { member_id: 'm-1', month: 2, year: 2026, date: null };

type Recorded = { op: string; args: unknown[] };

type Responses = {
  select?: { data?: unknown; error?: unknown };
  update?: { data?: unknown; error?: unknown };
};

/**
 * The same chainable query-builder double used by the sibling route suites:
 * a fresh builder per `.from()` call, terminal op (`update` | anything else)
 * selects the response, and every method records itself for assertions.
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
      const terminal = chain.some((call) => call.op === 'update') ? responses.update : responses.select;
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

/**
 * The filters applied inside the chains of `name` that START with `initial`
 * (a chain's first op is its write kind: the legacy update ends in a
 * `.select('*')` projection, so matching on "contains" would catch it too).
 */
function filters(name: string, initial: string, op: string): unknown[][] {
  return table(name).chains
    .filter((chain) => chain[0]?.op === initial)
    .flat()
    .filter((call) => call.op === op)
    .map((call) => call.args);
}

function resetTables(overrides: { target?: unknown; submission?: unknown; updated?: unknown } = {}) {
  tables = new Map([
    ['availability', createTable('availability', {
      select: { data: overrides.target === undefined ? target : overrides.target, error: null },
      update: { data: overrides.updated === undefined ? { id: 'a-1', status: 'approved' } : overrides.updated, error: null },
    })],
    ['availability_submissions', createTable('availability_submissions', {
      select: { data: overrides.submission === undefined ? null : overrides.submission, error: null },
    })],
  ]);
  from.mockImplementation((name: string) => tables.get(name)?.newBuilder());
  getAdminClient.mockReturnValue({ from });
}

function put(body: unknown): Request {
  return new Request('https://app.test/api/availability', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetTables();
  getAuthContext.mockResolvedValue(staff);
});

describe('PUT /api/availability — access', () => {
  it('refuses a non-staff caller before any database access', async () => {
    getAuthContext.mockResolvedValue({ ...staff, role: 'member' as const });

    const response = await PUT(put({ id: 'a-1', status: 'approved' }) as never);

    expect(response.status).toBe(403);
    expect(from).not.toHaveBeenCalled();
  });

  it('refuses an unauthenticated caller before any database access', async () => {
    getAuthContext.mockResolvedValue(null);

    const response = await PUT(put({ id: 'a-1', status: 'approved' }) as never);

    expect(response.status).toBe(403);
    expect(from).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing id', { status: 'approved' }],
    ['an invalid status', { id: 'a-1', status: 'submitted' }],
  ])('returns 400 for %s and never reads the database', async (_label, body) => {
    const response = await PUT(put(body) as never);

    expect(response.status).toBe(400);
    expect(from).not.toHaveBeenCalled();
  });
});

describe('PUT /api/availability — current-submission guard', () => {
  it('returns 409 when the target row’s month already has a current submission, and never updates', async () => {
    resetTables({ submission: { id: 'sub-1' } });

    const response = await PUT(put({ id: 'a-1', status: 'approved' }) as never);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'This month already has a complete response. Use the monthly submission review workflow instead.',
    });
    // The guard must fire BEFORE any write.
    expect(table('availability').calls.some((call) => call.op === 'update')).toBe(false);
  });

  it('checks the submission for the row’s own member, church, month and year', async () => {
    resetTables({ submission: null });

    const response = await PUT(put({ id: 'a-1', status: 'approved' }) as never);

    expect(response.status).toBe(200);
    expect(filters('availability_submissions', 'select', 'eq')).toEqual([
      ['church_id', 'church-1'],
      ['member_id', 'm-1'],
      ['month', 2],
      ['year', 2026],
      ['is_current', true],
    ]);
  });

  it('derives the month and year from the row’s date when they are not stamped, like POST does', async () => {
    // A legacy date row carries no month/year columns; the guard must derive
    // them from the date (2026-03-08 -> month 2, year 2026) exactly the way
    // POST derives a submission's scope.
    resetTables({
      target: { member_id: 'm-1', month: null, year: null, date: '2026-03-08' },
      submission: { id: 'sub-1' },
    });

    const response = await PUT(put({ id: 'a-1', status: 'rejected' }) as never);

    expect(response.status).toBe(409);
    expect(filters('availability_submissions', 'select', 'eq')).toContainEqual(['month', 2]);
    expect(filters('availability_submissions', 'select', 'eq')).toContainEqual(['year', 2026]);
    expect(table('availability').calls.some((call) => call.op === 'update')).toBe(false);
  });

  it('skips the guard when the row’s month and year cannot be derived and proceeds with the legacy update', async () => {
    // No stamped month/year and no date: there is no monthly scope to check,
    // so the legacy path is unchanged.
    resetTables({ target: { member_id: 'm-1', month: null, year: null, date: null } });

    const response = await PUT(put({ id: 'a-1', status: 'approved' }) as never);

    expect(response.status).toBe(200);
    expect(tableCalls('availability_submissions')).toHaveLength(0);
    expect(table('availability').calls.some((call) => call.op === 'update')).toBe(true);
  });

  it('returns 500 when the submission state cannot be verified', async () => {
    tables.set('availability_submissions', createTable('availability_submissions', {
      select: { data: null, error: { message: 'boom' } },
    }));

    const response = await PUT(put({ id: 'a-1', status: 'approved' }) as never);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Could not verify the monthly submission state.' });
    expect(table('availability').calls.some((call) => call.op === 'update')).toBe(false);
  });
});

describe('PUT /api/availability — legacy path unchanged', () => {
  it('updates the row when its month has no current submission', async () => {
    const response = await PUT(put({ id: 'a-1', status: 'approved' }) as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ availability: { id: 'a-1', status: 'approved' } });
    // The legacy write keeps its exact scope: this church, this row, and only
    // rows with no submission behind them.
    expect(filters('availability', 'update', 'eq')).toEqual([
      ['id', 'a-1'],
      ['church_id', 'church-1'],
    ]);
    expect(filters('availability', 'update', 'is')).toEqual([['submission_id', null]]);
  });

  it('scopes the target lookup to the authenticated church', async () => {
    await PUT(put({ id: 'a-1', status: 'approved' }) as never);

    expect(filters('availability', 'select', 'eq')).toEqual([
      ['id', 'a-1'],
      ['church_id', 'church-1'],
    ]);
  });

  it('returns 404 when the target row does not exist', async () => {
    resetTables({ target: null });

    const response = await PUT(put({ id: 'missing', status: 'approved' }) as never);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Availability not found' });
  });

  it('returns 500 when the target row cannot be loaded', async () => {
    tables.set('availability', createTable('availability', {
      select: { data: null, error: { message: 'boom' } },
    }));

    const response = await PUT(put({ id: 'a-1', status: 'approved' }) as never);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Could not update availability.' });
  });

  it('returns 404 when the legacy update matches no row (e.g. a submission-owned row)', async () => {
    resetTables({ updated: null });

    const response = await PUT(put({ id: 'a-1', status: 'approved' }) as never);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: 'Availability not found' });
  });

  it('returns 500 when the legacy update fails', async () => {
    tables.set('availability', createTable('availability', {
      select: { data: target, error: null },
      update: { data: null, error: { message: 'boom' } },
    }));

    const response = await PUT(put({ id: 'a-1', status: 'approved' }) as never);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Could not update availability.' });
  });
});
