import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient, getAuthContext, isStaff } from '@/lib/auth/server';
import { validateAvailabilityInput } from '@/lib/api/availability';
import { getWeekDateRange } from '@/lib/utils/date-utils';

export async function GET(request: NextRequest) {
  const context = await getAuthContext(request);
  if (!context) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const memberId = isStaff(context.role) ? searchParams.get('member_id') : context.memberId;
  if (!memberId) return NextResponse.json({ availabilities: [] });
  const { data, error } = await getAdminClient().from('availability').select('*').eq('church_id', context.churchId).eq('member_id', memberId);
  if (error) return NextResponse.json({ error: 'Could not load availability.' }, { status: 500 });
  return NextResponse.json({ availabilities: data ?? [] });
}

export async function POST(request: NextRequest) {
  const context = await getAuthContext(request);
  if (!context?.memberId) return NextResponse.json({ error: 'Only active members can submit availability.' }, { status: 403 });

  const body = await request.json();
  const validated = validateAvailabilityInput(body ?? {});
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }
  const { type, week_number, month, year, date, end_date, reason } = validated.value;

  if (type === 'weekly') {
    const weekRange =
      week_number !== undefined && month !== undefined && year !== undefined
        ? getWeekDateRange(week_number, month, year)
        : null;
    if (weekRange && weekRange.end.getTime() < Date.now()) {
      return NextResponse.json({ error: 'That week has already passed.' }, { status: 400 });
    }

    const { data: existing } = await getAdminClient()
      .from('availability')
      .select('id')
      .eq('church_id', context.churchId)
      .eq('member_id', context.memberId)
      .eq('type', 'weekly')
      .eq('week_number', week_number)
      .eq('month', month)
      .eq('year', year)
      .in('status', ['pending', 'approved'])
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ error: 'You already have a request for that week.' }, { status: 409 });
    }
  }

  const { data, error } = await getAdminClient().from('availability').insert({
    member_id: context.memberId, church_id: context.churchId, type, week_number, month, year, date, end_date, reason, status: 'pending',
  }).select('*').single();
  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'You already have a request for that week.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Could not save availability.' }, { status: 500 });
  }
  return NextResponse.json({ availability: data }, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const context = await getAuthContext(request);
  if (!context || !isStaff(context.role)) return NextResponse.json({ error: 'Staff access required.' }, { status: 403 });
  const body = await request.json();
  const { id, status } = body;
  if (!id || !['pending', 'approved', 'rejected'].includes(status)) {
    return NextResponse.json({ error: 'A valid availability id and status are required.' }, { status: 400 });
  }

  const { data, error } = await getAdminClient()
    .from('availability')
    .update({ status })
    .eq('id', id)
    .eq('church_id', context.churchId)
    .select('*')
    .maybeSingle();
  if (error) return NextResponse.json({ error: 'Could not update availability.' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Availability not found' }, { status: 404 });

  return NextResponse.json({ availability: data });
}

export async function DELETE(request: NextRequest) {
  const context = await getAuthContext(request);
  if (!context) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Availability id is required.' }, { status: 400 });

  if (!isStaff(context.role)) {
    if (!context.memberId) return NextResponse.json({ error: 'Member access required.' }, { status: 403 });
  }

  const base = getAdminClient()
    .from('availability')
    .delete()
    .eq('id', id)
    .eq('church_id', context.churchId)
    .select('id');
  const query = isStaff(context.role)
    ? base
    : base.eq('member_id', context.memberId).eq('status', 'pending');

  const { data, error } = await query.maybeSingle();
  if (error) return NextResponse.json({ error: 'Could not delete availability.' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Availability not found' }, { status: 404 });

  return NextResponse.json({ success: true });
}