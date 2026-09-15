import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient, getAuthContext, isStaff } from '@/lib/auth/server';

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
  const { type, week_number, date, end_date, reason } = body;
  const { data, error } = await getAdminClient().from('availability').insert({
    member_id: context.memberId, church_id: context.churchId, type, week_number, date, end_date, reason, status: 'pending',
  }).select('*').single();
  if (error) return NextResponse.json({ error: 'Could not save availability.' }, { status: 500 });
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
  if (!context || !isStaff(context.role)) return NextResponse.json({ error: 'Staff access required.' }, { status: 403 });
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Availability id is required.' }, { status: 400 });

  const { data, error } = await getAdminClient()
    .from('availability')
    .delete()
    .eq('id', id)
    .eq('church_id', context.churchId)
    .select('id')
    .maybeSingle();
  if (error) return NextResponse.json({ error: 'Could not delete availability.' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Availability not found' }, { status: 404 });

  return NextResponse.json({ success: true });
}
