import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

/**
 * Route-level contract tests for `GET /api/analytics`.
 *
 * The report is built from the authenticated church's services, members,
 * assignments, and availability only. These tests pin the staff gate and the
 * tenant filter so a future query addition cannot silently drop either.
 */

const requireStaff = vi.fn();
const getAdminClient = vi.fn();

vi.mock('@/lib/auth/server', () => ({
  requireStaff: (request: Request) => requireStaff(request),
  getAdminClient: () => getAdminClient(),
}));

const auth = { userId: 'user-1', churchId: 'church-1' } as never;

type Query = {
  table: string;
  selected: string;
  filters: Record<string, unknown>;
};

let queries: Query[] = [];
let monthRows: Array<Record<string, unknown>> = [];
let serviceRows: Array<Record<string, unknown>> = [];
let memberRows: Array<Record<string, unknown>> = [];
let assignmentRows: Array<Record<string, unknown>> = [];
let availabilityRows: Array<Record<string, unknown>> = [];

function resultFor(query: Query) {
  if (query.table === 'services' && query.selected === 'month, year') {
    return { data: monthRows, error: null };
  }
  if (query.table === 'services') return { data: serviceRows, error: null };
  if (query.table === 'members') return { data: memberRows, error: null };
  if (query.table === 'schedule_assignments') return { data: assignmentRows, error: null };
  if (query.table === 'availability') return { data: availabilityRows, error: null };
  return { data: [], error: null };
}

function queryBuilder(table: string) {
  const query: Query = { table, selected: '', filters: {} };
  queries.push(query);

  const builder = {
    select(selected: string) {
      query.selected = selected;
      return builder;
    },
    eq(column: string, value: unknown) {
      query.filters[column] = value;
      return builder;
    },
    neq(column: string, value: unknown) {
      query.filters[column] = value;
      return builder;
    },
    in(column: string, value: unknown) {
      query.filters[column] = value;
      return builder;
    },
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
      return Promise.resolve(resultFor(query)).then(resolve, reject);
    },
  };

  return builder;
}

function getRequest(query = '') {
  return GET(new Request(`https://app.test/api/analytics${query}`) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  queries = [];
  monthRows = [];
  serviceRows = [];
  memberRows = [];
  assignmentRows = [];
  availabilityRows = [];
  requireStaff.mockResolvedValue(auth);
  getAdminClient.mockReturnValue({ from: (table: string) => queryBuilder(table) });
});

describe('GET /api/analytics', () => {
  it('requires staff auth before querying', async () => {
    requireStaff.mockResolvedValue(new Response(null, { status: 403 }));

    const response = await getRequest();

    expect(response.status).toBe(403);
    expect(getAdminClient).not.toHaveBeenCalled();
  });

  it('rejects a partial or invalid month selection', async () => {
    const partial = await getRequest('?month=8');
    expect(partial.status).toBe(400);

    const invalid = await getRequest('?month=12&year=2026');
    expect(invalid.status).toBe(400);
  });

  it('scopes every tenant query and returns computed metrics', async () => {
    monthRows = [{ month: 8, year: 2026 }];
    serviceRows = [{ id: 'service-1' }];
    memberRows = [
      { id: 'alice', full_name: 'Alice', status: 'active', max_monthly_assignments: 3 },
      { id: 'bob', full_name: 'Bob', status: 'inactive', max_monthly_assignments: 3 },
    ];
    assignmentRows = [
      { member_id: 'alice', service_id: 'service-1' },
      { member_id: 'alice', service_id: 'service-1' },
    ];

    const response = await getRequest('?month=8&year=2026');
    const body = (await response.json()) as {
      month: number;
      year: number;
      fairness: Array<{ member_id: string; assignment_count: number }>;
      overall_fairness: number;
      assignment_count: number;
    };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ month: 8, year: 2026, overall_fairness: 93, assignment_count: 2 });
    expect(body.fairness).toHaveLength(1);
    expect(body.fairness[0]).toMatchObject({ member_id: 'alice', assignment_count: 2 });

    const tenantQueries = queries.filter((query) => query.filters.church_id !== undefined);
    expect(tenantQueries.map((query) => query.table)).toEqual([
      'services',
      'services',
      'members',
      'availability',
    ]);
    expect(tenantQueries.every((query) => query.filters.church_id === 'church-1')).toBe(true);
    expect(queries.find((query) => query.table === 'schedule_assignments')?.filters).toMatchObject({
      service_id: ['service-1'],
    });
  });
});
