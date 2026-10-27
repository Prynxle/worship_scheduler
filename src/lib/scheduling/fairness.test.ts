import { describe, expect, it } from 'vitest';
import {
  FairnessCalculator,
  fairnessDeviation,
  fairnessStatus,
  memberFairnessScore,
  overallFairnessScore,
} from './fairness';
import type { Member, ScheduleAssignment } from '../types/database';

function member(overrides: Partial<Member> = {}): Member {
  return {
    id: 'member-1',
    church_id: 'church-1',
    full_name: 'Alice Santos',
    status: 'active',
    max_monthly_assignments: 3,
    priority_score: 50,
    total_assignments: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function assignment(memberId: string, createdAt = '2020-01-01T00:00:00Z'): ScheduleAssignment {
  return {
    id: `assignment-${memberId}-${createdAt}`,
    service_id: 'service-1',
    member_id: memberId,
    role_id: 'role-1',
    is_leader: false,
    status: 'confirmed',
    created_at: createdAt,
    updated_at: createdAt,
  };
}

describe('fairness scores', () => {
  it('keeps the 60% target as zero deviation and 100 points of display score', () => {
    expect(fairnessDeviation(3, 3)).toBeCloseTo(40, 5);
    expect(fairnessDeviation(2, 3)).toBeCloseTo(6.67, 1);
    expect(fairnessDeviation(0, 3)).toBeCloseTo(60, 5);
    expect(memberFairnessScore(2, 3)).toBeCloseTo(93.33, 1);
    expect(memberFairnessScore(3, 3)).toBeCloseTo(60, 5);
    expect(memberFairnessScore(0, 3)).toBeCloseTo(40, 5);
  });

  it('clamps the display score to 0-100', () => {
    expect(memberFairnessScore(10, 3)).toBe(0);
    expect(memberFairnessScore(1, 3)).toBeLessThanOrEqual(100);
  });

  it('uses the existing utilization bands', () => {
    expect(fairnessStatus(29.9)).toBe('underutilized');
    expect(fairnessStatus(30)).toBe('balanced');
    expect(fairnessStatus(80)).toBe('balanced');
    expect(fairnessStatus(80.1)).toBe('overutilized');
    expect(fairnessStatus(100)).toBe('overutilized');
  });

  it('averages member scores into the overall score', () => {
    expect(overallFairnessScore([100, 80])).toBe(90);
    expect(overallFairnessScore([])).toBe(0);
  });
});

describe('FairnessCalculator.calculateFairnessForAssignments', () => {
  it('counts every supplied assignment, even one created in another month', () => {
    const reports = new FairnessCalculator().calculateFairnessForAssignments(
      [member()],
      [assignment('member-1', '2020-01-01T00:00:00Z'), assignment('member-1')]
    );

    expect(reports).toHaveLength(1);
    expect(reports[0].assignment_count).toBe(2);
  });

  it('ignores inactive members and honors the member limit', () => {
    const reports = new FairnessCalculator().calculateFairnessForAssignments(
      [
        member({ id: 'active', full_name: 'Active', max_monthly_assignments: 2 }),
        member({ id: 'inactive', full_name: 'Inactive', status: 'inactive' }),
      ],
      [assignment('active'), assignment('inactive')]
    );

    expect(reports.map((report) => report.member_id)).toEqual(['active']);
    expect(reports[0].max_allowed).toBe(2);
  });
});
