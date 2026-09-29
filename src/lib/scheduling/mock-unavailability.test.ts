import { afterEach, describe, expect, it, vi } from 'vitest';
import { planMockUnavailability, soleQualifiedMemberIds } from './mock-unavailability';
import { getCurrentMonth, getMonthName, getWeeksInMonth } from '../utils/date-utils';

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

describe('planMockUnavailability for the current month', () => {
  // The mock-unavailability route no longer hardcodes a month; it passes
  // getCurrentMonth() through to the planner. These cases pin the clock to
  // calendar edge cases and assert the month/year with literals written here,
  // so a 0-indexed/1-indexed slip or a leap-year miscount fails outright
  // instead of quietly agreeing with the implementation.
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    { at: [2026, 1, 15] as const, month: 1, year: 2026, label: 'February 2026 (28 days, 4 weeks)' },
    { at: [2024, 1, 15] as const, month: 1, year: 2024, label: 'February 2024 leap year (29 days, 5 weeks)' },
    { at: [2027, 0, 31] as const, month: 0, year: 2027, label: 'January 2027 (5 weeks)' },
    { at: [2026, 5, 30] as const, month: 5, year: 2026, label: 'June 2026 (30 days, 4 weeks)' },
    { at: [2026, 11, 31] as const, month: 11, year: 2026, label: 'December 2026 (0-indexed 11)' },
  ])('plans a valid month for $label', ({ at, month, year }) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(at[0], at[1], at[2], 12, 0, 0));

    const current = getCurrentMonth();
    expect(current).toEqual({ month, year });

    const weeks = getWeeksInMonth(month, year);
    // 5-week months are the ones where an off-by-one in the rotation would
    // otherwise hide inside a member count that never reaches `weeks`.
    expect(weeks).toBeGreaterThanOrEqual(4);

    const plan = planMockUnavailability(rosterOf(weeks), month, year);

    expect(plan).toHaveLength(weeks);
    // Full rotation across every week of the resolved month.
    expect(plan.map((row) => row.week_number)).toEqual(
      Array.from({ length: weeks }, (_, index) => index + 1),
    );
    for (const row of plan) {
      expect(row.month).toBe(month);
      expect(row.year).toBe(year);
    }
  });

  it('keeps the rotation in range for the current month on every month of a year', () => {
    // Sweeping all twelve months of 2026 through the real default proves the
    // route can be called at any time of year without producing a week number
    // the availability table would reject.
    for (let month = 0; month < 12; month += 1) {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, month, 15, 12, 0, 0));

      expect(getCurrentMonth().month).toBe(month);

      const weeks = getWeeksInMonth(month, 2026);
      const plan = planMockUnavailability(rosterOf(9), month, 2026);

      expect(plan).toHaveLength(9);
      for (const row of plan) {
        expect(row.week_number).toBeGreaterThanOrEqual(1);
        expect(row.week_number).toBeLessThanOrEqual(weeks);
      }
    }
  });

  it('names the current month without an off-by-one for the reason text the route writes', () => {
    // The route persists `Mock unavailability (${getMonthName(month)} ${year} test)`,
    // so a 1-indexed month would mislabel every mock row it writes.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 2, 18, 12, 0, 0));

    const current = getCurrentMonth();
    expect(getMonthName(current.month)).toBe('March');
    expect(getMonthName(0)).toBe('January');
    expect(getMonthName(11)).toBe('December');
  });

  it('leaves the planner caller-agnostic: it never reads the clock itself', () => {
    // The default lives in the route, so the planner must stay pure. If it ever
    // started calling getCurrentMonth() internally, these two would diverge.
    const january = new Date(2026, 0, 15, 12, 0, 0);
    const july = new Date(2026, 6, 15, 12, 0, 0);

    vi.useFakeTimers();
    vi.setSystemTime(january);
    const fromJanuary = planMockUnavailability(roster, 9, 2026);
    vi.setSystemTime(july);
    const fromJuly = planMockUnavailability(roster, 9, 2026);

    expect(fromJuly).toEqual(fromJanuary);
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