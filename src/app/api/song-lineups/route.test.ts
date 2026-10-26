import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { getAuthContext, getAdminClient, verifyReachableHttpUrl } = vi.hoisted(() => ({ getAuthContext: vi.fn(), getAdminClient: vi.fn(), verifyReachableHttpUrl: vi.fn() }));
vi.mock('@/lib/auth/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/server')>()),
  getAuthContext: (...args: unknown[]) => getAuthContext(...args),
  getAdminClient: (...args: unknown[]) => getAdminClient(...args),
}));
vi.mock('@/lib/song-lineups/urls', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/song-lineups/urls')>()), verifyReachableHttpUrl: (...args: unknown[]) => verifyReachableHttpUrl(...args) }));

import { GET, POST } from './route';
import { resetRateLimiters } from '@/lib/api/rate-limit';
import { formatLocalDate } from '@/lib/utils/date-utils';

const auth = { authId: 'auth-1', userId: 'user-1', memberId: 'member-1', churchId: 'church-1', fullName: 'Leader', memberName: 'Leader', phone: null, role: 'member' as const };
const staffAuth = { ...auth, role: 'coordinator' as const };
/** Terminal step of the assignment chain; `makeQuery` attaches it. */
const maybeSingle = vi.fn();
const songs = [
  { title: 'Song One', song_url: 'https://example.com/one' },
  { title: 'Song Two', song_url: 'https://example.com/two' },
];

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/song-lineups', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

function makeGetRequest(month = 4, year = 2099) {
  return new NextRequest(`http://localhost/api/song-lineups?month=${month}&year=${year}`);
}

/** One assigned, future-dated service. `service` is the embedded relation POST reads. */
function assignmentFor(overrides: { availability_reset_at?: string | null; date?: string; church_id?: string } = {}) {
  return {
    data: {
      service_id: 'service-1',
      member_id: 'member-1',
      is_leader: true,
      service: { church_id: 'church-1', availability_reset_at: null, date: '2099-05-03', ...overrides },
    },
    error: null,
  };
}

/**
 * A PostgREST builder double. Every chain method returns the builder, and the
 * builder is thenable, so both `await chain(...)` and `await chain.order(...)`
 * resolve to the configured result. `resolve` swaps that result per test.
 * `maybeSingle` is the terminal call, so it is the shared mock the tests stub.
 */
function makeQuery(initial: { data?: unknown; error?: unknown }) {
  let result = initial;
  const query = {} as Record<string, unknown> & { resolve: (next: { data?: unknown; error?: unknown }) => void };
  for (const method of ['select', 'eq', 'neq', 'in', 'or', 'order']) {
    query[method] = vi.fn(() => query);
  }
  query.maybeSingle = maybeSingle;
  query.then = (onFulfilled: (value: unknown) => unknown) => Promise.resolve(result).then(onFulfilled);
  query.resolve = (next) => { result = next; };
  return query;
}

describe('GET /api/song-lineups', () => {
  let services: ReturnType<typeof makeQuery>;
  let assignments: ReturnType<typeof makeQuery>;
  let lineups: ReturnType<typeof makeQuery>;

  beforeEach(() => {
    vi.clearAllMocks();
    services = makeQuery({ data: [], error: null });
    assignments = makeQuery({ data: [], error: null });
    lineups = makeQuery({ data: [], error: null });
    maybeSingle.mockResolvedValue(assignmentFor());
    getAdminClient.mockReturnValue({
      from: vi.fn((table: string) => (table === 'services' ? services : table === 'song_lineups' ? lineups : assignments)),
      rpc: vi.fn(),
    });
  });

  it('requires authentication before opening a client', async () => {
    getAuthContext.mockResolvedValue(null);
    const response = await GET(makeGetRequest());
    expect(response.status).toBe(401);
    expect(getAdminClient).not.toHaveBeenCalled();
  });

  it('reads only non-archived services of this church that are not live stale drafts', async () => {
    getAuthContext.mockResolvedValue(staffAuth);

    const response = await GET(makeGetRequest(4, 2099));

    expect(response.status).toBe(200);
    // GH #97: a live, future-dated reset stamp hides the month's stale drafts
    // from Line Up Songs. The filter is server-side and unconditional, for staff
    // and members alike, and it is the exact complement of `isStaleDraft`
    // (`stamp IS NULL OR date < today`), so a past-dated stamp no longer hides a
    // week. Only the date value exists in this string, so it stays inert.
    expect(services.or).toHaveBeenCalledWith(
      `availability_reset_at.is.null,date.lt.${formatLocalDate(new Date())}`,
    );
    expect(services.eq).toHaveBeenCalledWith('church_id', 'church-1');
    expect(services.eq).toHaveBeenCalledWith('month', 4);
    expect(services.eq).toHaveBeenCalledWith('year', 2099);
    expect(services.neq).toHaveBeenCalledWith('status', 'archived');
    await expect(response.json()).resolves.toEqual({ services: [] });
  });

  it('returns no services to a member with no assignments instead of an unfiltered list', async () => {
    getAuthContext.mockResolvedValue(auth);

    const response = await GET(makeGetRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ services: [] });
    expect(services.or).toHaveBeenCalledWith(
      `availability_reset_at.is.null,date.lt.${formatLocalDate(new Date())}`,
    );
  });
});

describe('POST /api/song-lineups', () => {
  const rpc = vi.fn();
  let services: ReturnType<typeof makeQuery>;
  let assignments: ReturnType<typeof makeQuery>;

  beforeEach(() => {
    vi.clearAllMocks();
    // The limiter is module-level (5 / 60s), so this suite's POSTs would trip it.
    resetRateLimiters();
    getAuthContext.mockResolvedValue(auth);
    verifyReachableHttpUrl.mockResolvedValue(true);
    maybeSingle.mockResolvedValue(assignmentFor());
    services = makeQuery({ data: [], error: null });
    assignments = makeQuery({ data: [], error: null });
    rpc.mockResolvedValue({ data: 'lineup-1', error: null });
    getAdminClient.mockReturnValue({
      from: vi.fn((table: string) => (table === 'services' ? services : assignments)),
      rpc,
    });
  });

  it('requires a bearer-authenticated member', async () => {
    getAuthContext.mockResolvedValue(null);
    const response = await POST(makeRequest({ service_id: 'service-1', songs }));
    expect(response.status).toBe(401);
    expect(getAdminClient).not.toHaveBeenCalled();
  });

  it('rejects fewer than two songs before looking up an assignment', async () => {
    const response = await POST(makeRequest({ service_id: 'service-1', songs: songs.slice(0, 1) }));
    expect(response.status).toBe(400);
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it('rejects a leader assignment from another church', async () => {
    maybeSingle.mockResolvedValue(assignmentFor({ church_id: 'church-other' }));
    const response = await POST(makeRequest({ service_id: 'service-1', songs }));
    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses a stale schedule before verifying or saving any song (GH #97)', async () => {
    maybeSingle.mockResolvedValue(assignmentFor({ availability_reset_at: '2026-10-26T12:00:00Z', date: '2099-05-03' }));

    const response = await POST(makeRequest({ service_id: 'service-1', songs }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'schedule_pending_regeneration' });
    // The refusal is before the network URL check and before the RPC, so a
    // stale draft can never gain a song lineup.
    expect(verifyReachableHttpUrl).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('ignores a stamp on a week that has already passed', async () => {
    // Regeneration only reaches future weeks, so a past-dated stamp could never
    // be cleared. Honouring it would permanently lock a week that was played.
    maybeSingle.mockResolvedValue(assignmentFor({ availability_reset_at: '2026-10-26T12:00:00Z', date: '2020-01-05' }));

    const response = await POST(makeRequest({ service_id: 'service-1', songs }));

    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalled();
  });

  it('maps a W0004 from save_song_lineup to the same 409 refusal', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'W0004', message: 'Availability for this month was reset' } });

    const response = await POST(makeRequest({ service_id: 'service-1', songs }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'schedule_pending_regeneration' });
  });

  it('submits reachable songs for the assigned service using server-resolved tenant and member ids', async () => {
    const response = await POST(makeRequest({ service_id: 'service-1', church_id: 'church-other', member_id: 'member-other', songs }));
    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith('save_song_lineup', expect.objectContaining({ p_church_id: 'church-1', p_service_id: 'service-1', p_member_id: 'member-1' }));
  });

  it('does not save a song URL that fails safe reachability verification', async () => {
    verifyReachableHttpUrl.mockResolvedValue(false);
    const response = await POST(makeRequest({ service_id: 'service-1', songs }));
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});
