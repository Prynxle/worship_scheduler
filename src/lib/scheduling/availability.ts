import { Availability } from '../types/database';

/**
 * Whether a weekly availability record blocks a given service week.
 * New records carry a 0-based `month`/`year`; legacy records without them
 * match any month so existing data keeps working.
 */
export function isWeeklyUnavailable(
  record: Availability,
  weekNumber: number,
  month: number,
  year: number
): boolean {
  return (
    record.type === 'weekly' &&
    record.week_number === weekNumber &&
    (record.month === undefined || record.month === month) &&
    (record.year === undefined || record.year === year)
  );
}