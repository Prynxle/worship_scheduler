import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Service } from '@/lib/types/database';
import type { GeneratedService } from '@/lib/types/scheduling';

/**
 * Route-level contract tests.
 *
 * These REPLACE a source-text assertion that read `route.ts` and string-matched
 * the ordering of two identifiers. That test asserted nothing about behaviour:
 * it passed as long as the words appeared in a particular order, and it broke
 * for any refactor that legitimately moved the logic. It also could not observe
 * the property that actually matters -- that persistence leaves the route
 * entirely. These tests mock the collaborators and assert the real thing.
 */

const requireStaff = vi.fn();
const getAdminClient = vi.fn();
const loadScheduleData = vi.fn();
const generateSchedule = vi.fn();
const rpc = vi.fn();
const from = vi.fn();

vi.mock('@/lib/auth/server', () => ({
  requireStaff: (request: Request) => requireStaff(request),
  getAdminClient: () => getAdminClient(),
}));

vi.mock('@/lib/scheduling/schedule-data', () => ({
  loadScheduleData: (churchId: string, month: number, year: number, ministryId?: string) =>
    loadScheduleData(churchId, month, year, ministryId),
}));

vi.mock('@/lib/scheduling/engine', () => ({
  SchedulingEngine: class {
    generateSchedule() {
      return generateSchedule();
    }
  },
}));

const { POST } = await import('./route');

const auth = { authId: 'auth-1', userId: 'user-1', memberId: 'member-1', churchId: 'church-1', fullName: 'Zed', memberName: 'Zed', phone: null, role: 'admin' as const };

const existingDraft: Service = {
  id: 'service-week-1', church_id: 'church-1', date: '2026-09-06', week_number: 1,
  month: 8, year: 2026, service_type: 'sunday', status: 'draft', created_at: '', updated_at: '',
};

const generated: GeneratedService = {
  week_number: 1, date: '2026-09-06', leader: null, backup_singers: [], devotion: null,
  conflicts: [], instrumentalists: [],
};

function post(body: unknown): Request {
  return new Request('https://app.test/api/schedule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // `.overrideTypes<T>()` is a fluent no-op terminator; the route chains it onto
  // the builder, so the mock must return something chainable.
  //
  // The happy path: September 2026 has 4 Sundays (6, 13, 20, 27), so an
  // unfiltered request writes 4 services. Returning the 4 rows is what a
  // successful RPC actually does, and is what keeps the post-write invariant
  // green without weakening the invariant itself.
  const september = [
    { service_id: 'service-week-1', week_number: 1, service_date: '2026-09-06', assignment_count: 4 },
    { service_id: 'service-week-2', week_number: 2, service_date: '2026-09-13', assignment_count: 4 },
    { service_id: 'service-week-3', week_number: 3, service_date: '2026-09-20', assignment_count: 4 },
    { service_id: 'service-week-4', week_number: 4, service_date: '2026-09-27', assignment_count: 4 },
  ];
  rpc.mockReturnValue({ overrideTypes: () => Promise.resolve({ data: september, error: null }) });
  from.mockReturnValue({ select: vi.fn(), insert: vi.fn(), delete: vi.fn(), update: vi.fn() });
  getAdminClient.mockReturnValue({ rpc, from });
  requireStaff.mockResolvedValue(auth);
  loadScheduleData.mockResolvedValue({ services: [existingDraft], assignments: [], members: [], rules: [], config: {} });
  generateSchedule.mockResolvedValue([generated]);
});

describe('POST /api/schedule', () => {
  it('persists the month through the transactional RPC', async () => {
    const response = await POST(post({ month: 8, year: 2026 }) as never);

    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('replace_month_schedule', expect.objectContaining({
      p_church_id: 'church-1',
      p_month: 8,
      p_year: 2026,
      p_week_numbers: [1, 2, 3, 4],
    }));
    await expect(response.json()).resolves.toMatchObject({ month: 8, year: 2026 });
  });

  it('never writes services or assignments directly from the route', async () => {
    // The regression this guards: the previous writer deleted and re-inserted
    // services/assignments row-by-row with no transaction, which is what left
    // duplicate draft services behind on every failed generation.
    await POST(post({ month: 8, year: 2026 }) as never);

    expect(from).not.toHaveBeenCalled();
  });

  it('takes church_id from auth only, never from the request body', async () => {
    await POST(post({ month: 8, year: 2026, church_id: 'attacker-church' }) as never);

    expect(rpc).toHaveBeenCalledWith('replace_month_schedule', expect.objectContaining({ p_church_id: 'church-1' }));
  });

  it('returns 400 for an out-of-range month without touching the database', async () => {
    const response = await POST(post({ month: 12, year: 2026 }) as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'invalid_month_year' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns 400 for a malformed body', async () => {
    const response = await POST(post('{not json') as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'invalid_json' });
  });

  it('returns 409 with service_ids for a published service', async () => {
    loadScheduleData.mockResolvedValue({
      services: [{ ...existingDraft, status: 'published' }], assignments: [], members: [], rules: [], config: {},
    });

    const response = await POST(post({ month: 8, year: 2026 }) as never);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ service_ids: ['service-week-1'] });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('maps a data-integrity SQLSTATE to 500 without disclosing driver detail', async () => {
    rpc.mockReturnValue({
      overrideTypes: () => Promise.resolve({
        data: null,
        error: { code: '23503', message: 'duplicate key value violates unique constraint "audit_logs_church_id_fkey"' },
      }),
    });

    const response = await POST(post({ month: 8, year: 2026 }) as never);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.code).toBe('foreign_key_violation');
    expect(JSON.stringify(body)).not.toContain('audit_logs_church_id_fkey');
  });

  it('maps a protection violation SQLSTATE to 409', async () => {
    rpc.mockReturnValue({
      overrideTypes: () => Promise.resolve({ data: null, error: { code: 'W0001', message: 'service is published' } }),
    });

    const response = await POST(post({ month: 8, year: 2026 }) as never);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'protected_service' });
  });

  it('returns 500 with a request_id when the RPC writes fewer weeks than requested', async () => {
    // Post-write invariant: a silent partial month must never read as success.
    loadScheduleData.mockResolvedValue({ services: [existingDraft], assignments: [], members: [], rules: [], config: {} });
    generateSchedule.mockResolvedValue([generated, { ...generated, week_number: 2, date: '2026-09-13' }]);
    rpc.mockReturnValue({
      overrideTypes: () => Promise.resolve({
        data: [{ service_id: 'service-week-1', week_number: 1, service_date: '2026-09-06', assignment_count: 1 }],
        error: null,
      }),
    });

    const response = await POST(post({ month: 8, year: 2026 }) as never);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.code).toBe('post_write_invariant_failed');
    expect(body.request_id).toEqual(expect.any(String));
  });

  it('returns 500 when a written service has zero assignments', async () => {
    rpc.mockReturnValue({
      overrideTypes: () => Promise.resolve({
        data: [{ service_id: 'service-week-1', week_number: 1, service_date: '2026-09-06', assignment_count: 0 }],
        error: null,
      }),
    });

    const response = await POST(post({ month: 8, year: 2026 }) as never);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ code: 'post_write_invariant_failed' });
  });
});
