import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';

/**
 * Route-level contract tests for `POST /api/schedule/month/publish`.
 *
 * The route is the TypeScript half of the month publish gate: it calls the
 * `publish_month_schedule` RPC, which owns the two month-level gates and
 * returns them as result documents so the route can map each to a distinct
 * status: 'unvalidated' -> 409 and 'incomplete' -> 422. SQL re-asserts the
 * publication rules inside its own transaction.
 */

const requireStaff = vi.fn();
const getAdminClient = vi.fn();
const loadAvailabilityReadiness = vi.fn();
const rpc = vi.fn();

vi.mock('@/lib/auth/server', () => ({
  requireStaff: (request: Request) => requireStaff(request),
  getAdminClient: () => getAdminClient(),
}));

vi.mock('@/lib/scheduling/availability-readiness', () => ({
  loadAvailabilityReadiness: (churchId: string, month: number, year: number) =>
    loadAvailabilityReadiness(churchId, month, year),
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

function postRequest(body: unknown) {
  return new Request('https://app.test/api/schedule/month/publish', {
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
  getAdminClient.mockReturnValue({ rpc });
  rpcReturns(null);
});

describe('POST /api/schedule/month/publish', () => {
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

  it('publishes the whole month atomically and reports already-published services', async () => {
    rpcReturns({ ok: true, month_status: 'published', published: ['w1', 'w2'], already_published: ['w3'] });
    const response = await callPost();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('published');
    expect(body.month_status).toBe('published');
    expect(body.published).toEqual(['w1', 'w2']);
    expect(body.already_published).toEqual(['w3']);
    expect(rpc).toHaveBeenCalledWith('publish_month_schedule', {
      p_church_id: 'church-1',
      p_ministry_id: 'ministry-1',
      p_month: 10,
      p_year: 2026,
      p_actor_id: 'user-1',
    });
  });

  it('maps the unvalidated gate to 409 with the offending services', async () => {
    rpcReturns({
      ok: false,
      code: 'unvalidated',
      month_status: 'draft',
      services: [
        { service_id: 'w1', week_number: 1, status: 'draft', reason: 'not_validated' },
        { service_id: 'w2', week_number: 2, status: 'validated', reason: 'version_drifted' },
      ],
    });
    const response = await callPost();
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('unvalidated');
    expect(body.services).toHaveLength(2);
    expect(body.services[1].reason).toBe('version_drifted');
  });

  it('maps the incomplete gate to 422 and sums the unfilled positions', async () => {
    rpcReturns({
      ok: false,
      code: 'incomplete',
      services: [
        { service_id: 'w1', week_number: 1, status: 'validated', unfilled_count: 2 },
        { service_id: 'w2', week_number: 2, status: 'validated', unfilled_count: 1 },
      ],
    });
    const response = await callPost();
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.code).toBe('incomplete');
    expect(body.error).toContain('3 position(s) are still unfilled');
    expect(body.services).toHaveLength(2);
  });

  it('maps an RPC authorization failure to 403', async () => {
    rpcReturns(null, { message: 'Coordinator authorization could not be verified', code: '42501' });
    const response = await callPost();
    expect(response.status).toBe(403);
  });

  it('maps an unexpected RPC error to 409', async () => {
    rpcReturns(null, { message: 'No schedules exist for this month', code: 'P0002' });
    const response = await callPost();
    expect(response.status).toBe(409);
  });

  it('resolves the ministry through readiness, never from the body', async () => {
    rpcReturns({ ok: true, month_status: 'published', published: [], already_published: [] });
    const response = await callPost({ month: 10, year: 2026, ministry_id: 'evil-ministry' });
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('publish_month_schedule', expect.objectContaining({
      p_ministry_id: 'ministry-1',
    }));
  });
});