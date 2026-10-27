/**
 * The month an availability reset wants the coordinator to review next.
 *
 * `reset_month_availability` invalidates the month's future-dated drafts, so
 * the natural next step is Line Up Songs for that same month -- the page that
 * would otherwise keep showing songs attached to lineups that are now out of
 * date. The availability page links there with `?month=YYYY-MM`.
 *
 * The parameter is optional and advisory: an absent or malformed value leaves
 * the page's own default (the current month) in place. It only seeds which
 * month to LOAD, never a church, service or row, so there is nothing here that
 * could cross a tenant boundary. The month is validated as a real calendar
 * month (not just any `YYYY-MM` shape) so the page never requests
 * `/api/song-lineups?month=13`.
 *
 * Parsed with `URLSearchParams` from the passed search string rather than
 * `useSearchParams`, because a single optional parameter does not justify a
 * Suspense boundary around the whole page.
 */
export function parseMonthParam(search: string, fallback: string): string {
  const value = new URLSearchParams(search).get('month');
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return fallback;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  // Same bounds the `/api/song-lineups` GET enforces.
  if (year < 2000 || year > 2100 || month < 1 || month > 12) return fallback;
  return value;
}
