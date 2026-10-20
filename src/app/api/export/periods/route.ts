import { NextRequest, NextResponse } from 'next/server';
import { requireStaff, getAdminClient } from '@/lib/auth/server';

/**
 * GET /api/export/periods
 * The months this church can actually export, newest last, each with the
 * service weeks available in it.
 *
 * Only services that are `published` or `validated` are considered, because
 * `POST /api/export/pdf` refuses anything else. Building the picker from this
 * list means a period can never be selected that the export would reject, and
 * the year travels with the month instead of being assumed -- the previous
 * picker offered a rolling range of month NUMBERS, so two different years'
 * "September" were indistinguishable and the wrong period could be exported.
 *
 * The tenant is taken from `auth.churchId` ONLY; no client value participates.
 */
export async function GET(request: NextRequest) {
  const auth = await requireStaff(request);
  if (auth instanceof Response) return auth;

  try {
    const admin = getAdminClient();
    const { data, error } = await admin
      .from('services')
      .select('month, year, week_number')
      .eq('church_id', auth.churchId)
      .in('status', ['published', 'validated']);

    if (error) {
      console.error('Failed to load exportable periods:', error);
      return NextResponse.json({ error: 'Could not load the months available for export.' }, { status: 500 });
    }

    const byPeriod = new Map<string, { month: number; year: number; weeks: Set<number> }>();
    for (const row of (data ?? []) as { month: number; year: number; week_number: number }[]) {
      const key = `${row.year}-${row.month}`;
      const entry = byPeriod.get(key) ?? { month: row.month, year: row.year, weeks: new Set<number>() };
      entry.weeks.add(row.week_number);
      byPeriod.set(key, entry);
    }

    const periods = [...byPeriod.values()]
      .map((entry) => ({
        month: entry.month,
        year: entry.year,
        weeks: [...entry.weeks].sort((a, b) => a - b),
      }))
      .sort((a, b) => (a.year - b.year) || (a.month - b.month));

    return NextResponse.json({ periods });
  } catch (error) {
    console.error('Failed to load exportable periods:', error);
    return NextResponse.json({ error: 'Could not load the months available for export.' }, { status: 500 });
  }
}
