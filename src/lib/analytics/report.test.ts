import { describe, expect, it } from 'vitest';
import { buildAnalyticsReport } from './report';
import type { AnalyticsMember } from './report';
import type { AvailabilityRecord } from '@/lib/scheduling/availability';

function member(overrides: Partial<AnalyticsMember> = {}): AnalyticsMember {
  return {
    id: 'alice',
    full_name: 'Alice Santos',
    status: 'active',
    max_monthly_assignments: 3,
    ...overrides,
  };
}

function availability(overrides: Partial<AvailabilityRecord> = {}): AvailabilityRecord {
  return {
    member_id: 'alice',
    type: 'weekly',
    week_number: 1,
    month: 8,
    year: 2026,
    status: 'approved',
    ...overrides,
  };
}

describe('buildAnalyticsReport', () => {
  it('counts only active members and reports count against each limit', () => {
    const report = buildAnalyticsReport({
      members: [
        member(),
        member({ id: 'bob', full_name: 'Bob Cruz', max_monthly_assignments: 2 }),
        member({ id: 'cara', full_name: 'Cara Lim', status: 'inactive' }),
      ],
      assignments: [
        { member_id: 'alice', service_id: 's1' },
        { member_id: 'alice', service_id: 's2' },
        { member_id: 'alice', service_id: 's3' },
        { member_id: 'bob', service_id: 's1' },
        { member_id: 'cara', service_id: 's1' },
      ],
      availability: [],
      month: 8,
      year: 2026,
    });

    expect(report.member_count).toBe(2);
    expect(report.assignment_count).toBe(5);
    expect(report.fairness).toHaveLength(2);

    const alice = report.fairness.find((row) => row.member_id === 'alice');
    expect(alice).toMatchObject({
      assignment_count: 3,
      max_allowed: 3,
      utilization: 100,
      fairness_score: 60,
      status: 'overutilized',
    });

    const bob = report.workload.find((row) => row.member_id === 'bob');
    expect(bob).toMatchObject({ assignments: 1, max_allowed: 2, percentage: 50 });
    expect(report.overall_fairness).toBe(75);
  });

  it('counts weekly, date, vacation, and recurring availability for each week', () => {
    const report = buildAnalyticsReport({
      members: [
        member({ id: 'alice', full_name: 'Alice' }),
        member({ id: 'bob', full_name: 'Bob' }),
        member({ id: 'cara', full_name: 'Cara', status: 'inactive' }),
      ],
      assignments: [],
      availability: [
        availability({ member_id: 'alice', type: 'weekly', week_number: 1 }),
        availability({
          member_id: 'bob',
          type: 'vacation',
          date: '2026-09-13',
          end_date: '2026-09-20',
        }),
        availability({ member_id: 'alice', type: 'date', date: '2026-09-27' }),
        availability({
          member_id: 'bob',
          type: 'recurring',
          week_number: 1,
          month: 8,
          year: 2026,
          date: undefined,
        }),
        availability({ member_id: 'alice', type: 'weekly', week_number: 4, status: 'rejected' }),
        availability({ member_id: 'cara', type: 'weekly', week_number: 1 }),
      ],
      month: 8,
      year: 2026,
    });

    expect(report.availability).toEqual([
      { week_number: 1, unavailable_count: 2, unavailable_members: ['Alice', 'Bob'] },
      { week_number: 2, unavailable_count: 1, unavailable_members: ['Bob'] },
      { week_number: 3, unavailable_count: 1, unavailable_members: ['Bob'] },
      { week_number: 4, unavailable_count: 1, unavailable_members: ['Alice'] },
    ]);
  });

  it('returns an empty, well-formed report when there are no members or assignments', () => {
    const report = buildAnalyticsReport({
      members: [],
      assignments: [],
      availability: [],
      month: 0,
      year: 2026,
      months: [{ month: 0, year: 2026 }],
    });

    expect(report).toMatchObject({
      month: 0,
      year: 2026,
      months: [{ month: 0, year: 2026 }],
      overall_fairness: 0,
      assignment_count: 0,
      member_count: 0,
      workload: [],
      fairness: [],
    });
    expect(report.availability.length).toBeGreaterThan(0);
  });
});
