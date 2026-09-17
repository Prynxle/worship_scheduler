import { describe, expect, it } from 'vitest';
import { getCurrentWeekNumber, getWeekDateRange, getAvailableWeeks, getWeeksInMonth } from './date-utils';

describe('getCurrentWeekNumber (database first-Sunday semantics)', () => {
  it('treats dates before the first Sunday of the month as week 1', () => {
    // January 2026: Jan 1 is a Thursday, first Sunday is Jan 4
    expect(getCurrentWeekNumber(new Date(2026, 0, 1))).toBe(1);
    expect(getCurrentWeekNumber(new Date(2026, 0, 3))).toBe(1);
  });

  it('week 1 runs Sunday through Saturday before the next Sunday', () => {
    expect(getCurrentWeekNumber(new Date(2026, 0, 4))).toBe(1);
    expect(getCurrentWeekNumber(new Date(2026, 0, 10))).toBe(1);
  });

  it('advances the week number each Sunday', () => {
    expect(getCurrentWeekNumber(new Date(2026, 0, 11))).toBe(2);
    expect(getCurrentWeekNumber(new Date(2026, 0, 18))).toBe(3);
    expect(getCurrentWeekNumber(new Date(2026, 0, 25))).toBe(4);
    // February 2026 starts on a Sunday, so Feb 8 is week 2 of February
    expect(getCurrentWeekNumber(new Date(2026, 1, 8))).toBe(2);
  });

  it('handles months that start on a Sunday', () => {
    // March 2026: Mar 1 is a Sunday
    expect(getCurrentWeekNumber(new Date(2026, 2, 1))).toBe(1);
    expect(getCurrentWeekNumber(new Date(2026, 2, 8))).toBe(2);
    expect(getCurrentWeekNumber(new Date(2026, 2, 29))).toBe(5);
  });
});

describe('getWeekDateRange (Monday-based, month is 0-based)', () => {
  it('returns the Monday-to-Sunday range for each week', () => {
    // September 2026: first Monday on/before Sep 1 (Tue) is Aug 31
    const week3 = getWeekDateRange(3, 8, 2026);
    expect(week3.start.getDate()).toBe(14);
    expect(week3.start.getDay()).toBe(1);
    expect(week3.end.getDate()).toBe(20);
    expect(week3.end.getDay()).toBe(0);
  });

  it('anchors week 1 at the first day when the month starts on a Monday', () => {
    // February 2027 starts on a Monday
    const week1 = getWeekDateRange(1, 1, 2027);
    expect(week1.start.getDate()).toBe(1);
    expect(week1.start.getDay()).toBe(1);
    expect(week1.end.getDate()).toBe(7);
  });
});

describe('getWeeksInMonth', () => {
  it('counts Monday-anchored weeks covering the month', () => {
    expect(getWeeksInMonth(8, 2026)).toBe(5); // Sep 2026 spans 5 blocks
    expect(getWeeksInMonth(1, 2027)).toBe(4); // Feb 2027: exactly 4 Mondays
  });
});

describe('getAvailableWeeks', () => {
  it('excludes weeks that have fully passed', () => {
    // Sep 16 2026 (Wed): weeks 1-2 are past, 3-5 remain
    expect(getAvailableWeeks(8, 2026, new Date(2026, 8, 16))).toEqual([3, 4, 5]);
  });

  it('keeps the current week available until it ends', () => {
    expect(getAvailableWeeks(8, 2026, new Date(2026, 8, 20, 8, 0))).toEqual([3, 4, 5]);
    // After the week ends (Sep 21), week 3 drops out
    expect(getAvailableWeeks(8, 2026, new Date(2026, 8, 21))).toEqual([4, 5]);
  });

  it('returns all weeks for a future month', () => {
    expect(getAvailableWeeks(11, 2026, new Date(2026, 8, 16))).toEqual([1, 2, 3, 4, 5]);
  });
});