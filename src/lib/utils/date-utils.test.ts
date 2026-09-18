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

describe('getWeekDateRange (Sunday-based, month is 0-based)', () => {
  it('returns the Sunday-to-Saturday range for each week', () => {
    // September 2026: first Sunday is Sep 6 (Sep 1 is a Tuesday)
    const week3 = getWeekDateRange(3, 8, 2026);
    expect(week3.start.getDate()).toBe(20);
    expect(week3.start.getDay()).toBe(0);
    expect(week3.end.getDate()).toBe(26);
    expect(week3.end.getDay()).toBe(6);
  });

  it('anchors week 1 at the first Sunday when the month starts on a Sunday', () => {
    // November 2026 starts on a Sunday
    const week1 = getWeekDateRange(1, 10, 2026);
    expect(week1.start.getDate()).toBe(1);
    expect(week1.start.getDay()).toBe(0);
    expect(week1.end.getDate()).toBe(7);
  });
});

describe('getWeeksInMonth', () => {
  it('counts Sunday-anchored weeks covering the month', () => {
    expect(getWeeksInMonth(8, 2026)).toBe(4); // Sep 2026: Sundays 6,13,20,27
    expect(getWeeksInMonth(10, 2026)).toBe(5); // Nov 2026 starts on a Sunday
  });
});

describe('getAvailableWeeks', () => {
  it('excludes weeks whose Sunday service has passed', () => {
    // Sep 16 2026 (Wed): Sundays Sep 6 and Sep 13 have passed, Sep 20/27 remain
    expect(getAvailableWeeks(8, 2026, new Date(2026, 8, 16))).toEqual([3, 4]);
  });

  it('keeps a week requestable on its Sunday, drops it the next day', () => {
    // Week 3 is Sunday Sep 20: requestable on Sep 20, gone on Sep 21
    expect(getAvailableWeeks(8, 2026, new Date(2026, 8, 20, 8, 0))).toEqual([3, 4]);
    expect(getAvailableWeeks(8, 2026, new Date(2026, 8, 21))).toEqual([4]);
  });

  it('returns all weeks for a future month', () => {
    expect(getAvailableWeeks(11, 2026, new Date(2026, 8, 16))).toEqual([1, 2, 3, 4]);
  });
});