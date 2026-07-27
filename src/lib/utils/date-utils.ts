import { format, startOfMonth, endOfMonth, eachWeekOfInterval, getWeekOfMonth, startOfWeek, endOfWeek, addWeeks, subWeeks, isWithinInterval } from 'date-fns';

export function getWeekNumber(date: Date): number {
  const monthStart = startOfMonth(date);
  const firstMonday = startOfWeek(monthStart, { weekStartsOn: 1 });
  const diffDays = Math.floor((date.getTime() - firstMonday.getTime()) / (1000 * 60 * 60 * 24));
  return Math.floor(diffDays / 7) + 1;
}

export function getWeeksInMonth(month: number, year: number): number {
  const date = new Date(year, month, 1);
  const monthStart = startOfMonth(date);
  const monthEnd = endOfMonth(date);
  const weeks = eachWeekOfInterval({ start: monthStart, end: monthEnd }, { weekStartsOn: 1 });
  return weeks.length;
}

export function getWeekDate(weekNumber: number, month: number, year: number): Date {
  const date = new Date(year, month, 1);
  const monthStart = startOfMonth(date);
  const firstMonday = startOfWeek(monthStart, { weekStartsOn: 1 });
  return addWeeks(firstMonday, weekNumber - 1);
}

export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return format(d, 'MMM dd, yyyy');
}

export function formatWeekDate(weekNumber: number, month: number, year: number): string {
  const weekDate = getWeekDate(weekNumber, month, year);
  return format(weekDate, 'MMM dd');
}

export function isDateInRange(date: Date, startDate: Date, endDate: Date): boolean {
  return isWithinInterval(date, { start: startDate, end: endDate });
}

export function getMonthName(month: number): string {
  const date = new Date(2024, month, 1);
  return format(date, 'MMMM');
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
