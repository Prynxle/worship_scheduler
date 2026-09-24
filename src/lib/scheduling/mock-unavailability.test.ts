import { describe, expect, it } from 'vitest';
import { planMockUnavailability, soleQualifiedMemberIds } from './mock-unavailability';
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

describe('planMockUnavailability with excludedMemberIds', () => {
  it('excludes the given member ids while keeping every non-excluded week unchanged', () => {
    const full = planMockUnavailability(roster, 9, 2026);
    const plan = planMockUnavailability(roster, 9, 2026, new Set(['m-2']));
    expect(plan).toHaveLength(roster.length - 1);
    for (const row of plan) {
      expect(row.member_id).not.toBe('m-2');
      const original = full.find((item) => item.member_id === row.member_id);
      expect(original).toBeDefined();
      expect(row.week_number).toBe(original!.week_number);
    }
    expect(new Set(plan.map((row) => row.member_id)).size).toBe(plan.length);
  });

  it('ignores excluded ids that are not members and preserves default behavior for an empty set', () => {
    const plan = planMockUnavailability(roster, 9, 2026, new Set(['missing']));
    expect(plan).toHaveLength(roster.length);
    expect(plan).toEqual(planMockUnavailability(roster, 9, 2026));
  });
});

describe('soleQualifiedMemberIds', () => {
  const twoLeadersTwoBackups = [
    { member_id: 'm-1', role: { name: 'Worship Leader', is_active: true } },
    { member_id: 'm-2', role: { name: 'Worship Leader', is_active: true } },
    { member_id: 'm-3', role: { name: 'Singer', is_active: true } },
    { member_id: 'm-4', role: { name: 'Singer', is_active: true } },
  ];

  it('excludes the sole Worship Leader holder but not leaders in a 2+ holder group', () => {
    const sole = soleQualifiedMemberIds({
      memberIds: ['m-1', 'm-2', 'm-3'],
      roles: [
        { member_id: 'm-1', role: { name: 'Worship Leader', is_active: true } },
        { member_id: 'm-2', role: { name: 'Singer', is_active: true } },
        { member_id: 'm-3', role: { name: 'Singer', is_active: true } },
      ],
      skills: [],
    });
    expect(sole.has('m-1')).toBe(true);

    const shared = soleQualifiedMemberIds({
      memberIds: ['m-1', 'm-2', 'm-3', 'm-4'],
      roles: twoLeadersTwoBackups,
      skills: [],
    });
    expect(shared.has('m-1')).toBe(false);
    expect(shared.has('m-2')).toBe(false);
    expect(shared.has('m-3')).toBe(false);
  });

  it('excludes a sole required-instrument holder (Simone-shaped)', () => {
    const excluded = soleQualifiedMemberIds({
      memberIds: ['m-1', 'm-2', 'm-3', 'm-4', 'm-5'],
      roles: [
        ...twoLeadersTwoBackups,
        { member_id: 'm-5', role: { name: 'Singer', is_active: true } },
      ],
      skills: [{ member_id: 'm-1', instrument: { id: 'drums', is_required: true } }],
    });
    expect(excluded.has('m-1')).toBe(true);
  });

  it('does not exclude when 2+ members hold the required instrument', () => {
    const excluded = soleQualifiedMemberIds({
      memberIds: ['m-1', 'm-2', 'm-3', 'm-4'],
      roles: twoLeadersTwoBackups,
      skills: [
        { member_id: 'm-1', instrument: { id: 'drums', is_required: true } },
        { member_id: 'm-2', instrument: { id: 'drums', is_required: true } },
      ],
    });
    expect(excluded.size).toBe(0);
  });

  it('does not exclude when a required instrument has zero active holders', () => {
    const excluded = soleQualifiedMemberIds({
      memberIds: ['m-1', 'm-2', 'm-3', 'm-4'],
      roles: twoLeadersTwoBackups,
      skills: [
        { member_id: 'm-inactive', instrument: { id: 'drums', is_required: true } },
        { member_id: 'm-3', instrument: { id: 'piano', is_required: false } },
      ],
    });
    expect(excluded.size).toBe(0);
  });

  it('excludes a sole active Devotion holder and ignores a zero-holder devotion slot', () => {
    const excluded = soleQualifiedMemberIds({
      memberIds: ['m-1', 'm-2', 'm-3', 'm-4', 'm-5'],
      roles: [
        { member_id: 'm-1', role: { name: 'Devotion', is_active: true } },
        ...twoLeadersTwoBackups,
        { member_id: 'm-5', role: { name: 'Singer', is_active: true } },
      ],
      skills: [],
    });
    expect(excluded.has('m-1')).toBe(true);

    const noDevotion = soleQualifiedMemberIds({
      memberIds: ['m-1', 'm-2', 'm-3', 'm-4'],
      roles: twoLeadersTwoBackups,
      skills: [],
    });
    expect(noDevotion.size).toBe(0);
  });

  it('does not count inactive roles (is_active:false)', () => {
    const excluded = soleQualifiedMemberIds({
      memberIds: ['m-1', 'm-2', 'm-3'],
      roles: [
        { member_id: 'm-1', role: { name: 'Worship Leader', is_active: false } },
        { member_id: 'm-2', role: { name: 'Singer', is_active: true } },
        { member_id: 'm-3', role: { name: 'Singer', is_active: true } },
      ],
      skills: [],
    });
    expect(excluded.has('m-1')).toBe(false);
  });

  it('never counts or excludes members outside the active memberIds (HIGH-risk)', () => {
    const excluded = soleQualifiedMemberIds({
      memberIds: ['m-1', 'm-2', 'm-3'],
      roles: [
        { member_id: 'm-inactive', role: { name: 'Worship Leader', is_active: true } },
        { member_id: 'm-1', role: { name: 'Singer', is_active: true } },
        { member_id: 'm-2', role: { name: 'Singer', is_active: true } },
        { member_id: 'm-3', role: { name: 'Singer', is_active: true } },
      ],
      skills: [
        { member_id: 'm-inactive', instrument: { id: 'drums', is_required: true } },
      ],
    });
    expect(excluded.size).toBe(0);
    expect(excluded.has('m-inactive')).toBe(false);
  });
});