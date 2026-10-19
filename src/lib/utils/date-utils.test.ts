import { describe, expect, it } from 'vitest';
import { getCurrentWeekNumber, getWeekDateRange, getAvailableWeeks, getMonthIndex, getWeeksInMonth, formatLongDate, isMonthBefore } from './date-utils';

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

describe('formatLongDate (dashboard header date)', () => {
  it('renders weekday, month and day in that order', () => {
    expect(formatLongDate(new Date(2026, 9, 4))).toBe('Sunday, October 4');
  });

  it('keeps the weekday consistent with the date', () => {
    // The header previously showed a frozen "Sunday, August 2" regardless of
    // the real date, so the weekday is asserted against known calendar dates.
    expect(formatLongDate(new Date(2026, 7, 2))).toBe('Sunday, August 2');
    expect(formatLongDate(new Date(2026, 9, 7))).toBe('Wednesday, October 7');
  });

  it('does not pad the day of the month', () => {
    expect(formatLongDate(new Date(2026, 0, 5))).toBe('Monday, January 5');
  });

  it('tracks month and year rollovers', () => {
    expect(formatLongDate(new Date(2026, 11, 31))).toBe('Thursday, December 31');
    expect(formatLongDate(new Date(2027, 0, 1))).toBe('Friday, January 1');
  });
});

describe('getMonthIndex (0-based, matching services.month)', () => {
  it('returns the 0-based month index', () => {
    // The month mismatch that this change fixed: September 2026 was written to
    // services.month as 9 instead of 8, because a 1-based literal was used at
    // the call site.
    expect(getMonthIndex(new Date(2026, 8, 6))).toBe(8);
    expect(getMonthIndex(new Date(2026, 0, 1))).toBe(0);
    expect(getMonthIndex(new Date(2026, 11, 31))).toBe(11);
  });

  it('is independent of the day of the month', () => {
    expect(getMonthIndex(new Date(2026, 8, 1))).toBe(8);
    expect(getMonthIndex(new Date(2026, 8, 30))).toBe(8);
  });
});

describe('isMonthBefore (mirrors the SQL editable-window boundary)', () => {
  // October 2026 is the current month; mid-month so an earlier day in the SAME
  // month must still be editable.
  const now = new Date(2026, 9, 19);

  it('treats an earlier month in the same year as past', () => {
    expect(isMonthBefore(8, 2026, now)).toBe(true); // September
    expect(isMonthBefore(0, 2026, now)).toBe(true); // January
  });

  it('treats the current month as NOT past, regardless of the day', () => {
    // The exact bug: a service dated Oct 4 was still offered as editable while
    // the month was current, so the boundary must ignore the day.
    expect(isMonthBefore(9, 2026, now)).toBe(false);
  });

  it('treats later months and future years as not past', () => {
    expect(isMonthBefore(10, 2026, now)).toBe(false); // November
    expect(isMonthBefore(11, 2026, now)).toBe(false); // December
    expect(isMonthBefore(0, 2027, now)).toBe(false); // next January
  });

  it('treats any month of an earlier year as past', () => {
    expect(isMonthBefore(11, 2025, now)).toBe(true); // December of last year
    expect(isMonthBefore(0, 2025, now)).toBe(true);
  });

  it('agrees with the month-start comparison the database uses', () => {
    // date_trunc('month', d) < date_trunc('month', CURRENT_DATE) for each case.
    const cases: Array<[number, number, boolean]> = [
      [9, 2026, false],
      [8, 2026, true],
      [10, 2026, false],
      [11, 2025, true],
      [0, 2027, false],
    ];
    for (const [month, year, expected] of cases) {
      const serviceMonthStart = new Date(year, month, 1);
      const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      expect(serviceMonthStart.getTime() < currentMonthStart.getTime()).toBe(expected);
      expect(isMonthBefore(month, year, now)).toBe(expected);
    }
  });
});
