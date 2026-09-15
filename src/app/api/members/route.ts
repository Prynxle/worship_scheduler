import { NextRequest, NextResponse } from 'next/server';
import { requireStaff, getAdminClient } from '@/lib/auth/server';

export async function GET(request: NextRequest) {
  const auth = await requireStaff(request);
  if (auth instanceof Response) return auth;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  let query = getAdminClient()
    .from('members')
    .select('*')
    .eq('church_id', auth.churchId)
    .order('full_name');

  if (status === 'active' || status === 'inactive') {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: 'Could not load members.' }, { status: 500 });

  return NextResponse.json({ members: data ?? [] });
}

export async function POST(request: NextRequest) {
  const auth = await requireStaff(request);
  if (auth instanceof Response) return auth;

  const body = await request.json();
  const { full_name, nickname, gender, phone, roles, skills } = body;
  if (typeof full_name !== 'string' || !full_name.trim()) {
    return NextResponse.json({ error: 'A member name is required.' }, { status: 400 });
  }

  const { data, error } = await getAdminClient()
    .from('members')
    .insert({
      church_id: auth.churchId,
      full_name: full_name.trim(),
      nickname,
      gender,
      phone,
      status: 'active',
      max_monthly_assignments: 3,
      priority_score: 50,
      total_assignments: 0,
    })
    .select('*')
    .single();

  if (error) return NextResponse.json({ error: 'Could not create member.' }, { status: 500 });

  return NextResponse.json({ member: { ...data, roles: roles ?? [], skills: skills ?? [], availability: [] } }, { status: 201 });
}
