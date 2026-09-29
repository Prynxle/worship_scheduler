import { describe, expect, it } from 'vitest';
import { isWeeklyUnavailable } from './availability';
import type { Availability } from '../types/database';

function weeklyRecord(overrides: Partial<Availability> = {}): Availability {
  return {
    id: 'a-1',
    member_id: 'm-1',
    church_id: 'church',
    type: 'weekly',
    week_number: 2,
    month: 9,
    year: 2026,
    status: 'approved',
    created_at: '2026-09-01',
    ...overrides,
  };
}

describe('isWeeklyUnavailable', () => {
  it('matches the same week, month, and year', () => {
    expect(isWeeklyUnavailable(weeklyRecord(), 2, 9, 2026)).toBe(true);
  });

  it('does not match the same week in a different month', () => {
    expect(isWeeklyUnavailable(weeklyRecord(), 2, 8, 2026)).toBe(false);
    expect(isWeeklyUnavailable(weeklyRecord(), 2, 10, 2026)).toBe(false);
  });

  it('does not match a different year', () => {
    expect(isWeeklyUnavailable(weeklyRecord(), 2, 9, 2025)).toBe(false);
  });

  it('does not match a different week', () => {
    expect(isWeeklyUnavailable(weeklyRecord(), 1, 9, 2026)).toBe(false);
  });

  it('still matches legacy records without month or year', () => {
    const legacy = weeklyRecord({ month: undefined, year: undefined });
    expect(isWeeklyUnavailable(legacy, 2, 9, 2026)).toBe(true);
    expect(isWeeklyUnavailable(legacy, 2, 0, 2000)).toBe(true);
  });

  it('ignores non-weekly records', () => {
    const record = weeklyRecord({ type: 'vacation', month: undefined, year: undefined });
    expect(isWeeklyUnavailable(record, 2, 9, 2026)).toBe(false);
  });
});