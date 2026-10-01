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
 * Route-level contract tests for `PUT /api/schedule/[serviceId]/assignments`.
 *
 * The collaborators that touch the database or the network are mocked
 * (`requireStaff`, `getAdminClient`, `loadScheduleData`); the validator and
 * `gaps.ts` run for real, so "a partial save is allowed" and "an override cannot
 * reach a hard rule" are assertions about the actual decision code rather than
 * about a stub's return value.
 *
 * The cases that matter most here are the negative ones. This route is the one
 * place a human can deliberately downgrade a `critical`, so the tests are written
 * to fail if that power ever widens.
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

const { PUT } = await import('./route');

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
const singerRole: Role = {
  id: 'role-singer', ministry_id: MINISTRY_ID, name: 'Singer',
  min_required: 0, max_allowed: 10, priority: 2, is_active: true, created_at: '',
};
const instrumentalistRole: Role = {
  id: 'role-instrumentalist', ministry_id: MINISTRY_ID, name: 'Instrumentalist',
  min_required: 0, max_allowed: 10, priority: 3, is_active: true, created_at: '',
};
const guitar: Instrument = {
  id: 'instrument-guitar-1', ministry_id: MINISTRY_ID, name: 'Guitar 1',
  is_required: true, min_count: 1, max_count: 1, created_at: '',
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
const backup1 = member({ id: 'm-b1', full_name: 'Backup One', roles: [memberRole(backupRole, 'm-b1')] });
const backup2 = member({ id: 'm-b2', full_name: 'Backup Two', roles: [memberRole(backupRole, 'm-b2')] });
const backup3 = member({ id: 'm-b3', full_name: 'Backup Three', roles: [memberRole(backupRole, 'm-b3')] });
/** The member who actually satisfies the required Guitar 1 position. */
const guitarist = member({
  id: 'm-guitar',
  full_name: 'Guitarist',
  roles: [memberRole(instrumentalistRole, 'm-guitar')],
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

function contextData(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    members: [leader, backup1, backup2, backup3, guitarist, unqualifiedGuitarist],
    roles: [leaderRole, backupRole, singerRole, instrumentalistRole],
    instruments: [guitar],
    assignments: [] as ScheduleAssignment[],
    monthlyAssignments: [] as ScheduleAssignment[],
    rules: [{ rule_type: 'backup_count', severity: 'critical' as const, rule_config: { min_required: 3, max_allowed: 3 } }],
    config: {},
    ...overrides,
  };
}

const guitaristSlot = { member_id: guitarist.id, role_id: instrumentalistRole.id, instrument_id: guitar.id, is_leader: false };

/** Leader + 3 backups + the required guitarist: nothing unfilled. */
const completeLineup = [
  { member_id: leader.id, role_id: leaderRole.id, instrument_id: null, is_leader: true },
  { member_id: backup1.id, role_id: backupRole.id, instrument_id: null, is_leader: false },
  { member_id: backup2.id, role_id: backupRole.id, instrument_id: null, is_leader: false },
  { member_id: backup3.id, role_id: backupRole.id, instrument_id: null, is_leader: false },
  guitaristSlot,
];

/**
 * Holds the Instrumentalist role but has NO skill row for Guitar 1. The role
 * check passes and the instrument check fails, which is exactly the S6 case:
 * a real person in a real role, staffed onto an instrument they cannot play.
 */
const unqualifiedGuitarist = member({
  id: 'm-fake-guitar',
  full_name: 'Unqualified Guitarist',
  roles: [memberRole(instrumentalistRole, 'm-fake-guitar')],
});

const unqualifiedGuitarLineup = completeLineup.slice(0, 4).concat({
  member_id: unqualifiedGuitarist.id, role_id: instrumentalistRole.id,
  instrument_id: guitar.id, is_leader: false,
});

/** The same week with the required instrument simply not staffed. */
const withoutGuitarist = completeLineup.slice(0, 4);

function putRequest(body: unknown) {
  return new Request('https://app.test/api/schedule/service-week-1/assignments', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never;
}

function callPut(body: unknown) {
  return PUT(putRequest(body), { params: Promise.resolve({ serviceId: 'service-week-1' }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireStaff.mockResolvedValue(auth);
  serviceQuery.select.mockReturnValue(serviceQuery);
  serviceQuery.eq.mockReturnValue(serviceQuery);
  serviceQuery.maybeSingle.mockResolvedValue({ data: service(), error: null });
  getAdminClient.mockReturnValue({ from: () => serviceQuery, rpc });
  rpc.mockResolvedValue({ data: 4, error: null });
  loadScheduleData.mockResolvedValue(contextData());
});

describe('PUT /api/schedule/[serviceId]/assignments', () => {
  it('saves a complete lineup and reports the service as complete', async () => {
    const response = await callPut({ expected_version: 3, assignments: completeLineup });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.schedule_version).toBe(4);
    expect(body.unfilled_positions).toEqual([]);
    expect(body.is_complete).toBe(true);
    expect(rpc).toHaveBeenCalledWith('replace_service_assignments', expect.objectContaining({
      p_service_id: 'service-week-1',
      p_expected_version: 3,
      p_unfilled_positions: [],
    }));
  });

  it('accepts a PARTIAL lineup without an override reason, because a gap is not an override', async () => {
    // This is the case the stage split exists for. A missing leader and a missing
    // instrument are reported as unfilled positions; they must not be treated as
    // warnings the coordinator has to justify, or partial scheduling is unusable.
    const response = await callPut({ expected_version: 3, assignments: [completeLineup[0]] });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.is_complete).toBe(false);
    expect(body.unfilled_positions.map((gap: { role_name: string }) => gap.role_name).sort())
      .toEqual(['Backup', 'Guitar 1']);
    // The gap is disclosed as deferred to validation, not as an override.
    expect(body.overridden_checks).toEqual([]);
    expect(body.validation.filter((item: { deferred_until?: string }) => item.deferred_until === 'validate').length).toBeGreaterThan(0);
  });

  it('records a required instrument gap even when no member holds that skill', async () => {
    // The bug this locks shut: deriving required instruments from member.skills
    // made an instrument nobody plays invisible instead of unfilled.
    const response = await callPut({ expected_version: 3, assignments: withoutGuitarist });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.unfilled_positions).toEqual([expect.objectContaining({ role_name: 'Guitar 1', required_slots: 1 })]);
    expect(body.is_complete).toBe(false);
  });

  it('refuses a hard conflict that no override can license', async () => {
    // Two leaders is Rule 5, not an unfillable gap.
    const response = await callPut({
      expected_version: 3,
      reason: 'trying to force it through',
      overrides: { availability: true, instrument_qualification: true },
      assignments: [
        { member_id: leader.id, role_id: leaderRole.id, instrument_id: null, is_leader: true },
        { member_id: backup1.id, role_id: leaderRole.id, instrument_id: null, is_leader: true },
        ...completeLineup.slice(1),
      ],
    });
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.validation.some((item: { check: string }) => item.check === 'leader_count_multiple')).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses an inactive member', async () => {
    const inactive = member({ id: 'm-inactive', full_name: 'Inactive', status: 'inactive', roles: [memberRole(backupRole, 'm-inactive')] });
    loadScheduleData.mockResolvedValue(contextData({ members: [leader, backup1, backup2, backup3, inactive, guitarist] }));

    const response = await callPut({
      expected_version: 3,
      reason: 'they said they can make it',
      overrides: { availability: true },
      assignments: [...completeLineup.slice(0, 3), { member_id: inactive.id, role_id: backupRole.id, instrument_id: null, is_leader: false }],
    });
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.validation.some((item: { check: string }) => item.check === 'active_member')).toBe(true);
  });

  it('licenses an availability conflict when a reason is supplied, and reports the licence', async () => {
    const unavailable = member({
      id: 'm-b1',
      full_name: 'Backup One',
      roles: [memberRole(backupRole, 'm-b1')],
      availability: [{ id: 'av-1', member_id: 'm-b1', church_id: 'church-1', type: 'weekly', week_number: 1, status: 'approved', created_at: '' }],
    });
    loadScheduleData.mockResolvedValue(contextData({ members: [leader, unavailable, backup2, backup3, guitarist] }));

    const response = await callPut({
      expected_version: 3,
      reason: 'Covered the worship team that week; agreed with the pastor.',
      overrides: { availability: true },
      assignments: completeLineup,
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.overridden_checks).toEqual(['availability']);
    expect(body.active_overrides).toEqual({ availability: true });
    expect(body.validation.find((item: { check: string }) => item.check === 'availability'))
      .toMatchObject({ severity: 'warning', deferred_until: 'publish' });
  });

  it('refuses an unqualified instrumentalist when the instrument axis is not licensed', async () => {
    // S6, the negative half. An unqualified member on a required instrument is a
    // `critical`; if the `instrument_qualification` axis stopped being load-bearing
    // this would silently save and the shortfall would surface only at publish.
    const response = await callPut({ expected_version: 3, assignments: unqualifiedGuitarLineup });
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.validation.some((item: { check: string }) => item.check === 'instrument_qualification')).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('licenses an instrument-qualification conflict when a reason is supplied, and reports the licence', async () => {
    // S6, the positive half. This is the one qualification axis a coordinator may
    // override, and the licence has to reach `active_overrides` so the database
    // re-assertion at validate/publish can honour it (M6).
    const response = await callPut({
      expected_version: 3,
      reason: 'Played the part last season and the pastor approved it.',
      overrides: { instrument_qualification: true },
      assignments: unqualifiedGuitarLineup,
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.overridden_checks).toEqual(['instrument_qualification']);
    expect(body.active_overrides).toEqual({ instrument_qualification: true });
    expect(body.validation.find((item: { check: string }) => item.check === 'instrument_qualification'))
      .toMatchObject({ severity: 'warning', deferred_until: 'publish' });
    // The required position is staffed, so it is not a gap: it is a licensed
    // exception, and the two facts must not be conflated.
    expect(body.unfilled_positions).toEqual([]);
    expect(body.is_complete).toBe(true);
    expect(rpc).toHaveBeenCalledWith('replace_service_assignments', expect.objectContaining({
      p_active_overrides: { instrument_qualification: true },
    }));
  });

  it('refuses to record an instrument-qualification licence with no reason', async () => {
    const response = await callPut({
      expected_version: 3,
      overrides: { instrument_qualification: true },
      assignments: unqualifiedGuitarLineup,
    });

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses to record a licence with no reason', async () => {
    const unavailable = member({
      id: 'm-b1', full_name: 'Backup One', roles: [memberRole(backupRole, 'm-b1')],
      availability: [{ id: 'av-1', member_id: 'm-b1', church_id: 'church-1', type: 'weekly', week_number: 1, status: 'approved', created_at: '' }],
    });
    loadScheduleData.mockResolvedValue(contextData({ members: [leader, unavailable, backup2, backup3, guitarist] }));

    const response = await callPut({ expected_version: 3, overrides: { availability: true }, assignments: completeLineup });

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects an override key outside the allowlist instead of silently ignoring it', async () => {
    // Silently dropping it would confirm a licence that was never stored, and the
    // coordinator would only discover the truth on the next save.
    const response = await callPut({
      expected_version: 3,
      reason: 'attempting to widen the surface',
      overrides: { leader_qualification: true },
      assignments: completeLineup,
    });

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects a non-boolean override value', async () => {
    const response = await callPut({
      expected_version: 3,
      reason: 'stringly typed',
      overrides: { availability: 'yes' },
      assignments: completeLineup,
    });

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('treats an unchecked override axis as no licence, matching the database allowlist', async () => {
    // `services_active_overrides_allowlist` is an equality against four literals,
    // none containing a `false`. Forwarding `{"availability": false}` would pass
    // this route and then be refused by the CHECK as a 23514.
    const response = await callPut({ expected_version: 3, overrides: { availability: false }, assignments: completeLineup });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.active_overrides).toEqual({});
    expect(rpc).toHaveBeenCalledWith('replace_service_assignments', expect.objectContaining({
      p_active_overrides: {},
    }));
  });

  it('treats a missing overrides key as "no licences" rather than an error', async () => {
    const response = await callPut({ expected_version: 3, assignments: completeLineup });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.active_overrides).toEqual({});
  });

  it('rejects an assignment naming a member, role, or instrument outside the ministry', async () => {
    const foreign = member({ id: 'm-foreign' });
    loadScheduleData.mockResolvedValue(contextData({ members: [leader, backup1, backup2, backup3, foreign, guitarist] }));

    const response = await callPut({
      expected_version: 3,
      assignments: [{ member_id: 'm-not-in-ministry', role_id: backupRole.id, instrument_id: null, is_leader: false }],
    });

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects a stale expected_version rather than clobbering a concurrent edit', async () => {
    const response = await callPut({ expected_version: 1, assignments: completeLineup });

    expect(response.status).toBe(409);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('refuses to edit a published schedule', async () => {
    serviceQuery.maybeSingle.mockResolvedValue({ data: service({ status: 'published' }), error: null });

    const response = await callPut({ expected_version: 3, assignments: completeLineup });

    expect(response.status).toBe(409);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('requires staff', async () => {
    requireStaff.mockResolvedValue(new Response('nope', { status: 403 }));

    const response = await callPut({ expected_version: 3, assignments: completeLineup });

    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('surfaces a database override-constraint violation as 422, not 500', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '23514', message: 'services_active_overrides_allowlist' } });

    const response = await callPut({ expected_version: 3, assignments: completeLineup });

    expect(response.status).toBe(422);
  });
});
