import { describe, expect, it } from 'vitest';
import { SchedulingEngine } from './engine';
import { ScheduleContext } from '../types/scheduling';
import type { Availability, Instrument, Member, MemberRole, MemberSkill, Role, ScheduleAssignment, Service } from '../types/database';

const leaderRole: Role = { id: 'leader', ministry_id: 'ministry', name: 'Worship Leader', min_required: 1, max_allowed: 1, priority: 1, is_active: true, created_at: '' };
const backupRole: Role = { id: 'backup', ministry_id: 'ministry', name: 'Singer', min_required: 3, max_allowed: 3, priority: 2, is_active: true, created_at: '' };

function role(memberId: string, value: Role, id = `${memberId}-${value.id}`): MemberRole {
  return { id, member_id: memberId, role_id: value.id, skill_level: 'advanced', is_preferred: true, created_at: '', role: value };
}

function member(id: string, roles: MemberRole[] = [role(id, backupRole)], overrides: Partial<Member> = {}): Member {
  return { id, church_id: 'church', full_name: id, status: 'active', max_monthly_assignments: 3, priority_score: 50, total_assignments: 0, created_at: '', updated_at: '', roles, availability: [], ...overrides };
}

function assignment(id: string, memberId: string, roleValue: Role, isLeader = false): ScheduleAssignment {
  return { id, service_id: 'service', member_id: memberId, role_id: roleValue.id, is_leader: isLeader, status: 'pending', created_at: '', updated_at: '', role: roleValue };
}

function context(members: Member[], overrides: Partial<ScheduleContext> = {}): ScheduleContext {
  const service: Service = { id: 'service', church_id: 'church', date: '2026-09-06', week_number: 1, month: 8, year: 2026, service_type: 'sunday', status: 'draft', created_at: '', updated_at: '' };
  return { service, church_id: 'church', month: 8, year: 2026, week_number: 1, existing_assignments: [], available_members: members, all_members: members, rules: [{ rule_type: 'backup_count', rule_config: { min_required: 3, max_allowed: 3 }, severity: 'critical' }, ...[]], ...overrides };
}

describe('SchedulingEngine', () => {
  it('filters unavailable and inactive members before assignment', async () => {
    const unavailable: Availability = { id: 'availability', member_id: 'leader', church_id: 'church', type: 'weekly', week_number: 1, month: 8, year: 2026, status: 'approved', created_at: '' };
    const members = [
      member('leader', [role('leader', leaderRole), role('leader', backupRole)], { availability: [unavailable] }),
      member('leader-2', [role('leader-2', leaderRole), role('leader-2', backupRole)]),
      member('inactive', [role('inactive', backupRole)], { status: 'inactive' }),
      member('backup-1'), member('backup-2'), member('backup-3'),
    ];
    const [service] = await new SchedulingEngine(context(members)).generateSchedule();
    expect(service.leader?.id).toBe('leader-2');
    expect(service.backup_singers.map((candidate) => candidate.id)).not.toContain('inactive');
    expect(service.backup_singers.map((candidate) => candidate.id)).not.toContain('leader');
  });

  it('prefers the lower historical and role-specific workload', async () => {
    const members = [
      member('leader', [role('leader', leaderRole), role('leader', backupRole)]),
      member('heavy', [role('heavy', backupRole)], { total_assignments: 8 }),
      member('light', [role('light', backupRole)], { total_assignments: 1 }),
      member('backup-3'), member('backup-4'),
    ];
    const history = [
      assignment('history-1', 'heavy', backupRole), assignment('history-2', 'heavy', backupRole),
    ];
    const [service] = await new SchedulingEngine(context(members, { historical_assignments: history })).generateSchedule();
    expect(service.backup_singers.map((candidate) => candidate.id)).toContain('light');
  });

  it('reports an unfilled leader with its rejection reason instead of failing the whole month', async () => {
    const leader = member('leader', [role('leader', leaderRole)], { max_monthly_assignments: 1 });
    const existing = assignment('existing', 'leader', leaderRole, true);
    const [service] = await new SchedulingEngine(context([leader], { existing_assignments: [existing] })).generateSchedule();

    // The month still returns a schedule; Rule 2 is reported, not enforced away.
    expect(service.week_number).toBe(1);
    const leaderGap = service.unfilled_positions?.find((gap) => gap.role_name === 'Worship Leader');
    expect(leaderGap).toMatchObject({ week_number: 1, required_slots: 1 });
    expect(leaderGap?.rejected_candidates[0].reason).toBe('monthly limit reached');
    // A short backup count is ONE gap with the shortfall, not one row per slot.
    const backupGap = service.unfilled_positions?.find((gap) => gap.role_name === 'Backup');
    expect(backupGap?.required_slots).toBe(3);
    expect(service.unfilled_positions).toHaveLength(2);
  });

  it('degrades the four gap criticals to deferred warnings at draft stage but never a non-deferrable one', async () => {
    const leader = member('leader', [role('leader', leaderRole)], { max_monthly_assignments: 1 });
    const existing = assignment('existing', 'leader', leaderRole, true);
    const [service] = await new SchedulingEngine(context([leader], { existing_assignments: [existing] })).generateSchedule();

    const byCheck = new Map(service.conflicts.map((conflict) => [conflict.check, conflict]));
    // Rule 5, Rule 4 minimum: downgraded, and the downgrade is DISCLOSED.
    expect(byCheck.get('leader_count_missing')).toMatchObject({ severity: 'warning', deferred_until: 'validate' });
    expect(byCheck.get('backup_count_min')).toMatchObject({ severity: 'warning', deferred_until: 'validate' });
    // Nothing in the result set is still critical: a draft may be partial.
    expect(service.conflicts.filter((conflict) => conflict.severity === 'critical')).toEqual([]);
  });

  it('is deterministic for identical input', async () => {
    const members = [member('leader', [role('leader', leaderRole), role('leader', backupRole)]), member('b'), member('c'), member('d')];
    const first = await new SchedulingEngine(context(members)).generateSchedule();
    const second = await new SchedulingEngine(context(members)).generateSchedule();
    expect(first.map((service) => [service.leader?.id, ...service.backup_singers.map((candidate) => candidate.id)])).toEqual(
      second.map((service) => [service.leader?.id, ...service.backup_singers.map((candidate) => candidate.id)]),
    );
  });

  it('reports the October mock unavailability as an unfilled leader in October and keeps the member eligible in other months', async () => {
    // Exact shape written by the mock-unavailability route for October 2026.
    const octoberMock: Availability = {
      id: 'mock-availability', member_id: 'leader', church_id: 'church',
      type: 'weekly', week_number: 1, month: 9, year: 2026,
      reason: 'Mock unavailability (October 2026 test)', status: 'approved', created_at: '',
    };
    const members = [
      member('leader', [role('leader', leaderRole), role('leader', backupRole)], { availability: [octoberMock] }),
      member('backup-1'), member('backup-2'), member('backup-3'),
    ];
    const octoberContext = (): ScheduleContext => context(members, {
      month: 9, year: 2026,
      service: { id: 'service', church_id: 'church', date: '2026-10-04', week_number: 1, month: 9, year: 2026, service_type: 'sunday', status: 'draft', created_at: '', updated_at: '' },
    });

    // October 2026: the only leader is unavailable for week 1. The month is
    // generated anyway, with the leader position reported as unfilled and the
    // reason attached. Rule 1 is still never violated by an ASSIGNMENT.
    const [octoberService] = await new SchedulingEngine(octoberContext()).generateSchedule();
    expect(octoberService.leader).toBeNull();
    const leaderGap = octoberService.unfilled_positions?.find((gap) => gap.role_name === 'Worship Leader');
    expect(leaderGap?.week_number).toBe(1);
    expect(leaderGap?.rejected_candidates.some(
      (candidate) => candidate.member_id === 'leader' && candidate.reason === 'unavailable',
    )).toBe(true);
    // Only the leader is unfilled; the three backups are still placed.
    expect(octoberService.unfilled_positions).toHaveLength(1);
    expect(octoberService.backup_singers).toHaveLength(3);

    // A different month (the helper's default August 2026): the record does not
    // apply and the same member is eligible and selected as leader.
    const [service] = await new SchedulingEngine(context(members)).generateSchedule();
    expect(service.leader?.id).toBe('leader');
    expect(service.unfilled_positions).toEqual([]);
  });

  it('reports a monthly-limit (not unavailability) gap when one Drums member cannot cover 4 weeks', async () => {
    // Regression for the October 2026 mock test run: with a single Drums holder
    // and max_monthly_assignments = 3, week 4 must be a gap explained by
    // 'monthly limit reached' — never by 'unavailable'.
    const drumsInstrument: Instrument = { id: 'drums', ministry_id: 'ministry', name: 'Drums', is_required: true, min_count: 1, max_count: 2, created_at: '' };
    const drumSkill: MemberSkill = { id: 'drum-skill', member_id: 'drummer', instrument_id: 'drums', skill_level: 'advanced', is_primary: true, created_at: '', instrument: drumsInstrument };
    const drummer = member('drummer', [], { skills: [drumSkill] });
    const leaders = ['leader-1', 'leader-2', 'leader-3'].map((id) => member(id, [role(id, leaderRole)]));
    const backups = ['backup-1', 'backup-2', 'backup-3', 'backup-4'].map((id) => member(id));
    const october = () => context([drummer, ...leaders, ...backups], {
      month: 9, year: 2026, week_numbers: [1, 2, 3, 4],
      service: { id: 'service', church_id: 'church', date: '2026-10-04', week_number: 1, month: 9, year: 2026, service_type: 'sunday', status: 'draft', created_at: '', updated_at: '' },
    });

    const services = await new SchedulingEngine(october()).generateSchedule();
    // All four weeks are generated. Weeks 1-3 are complete; week 4 is the gap.
    expect(services.map((service) => service.week_number)).toEqual([1, 2, 3, 4]);
    for (const service of services.slice(0, 3)) {
      expect(service.unfilled_positions).toEqual([]);
      expect(service.instrumentalists.map((entry) => entry.member?.id)).toEqual(['drummer']);
    }
    const [weekFour] = services.slice(3);
    expect(weekFour.instrumentalists).toEqual([]);
    const drumsGap = weekFour.unfilled_positions?.find((gap) => gap.role_name === 'Drums');
    expect(drumsGap).toMatchObject({ week_number: 4, required_slots: 1 });
    expect(drumsGap?.rejected_candidates.some(
      (candidate) => candidate.member_id === 'drummer' && candidate.reason === 'monthly limit reached',
    )).toBe(true);
    expect(drumsGap?.rejected_candidates.some((candidate) => candidate.reason === 'unavailable')).toBe(false);
  });

  it('reports a required instrument that no member holds a skill for', async () => {
    // H1: the catalogue is the source of "required". Before this, an instrument
    // with zero skill-holders was absent from BOTH the slot list and the
    // validator, so the gap did not exist rather than being reported.
    const bass: Instrument = { id: 'bass', ministry_id: 'ministry', name: 'Bass', is_required: true, min_count: 1, max_count: 1, created_at: '' };
    const members = [
      member('leader', [role('leader', leaderRole), role('leader', backupRole)]),
      member('backup-1'), member('backup-2'), member('backup-3'),
    ];
    const [service] = await new SchedulingEngine(context(members, { instruments: [bass] })).generateSchedule();
    const bassGap = service.unfilled_positions?.find((gap) => gap.role_name === 'Bass');
    expect(bassGap).toBeDefined();
    expect(service.conflicts.some((conflict) => conflict.check === 'required_instrument_missing')).toBe(true);
  });

  it('treats an empty instrument catalogue as authoritative, not as a missing catalogue', async () => {
    // The H1 guard: `[]` means "no required instruments". Falling back to the
    // skills-derived list here would silently invent requirements.
    const drums: Instrument = { id: 'drums', ministry_id: 'ministry', name: 'Drums', is_required: true, min_count: 1, max_count: 2, created_at: '' };
    const drumSkill: MemberSkill = { id: 'drum-skill', member_id: 'drummer', instrument_id: 'drums', skill_level: 'advanced', is_primary: true, created_at: '', instrument: drums };
    const drummer = member('drummer', [], { skills: [drumSkill] });
    const members = [
      member('leader', [role('leader', leaderRole), role('leader', backupRole)]),
      drummer, member('backup-1'), member('backup-2'), member('backup-3'),
    ];
    const [service] = await new SchedulingEngine(context(members, { instruments: [] })).generateSchedule();
    expect(service.unfilled_positions).toEqual([]);
    expect(service.instrumentalists).toEqual([]);
    // Same roster WITHOUT the catalogue falls back to the skills-derived list.
    const [fallback] = await new SchedulingEngine(context(members)).generateSchedule();
    expect(fallback.instrumentalists.map((entry) => entry.member?.id)).toEqual(['drummer']);
  });

  it('restores the gap log when a candidate is rolled back, so an abandoned branch cannot leave a phantom gap', () => {
    // M1: `solve` records a gap and skips the slot (engine.ts:105). When the
    // enclosing branch is abandoned, `rollback` must undo that gap as well as
    // the choice. It restored `service.choices` and `memberState` but never
    // `this.gaps`, so any branch that recorded a gap and was then rolled back
    // left that gap in the log: the month would report a position as unfilled
    // on the strength of a branch the search rejected, and a sibling branch
    // that DID fill the slot would be contradicted by the stale row.
    interface InternalSlot { id: string; kind: string; roleName: string; weekNumber: number; date: string; isLeader: boolean }
    interface InternalRejection { member: Member; reason: string }
    interface EngineInternals {
      gaps: unknown[];
      buildSlots(weekNumber: number): InternalSlot[];
      getEligibleCandidates(slot: InternalSlot): { candidates: Member[]; rejections: InternalRejection[] };
      createFailure(slot: InternalSlot, rejections: InternalRejection[]): unknown;
      apply(choice: unknown): void;
      rollback(choice: unknown): void;
    }

    const leader = member('leader', [role('leader', leaderRole), role('leader', backupRole)]);
    const engine = new SchedulingEngine(context([leader, member('backup-1'), member('backup-2'), member('backup-3')])) as unknown as EngineInternals;
    const leaderSlot = engine.buildSlots(1).find((slot) => slot.kind === 'leader')!;
    const pool = engine.getEligibleCandidates(leaderSlot);

    // The exact sequence a failing branch performs: apply the candidate, let a
    // deeper frame record a gap, then roll the branch back and try a different
    // candidate for the same slot.
    const choice = { slot: leaderSlot, member: pool.candidates[0], score: 0 };
    engine.apply(choice);
    engine.gaps.push(engine.createFailure(leaderSlot, pool.rejections));
    engine.rollback(choice);

    expect(engine.gaps).toHaveLength(0);
  });
});
