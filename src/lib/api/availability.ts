import { Availability } from '../types/database';

const AVAILABILITY_TYPES: ReadonlySet<string> = new Set([
  'weekly',
  'date',
  'vacation',
  'temporary_leave',
  'emergency_leave',
  'recurring',
]);

const RANGE_TYPES: ReadonlySet<string> = new Set([
  'vacation',
  'temporary_leave',
  'emergency_leave',
]);

export type AvailabilityInput = {
  type: Availability['type'];
  week_number?: number;
  month?: number;
  year?: number;
  date?: string;
  end_date?: string;
  reason?: string;
};

export type AvailabilityValidationResult =
  | { ok: true; value: AvailabilityInput }
  | { ok: false; error: string };

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function toInteger(value: unknown): number | undefined {
  if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) return Number(value);
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  return undefined;
}

export function validateAvailabilityInput(
  body: Record<string, unknown>
): AvailabilityValidationResult {
  const { type, week_number, date, end_date, month, year } = body;

  if (typeof type !== 'string' || !AVAILABILITY_TYPES.has(type)) {
    return { ok: false, error: 'A valid availability type is required.' };
  }
  const availabilityType = type as Availability['type'];

  if (availabilityType === 'weekly') {
    const week = toInteger(week_number);
    if (week === undefined || week < 1 || week > 5) {
      return { ok: false, error: 'A week number between 1 and 5 is required for weekly availability.' };
    }
    const monthValue = toInteger(month);
    if (monthValue === undefined || monthValue < 0 || monthValue > 11) {
      return { ok: false, error: 'A month between 0 and 11 is required for weekly availability.' };
    }
    const yearValue = toInteger(year);
    if (yearValue === undefined || yearValue < 2000 || yearValue > 2100) {
      return { ok: false, error: 'A valid year is required for weekly availability.' };
    }
    return {
      ok: true,
      value: {
        type: availabilityType,
        week_number: week,
        month: monthValue,
        year: yearValue,
        reason: stringOrUndefined(body.reason),
      },
    };
  }

  if (availabilityType === 'date') {
    if (typeof date !== 'string' || Number.isNaN(Date.parse(date))) {
      return { ok: false, error: 'A valid date is required for date availability.' };
    }
    return { ok: true, value: { type: availabilityType, date, reason: stringOrUndefined(body.reason) } };
  }

  if (RANGE_TYPES.has(availabilityType)) {
    const hasStart = typeof date === 'string' && !Number.isNaN(Date.parse(date));
    const hasEnd = typeof end_date === 'string' && !Number.isNaN(Date.parse(end_date));
    if (!hasStart || !hasEnd) {
      return { ok: false, error: 'Valid start and end dates are required for this availability type.' };
    }
    return { ok: true, value: { type: availabilityType, date, end_date, reason: stringOrUndefined(body.reason) } };
  }

  // recurring
  return { ok: true, value: { type: availabilityType, reason: stringOrUndefined(body.reason) } };
}