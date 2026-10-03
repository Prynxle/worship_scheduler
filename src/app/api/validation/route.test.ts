import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Instrument,
  Member,
  MemberRole,
  Role,
  ScheduleAssignment,
  Service,
} from '@/lib/types/database';

/**
 * Route-level contract tests for `POST /api/validation`.
 *
 * Validation is one of the two lifecycle re-assertion points: it is where every
 * rule that a draft was allowed to defer comes back as a hard critical. These
 * tests therefore pin the *stage* of this route above all else. A regression that
 * quietly ran this surface at draft stage would let a partial month be marked
 * `validated` and published, and it would not fail any other test in the suite.
 *
 * The database and network collaborators are mocked; the validator and `gaps.ts`
 * run for real so the assertions are about the actual decision code.
 */

const requireStaff = vi.fn();
const getAdminClient = vi.fn();
const loadScheduleData = vi.fn();
const rpc = vi.fn();
const serviceQuery = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() };

vi.mock('@/lib/auth/server', () => ({
  requireStaff: (request: Request) => requireStaff(request),
  getAdminClient: () => getAdminClient(),
}));

vi.mock('@/lib/scheduling/schedule-data', () => ({
  loadScheduleData: (churchId: string, month: number, year: number, ministryId?: string) =>
    loadScheduleData(churchId, month, year, ministryId),
}));

const { POST } = await import('./route');

const auth = {
  authId: 'auth-1', userId: 'user-1', memberId: 'member-1', churchId: 'church-1',
  fullName: 'Zed', memberName: 'Zed', phone: null, role: 'admin' as const,
};

const MINISTRY_ID = 'ministry-9';

const leaderRole: Role = {
  id: 'role-leader', ministry_id: MINISTRY_ID, name: 'Worship Leader',
  min_required: 1, max_allowed: 1, priority: 1, is_active: true, created_at: '',
};
const backupRole: Role = {
  id: 'role-backup', ministry_id: MINISTRY_ID, name: 'Backup Singer',
  min_required: 0, max_allowed: 10, priority: 2, is_active: true, created_at: '',
};
const instrumentalistRole: Role = {
  id: 'role-instrumentalist', ministry_id: MINISTRY_ID, name: 'Instrumentalist',
  min_required: 0, max_allowed: 10, priority: 3, is_active: true, created_at: '',
};
const guitar: Instrument = {
  id: 'instrument-guitar-1', ministry_id: MINISTRY_ID, name: 'Guitar 1',
  is_required: true, min_count: 1, max_count: 1, slot_counts: false, created_at: '',
};

function memberRole(role: Role, memberId: string): MemberRole {
  return {
    id: `mr-${memberId}-${role.id}`, member_id: memberId, role_id: role.id,
    skill_level: 'expert', is_preferred: true, created_at: '', role,
  };
}

function member(overrides: Partial<Member> = {}): Member {
  return {
    id: 'm-1', church_id: 'church-1', full_name: 'Member One', status: 'active',
    max_monthly_assignments: 3, priority_score: 1, total_assignments: 0,
    created_at: '', updated_at: '', ...overrides,
  };
}

const leader = member({ id: 'm-leader', full_name: 'Leader', roles: [memberRole(leaderRole, 'm-leader')] });
const backups = ['m-b1', 'm-b2', 'm-b3'].map((id, index) =>
  member({ id, full_name: `Backup ${index + 1}`, roles: [memberRole(backupRole, id)] }));
const guitarist = member({
  id: 'm-guitar', full_name: 'Guitarist', roles: [memberRole(instrumentalistRole, 'm-guitar')],
  skills: [{ id: 'sk-1', member_id: 'm-guitar', instrument_id: guitar.id, skill_level: 'expert', is_primary: true, created_at: '', instrument: guitar }],
});

function service(overrides: Partial<Service> = {}): Service {
  return {
    id: 'service-week-1', church_id: 'church-1', ministry_id: MINISTRY_ID,
    date: '2026-10-04', week_number: 1, month: 10, year: 2026,
    service_type: 'sunday', status: 'draft', schedule_version: 3,
    unfilled_positions: [], active_overrides: {}, created_at: '', updated_at: '',
    ...overrides,
  };
}

/** The STORED lineup, as `loadScheduleData` would return it for this service. */
function storedAssignment(overrides: Partial<ScheduleAssignment> = {}): ScheduleAssignment {
  return {
    id: 'a-1', service_id: 'service-week-1', member_id: leader.id, role_id: leaderRole.id,
    is_leader: true, status: 'pending', created_at: '', updated_at: '',
    member: leader, role: leaderRole, ...overrides,
  };
}

const completeStored = [
  storedAssignment({ id: 'a-leader' }),
  ...backups.map((each, index) => storedAssignment({
    id: `a-b${index}`, member_id: each.id, role_id: backupRole.id, is_leader: false, member: each, role: backupRole,
  })),
  storedAssignment({
    id: 'a-guitar', member_id: guitarist.id, role_id: instrumentalistRole.id, is_leader: false,
    member: guitarist, role: instrumentalistRole, instrument_id: guitar.id, instrument: guitar,
  }),
];

function contextData(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    members: [leader, ...backups, guitarist],
    roles: [leaderRole, backupRole, instrumentalistRole],
    instruments: [guitar],
    assignments: completeStored as ScheduleAssignment[],
    monthlyAssignments: [] as ScheduleAssignment[],
    rules: [{ rule_type: 'backup_count', severity: 'critical' as const, rule_config: { min_required: 3, max_allowed: 3 } }],
    config: {},
    ...overrides,
  };
}

function postRequest(body: unknown) {
  return new Request('https://app.test/api/validation', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never;
}

function callPost(body: unknown = { service_id: 'service-week-1', expected_version: 3 }) {
  return POST(postRequest(body));
}

beforeEach(() => {
  vi.clearAllMocks();
  requireStaff.mockResolvedValue(auth);
  serviceQuery.select.mockReturnValue(serviceQuery);
  serviceQuery.eq.mockReturnValue(serviceQuery);
  serviceQuery.maybeSingle.mockResolvedValue({ data: service(), error: null });
  getAdminClient.mockReturnValue({ from: () => serviceQuery, rpc });
  rpc.mockResolvedValue({ data: null, error: null });
  loadScheduleData.mockResolvedValue(contextData());
});

describe('POST /api/validation', () => {
  it('validates a complete lineup and transitions the service', async () => {
    const response = await callPost();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.valid).toBe(true);
    expect(body.status).toBe('validated');
    expect(body.validated_by).toBe('user-1');
    expect(body.is_complete).toBe(true);
    expect(body.unfilled_positions).toEqual([]);
    expect(rpc).toHaveBeenCalledWith('validate_service_schedule', expect.objectContaining({
      p_service_id: 'service-week-1',
      p_expected_version: 3,
    }));
  });

  it('RE-ASSERTS a draft-deferred gap as a hard critical, refusing to validate', async () => {
    // The draft stage let this lineup be saved. Validation is where that
    // leniency ends, and it must end regardless of what the draft allowed.
    loadScheduleData.mockResolvedValue(contextData({ assignments: completeStored.filter((item) => !item.is_leader) }));

    const response = await callPost();
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.valid).toBe(false);
    const critical = body.results.filter((item: { severity: string }) => item.severity === 'critical').map((item: { check: string }) => item.check);
    expect(critical).toContain('leader_count_missing');
    // The refusal still tells the coordinator exactly what is unfilled.
    expect(body.unfilled_positions.map((gap: { role_name: string }) => gap.role_name)).toEqual(['Worship Leader']);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses to validate when the backup minimum is not met (below backup minimum)', async () => {
    // S9: validate stage re-asserts backup shortfall as hard critical.
    const shortBackups = completeStored.filter((item) => item.role_id !== backupRole.id);
    loadScheduleData.mockResolvedValue(contextData({ assignments: shortBackups }));
    const response = await callPost();
    const body = await response.json();
    expect(response.status).toBe(422);
    expect(body.valid).toBe(false);
    const critical = body.results.filter((r: { severity: string }) => r.severity === 'critical').map((r: { check: string }) => r.check);
    expect(critical).toContain('backup_count_min');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('honours a recorded availability licence, so a deliberate override can still be validated', async () => {
    const unavailableBackup = {
      ...backups[0],
      availability: [{ id: 'av-1', member_id: backups[0].id, church_id: 'church-1', type: 'weekly' as const, week_number: 1, status: 'approved' as const, created_at: '' }],
    };
    const stored = completeStored.map((item) => (item.member_id === unavailableBackup.id ? { ...item, member: unavailableBackup } : item));
    loadScheduleData.mockResolvedValue(contextData({
      members: [leader, unavailableBackup, ...backups.slice(1), guitarist],
      assignments: stored,
    }));
    serviceQuery.maybeSingle.mockResolvedValue({ data: service({ active_overrides: { availability: true } }), error: null });

    const response = await callPost();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.valid).toBe(true);
    // The licence is disclosed in the response, not applied invisibly.
    expect(body.overridden_checks).toEqual(['availability']);
    expect(body.results.find((item: { check: string }) => item.check === 'availability'))
      .toMatchObject({ severity: 'warning', deferred_until: 'publish' });
  });

  it('does NOT honour an override for a hard rule, even when the service claims one', async () => {
    // Two leaders, with an availability licence on file. The licence must not
    // reach leader_count_multiple.
    const stored = [
      ...completeStored,
      storedAssignment({ id: 'a-leader-2', member_id: backups[0].id, role_id: leaderRole.id, is_leader: true, member: backups[0], role: leaderRole }),
    ];
    loadScheduleData.mockResolvedValue(contextData({ assignments: stored }));
    serviceQuery.maybeSingle.mockResolvedValue({ data: service({ active_overrides: { availability: true, instrument_qualification: true } }), error: null });

    const response = await callPost();
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.results.some((item: { check: string; severity: string }) => item.check === 'leader_count_multiple' && item.severity === 'critical')).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('ignores a licence key that is not in the allowlist', async () => {
    const stored = completeStored.map((item) => (item.member_id === backups[0].id ? {
      ...item,
      member: {
        ...item.member,
        roles: [memberRole(leaderRole, backups[0].id)],
      },
      role: leaderRole,
    } : item));
    loadScheduleData.mockResolvedValue(contextData({ assignments: stored }));
    serviceQuery.maybeSingle.mockResolvedValue({ data: service({ active_overrides: { leader_qualification: true } as never }), error: null });

    const response = await callPost();

    expect(response.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('requires staff', async () => {
    requireStaff.mockResolvedValue(new Response('nope', { status: 403 }));

    const response = await callPost();

    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects a stale expected_version', async () => {
    const response = await callPost({ service_id: 'service-week-1', expected_version: 1 });

    expect(response.status).toBe(409);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('requires a service_id and an integer expected_version', async () => {
    for (const body of [{}, { service_id: 'service-week-1' }, { service_id: 'service-week-1', expected_version: 1.5 }, { service_id: '', expected_version: 3 }]) {
      const response = await callPost(body);
      expect(response.status).toBe(400);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it('only validates a draft schedule', async () => {
    serviceQuery.maybeSingle.mockResolvedValue({ data: service({ status: 'published' }), error: null });

    const response = await callPost();

    expect(response.status).toBe(409);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns 404 for a service that is not this church\'s', async () => {
    serviceQuery.maybeSingle.mockResolvedValue({ data: null, error: null });

    const response = await callPost();

    expect(response.status).toBe(404);
  });

  it('surfaces a permission failure from the transition as 403', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'permission denied' } });

    const response = await callPost();

    expect(response.status).toBe(403);
  });
});
