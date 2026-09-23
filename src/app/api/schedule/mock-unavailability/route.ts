import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient, requireStaff } from '@/lib/auth/server';
import { planMockUnavailability } from '@/lib/scheduling/mock-unavailability';
import { getMonthName } from '@/lib/utils/date-utils';

const DEFAULT_MONTH = 9; // October for the October 2026 test run
const DEFAULT_YEAR = 2026;

export async function POST(request: NextRequest) {
  const auth = await requireStaff(request);
  if (auth instanceof Response) return auth;

  let body: Record<string, unknown> = {};
  const rawBody = await request.text();
  if (rawBody.trim() !== '') {
    try {
      const parsed: unknown = JSON.parse(rawBody);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return NextResponse.json({ error: 'Request body must be an object.' }, { status: 400 });
      }
      body = parsed as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
    }
  }

  const rawMonth: unknown = body.month === undefined ? DEFAULT_MONTH : body.month;
  const rawYear: unknown = body.year === undefined ? DEFAULT_YEAR : body.year;
  if (typeof rawMonth !== 'number' || !Number.isInteger(rawMonth) ||
      typeof rawYear !== 'number' || !Number.isInteger(rawYear)) {
    return NextResponse.json({ error: 'Month and year must be whole numbers.' }, { status: 400 });
  }
  const month = rawMonth;
  const year = rawYear;
  if (month < 0 || month > 11) {
    return NextResponse.json({ error: 'Month must be between 0 and 11.' }, { status: 400 });
  }
  if (year < 2000 || year > 2100) {
    return NextResponse.json({ error: 'Year must be between 2000 and 2100.' }, { status: 400 });
  }

  const admin = getAdminClient();

  // Active members are always resolved church-side from the authenticated
  // caller. Member ids and church_id are never accepted from the client.
  const { data: members, error: membersError } = await admin
    .from('members')
    .select('id, full_name')
    .eq('church_id', auth.churchId)
    .eq('status', 'active');
  if (membersError) {
    return NextResponse.json({ error: 'Could not load members.' }, { status: 500 });
  }

  // Pre-check mirrors the partial unique index predicate
  // (availability_active_weekly_member_month_week_idx): one pending/approved
  // weekly row per (member_id, year, month, week_number).
  const { data: existingRows, error: existingError } = await admin
    .from('availability')
    .select('member_id, week_number')
    .eq('church_id', auth.churchId)
    .eq('type', 'weekly')
    .eq('month', month)
    .eq('year', year)
    .in('status', ['pending', 'approved']);
  if (existingError) {
    return NextResponse.json({ error: 'Could not load existing availability.' }, { status: 500 });
  }

  const existingKeys = new Set(
    (existingRows ?? []).map((row) => `${row.member_id}:${row.week_number}`)
  );
  const records = planMockUnavailability(members ?? [], month, year);
  const reason = `Mock unavailability (${getMonthName(month)} ${year} test)`;

  let added = 0;
  let skipped = 0;
  for (const row of records) {
    if (existingKeys.has(`${row.member_id}:${row.week_number}`)) {
      skipped += 1;
      continue;
    }
    const { error } = await admin.from('availability').insert({
      member_id: row.member_id,
      church_id: auth.churchId,
      type: 'weekly',
      week_number: row.week_number,
      month: row.month,
      year: row.year,
      reason,
      status: 'approved',
    });
    if (error) {
      if (error.code === '23505') {
        // Concurrent duplicate: the unique index already guarantees no active
        // weekly duplicates, so this is a skipped record, never a failure.
        skipped += 1;
        continue;
      }
      return NextResponse.json({ error: 'Could not save mock unavailability.' }, { status: 500 });
    }
    added += 1;
  }

  return NextResponse.json({
    success: true,
    added,
    skipped,
    total_members: (members ?? []).length,
    month,
    year,
    records,
  }, { status: 201 });
}