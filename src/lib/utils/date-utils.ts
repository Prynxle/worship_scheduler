import { format, endOfMonth, eachWeekOfInterval, addWeeks, addDays, isWithinInterval } from 'date-fns';

/**
 * First Sunday of a month (on or after the 1st), matching the database's
 * `get_week_number` semantics. Weeks are anchored here so no week starts in
 * the previous month.
 */
export function getFirstSunday(month: number, year: number): Date {
  const monthStart = new Date(year, month, 1);
  const dow = monthStart.getDay();
  return dow === 0 ? monthStart : new Date(year, month, 1 + (7 - dow));
}

/** Week of the month for a date (1-based), 0 for days before the first Sunday. */
export function getWeekNumber(date: Date): number {
  const firstSunday = getFirstSunday(date.getMonth(), date.getFullYear());
  const diffMs = date.getTime() - firstSunday.getTime();
  if (diffMs < 0) return 0;
  return Math.floor(diffMs / (7 * 86_400_000)) + 1;
}

/** Number of Sunday-anchored weeks that start within the month. */
export function getWeeksInMonth(month: number, year: number): number {
  const firstSunday = getFirstSunday(month, year);
  const monthEnd = endOfMonth(new Date(year, month, 1));
  const weeks = eachWeekOfInterval({ start: firstSunday, end: monthEnd }, { weekStartsOn: 0 });
  return weeks.length;
}

/** Week 1 of the month starts on its first Sunday. */
export function getWeekDate(weekNumber: number, month: number, year: number): Date {
  const firstSunday = getFirstSunday(month, year);
  return addWeeks(firstSunday, weekNumber - 1);
}

/** Sunday-to-Saturday range for a week of the given month (month is 0-based). */
export function getWeekDateRange(
  weekNumber: number,
  month: number,
  year: number
): { start: Date; end: Date } {
  const start = getWeekDate(weekNumber, month, year);
  return { start, end: addDays(start, 6) };
}

/**
 * Valid week numbers (1..getWeeksInMonth) for a month, excluding weeks whose
 * Sunday service has already passed. The week stays requestable on its Sunday.
 */
export function getAvailableWeeks(month: number, year: number, now: Date = new Date()): number[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const weeks: number[] = [];
  for (let weekNumber = 1; weekNumber <= getWeeksInMonth(month, year); weekNumber++) {
    const range = getWeekDateRange(weekNumber, month, year);
    if (range.start.getTime() >= today) weeks.push(weekNumber);
  }
  return weeks;
}

export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return format(d, 'MMM dd, yyyy');
}

export function formatWeekDate(weekNumber: number, month: number, year: number): string {
  const weekDate = getWeekDate(weekNumber, month, year);
  return format(weekDate, 'MMM dd');
}

/**
 * Local (not UTC) calendar date string `yyyy-MM-dd` for the given Date, derived
 * from local date components. Unlike `.toISOString().slice(0, 10)` this never
 * drifts to the previous day on machines with a positive UTC offset — e.g. a
 * Sunday at local midnight in October 2026 on UTC+8 is still 2026-10-04, not
 * 2026-10-03. Used for persisted service dates so `set_week_number` computes
 * the correct week 1..4.
 */
export function formatLocalDate(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

export function isDateInRange(date: Date, startDate: Date, endDate: Date): boolean {
  return isWithinInterval(date, { start: startDate, end: endDate });
}

export function getMonthName(month: number): string {
  const date = new Date(2024, month, 1);
  return format(date, 'MMMM');
}

/**
 * Current week of the month (1-5) using the database's "first Sunday" semantics,
 * matching `get_week_number` in the functions/triggers migration. Days before the
 * month's first Sunday are treated as week 1 so a request for the current week is
 * still allowed.
 */
export function getCurrentWeekNumber(now: Date = new Date()): number {
  const firstSunday = getFirstSunday(now.getMonth(), now.getFullYear());

  if (now.getTime() < firstSunday.getTime()) return 1;

  const daysBetween = Math.floor((now.getTime() - firstSunday.getTime()) / 86_400_000);
  return Math.floor(daysBetween / 7) + 1;
}

export function getCurrentMonth(): { month: number; year: number } {
  const now = new Date();
  return { month: now.getMonth(), year: now.getFullYear() };
}

export function getUpcomingWeeks(count: number = 4): { weekNumber: number; date: Date }[] {
  const now = new Date();
  const weeks: { weekNumber: number; date: Date }[] = [];

  for (let i = 0; i < count; i++) {
    const weekDate = addWeeks(now, i);
    weeks.push({
      weekNumber: getWeekNumber(weekDate),
      date: weekDate,
    });
  }

  return weeks;
}
