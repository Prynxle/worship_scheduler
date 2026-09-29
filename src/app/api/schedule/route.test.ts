import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Instrument, Member, Role, ScheduleAssignment, Service } from '@/lib/types/database';
import type { GeneratedService, ScheduleContext } from '@/lib/types/scheduling';
import { SchedulingFailureError } from '@/lib/types/scheduling';

/**
 * Route-level contract tests for the COMPOSITE `GET`/`POST /api/schedule`
 * produced by merging `fix/scheduler-hardening` with `origin/staging`.
 *
 * These mock only the collaborators (`requireStaff`, `getAdminClient`,
 * `loadScheduleData`, `loadAvailabilityReadiness`, `SchedulingEngine`) and
 * assert observable behaviour. The persistence layer is deliberately NOT
 * mocked: `@/lib/scheduling/persistence` and `@/lib/scheduling/role-classifier`
 * run for real, so the instrumentalist regression below is a genuine
 * end-to-end assertion about the bytes that reach the RPC, not a mock echo.
 *
 * The clock is pinned, because the route derives "which Sundays have passed"
 * from `Date.now()`. October 2026 (Sundays 4, 11, 18, 25) is used as the
 * generatable month: at a 1 October 2026 clock every one of its four Sundays
 * is still ahead, so a request for the whole month is a realistic 201.
 */

const requireStaff = vi.fn();
const getAdminClient = vi.fn();
const loadScheduleData = vi.fn();
const loadAvailabilityReadiness = vi.fn();
const generateSchedule = vi.fn();
const engineContexts: ScheduleContext[] = [];
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

vi.mock('@/lib/scheduling/availability-readiness', () => ({
  loadAvailabilityReadiness: (churchId: string, month: number, year: number, ministryId?: string) =>
    loadAvailabilityReadiness(churchId, month, year, ministryId),
}));

vi.mock('@/lib/scheduling/engine', () => ({
  SchedulingEngine: class {
    constructor(context: ScheduleContext) {
      engineContexts.push(context);
    }
    generateSchedule() {
      return generateSchedule();
    }
  },
}));

const { GET, POST } = await import('./route');

const auth = {
  authId: 'auth-1', userId: 'user-1', memberId: 'member-1', churchId: 'church-1',
  fullName: 'Zed', memberName: 'Zed', phone: null, role: 'admin' as const,
};

const MINISTRY_ID = 'ministry-9';

const readinessReady = {
  month: 9, year: 2026, ministry_id: MINISTRY_ID, ministry_name: 'Worship',
  ministries: [{ id: MINISTRY_ID, name: 'Worship' }],
  required_members: 2, submitted_count: 2, approved_count: 2, outstanding_count: 0,
  ready: true, members: [],
};

const readinessBlocked = { ...readinessReady, ready: false, approved_count: 1, outstanding_count: 1 };

function service(overrides: Partial<Service> = {}): Service {
  return {
    id: 'service-week-1', church_id: 'church-1', ministry_id: MINISTRY_ID,
    date: '2026-10-04', week_number: 1, month: 9, year: 2026,
    service_type: 'sunday', status: 'draft', created_at: '', updated_at: '',
    ...overrides,
  };
}

function assignment(overrides: Partial<ScheduleAssignment> = {}): ScheduleAssignment {
  return {
    id: 'a-1', service_id: 'service-week-1', member_id: 'm-1', role_id: 'role-backup',
    is_leader: false, status: 'pending', created_at: '', updated_at: '',
    ...overrides,
  };
}

const instrumentalistRole: Role = {
  id: 'role-instrumentalist', ministry_id: MINISTRY_ID, name: 'Instrumentalist',
  min_required: 0, max_allowed: 10, priority: 2, is_active: true, created_at: '',
};
const guitar: Instrument = {
  id: 'instrument-guitar-1', ministry_id: MINISTRY_ID, name: 'Guitar 1',
  is_required: true, min_count: 1, max_count: 1, created_at: '',
};
/** The live-data shape that used to be dropped: role 'Instrumentalist', instrument 'Guitar 1'. */
const instrumentalist: Member = {
  id: 'm-instrumentalist', church_id: 'church-1', full_name: 'Instrumentalist',
  status: 'active', max_monthly_assignments: 3, priority_score: 1, total_assignments: 0,
  created_at: '', updated_at: '', roles: [{
    id: 'mr-1', member_id: 'm-instrumentalist', role_id: instrumentalistRole.id,
    skill_level: 'advanced', is_preferred: true, created_at: '', role: instrumentalistRole,
  }],
};

function generated(weekNumber = 1, date = '2026-10-04'): GeneratedService {
  return { week_number: weekNumber, date, leader: null, backup_singers: [], instrumentalists: [], devotion: null, conflicts: [] };
}

/** The four Sundays of October 2026, one generated service each. */
const octoberGeneration = [1, 2, 3, 4].map((week) => generated(week, ['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25'][week - 1]));

function post(body: unknown): Request {
  return new Request('https://app.test/api/schedule', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function get(query = 'month=9&year=2026'): Request {
  return new Request(`https://app.test/api/schedule?${query}`);
}

/** Resolve the RPC with the given `UUID[]` the RPC actually returns. */
function rpcReturns(data: string[] | null, error: unknown = null) {
  rpc.mockReturnValue({ overrideTypes: () => Promise.resolve({ data, error }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  engineContexts.length = 0;
  // The error layer logs every failure server-side; several tests assert on a
  // logged failure, so the expected noise is silenced rather than printed.
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.useFakeTimers();
  // 1 October 2026: every October Sunday (4, 11, 18, 25) is still ahead.
  vi.setSystemTime(new Date(2026, 9, 1, 10, 0, 0));
  rpcReturns(['service-uuid-1', 'service-uuid-2', 'service-uuid-3', 'service-uuid-4']);
  from.mockReturnValue({ select: vi.fn(), insert: vi.fn(), delete: vi.fn(), update: vi.fn() });
  getAdminClient.mockReturnValue({ rpc, from });
  requireStaff.mockResolvedValue(auth);
  loadAvailabilityReadiness.mockResolvedValue(readinessReady);
  loadScheduleData.mockResolvedValue({
    services: [], assignments: [], monthlyAssignments: [], members: [], roles: [], instruments: [], rules: [], config: {},
  });
  generateSchedule.mockResolvedValue(octoberGeneration);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GET /api/schedule', () => {
  it('returns the auth layer rejection untouched and reads nothing', async () => {
    const denied = Response.json({ error: 'Forbidden' }, { status: 403 });
    requireStaff.mockResolvedValue(denied);

    const response = await GET(get() as never);

    expect(response).toBe(denied);
    expect(loadAvailabilityReadiness).not.toHaveBeenCalled();
  });

  it('resolves the ministry through readiness and returns the rich payload', async () => {
    loadScheduleData.mockResolvedValue({
      services: [service({ schedule_version: 3, ministry_id: MINISTRY_ID })],
      assignments: [], monthlyAssignments: [],
      members: [
        { id: 'm-1', full_name: 'Active', status: 'active', roles: [{ role: { id: 'r-1', name: 'Backup' } }], skills: [] },
        { id: 'm-2', full_name: 'Inactive', status: 'inactive', roles: [], skills: [] },
      ],
      roles: [{ id: 'r-1', name: 'Backup' }], instruments: [{ id: 'i-1', name: 'Guitar 1' }],
      rules: [], config: {},
    });

    const response = await GET(get() as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    // Readiness is the ministry authority: the read is scoped by the id it
    // resolved against this church's active ministries, never by raw input.
    expect(loadAvailabilityReadiness).toHaveBeenCalledWith('church-1', 9, 2026, undefined);
    expect(loadScheduleData).toHaveBeenCalledWith('church-1', 9, 2026, MINISTRY_ID);
    expect(body).toMatchObject({ month: 9, year: 2026, church_id: 'church-1', ministry_id: MINISTRY_ID, ministry_name: 'Worship' });
    // Only active members are offered to the lineup editor.
    expect(body.members.map((member: { full_name: string }) => member.full_name)).toEqual(['Active']);
    // The per-service workflow fields the page renders must survive the merge.
    expect(body.services[0]).toMatchObject({ ministry_id: MINISTRY_ID, legacy_unscoped: false, schedule_version: 3, assignments: [] });
  });

  it('marks a ministry-unscoped historical service as legacy', async () => {
    loadScheduleData.mockResolvedValue({
      services: [service({ id: 'legacy-1', ministry_id: null })], assignments: [], monthlyAssignments: [],
      members: [], roles: [], instruments: [], rules: [], config: {},
    });

    const body = await (await GET(get() as never)).json();

    expect(body.services[0]).toMatchObject({ ministry_id: null, legacy_unscoped: true });
  });

  it('normalises an archived service to draft in the display status', async () => {
    loadScheduleData.mockResolvedValue({
      services: [service({ id: 'archived-1', status: 'archived' })], assignments: [], monthlyAssignments: [],
      members: [], roles: [], instruments: [], rules: [], config: {},
    });

    const body = await (await GET(get() as never)).json();

    expect(body.services[0].status).toBe('draft');
  });

  it('returns 400 for an out-of-range month without touching the database', async () => {
    const response = await GET(get('month=12&year=2026') as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'invalid_month_year' });
    expect(loadScheduleData).not.toHaveBeenCalled();
  });
});

describe('POST /api/schedule — auth and body parsing', () => {
  it('returns the auth layer rejection untouched and writes nothing', async () => {
    const denied = Response.json({ error: 'Forbidden' }, { status: 403 });
    requireStaff.mockResolvedValue(denied);

    const response = await POST(post({ month: 9, year: 2026 }) as never);

    expect(response).toBe(denied);
    expect(rpc).not.toHaveBeenCalled();
    expect(getAdminClient).not.toHaveBeenCalled();
  });

  it.each([
    ['malformed JSON', '{not json', 'invalid_json'],
    ['a JSON array', '[]', 'invalid_body'],
    ['a JSON null', 'null', 'invalid_body'],
  ])('returns 400 for %s without reaching the database', async (_label, raw, code) => {
    const response = await POST(post(raw) as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns 400 for a non-boolean regenerate', async () => {
    const response = await POST(post({ month: 9, year: 2026, regenerate: 'yes' }) as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'invalid_regenerate' });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('POST /api/schedule — readiness gate', () => {
  it('returns 409 with the readiness payload when the month is not approved', async () => {
    loadAvailabilityReadiness.mockResolvedValue(readinessBlocked);

    const response = await POST(post({ month: 9, year: 2026 }) as never);
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.code).toBe('availability_not_ready');
    // The page reads `readiness` off the failure so the coordinator can see WHO
    // is outstanding; a bare 409 would force a second round trip.
    expect(body.readiness).toMatchObject({ ready: false, required_members: 2, outstanding_count: 1 });
    expect(loadScheduleData).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('scopes the schedule read by readiness.ministry_id, never by the request body', async () => {
    await POST(post({ month: 9, year: 2026, ministry_id: 'attacker-ministry' }) as never);

    // Readiness re-validates the requested ministry against this church's
    // active ministries and returns the resolved id; that resolved id, not the
    // caller's string, is what scopes the read and the write.
    expect(loadScheduleData).toHaveBeenCalledWith('church-1', 9, 2026, MINISTRY_ID);
    expect(rpc).toHaveBeenCalledWith('persist_month_schedule', expect.objectContaining({ p_ministry_id: MINISTRY_ID }));
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('attacker-ministry');
  });
});

describe('POST /api/schedule — month and week validation', () => {
  it('rejects a month that has already passed with 400', async () => {
    vi.setSystemTime(new Date(2026, 8, 29, 10, 0, 0));

    const response = await POST(post({ month: 7, year: 2026 }) as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'past_month' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('names the month when the current month has no Sunday left', async () => {
    // 29 September 2026: September's Sundays (6, 13, 20, 27) are all behind us,
    // so the month can never be generated -- whatever the availability state is.
    // This used to fall through to the generic `week_numbers` complaint, which
    // reads as a malformed client payload and tells the coordinator nothing.
    vi.setSystemTime(new Date(2026, 8, 29, 10, 0, 0));

    const response = await POST(post({ month: 8, year: 2026 }) as never);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.code).toBe('no_upcoming_sundays');
    expect(body.error).toBe('September 2026 has no upcoming Sundays left. Choose a future month.');
    // Reported before the readiness gate: a month with no dates left is not an
    // availability problem, and telling the coordinator to chase approvals for an
    // ungeneratable month is the same dead end in a different costume.
    expect(loadAvailabilityReadiness).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('still names the month when the caller supplies week_numbers for a spent month', async () => {
    vi.setSystemTime(new Date(2026, 8, 29, 10, 0, 0));

    const response = await POST(post({ month: 8, year: 2026, week_numbers: [4] }) as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'no_upcoming_sundays', error: 'September 2026 has no upcoming Sundays left. Choose a future month.' });
  });

  it('rejects a week whose Sunday has already passed', async () => {
    // Mid-month, so the month still has Sundays left (weeks 3 and 4) and this
    // isolates the per-week check from the whole-month one above.
    vi.setSystemTime(new Date(2026, 8, 15, 10, 0, 0));

    const response = await POST(post({ month: 8, year: 2026, week_numbers: [1] }) as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'past_service_date' });
  });

  it('generates the remaining weeks of a partly-spent month', async () => {
    vi.setSystemTime(new Date(2026, 8, 15, 10, 0, 0));
    // Weeks 1 and 2 (6 and 13 September) are behind us, so the engine is asked
    // for weeks 3 and 4 only and the RPC returns exactly those two service ids.
    generateSchedule.mockResolvedValue([generated(3, '2026-09-20'), generated(4, '2026-09-27')]);
    rpcReturns(['service-uuid-3', 'service-uuid-4']);

    const response = await POST(post({ month: 8, year: 2026 }) as never);

    // The default request is the future weeks only, which is also what the RPC
    // insists on -- it refuses any service dated in the past.
    expect(response.status).toBe(201);
    // The engine is told the surviving weeks, so it never proposes a service on
    // a Sunday that has already gone by.
    expect(engineContexts.at(-1)).toMatchObject({ month: 8, year: 2026, week_numbers: [3, 4] });
    expect(rpc).toHaveBeenCalledWith('persist_month_schedule', expect.objectContaining({
      p_month: 8,
      p_year: 2026,
      p_services: [
        expect.objectContaining({ week_number: 3, date: '2026-09-20' }),
        expect.objectContaining({ week_number: 4, date: '2026-09-27' }),
      ],
    }));
  });

  it('rejects a duplicated service week', async () => {
    const response = await POST(post({ month: 9, year: 2026, week_numbers: [1, 1] }) as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'duplicate_week' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects a week outside the month without calling the RPC', async () => {
    const response = await POST(post({ month: 9, year: 2026, week_numbers: [9] }) as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'invalid_week_numbers' });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('POST /api/schedule — monthly-limit ledger', () => {
  it('builds both assignment sets from monthlyAssignments, never from assignments', async () => {
    // `assignments` is filtered by ministry-scoped service ids; `monthlyAssignments`
    // by every non-archived service in the month. The monthly-limit ledger
    // (Rule 2) must see the wider set, or a legacy or other-ministry assignment
    // is under-counted and a member can exceed their monthly limit.
    const scoped = assignment({ id: 'a-scoped', service_id: 'service-week-1', member_id: 'm-1' });
    const other = assignment({ id: 'a-other', service_id: 'service-other-ministry', member_id: 'm-2' });
    loadScheduleData.mockResolvedValue({
      services: [service()], assignments: [scoped], monthlyAssignments: [scoped, other],
      members: [], roles: [], instruments: [], rules: [], config: {},
    });
    generateSchedule.mockResolvedValue([generated(1)]);

    await POST(post({ month: 9, year: 2026, week_numbers: [1] }) as never);

    const context = engineContexts[0];
    expect(context.historical_assignments).toEqual([scoped, other]);
    // Week 1 is being replaced, so only the out-of-scope assignment survives into
    // `existing_assignments` -- and it is the one `assignments` would have hidden.
    expect(context.existing_assignments).toEqual([other]);
  });
});

describe('POST /api/schedule — persistence', () => {
  it('writes the month through persist_month_schedule, never replace_month_schedule', async () => {
    const response = await POST(post({ month: 9, year: 2026 }) as never);

    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe('persist_month_schedule');
    expect(rpc).toHaveBeenCalledWith('persist_month_schedule', expect.objectContaining({
      p_church_id: 'church-1', p_ministry_id: MINISTRY_ID, p_month: 9, p_year: 2026, p_actor_id: 'user-1', p_replace_existing: false,
    }));
    await expect(response.json()).resolves.toMatchObject({ month: 9, year: 2026, ministry_id: MINISTRY_ID });
  });

  it('passes p_replace_existing only when regenerate was requested', async () => {
    await POST(post({ month: 9, year: 2026, regenerate: true }) as never);

    expect(rpc).toHaveBeenCalledWith('persist_month_schedule', expect.objectContaining({ p_replace_existing: true }));
  });

  it('never writes services or assignments directly from the route', async () => {
    // The regression this guards: the pre-merge writer deleted and re-inserted
    // services/assignments row-by-row with no transaction.
    await POST(post({ month: 9, year: 2026 }) as never);

    expect(from).not.toHaveBeenCalled();
  });

  it('takes church_id from auth only, never from the request body', async () => {
    await POST(post({ month: 9, year: 2026, church_id: 'attacker-church' }) as never);

    expect(rpc).toHaveBeenCalledWith('persist_month_schedule', expect.objectContaining({ p_church_id: 'church-1' }));
    expect(JSON.stringify(rpc.mock.calls)).not.toContain('attacker-church');
  });

  it('sends local, not UTC, service dates for every week', async () => {
    await POST(post({ month: 9, year: 2026 }) as never);

    // `formatLocalDate`, never `toISOString().slice(0, 10)`: a UTC slice moves a
    // local Sunday back a day east of Greenwich, which then fails the RPC's
    // `dow = 0` check and `set_week_number`.
    const sent = rpc.mock.calls[0][1].p_services as Array<{ date: string; week_number: number }>;
    expect(sent.map((entry) => entry.date)).toEqual(['2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25']);
  });

  it('persists an instrumentalist whose only role is the generic Instrumentalist role', async () => {
    // THE regression. The pre-merge inline predicates matched neither
    // `name.includes('Guitar 1')` nor `/guitar|drum|pian|keyboard/`, so every
    // instrumentalist in the live roster was SILENTLY DROPPED while the request
    // still returned 201.
    generateSchedule.mockResolvedValue([{
      ...generated(1), instrumentalists: [{ instrument: guitar, member: instrumentalist, is_fallback: false }],
    }]);
    rpcReturns(['service-uuid-1']);

    const response = await POST(post({ month: 9, year: 2026, week_numbers: [1] }) as never);
    const sent = rpc.mock.calls[0][1].p_services as Array<{ assignments: Array<Record<string, unknown>> }>;

    expect(response.status).toBe(201);
    expect(sent[0].assignments).toEqual([
      { member_id: instrumentalist.id, role_id: instrumentalistRole.id, instrument_id: guitar.id, is_leader: false },
    ]);
  });

  it('fails closed before the write when a generated role cannot be resolved', async () => {
    generateSchedule.mockResolvedValue([{
      ...generated(1), instrumentalists: [{ instrument: guitar, member: { ...instrumentalist, roles: [] }, is_fallback: false }],
    }]);

    const response = await POST(post({ month: 9, year: 2026, week_numbers: [1] }) as never);

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ code: 'unresolvable_role' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns 500 with a request_id when the RPC writes fewer services than requested', async () => {
    // Post-write invariant: a silent partial month must never read as success.
    // `persist_month_schedule` returns the `UUID[]` it inserted, so arity is the
    // only thing provable without a second verification query.
    rpcReturns(['service-uuid-1']);

    const response = await POST(post({ month: 9, year: 2026 }) as never);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.code).toBe('post_write_invariant_failed');
    expect(body.request_id).toEqual(expect.any(String));
  });
});

describe('POST /api/schedule — protection and error mapping', () => {
  it('returns 409 with service_ids for a published service and never calls the RPC', async () => {
    loadScheduleData.mockResolvedValue({
      services: [service({ status: 'published' })], assignments: [], monthlyAssignments: [],
      members: [], roles: [], instruments: [], rules: [], config: {},
    });

    const response = await POST(post({ month: 9, year: 2026 }) as never);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ service_ids: ['service-week-1'] });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('preserves the SchedulingFailureError response shape exactly', async () => {
    generateSchedule.mockRejectedValue(new SchedulingFailureError([{
      week_number: 1, date: '2026-10-04', role_name: 'Worship Leader',
      required_slots: 1, eligible_candidates: [], rejected_candidates: [],
      message: 'No eligible worship leader for Week 1',
    }]));

    const response = await POST(post({ month: 9, year: 2026 }) as never);
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.services).toEqual([]);
    expect(body.validation).toEqual([]);
    expect(body.failures).toHaveLength(1);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('maps a data-integrity SQLSTATE to 500 without disclosing driver detail', async () => {
    rpcReturns(null, { code: '23503', message: 'insert or update on table "audit_logs" violates foreign key constraint "audit_logs_church_id_fkey"' });

    const response = await POST(post({ month: 9, year: 2026 }) as never);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.code).toBe('foreign_key_violation');
    expect(JSON.stringify(body)).not.toContain('audit_logs');
  });

  it('collapses an unexpected thrown value to a generic 500 with a request_id', async () => {
    generateSchedule.mockRejectedValue(new Error('postgres://user:pass@host/db leaked'));

    const response = await POST(post({ month: 9, year: 2026 }) as never);
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toMatchObject({ code: 'internal_error', error: 'An unexpected error occurred. Please try again.' });
    expect(JSON.stringify(body)).not.toContain('postgres://');
    expect(body.request_id).toEqual(expect.any(String));
  });
});
