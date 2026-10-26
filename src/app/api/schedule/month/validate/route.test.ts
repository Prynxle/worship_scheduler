import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import type { Service } from '@/lib/types/database';

/**
 * Route-level contract tests for `POST /api/schedule/month/validate`.
 *
 * The route is the TypeScript half of the month gate: it runs the full
 * final-stage validator per draft and refuses the month on any critical BEFORE
 * the RPC is reached (mirroring the single-service validate route). The SQL
 * half (`validate_month_schedule`) re-asserts the publication rules inside its
 * own transaction and is covered by the migration's rollback documentation.
 */

const requireStaff = vi.fn();
const getAdminClient = vi.fn();
const loadAvailabilityReadiness = vi.fn();
const loadScheduleData = vi.fn();
const activeMonthServices = vi.fn();
const finalValidateService = vi.fn();
const rpc = vi.fn();

vi.mock('@/lib/auth/server', () => ({
  requireStaff: (request: Request) => requireStaff(request),
  getAdminClient: () => getAdminClient(),
}));

vi.mock('@/lib/scheduling/availability-readiness', () => ({
  loadAvailabilityReadiness: (churchId: string, month: number, year: number) =>
    loadAvailabilityReadiness(churchId, month, year),
}));

vi.mock('@/lib/scheduling/schedule-data', () => ({
  loadScheduleData: (churchId: string, month: number, year: number, ministryId: string) =>
    loadScheduleData(churchId, month, year, ministryId),
}));

vi.mock('@/lib/scheduling/month-workflow', () => ({
  // Identity passthrough: the route's own ministry filtering is what we assert.
  activeMonthServices: (items: unknown[]) => activeMonthServices(items),
  finalValidateService: (service: unknown, data: unknown, churchId: string) =>
    finalValidateService(service, data, churchId),
}));

const auth = { userId: 'user-1', churchId: 'church-1' } as never;
const readiness = {
  ministry_id: 'ministry-1',
  ministry_name: 'Test Ministry',
  ready: true,
  required_members: 3,
  approved_count: 3,
  outstanding_count: 0,
  members: [],
} as never;

function storedService(overrides: Partial<Service> = {}): Service {
  return {
    id: 'service-week-1', church_id: 'church-1', ministry_id: 'ministry-1',
    date: '2026-10-04', week_number: 1, month: 10, year: 2026,
    service_type: 'sunday', status: 'draft', schedule_version: 1,
    unfilled_positions: [], active_overrides: {}, created_at: '', updated_at: '',
    ...overrides,
  } as Service;
}

function outcome(overrides: Partial<Awaited<ReturnType<typeof finalValidateService>>> = {}) {
  return {
    results: [],
    overridden_checks: [] as string[],
    criticals: [] as unknown[],
    warnings: [] as unknown[],
    suggestions: [] as unknown[],
    unfilled_positions: [] as unknown[],
    ...overrides,
  };
}

function postRequest(body: unknown) {
  return new Request('https://app.test/api/schedule/month/validate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never;
}

function callPost(body: unknown = { month: 10, year: 2026 }) {
  return POST(postRequest(body));
}

function rpcReturns(data: unknown, error: unknown = null) {
  rpc.mockResolvedValue({ data, error });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireStaff.mockResolvedValue(auth);
  loadAvailabilityReadiness.mockResolvedValue(readiness);
  loadScheduleData.mockResolvedValue({ services: [storedService()], assignments: [], members: [], roles: [], instruments: [], rules: [], config: {}, monthlyAssignments: [] });
  activeMonthServices.mockImplementation((items: unknown[]) => items);
  finalValidateService.mockResolvedValue(outcome());
  getAdminClient.mockReturnValue({ rpc });
  rpcReturns(null);
});

describe('POST /api/schedule/month/validate', () => {
  it('requires staff auth (403 before any parsing)', async () => {
    requireStaff.mockResolvedValue(new Response(null, { status: 403 }));
    const response = await callPost();
    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range month', async () => {
    const response = await callPost({ month: 12, year: 2026 });
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses when the month has nothing to validate (no drafts)', async () => {
    loadScheduleData.mockResolvedValue({ services: [storedService({ status: 'validated', validated_version: 1 })], assignments: [], members: [], roles: [], instruments: [], rules: [], config: {}, monthlyAssignments: [] });
    const response = await callPost();
    expect(response.status).toBe(409);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('excludes legacy ministry-unscoped services from the month set', async () => {
    loadScheduleData.mockResolvedValue({
      services: [
        storedService({ id: 'scoped', week_number: 1, status: 'draft' }),
        storedService({ id: 'legacy', week_number: 2, ministry_id: null, status: 'draft' }),
      ],
      assignments: [], members: [], roles: [], instruments: [], rules: [], config: {}, monthlyAssignments: [],
    });
    rpcReturns({ ok: true, month_status: 'validated', validated: ['scoped'], already_validated: [], skipped_published: [] });
    const response = await callPost();
    expect(response.status).toBe(200);
    // Only the ministry-scoped draft was validated.
    expect(finalValidateService).toHaveBeenCalledTimes(1);
    expect(finalValidateService.mock.calls[0][0]).toMatchObject({ id: 'scoped' });
  });

  it('refuses the month before validating any draft when one is a stale future draft (GH #97)', async () => {
    loadScheduleData.mockResolvedValue({
      services: [storedService({ id: 'stale', date: '2099-05-03', availability_reset_at: '2026-10-26T12:00:00Z' })],
      assignments: [], members: [], roles: [], instruments: [], rules: [], config: {}, monthlyAssignments: [],
    });
    rpcReturns({ ok: true });

    const response = await callPost();
    const body = await response.json() as { code?: string };

    expect(response.status).toBe(409);
    expect(body.code).toBe('schedule_pending_regeneration');
    // The pre-check must beat both the validator and the RPC: a per-service 422
    // about a lineup the coordinator cannot validate anyway is a dead end.
    expect(finalValidateService).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('ignores a reset stamp on a week that has already passed', async () => {
    loadScheduleData.mockResolvedValue({
      services: [storedService({ id: 'past', date: '2020-01-05', availability_reset_at: '2026-10-26T12:00:00Z' })],
      assignments: [], members: [], roles: [], instruments: [], rules: [], config: {}, monthlyAssignments: [],
    });
    rpcReturns({ ok: true, month_status: 'validated', validated: ['past'], already_validated: [], skipped_published: [] });

    const response = await callPost();

    expect(response.status).toBe(200);
    expect(finalValidateService).toHaveBeenCalled();
  });

  it('refuses the whole month with 422 when any draft has a critical', async () => {
    finalValidateService.mockResolvedValue(outcome({
      results: [{ check: 'leader_count_missing', severity: 'critical' }] as never[],
      criticals: [{ check: 'leader_count_missing', severity: 'critical' }] as never[],
      warnings: [{ check: 'active_member', severity: 'warning' }] as never[],
      unfilled_positions: [{ role_name: 'Worship Leader' }] as never[],
    }));
    const response = await callPost();
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.valid).toBe(false);
    expect(body.summary.critical).toBe(1);
    expect(body.services).toHaveLength(1);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('validates every draft and transitions the month when no critical remains', async () => {
    loadScheduleData.mockResolvedValue({
      services: [
        storedService({ id: 'w1', week_number: 1, status: 'draft' }),
        storedService({ id: 'w2', week_number: 2, status: 'draft', date: '2026-10-11' }),
      ],
      assignments: [], members: [], roles: [], instruments: [], rules: [], config: {}, monthlyAssignments: [],
    });
    rpcReturns({ ok: true, month_status: 'validated', validated: ['w1', 'w2'], already_validated: [], skipped_published: ['w3'] });

    const response = await callPost();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.valid).toBe(true);
    expect(body.month_status).toBe('validated');
    expect(finalValidateService).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith('validate_month_schedule', expect.objectContaining({
      p_church_id: 'church-1',
      p_ministry_id: 'ministry-1',
      p_month: 10,
      p_year: 2026,
      p_actor_id: 'user-1',
    }));
  });

  it('maps the RPC nothing-to-validate gate to 409', async () => {
    rpcReturns({ ok: false, code: 'nothing_to_validate', month_status: 'published' });
    const response = await callPost();
    expect(response.status).toBe(409);
  });

  it('maps an RPC authorization failure to 403', async () => {
    rpcReturns(null, { message: 'Coordinator authorization could not be verified', code: '42501' });
    const response = await callPost();
    expect(response.status).toBe(403);
  });
});