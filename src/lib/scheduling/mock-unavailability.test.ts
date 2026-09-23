import { describe, expect, it } from 'vitest';
import { planMockUnavailability } from './mock-unavailability';
import { getWeeksInMonth } from '../utils/date-utils';

const roster = [
  { id: 'm-3', full_name: 'C' },
  { id: 'm-1', full_name: 'A' },
  { id: 'm-2', full_name: 'B' },
];

function rosterOf(count: number) {
  return Array.from({ length: count }, (_, index) => ({ id: `m-${index}`, full_name: `Member ${index}` }));
}

describe('planMockUnavailability', () => {
  it('is deterministic and rotates by id so input order does not matter', () => {
    const first = planMockUnavailability([...roster].reverse(), 9, 2026);
    const second = planMockUnavailability(roster, 9, 2026);
    expect(second).toEqual(first);
    expect(first.map((row) => row.member_id)).toEqual(['m-1', 'm-2', 'm-3']);
    expect(first.every((row) => row.month === 9 && row.year === 2026)).toBe(true);
  });

  it('produces exactly one weekly record per member', () => {
    const plan = planMockUnavailability(roster, 9, 2026);
    expect(plan).toHaveLength(roster.length);
    expect(new Set(plan.map((row) => row.member_id)).size).toBe(roster.length);
  });

  it('rotates across all October 2026 weeks when there are at least four members', () => {
    // October 2026 (month 9) has 4 Sunday-anchored weeks.
    const plan = planMockUnavailability(rosterOf(4), 9, 2026);
    expect(plan.map((row) => row.week_number)).toEqual([1, 2, 3, 4]);
  });

  it('returns an empty plan for an empty roster', () => {
    expect(planMockUnavailability([], 9, 2026)).toEqual([]);
  });

  it('keeps every week number within 1..weeks for the requested month', () => {
    for (const [month, year] of [
      [0, 2026],
      [1, 2026],
      [8, 2026],
      [9, 2026],
      [10, 2026],
      [11, 2026],
    ] as const) {
      const weeks = getWeeksInMonth(month, year);
      const plan = planMockUnavailability(rosterOf(9), month, year);
      expect(plan).toHaveLength(9);
      for (const row of plan) {
        expect(row.week_number).toBeGreaterThanOrEqual(1);
        expect(row.week_number).toBeLessThanOrEqual(weeks);
        expect(row.month).toBe(month);
        expect(row.year).toBe(year);
      }
    }
  });
});