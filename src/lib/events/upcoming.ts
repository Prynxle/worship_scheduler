import { formatLocalDate } from '@/lib/utils/date-utils';

/**
 * Presentation rules for the dashboard header's event summary.
 *
 * The header used to render a hardcoded `Planning season` string with no data
 * behind it. Members now get a real count of their church's upcoming events,
 * and the line disappears entirely when there is nothing to report, so an empty
 * month is not dressed up as a season.
 *
 * Kept free of React and of `fetch` so the rules are unit-testable and the
 * component stays a thin renderer.
 */

/**
 * Lower bound for an "upcoming" event query, as a local `yyyy-MM-dd` string.
 *
 * Deliberately local rather than `toISOString()`: on a UTC+8 machine, 00:30
 * local on 4 October is still 3 October in UTC, and an ISO slice would hide
 * today's events until 8am. `formatLocalDate` exists for exactly this reason.
 */
export function getUpcomingEventsQueryStart(now: Date): string {
  return formatLocalDate(now);
}

/**
 * Header label for an upcoming-event count, or `null` when the line should be
 * omitted. Zero is a real answer — the church has nothing scheduled — so it
 * renders nothing rather than claiming a season.
 */
export function formatUpcomingEventCount(count: number): string | null {
  if (!Number.isFinite(count) || count <= 0) return null;
  return `${count} upcoming ${count === 1 ? 'event' : 'events'}`;
}
