import { describe, expect, it } from 'vitest';
import { parseMonthParam } from './month-param';

describe('parseMonthParam', () => {
  it('seeds the month from a valid ?month=YYYY-MM', () => {
    expect(parseMonthParam('?month=2026-11', '2026-10')).toBe('2026-11');
    expect(parseMonthParam('?month=2099-01&x=1', '2026-10')).toBe('2099-01');
  });

  it('keeps the fallback when the parameter is absent', () => {
    expect(parseMonthParam('', '2026-10')).toBe('2026-10');
    expect(parseMonthParam('?other=2026-11', '2026-10')).toBe('2026-10');
  });

  it('rejects anything that is not a real month in the API bounds', () => {
    for (const search of [
      '?month=2026-13',
      '?month=2026-00',
      '?month=2026-1',
      '?month=26-11',
      '?month=2026-11-01',
      '?month=1999-12',
      '?month=2101-01',
      '?month=abcd-ef',
      '?month=',
    ]) {
      expect(parseMonthParam(search, '2026-10')).toBe('2026-10');
    }
  });

  it('does not let a repeated parameter smuggle in an invalid month', () => {
    // URLSearchParams.get returns the FIRST value, so a trailing junk value
    // cannot override a valid one and vice versa: the first value is judged.
    expect(parseMonthParam('?month=2026-11&month=bad', '2026-10')).toBe('2026-11');
    expect(parseMonthParam('?month=bad&month=2026-11', '2026-10')).toBe('2026-10');
  });
});
