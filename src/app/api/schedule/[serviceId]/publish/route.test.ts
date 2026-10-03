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
 * Route-level contract tests for `POST /api/schedule/[serviceId]/publish`.
 *
 * Publish is the LAST re-assertion point. The database helper
 * `assert_service_meets_publication_rules` independently refuses a schedule with
 * unfilled positions, so this route's job is the TypeScript half: re-run the
 * validator at final stage and refuse on a hard critical before the RPC is
 * reached. Both layers are asserted here so neither can be removed alone.
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

/** Validated for the current version, which is the only publishable state. */
function service(overrides: Partial<Service> = {}): Service {
  return {
    id: 'service-week-1', church_id: 'church-1', ministry_id: MINISTRY_ID,
    date: '2026-10-04', week_number: 1, month: 10, year: 2026,
    service_type: 'sunday', status: 'validated', schedule_version: 3, validated_version: 3,
    unfilled_positions: [], active_overrides: {}, created_at: '', updated_at: '',
    ...overrides,
  };
}

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
  return new Request('https://app.test/api/schedule/service-week-1/publish', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never;
}

function callPost(body: unknown = { expected_version: 3 }) {
  return POST(postRequest(body), { params: Promise.resolve({ serviceId: 'service-week-1' }) });
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

describe('POST /api/schedule/[serviceId]/publish', () => {
  it('publishes a complete, validated schedule', async () => {
    const response = await callPost();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.status).toBe('published');
    expect(body.published_by).toBe('user-1');
    expect(rpc).toHaveBeenCalledWith('publish_service_schedule', expect.objectContaining({
      p_service_id: 'service-week-1',
      p_expected_version: 3,
    }));
  });

  it('refuses to publish when a deferred gap has reappeared as a critical', async () => {
    // The lineup lost its leader after validation. Publishing must re-assert Rule 5
    // rather than trusting the earlier validation pass.
    loadScheduleData.mockResolvedValue(contextData({ assignments: completeStored.filter((item) => !item.is_leader) }));

    const response = await callPost();
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.results.some((item: { check: string }) => item.check === 'leader_count_missing')).toBe(true);
    expect(body.unfilled_positions.map((gap: { role_name: string }) => gap.role_name)).toEqual(['Worship Leader']);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses to publish when a required instrument is no longer staffed', async () => {
    loadScheduleData.mockResolvedValue(contextData({ assignments: completeStored.filter((item) => item.instrument_id !== guitar.id) }));

    const response = await callPost();

    expect(response.status).toBe(422);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses to publish when the backup minimum is not met (below backup minimum)', async () => {
    // S9: publish stage re-asserts backup shortfall as hard critical. The lineup
    // lost a backup after validation, so the earlier validation pass is stale.
    loadScheduleData.mockResolvedValue(contextData({ assignments: completeStored.filter((item) => item.role_id !== backupRole.id) }));

    const response = await callPost();
    const body = await response.json();

    expect(response.status).toBe(422);
    const critical = body.results.filter((r: { severity: string }) => r.severity === 'critical').map((r: { check: string }) => r.check);
    expect(critical).toContain('backup_count_min');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses to publish a hard conflict that a recorded override cannot license', async () => {
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

  it('publishes a lineup whose availability conflict is covered by a recorded licence', async () => {
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
    expect(body.overridden_checks).toEqual(['availability']);
    // The licence travels with the published record so the override is auditable
    // after the fact, not just at the moment of the click.
    expect(body.active_overrides).toEqual({ availability: true });
  });

  it('refuses a draft that was never validated for its current version', async () => {
    // validated_version lagging schedule_version is how an edit-after-validation
    // is detected; publishing it would skip validation entirely.
    serviceQuery.maybeSingle.mockResolvedValue({ data: service({ validated_version: 2 }), error: null });

    const response = await callPost();

    expect(response.status).toBe(409);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses a schedule that is not in the validated state', async () => {
    serviceQuery.maybeSingle.mockResolvedValue({ data: service({ status: 'draft', validated_version: undefined }), error: null });

    const response = await callPost();

    expect(response.status).toBe(409);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects a stale expected_version', async () => {
    const response = await callPost({ expected_version: 1 });

    expect(response.status).toBe(409);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('requires an integer expected_version', async () => {
    for (const body of [{}, { expected_version: 1.5 }, { expected_version: '3' }]) {
      const response = await callPost(body);
      expect(response.status).toBe(400);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it('requires staff', async () => {
    requireStaff.mockResolvedValue(new Response('nope', { status: 403 }));

    const response = await callPost();

    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('returns 404 for a schedule that is not this church\'s', async () => {
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
