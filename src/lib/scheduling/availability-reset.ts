import { formatLocalDate } from '@/lib/utils/date-utils';

/**
 * Is this service a draft that a month availability reset invalidated?
 *
 * `reset_month_availability` stamps the month's future-dated drafts with
 * `availability_reset_at`. Such a schedule was built from unavailability the
 * coordinator has since withdrawn, so it must not be validated, published,
 * edited or given new songs until the month is regenerated.
 *
 * The date scope is part of the predicate, not an optimisation. Regeneration
 * only reaches future weeks (`futureWeeks` in `src/app/api/schedule/route.ts`),
 * so a stamp on a service whose date has already passed could never be cleared;
 * treating it as stale would permanently brick that month. A past week keeps the
 * lineup it was actually played with.
 *
 * The comparison is lexicographic on `YYYY-MM-DD`, the repository convention
 * (`src/app/api/schedule/route.ts` compares future-week dates the same way).
 *
 * ONE definition, exported, so the route pre-checks in
 * `/api/validation`, `/api/schedule/month/validate`,
 * `/api/schedule/[serviceId]/publish`, `/api/schedule/[serviceId]/assignments`
 * and `/api/song-lineups` cannot drift apart.
 */
export function isStaleDraft(
  service: { availability_reset_at?: string | null; date: string },
  today: string = formatLocalDate(new Date()),
): boolean {
  return Boolean(service.availability_reset_at) && service.date >= today;
}
