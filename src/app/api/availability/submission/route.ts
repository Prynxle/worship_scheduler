import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient, getAuthContext, isStaff, requireStaff } from '@/lib/auth/server';
import { validateAvailabilityInput } from '@/lib/api/availability';
import { Availability } from '@/lib/types/database';

function monthYear(monthValue: unknown, yearValue: unknown) {
  if (typeof monthValue !== 'number' || !Number.isInteger(monthValue) || monthValue < 0 || monthValue > 11
    || typeof yearValue !== 'number' || !Number.isInteger(yearValue) || yearValue < 2000 || yearValue > 2100) return null;
  return { month: monthValue, year: yearValue };
}

export async function GET(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const parsed = monthYear(Number(params.get('month')), Number(params.get('year')));
  if (!parsed) return NextResponse.json({ error: 'A valid month and year are required.' }, { status: 400 });
  const requestedMember = params.get('member_id');
  const memberId = isStaff(auth.role) ? requestedMember : auth.memberId;
  if (!memberId) return NextResponse.json({ error: 'A member is required.' }, { status: 400 });
  if (!isStaff(auth.role) && memberId !== auth.memberId) return NextResponse.json({ error: 'You can only view your own submission.' }, { status: 403 });

  const admin = getAdminClient();
  const { data: submissionRow, error: submissionError } = await admin.from('availability_submissions')
    .select('*')
    .eq('church_id', auth.churchId)
    .eq('member_id', memberId)
    .eq('month', parsed.month)
    .eq('year', parsed.year)
    .eq('is_current', true)
    .maybeSingle();
  if (submissionError) return NextResponse.json({ error: 'Could not load the monthly submission.' }, { status: 500 });

  let reviewerName: string | undefined;
  if (submissionRow?.reviewed_by) {
    const { data: reviewer } = await admin.from('users').select('full_name').eq('id', submissionRow.reviewed_by).eq('church_id', auth.churchId).maybeSingle();
    reviewerName = reviewer?.full_name;
  }
  const submission = submissionRow ? { ...submissionRow, reviewer_name: reviewerName } : null;

  const { data: legacyRows, error: legacyError } = await admin.from('availability')
    .select('*')
    .eq('church_id', auth.churchId)
    .eq('member_id', memberId)
    .eq('month', parsed.month)
    .eq('year', parsed.year)
    .is('submission_id', null);
  if (legacyError) return NextResponse.json({ error: 'Could not load availability details.' }, { status: 500 });

  let submittedRows: Availability[] = [];
  if (submission?.id) {
    const { data, error } = await admin.from('availability').select('*').eq('submission_id', submission.id);
    if (error) return NextResponse.json({ error: 'Could not load submitted unavailability.' }, { status: 500 });
    submittedRows = (data ?? []) as Availability[];
  }
  return NextResponse.json({ submission, availabilities: [...(legacyRows ?? []), ...submittedRows] });
}

export async function POST(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth?.memberId) return NextResponse.json({ error: 'Only active members can submit availability.' }, { status: 403 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const parsedMonth = monthYear(body.month, body.year);
    if (!parsedMonth || !Array.isArray(body.entries) || body.entries.length > 50) {
      return NextResponse.json({ error: 'A valid month, year, and list of up to 50 unavailability entries are required.' }, { status: 400 });
    }
    const entries: Array<Record<string, string | number | undefined>> = [];
    for (const item of body.entries) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return NextResponse.json({ error: 'Each unavailability entry must be an object.' }, { status: 400 });
      const value = item as Record<string, unknown>;
      const validated = validateAvailabilityInput({ ...value, month: parsedMonth.month, year: parsedMonth.year });
      if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });
      if (validated.value.date) {
        const date = new Date(`${validated.value.date.slice(0, 10)}T00:00:00Z`);
        const endDate = new Date(`${(validated.value.end_date ?? validated.value.date).slice(0, 10)}T00:00:00Z`);
        const startOfMonth = new Date(Date.UTC(parsedMonth.year, parsedMonth.month, 1));
        const endOfMonth = new Date(Date.UTC(parsedMonth.year, parsedMonth.month + 1, 0));
        if (endDate < startOfMonth || date > endOfMonth) return NextResponse.json({ error: 'Date-based unavailability must overlap the selected month.' }, { status: 400 });
      }
      entries.push({
        type: validated.value.type,
        week_number: validated.value.week_number,
        date: validated.value.date,
        end_date: validated.value.end_date,
        reason: validated.value.reason,
      });
    }
    const { data, error } = await getAdminClient().rpc('submit_month_availability', {
      p_church_id: auth.churchId,
      p_member_id: auth.memberId,
      p_actor_id: auth.userId,
      p_month: parsedMonth.month,
      p_year: parsedMonth.year,
      p_entries: entries,
    });
    if (error) {
      if (error.code === '23505') return NextResponse.json({ error: 'Availability has already been submitted for this month.' }, { status: 409 });
      if (error.code === '42501') return NextResponse.json({ error: 'Member ownership could not be verified.' }, { status: 403 });
      return NextResponse.json({ error: 'Could not save the monthly availability submission.' }, { status: 409 });
    }
    return NextResponse.json({ submission_id: data, status: 'submitted' }, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not save availability.' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const auth = await requireStaff(request);
  if (auth instanceof Response) return auth;
  try {
    const body = await request.json() as Record<string, unknown>;
    if (typeof body.id !== 'string' || !body.id || !['approved', 'revision_required'].includes(String(body.action))) {
      return NextResponse.json({ error: 'A submission id and review action are required.' }, { status: 400 });
    }
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (body.action === 'revision_required' && !note) return NextResponse.json({ error: 'Add a note explaining the requested revision.' }, { status: 400 });
    const { data, error } = await getAdminClient().rpc('review_month_availability', {
      p_church_id: auth.churchId,
      p_submission_id: body.id,
      p_reviewer_id: auth.userId,
      p_action: body.action,
      p_note: note || null,
    });
    if (error) {
      if (error.code === '42501') return NextResponse.json({ error: 'Coordinator authorization could not be verified.' }, { status: 403 });
      if (error.code === '55000') return NextResponse.json({ error: 'This submission is no longer awaiting review.' }, { status: 409 });
      return NextResponse.json({ error: 'Could not review this submission.' }, { status: 400 });
    }
    return NextResponse.json({ submission: data });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not review availability.' }, { status: 500 });
  }
}
