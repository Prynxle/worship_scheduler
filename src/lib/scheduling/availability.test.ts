import { describe, expect, it } from 'vitest';
import { isUnavailableForService, isWeeklyUnavailable } from './availability';
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

  it('still matches legacy records without month or year (null)', () => {
    const legacy = weeklyRecord({ month: null, year: null });
    expect(isWeeklyUnavailable(legacy, 2, 9, 2026)).toBe(true);
    expect(isWeeklyUnavailable(legacy, 2, 0, 2000)).toBe(true);
  });

  it('ignores non-weekly records', () => {
    const record = weeklyRecord({ type: 'vacation', month: undefined, year: undefined });
    expect(isWeeklyUnavailable(record, 2, 9, 2026)).toBe(false);
  });
});

describe('isUnavailableForService', () => {
  const service = {
    week_number: 2,
    month: 9,
    year: 2026,
    date: '2026-10-11',
  };

  it('matches a weekly record for the same month and year', () => {
    expect(isUnavailableForService(weeklyRecord(), service)).toBe(true);
    expect(isUnavailableForService(weeklyRecord(), { ...service, week_number: 3 })).toBe(false);
  });

  it('matches a date record on the service date', () => {
    const record = weeklyRecord({ type: 'date', date: '2026-10-11' });
    expect(isUnavailableForService(record, service)).toBe(true);
    expect(isUnavailableForService(record, { ...service, date: '2026-10-12' })).toBe(false);
  });

  it('matches vacation and leave ranges inclusively', () => {
    const record = weeklyRecord({
      type: 'temporary_leave',
      date: '2026-10-10',
      end_date: '2026-10-12',
    });
    expect(isUnavailableForService(record, service)).toBe(true);
    expect(isUnavailableForService(record, { ...service, date: '2026-10-13' })).toBe(false);
  });

  it('matches recurring records by week, month, and year', () => {
    const record = weeklyRecord({ type: 'recurring', date: undefined });
    expect(isUnavailableForService(record, service)).toBe(true);
    expect(isUnavailableForService(record, { ...service, month: 8 })).toBe(false);
  });

  it('ignores rejected records', () => {
    expect(isUnavailableForService(weeklyRecord({ status: 'rejected' }), service)).toBe(false);
  });
});