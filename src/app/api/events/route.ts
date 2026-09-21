import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient, getAuthContext, isStaff } from '@/lib/auth/server';
import { validateEventInput } from '@/lib/api/events';

export async function GET(request: NextRequest) {
  const context = await getAuthContext(request);
  if (!context) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const start = searchParams.get('start');
  const end = searchParams.get('end');

  let query = getAdminClient()
    .from('events')
    .select('*')
    .eq('church_id', context.churchId)
    .order('date', { ascending: true });
  if (start) query = query.gte('date', start);
  if (end) query = query.lte('date', end);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: 'Could not load events.' }, { status: 500 });
  return NextResponse.json({ events: data ?? [] });
}

export async function POST(request: NextRequest) {
  const context = await getAuthContext(request);
  if (!context || !isStaff(context.role)) {
    return NextResponse.json({ error: 'Staff access required.' }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const validated = validateEventInput(body);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const { title, date, time, location, kind, color, attendees } = validated.value;
  const { data, error } = await getAdminClient()
    .from('events')
    .insert({
      church_id: context.churchId,
      title,
      date,
      time,
      location,
      kind: kind ?? 'Gathering',
      color: color ?? 'violet',
      attendees,
      created_by: context.userId,
    })
    .select('*')
    .single();
  if (error) return NextResponse.json({ error: 'Could not save event.' }, { status: 500 });

  return NextResponse.json({ event: data }, { status: 201 });
}

export async function DELETE(request: NextRequest) {
  const context = await getAuthContext(request);
  if (!context || !isStaff(context.role)) {
    return NextResponse.json({ error: 'Staff access required.' }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Event id is required.' }, { status: 400 });

  const { data, error } = await getAdminClient()
    .from('events')
    .delete()
    .eq('id', id)
    .eq('church_id', context.churchId)
    .select('id')
    .maybeSingle();
  if (error) return NextResponse.json({ error: 'Could not delete event.' }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Event not found' }, { status: 404 });

  return NextResponse.json({ success: true });
}
