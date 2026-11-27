import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient, requireStaff } from '@/lib/auth/server';
import {
  buildAnalyticsReport,
  type AnalyticsAssignment,
  type AnalyticsMember,
} from '@/lib/analytics/report';
import type { AnalyticsMonth } from '@/lib/types/analytics';
import type { Availability } from '@/lib/types/database';

const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

function parseMonth(value: string | null): number | null {
  if (value === null || !/^\d{1,2}$/.test(value)) return null;
  const month = Number(value);
  return month >= 0 && month <= 11 ? month : null;
}

function parseYear(value: string | null): number | null {
  if (value === null || !/^\d{4}$/.test(value)) return null;
  const year = Number(value);
  return year >= MIN_YEAR && year <= MAX_YEAR ? year : null;
}

function uniqueMonths(rows: Array<{ month: number | null; year: number | null }>): AnalyticsMonth[] {
  const seen = new Set<string>();
  const months: AnalyticsMonth[] = [];

  for (const row of rows) {
    if (typeof row.month !== 'number' || typeof row.year !== 'number') continue;
    const key = `${row.year}-${row.month}`;
    if (seen.has(key)) continue;
    seen.add(key);
    months.push({ month: row.month, year: row.year });
  }

  return months.sort((left, right) => right.year - left.year || right.month - left.month);
}

/**
 * Church-scoped analytics for one month.
 *
 * `month` is 0-based, matching `services.month`. Both `month` and `year` must
 * be supplied together. With no parameters, the current month is used when it
 * has services; otherwise the newest month that does.
 */
export async function GET(request: NextRequest) {
  const auth = await requireStaff(request);
  if (auth instanceof Response) return auth;

  const { searchParams } = new URL(request.url);
  const hasMonth = searchParams.has('month');
  const hasYear = searchParams.has('year');
  if (hasMonth !== hasYear) {
    return NextResponse.json({ error: 'month and year must be provided together.' }, { status: 400 });
  }

  const requestedMonth = parseMonth(searchParams.get('month'));
  const requestedYear = parseYear(searchParams.get('year'));
  if (hasMonth && (requestedMonth === null || requestedYear === null)) {
    return NextResponse.json(
      { error: `month must be 0-11 and year must be ${MIN_YEAR}-${MAX_YEAR}.` },
      { status: 400 }
    );
  }

  try {
    const admin = getAdminClient();

    const { data: monthRows, error: monthsError } = await admin
      .from('services')
      .select('month, year')
      .eq('church_id', auth.churchId)
      .neq('status', 'archived');
    if (monthsError) {
      return NextResponse.json({ error: 'Could not load analytics months.' }, { status: 500 });
    }

    const months = uniqueMonths(
      (monthRows ?? []) as Array<{ month: number | null; year: number | null }>
    );
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const fallback =
      months.find((item) => item.month === currentMonth && item.year === currentYear) ??
      months[0] ?? { month: currentMonth, year: currentYear };

    const month = requestedMonth ?? fallback.month;
    const year = requestedYear ?? fallback.year;

    const { data: serviceRows, error: servicesError } = await admin
      .from('services')
      .select('id')
      .eq('church_id', auth.churchId)
      .eq('month', month)
      .eq('year', year)
      .neq('status', 'archived');
    if (servicesError) {
      return NextResponse.json({ error: 'Could not load analytics services.' }, { status: 500 });
    }

    const serviceIds = (serviceRows ?? [])
      .map((row) => (typeof row.id === 'string' ? row.id : null))
      .filter((id): id is string => Boolean(id));

    const [
      { data: memberRows, error: membersError },
      { data: assignmentRows, error: assignmentsError },
      { data: availabilityRows, error: availabilityError },
    ] = await Promise.all([
      admin
        .from('members')
        .select('id, full_name, status, max_monthly_assignments')
        .eq('church_id', auth.churchId),
      serviceIds.length
        ? admin
            .from('schedule_assignments')
            .select('member_id, service_id')
            .in('service_id', serviceIds)
        : Promise.resolve({ data: [], error: null }),
      admin
        .from('availability')
        .select('member_id, type, week_number, month, year, date, end_date, status')
        .eq('church_id', auth.churchId)
        .in('status', ['pending', 'approved']),
    ]);

    if (membersError || assignmentsError || availabilityError) {
      return NextResponse.json({ error: 'Could not load analytics data.' }, { status: 500 });
    }

    const report = buildAnalyticsReport({
      members: (memberRows ?? []) as AnalyticsMember[],
      assignments: (assignmentRows ?? []) as AnalyticsAssignment[],
      availability: (availabilityRows ?? []) as Availability[],
      month,
      year,
      months,
    });

    return NextResponse.json(report);
  } catch {
    return NextResponse.json({ error: 'Could not load analytics data.' }, { status: 500 });
  }
}
