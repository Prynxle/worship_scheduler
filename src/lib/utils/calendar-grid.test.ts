import { describe, it, expect } from 'vitest';
import { getCalendarGrid } from './calendar-grid';

describe('getCalendarGrid', () => {
  it('returns 42 Sunday-to-Saturday cells starting on the Sunday before the 1st', () => {
    const cells = getCalendarGrid(8, 2026);
    expect(cells).toHaveLength(42);
    // Sep 2026: Sep 1 is a Tuesday, so the grid starts on Sunday Aug 30.
    expect(cells[0].date.getDate()).toBe(30);
    expect(cells[0].date.getMonth()).toBe(7);
    expect(cells[0].date.getDay()).toBe(0);
    // Cells for Sep 1 onwards are inside the month.
    expect(cells.find((cell) => cell.iso === '2026-09-01')?.inMonth).toBe(true);
    expect(cells.find((cell) => cell.iso === '2026-08-30')?.inMonth).toBe(false);
  });

  it('marks only the given today as today', () => {
    const today = new Date(2026, 8, 20);
    const cells = getCalendarGrid(8, 2026, today);
    expect(cells.filter((cell) => cell.isToday)).toHaveLength(1);
    expect(cells.find((cell) => cell.isToday)?.iso).toBe('2026-09-20');
  });

  it('starts on the 1st itself when the month begins on a Sunday', () => {
    // Nov 2026 starts on a Sunday.
    const cells = getCalendarGrid(10, 2026);
    expect(cells[0].iso).toBe('2026-11-01');
    expect(cells[0].inMonth).toBe(true);
  });
});