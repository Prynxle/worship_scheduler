import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireStaff = vi.fn();
const getAdminClient = vi.fn();

vi.mock('@/lib/auth/server', () => ({
  requireStaff: (request: Request) => requireStaff(request),
  getAdminClient: () => getAdminClient(),
}));

const { GET } = await import('./route');

const auth = {
  authId: 'auth-1', userId: 'user-1', memberId: 'member-1', churchId: 'church-1',
  fullName: 'Zed', memberName: 'Zed', phone: null, role: 'coordinator' as const,
};
const MINISTRY_ID = 'ministry-1';

type Call = { op: string; args: unknown[] };
type QueryResult = { data: unknown; error: unknown };
const calls: Call[][] = [];
const results: Record<string, QueryResult> = {};

function makeBuilder(table: string) {
  const queryCalls: Call[] = [{ op: 'from', args: [table] }];
  calls.push(queryCalls);
  const self: Record<string, unknown> = {
    select: (...args: unknown[]) => { queryCalls.push({ op: 'select', args }); return self; },
    eq: (...args: unknown[]) => { queryCalls.push({ op: 'eq', args }); return self; },
    in: (...args: unknown[]) => { queryCalls.push({ op: 'in', args }); return self; },
    order: (...args: unknown[]) => { queryCalls.push({ op: 'order', args }); return self; },
    maybeSingle: () => Promise.resolve(results[table] ?? { data: null, error: null }),
    then: (resolve: (result: QueryResult) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(results[table] ?? { data: [], error: null }).then(resolve, reject),
  };
  return self;
}

function buildClient() {
  return { from: (table: string) => makeBuilder(table) };
}

function allCalls(table: string) {
  return calls.flat().filter((call) => call.op === 'from' && call.args[0] === table).length
    ? calls.filter((query) => query[0]?.args[0] === table).flat()
    : [];
}

const request = (url = 'https://app.test/api/ministries'): never => ({ url } as never);

beforeEach(() => {
  vi.clearAllMocks();
  calls.length = 0;
  Object.keys(results).forEach((key) => delete results[key]);
  requireStaff.mockResolvedValue(auth);
  getAdminClient.mockReturnValue(buildClient());
  results.ministries = { data: [{
    id: MINISTRY_ID, church_id: 'ignored-db-value', name: 'Worship Team', config: { requires_leader: true },
    priority: 1, is_active: true, created_at: '2026-01-01',
  }], error: null };
  results.churches = { data: { settings: { default_min_backup_singers: 3, default_max_backup_singers: 5 } }, error: null };
  results.roles = { data: [{ id: 'role-1', ministry_id: MINISTRY_ID, name: 'Back Up', min_required: 3, max_allowed: 5, priority: 1, is_active: true, created_at: '2026-01-01' }], error: null };
  results.instruments = { data: [{ id: 'instrument-1', ministry_id: MINISTRY_ID, name: 'Piano', is_required: true, min_count: 1, max_count: 1, created_at: '2026-01-01' }], error: null };
  results.ministry_rules = { data: [{ id: 'rule-1', ministry_id: MINISTRY_ID, rule_type: 'backup_count', rule_config: { min_backup_singers: 3 }, severity: 'critical', is_active: true }], error: null };
});

describe('GET /api/ministries', () => {
  it('returns the staff rejection before opening the database client', async () => {
    const denied = Response.json({ error: 'Staff access required.' }, { status: 403 });
    requireStaff.mockResolvedValue(denied);

    const response = await GET(request());

    expect(response).toBe(denied);
    expect(getAdminClient).not.toHaveBeenCalled();
  });

  it('scopes the ministry and church reads to the authenticated tenant', async () => {
    await GET(request('https://app.test/api/ministries?church_id=church-evil'));

    expect(allCalls('ministries').filter((call) => call.op === 'eq' && call.args[0] === 'church_id')).toEqual([
      { op: 'eq', args: ['church_id', 'church-1'] },
    ]);
    expect(allCalls('churches').filter((call) => call.op === 'eq')).toEqual([
      { op: 'eq', args: ['id', 'church-1'] },
    ]);
    for (const table of ['roles', 'instruments', 'ministry_rules']) {
      expect(allCalls(table).find((call) => call.op === 'in')?.args).toEqual(['ministry_id', [MINISTRY_ID]]);
      expect(JSON.stringify(allCalls(table))).not.toContain('church-evil');
    }
  });

  it('returns normalized typed configuration with the effective backup range', async () => {
    const response = await GET(request());
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ministries).toHaveLength(1);
    expect(payload.ministries[0]).toMatchObject({
      id: MINISTRY_ID,
      church_id: 'church-1',
      config: { min_members: 1, max_members: 10, requires_leader: true, allows_dual_role: false, auto_generate: false },
      roles: [{ id: 'role-1', name: 'Back Up', min_required: 3, max_allowed: 5 }],
      instruments: [{ id: 'instrument-1', name: 'Piano' }],
      rules: [{ name: 'Backup Count', is_active: true, rule_config: { min_required: 3, max_allowed: 5 } }],
      effective_backup_range: { min: 3, max: 5 },
    });
  });

  it('returns an empty list without querying child configuration when no ministries exist', async () => {
    results.ministries = { data: [], error: null };

    const response = await GET(request());

    expect(await response.json()).toEqual({ ministries: [] });
    expect(calls.some((query) => ['roles', 'instruments', 'ministry_rules'].includes(String(query[0]?.args[0])))).toBe(false);
  });
});
