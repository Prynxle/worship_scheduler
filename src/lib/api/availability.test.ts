import { describe, expect, it } from 'vitest';
import { validateAvailabilityInput } from './availability';

describe('validateAvailabilityInput', () => {
  it('accepts a valid weekly payload', () => {
    const result = validateAvailabilityInput({ type: 'weekly', week_number: 3, month: 8, year: 2026, reason: 'Work' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ type: 'weekly', week_number: 3, month: 8, year: 2026, reason: 'Work' });
    }
  });

  it('accepts numeric string week number, month, and year', () => {
    const result = validateAvailabilityInput({ type: 'weekly', week_number: '2', month: '8', year: '2026' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.week_number).toBe(2);
      expect(result.value.month).toBe(8);
      expect(result.value.year).toBe(2026);
    }
  });

  it('rejects weekly payloads without a valid week number', () => {
    expect(validateAvailabilityInput({ type: 'weekly', month: 8, year: 2026 }).ok).toBe(false);
    expect(validateAvailabilityInput({ type: 'weekly', week_number: 0, month: 8, year: 2026 }).ok).toBe(false);
    expect(validateAvailabilityInput({ type: 'weekly', week_number: 6, month: 8, year: 2026 }).ok).toBe(false);
    expect(validateAvailabilityInput({ type: 'weekly', week_number: 1.5, month: 8, year: 2026 }).ok).toBe(false);
    expect(validateAvailabilityInput({ type: 'weekly', week_number: 'abc', month: 8, year: 2026 }).ok).toBe(false);
  });

  it('requires a valid month for weekly payloads', () => {
    expect(validateAvailabilityInput({ type: 'weekly', week_number: 3, year: 2026 }).ok).toBe(false);
    expect(validateAvailabilityInput({ type: 'weekly', week_number: 3, month: -1, year: 2026 }).ok).toBe(false);
    expect(validateAvailabilityInput({ type: 'weekly', week_number: 3, month: 12, year: 2026 }).ok).toBe(false);
    expect(validateAvailabilityInput({ type: 'weekly', week_number: 3, month: 'abc', year: 2026 }).ok).toBe(false);
    expect(validateAvailabilityInput({ type: 'weekly', week_number: 3, month: 8 }).ok).toBe(false);
  });

  it('requires a valid year for weekly payloads', () => {
    expect(validateAvailabilityInput({ type: 'weekly', week_number: 3, month: 8 }).ok).toBe(false);
    expect(validateAvailabilityInput({ type: 'weekly', week_number: 3, month: 8, year: 1999 }).ok).toBe(false);
    expect(validateAvailabilityInput({ type: 'weekly', week_number: 3, month: 8, year: 2101 }).ok).toBe(false);
    expect(validateAvailabilityInput({ type: 'weekly', week_number: 3, month: 8, year: 'abc' }).ok).toBe(false);
  });

  it('rejects unknown or missing availability types', () => {
    expect(validateAvailabilityInput({ type: 'nope' }).ok).toBe(false);
    expect(validateAvailabilityInput({ type: '' }).ok).toBe(false);
    expect(validateAvailabilityInput({}).ok).toBe(false);
  });

  it('requires a valid date for date availability', () => {
    expect(validateAvailabilityInput({ type: 'date', date: '2026-09-20' }).ok).toBe(true);
    expect(validateAvailabilityInput({ type: 'date' }).ok).toBe(false);
    expect(validateAvailabilityInput({ type: 'date', date: 'not-a-date' }).ok).toBe(false);
  });

  it('requires valid start and end dates for leave types', () => {
    expect(
      validateAvailabilityInput({ type: 'vacation', date: '2026-09-20', end_date: '2026-09-27' }).ok
    ).toBe(true);
    expect(validateAvailabilityInput({ type: 'temporary_leave', date: '2026-09-20' }).ok).toBe(false);
    expect(validateAvailabilityInput({ type: 'emergency_leave' }).ok).toBe(false);
    expect(
      validateAvailabilityInput({ type: 'vacation', date: '2026-09-20', end_date: 'bogus' }).ok
    ).toBe(false);
  });

  it('accepts recurring without extra fields', () => {
    expect(validateAvailabilityInput({ type: 'recurring' }).ok).toBe(true);
  });
});