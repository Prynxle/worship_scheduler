import { Availability } from '../types/database';

/** The availability fields the scheduling and reporting predicates need. */
export type AvailabilityRecord = Pick<
  Availability,
  'member_id' | 'type' | 'week_number' | 'month' | 'year' | 'date' | 'end_date' | 'status'
>;

/**
 * Whether a weekly availability record blocks a given service week.
 * New records carry a 0-based `month`/`year`; legacy records without them
 * match any month so existing data keeps working.
 */
export function isWeeklyUnavailable(
  record: AvailabilityRecord,
  weekNumber: number,
  month: number,
  year: number
): boolean {
  return (
    record.type === 'weekly' &&
    record.week_number === weekNumber &&
    (record.month == null || record.month === month) &&
    (record.year == null || record.year === year)
  );
}

export interface ServiceAvailabilityContext {
  week_number: number;
  /** 0-based month, matching `services.month`. */
  month: number;
  year: number;
  /** Service date as `YYYY-MM-DD`. */
  date: string;
}

function datePart(value: string): string {
  return value.slice(0, 10);
}

function sameDate(left: string, right: string): boolean {
  return datePart(left) === datePart(right);
}

/**
 * The single availability predicate shared by the validator and reporting.
 *
 * Keep this at least as strict as anything downstream: a record handled here
 * but missed by a SQL gate would be a type the database waves through.
 */
export function isUnavailableForService(
  record: AvailabilityRecord,
  service: ServiceAvailabilityContext
): boolean {
  if (!['pending', 'approved'].includes(record.status)) return false;

  if (isWeeklyUnavailable(record, service.week_number, service.month, service.year)) {
    return true;
  }

  if (
    record.type === 'recurring' &&
    record.week_number === service.week_number &&
    (record.month == null || record.month === service.month) &&
    (record.year == null || record.year === service.year)
  ) {
    return true;
  }

  if (record.type === 'date' && record.date) {
    return sameDate(record.date, service.date);
  }

  if (
    ['vacation', 'temporary_leave', 'emergency_leave', 'recurring'].includes(record.type) &&
    record.date
  ) {
    // Date-only comparison, so a local timezone offset can never move a record
    // in or out of a service date.
    const serviceDate = datePart(service.date);
    const start = datePart(record.date);
    const end = datePart(record.end_date ?? record.date);
    return serviceDate >= start && serviceDate <= end;
  }

  return false;
}
