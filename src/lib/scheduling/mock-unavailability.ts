import { getWeeksInMonth } from '../utils/date-utils';

export type PlannedUnavailability = {
  member_id: string;
  month: number;
  year: number;
  week_number: number;
};

/**
 * Plans one deterministic mock unavailability row per member for a month.
 * Pure and tenant-free: rows carry only member/month/year/week; the API route
 * composes the persisted shape (church_id, type, status, reason) at write time.
 *
 * Rotation is stable: members are sorted by id so the same roster always maps
 * to the same weeks regardless of input order.
 */
export function planMockUnavailability(
  members: { id: string; full_name: string }[],
  month: number,
  year: number
): PlannedUnavailability[] {
  const weeks = getWeeksInMonth(month, year);
  const sorted = [...members].sort((a, b) => a.id.localeCompare(b.id));
  return sorted.map((member, index) => ({
    member_id: member.id,
    month,
    year,
    week_number: (index % weeks) + 1,
  }));
}