import { describe, it, expect } from 'vitest';
import { ScheduleValidator } from './validator';
import type { ScheduleContext } from '../types/scheduling';
import type {
  Member,
  Service,
  ScheduleAssignment,
  Role,
  MemberRole,
  Availability,
} from '../types/database';

// NOTE (Rule 6 - active members only):
// The engine filters inactive members in engine.ts getAvailableMembers();
// ScheduleValidator does not enforce this rule. That is engine-level behavior.
// Tests here cover the hard rules the validator itself enforces (Rules 1-5, 7).

const leaderRole: Role = {
  id: 'role-leader',
  ministry_id: 'min1',
  name: 'Worship Leader',
  description: '',
  min_required: 1,
  max_allowed: 1,
  priority: 1,
  is_active: true,
  created_at: '',
};

const roleMemberRole: MemberRole = {
  id: 'mr-1',
  member_id: 'm1',
  role_id: 'role-leader',
  skill_level: 'expert',
  is_preferred: true,
  created_at: '',
  role: leaderRole,
};

function member(overrides: Partial<Member> = {}): Member {
  return {
    id: 'm1',
    church_id: 'church1',
    full_name: 'Test Member',
    status: 'active',
    max_monthly_assignments: 3,
    priority_score: 1,
    total_assignments: 0,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

function roleMember(overrides: Partial<Member> = {}): Member {
  return member({ roles: [roleMemberRole], ...overrides });
}

function assignment(overrides: Partial<ScheduleAssignment> = {}): ScheduleAssignment {
  return {
    id: 'a1',
    service_id: 'svc1',
    member_id: 'm1',
    role_id: 'role-leader',
    is_leader: false,
    status: 'pending',
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

function service(overrides: Partial<Service> = {}): Service {
  return {
    id: 'svc1',
    church_id: 'church1',
    date: '2026-09-06',
    week_number: 1,
    month: 9,
    year: 2026,
    service_type: 'Sunday Worship',
    status: 'draft',
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

function context(overrides: Partial<ScheduleContext> = {}): ScheduleContext {
  return {
    service: service(),
    church_id: 'church1',
    month: 9,
    year: 2026,
    week_number: 1,
    existing_assignments: [],
    available_members: [],
    all_members: [],
    rules: [],
    ...overrides,
  };
}

function getResults(ruleType: string, results: { rule_type: string; severity: string }[]) {
  return results.filter((r) => r.rule_type === ruleType && r.severity === 'critical');
}

describe('ScheduleValidator (AGENTS.md hard rules)', () => {
  it('Rule 1: flags an unavailable member assigned to the service week', async () => {
    const unavailable: Availability = {
      id: 'av1',
      member_id: 'm1',
      church_id: 'church1',
      type: 'weekly',
      week_number: 1,
      status: 'approved',
      created_at: '',
    };

    const ctx = context({
      existing_assignments: [assignment({ member_id: 'm1' })],
      all_members: [member({ availability: [unavailable] })],
    });

    const results = await new ScheduleValidator(ctx).validate();
    const critical = getResults('availability_check', results);
    expect(critical.length).toBeGreaterThan(0);
  });

  it('Rule 2: flags a member exceeding the monthly assignment limit (default 3)', async () => {
    const m = member({ max_monthly_assignments: 3 });
    const ctx = context({
      existing_assignments: [
        assignment({ id: 'a1', member_id: 'm1' }),
        assignment({ id: 'a2', member_id: 'm1' }),
        assignment({ id: 'a3', member_id: 'm1' }),
        assignment({ id: 'a4', member_id: 'm1' }),
      ],
      all_members: [m],
      rules: [],
    });

    const results = await new ScheduleValidator(ctx).validate();
    const critical = getResults('assignment_limit', results);
    expect(critical.length).toBeGreaterThan(0);
  });

  it('Rule 3: flags the same member assigned to multiple roles in one service', async () => {
    const ctx = context({
      existing_assignments: [
        assignment({ id: 'a1', member_id: 'm1', is_leader: true }),
        assignment({ id: 'a2', member_id: 'm1', is_leader: false }),
      ],
      all_members: [member({ roles: [roleMemberRole] })],
    });

    const results = await new ScheduleValidator(ctx).validate();
    const critical = getResults('dual_role_check', results);
    expect(critical.length).toBeGreaterThan(0);
  });

  it('Rule 5: flags a service with no worship leader', async () => {
    const ctx = context({
      existing_assignments: [
        assignment({ id: 'a1', member_id: 'm1', is_leader: false }),
        assignment({ id: 'a2', member_id: 'm2', is_leader: false }),
        assignment({ id: 'a3', member_id: 'm3', is_leader: false }),
      ],
      all_members: [member(), member({ id: 'm2' }), member({ id: 'm3' })],
    });

    const results = await new ScheduleValidator(ctx).validate();
    const critical = getResults('leader_count', results);
    expect(critical.length).toBeGreaterThan(0);
  });

  it('Rule 5: flags a service with more than one worship leader', async () => {
    const ctx = context({
      existing_assignments: [
        assignment({ id: 'a1', member_id: 'm1', is_leader: true }),
        assignment({ id: 'a2', member_id: 'm2', is_leader: true }),
        assignment({ id: 'a3', member_id: 'm3', is_leader: false }),
        assignment({ id: 'a4', member_id: 'm4', is_leader: false }),
        assignment({ id: 'a5', member_id: 'm5', is_leader: false }),
      ],
      all_members: [
        roleMember(),
        roleMember({ id: 'm2' }),
        member({ id: 'm3' }),
        member({ id: 'm4' }),
        member({ id: 'm5' }),
      ],
    });

    const results = await new ScheduleValidator(ctx).validate();
    const critical = getResults('leader_count', results);
    expect(critical.length).toBeGreaterThan(0);
  });

  it('Rule 4: flags a service with fewer than the minimum backup count', async () => {
    const ctx = context({
      existing_assignments: [
        assignment({ id: 'a1', member_id: 'm1', is_leader: true }),
        assignment({ id: 'a2', member_id: 'm2', is_leader: false }),
      ],
      all_members: [roleMember(), member({ id: 'm2' })],
      rules: [
        {
          rule_type: 'backup_count',
          severity: 'critical',
          rule_config: { min_required: 3, max_allowed: 3 },
        },
      ],
    });

    const results = await new ScheduleValidator(ctx).validate();
    const critical = getResults('backup_count', results);
    expect(critical.length).toBeGreaterThan(0);
  });

  it('Rule 7: flags a member without the Worship Leader role being assigned as leader', async () => {
    // m1 has role 'Singer' only, not 'Worship Leader'
    const singerRole: Role = {
      id: 'role-singer',
      ministry_id: 'min1',
      name: 'Singer',
      description: '',
      min_required: 1,
      max_allowed: 5,
      priority: 2,
      is_active: true,
      created_at: '',
    };
    const singerMember = member({
      roles: [
        {
          id: 'mr-singer',
          member_id: 'm1',
          role_id: 'role-singer',
          skill_level: 'intermediate',
          is_preferred: false,
          created_at: '',
          role: singerRole,
        },
      ],
    });

    const ctx = context({
      existing_assignments: [assignment({ id: 'a1', member_id: 'm1', is_leader: true })],
      all_members: [singerMember],
    });

    const results = await new ScheduleValidator(ctx).validate();
    const critical = getResults('role_validation', results);
    expect(critical.length).toBeGreaterThan(0);
  });

  it('Healthy schedule: one qualified leader + three backups produces no critical results', async () => {
    const ctx = context({
      existing_assignments: [
        assignment({ id: 'a1', member_id: 'm1', is_leader: true }),
        assignment({ id: 'a2', member_id: 'm2', is_leader: false }),
        assignment({ id: 'a3', member_id: 'm3', is_leader: false }),
        assignment({ id: 'a4', member_id: 'm4', is_leader: false }),
      ],
      all_members: [
        roleMember(),
        member({ id: 'm2' }),
        member({ id: 'm3' }),
        member({ id: 'm4' }),
      ],
      rules: [
        {
          rule_type: 'backup_count',
          severity: 'critical',
          rule_config: { min_required: 3, max_allowed: 3 },
        },
      ],
    });

    const results = await new ScheduleValidator(ctx).validate();
    const critical = results.filter((r) => r.severity === 'critical');
    expect(critical).toHaveLength(0);
  });
});

/**
 * Stage enforcement. The `check` field is the ONLY key the stage logic reads, and
 * these tests pin both halves of that contract: the four deferrable checks degrade
 * at draft stage, and everything else does not.
 */
describe('ScheduleValidator stage enforcement', () => {
  const backupRules = [{ rule_type: 'backup_count', severity: 'critical' as const, rule_config: { min_required: 3, max_allowed: 3 } }];

  /** A draft with no leader and one backup: two deferrable gaps at once. */
  const partialContext = (stage?: 'draft' | 'final') => context({
    existing_assignments: [assignment({ id: 'a1', member_id: 'm2', is_leader: false })],
    all_members: [roleMember(), member({ id: 'm2' })],
    rules: backupRules,
    validation_stage: stage,
  });

  it('defaults to the final stage, so a caller that ignores stages gets strict behaviour', async () => {
    const results = await new ScheduleValidator(partialContext()).validate();
    const checks = results.filter((r) => r.severity === 'critical').map((r) => r.check);
    expect(checks).toEqual(expect.arrayContaining(['leader_count_missing', 'backup_count_min']));
  });

  it('defers exactly the four gap criticals at draft stage, each disclosing where it is re-asserted', async () => {
    const results = await new ScheduleValidator(partialContext('draft')).validate();
    const deferred = results.filter((r) => r.deferred_until);
    expect(deferred.map((r) => r.check).sort()).toEqual(['backup_count_min', 'leader_count_missing']);
    for (const result of deferred) {
      expect(result.severity).toBe('warning');
      expect(result.deferred_until).toBe('validate');
    }
  });

  it('never defers a second leader, a backup overflow, or an unqualified leader', async () => {
    // Two leaders plus an overflowed backup count plus an unqualified leader: all
    // three are the non-deferrable half of their rules and must survive draft stage
    // as CRITICAL, because none of them is an unfillable gap.
    const twoLeaders = context({
      validation_stage: 'draft',
      existing_assignments: [
        assignment({ id: 'a1', member_id: 'm1', is_leader: true }),
        assignment({ id: 'a2', member_id: 'm2', is_leader: true }),
        assignment({ id: 'a3', member_id: 'm3', is_leader: false }),
        assignment({ id: 'a4', member_id: 'm4', is_leader: false }),
        assignment({ id: 'a5', member_id: 'm5', is_leader: false }),
        assignment({ id: 'a6', member_id: 'm6', is_leader: false }),
        // m1 is already a leader; giving m1 a second row is the "leader is also
        // doing another job" case, which is a hard duplicate, not a gap.
        assignment({ id: 'a7', member_id: 'm1', is_leader: false }),
      ],
      all_members: [
        roleMember(),
        member({ id: 'm2', roles: [roleMemberRole] }),
        member({ id: 'm3' }), member({ id: 'm4' }), member({ id: 'm5' }), member({ id: 'm6' }),
      ],
      rules: backupRules,
    });
    const results = await new ScheduleValidator(twoLeaders).validate();
    const critical = results.filter((r) => r.severity === 'critical').map((r) => r.check);
    expect(critical).toEqual(expect.arrayContaining(['leader_count_multiple', 'backup_count_max', 'dual_role']));
    // `m2` holds a leader role, so only the dual-role and count findings apply here.
    expect(critical).not.toContain('leader_qualification');
  });

  it('does not defer leader-role qualification, and does not mark it overridable', async () => {
    const singerMember = member({
      roles: [{
        id: 'mr-singer', member_id: 'm1', role_id: 'role-singer', skill_level: 'intermediate', is_preferred: false, created_at: '',
        role: { id: 'role-singer', ministry_id: 'min1', name: 'Singer', description: '', min_required: 1, max_allowed: 5, priority: 2, is_active: true, created_at: '' },
      }],
    });
    const results = await new ScheduleValidator(context({
      validation_stage: 'draft',
      existing_assignments: [assignment({ id: 'a1', member_id: 'm1', is_leader: true })],
      all_members: [singerMember],
      rules: backupRules,
    })).validate();
    const qualification = results.find((r) => r.check === 'leader_qualification');
    expect(qualification?.severity).toBe('critical');
    expect(qualification?.deferred_until).toBeUndefined();
    expect(qualification?.overridable).toBeFalsy();
  });

  it('marks exactly availability and instrument qualification as overridable', async () => {
    const unavailable: Availability = { id: 'av1', member_id: 'm2', church_id: 'church1', type: 'weekly', week_number: 1, status: 'approved', created_at: '' };
    const results = await new ScheduleValidator(context({
      existing_assignments: [
        assignment({ id: 'a1', member_id: 'm1', is_leader: true }),
        assignment({ id: 'a2', member_id: 'm2', is_leader: false, instrument_id: 'inst-guitar' }),
      ],
      all_members: [roleMember(), member({ id: 'm2', availability: [unavailable] })],
      rules: backupRules,
    })).validate();
    const overridable = results.filter((r) => r.overridable).map((r) => r.check).sort();
    expect(overridable).toEqual(['availability', 'instrument_qualification']);
  });

  it('reports a required instrument supplied by the catalogue that no member holds', async () => {
    const bass = { id: 'inst-bass', ministry_id: 'min1', name: 'Bass', is_required: true, min_count: 1, max_count: 1, created_at: '' };
    const results = await new ScheduleValidator(context({
      existing_assignments: [assignment({ id: 'a1', member_id: 'm1', is_leader: true })],
      all_members: [roleMember()],
      instruments: [bass],
      rules: backupRules,
    })).validate();
    const gap = results.find((r) => r.check === 'required_instrument_missing');
    expect(gap).toMatchObject({ severity: 'critical', role_name: 'Bass' });
  });
});
