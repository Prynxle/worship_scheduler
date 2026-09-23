import { describe, expect, it } from 'vitest';
import { SchedulingEngine } from './engine';
import { SchedulingFailureError, ScheduleContext } from '../types/scheduling';
import type { Availability, Member, MemberRole, Role, ScheduleAssignment, Service } from '../types/database';

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

  it('returns a structured failure when a hard constraint makes scheduling impossible', async () => {
    const leader = member('leader', [role('leader', leaderRole)], { max_monthly_assignments: 1 });
    const existing = assignment('existing', 'leader', leaderRole, true);
    await expect(new SchedulingEngine(context([leader], { existing_assignments: [existing] })).generateSchedule())
      .rejects.toMatchObject({ name: 'SchedulingFailureError' });
    try {
      await new SchedulingEngine(context([leader], { existing_assignments: [existing] })).generateSchedule();
    } catch (error) {
      expect(error).toBeInstanceOf(SchedulingFailureError);
      expect((error as SchedulingFailureError).failures[0]).toMatchObject({ role_name: 'Worship Leader', week_number: 1 });
      expect((error as SchedulingFailureError).failures[0].rejected_candidates[0].reason).toBe('monthly limit reached');
    }
  });

  it('is deterministic for identical input', async () => {
    const members = [member('leader', [role('leader', leaderRole), role('leader', backupRole)]), member('b'), member('c'), member('d')];
    const first = await new SchedulingEngine(context(members)).generateSchedule();
    const second = await new SchedulingEngine(context(members)).generateSchedule();
    expect(first.map((service) => [service.leader?.id, ...service.backup_singers.map((candidate) => candidate.id)])).toEqual(
      second.map((service) => [service.leader?.id, ...service.backup_singers.map((candidate) => candidate.id)]),
    );
  });

  it('rejects a member holding the October mock unavailability record in October but keeps them eligible in other months', async () => {
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

    // October 2026 (month 9, overriding the helper's August default): the only
    // leader is unavailable for week 1 so generation must fail with that reason.
    await expect(new SchedulingEngine(context(members, {
      month: 9, year: 2026,
      service: { id: 'service', church_id: 'church', date: '2026-10-04', week_number: 1, month: 9, year: 2026, service_type: 'sunday', status: 'draft', created_at: '', updated_at: '' },
    })).generateSchedule()).rejects.toMatchObject({ name: 'SchedulingFailureError' });
    try {
      await new SchedulingEngine(context(members, {
        month: 9, year: 2026,
        service: { id: 'service', church_id: 'church', date: '2026-10-04', week_number: 1, month: 9, year: 2026, service_type: 'sunday', status: 'draft', created_at: '', updated_at: '' },
      })).generateSchedule();
    } catch (error) {
      expect(error).toBeInstanceOf(SchedulingFailureError);
      const leaderFailure = (error as SchedulingFailureError).failures.find((failure) => failure.role_name === 'Worship Leader');
      expect(leaderFailure?.rejected_candidates.some(
        (candidate) => candidate.member_id === 'leader' && candidate.reason === 'unavailable',
      )).toBe(true);
    }

    // A different month (the helper's default August 2026): the record does not
    // apply and the same member is eligible and selected as leader.
    const [service] = await new SchedulingEngine(context(members)).generateSchedule();
    expect(service.leader?.id).toBe('leader');
  });
});
