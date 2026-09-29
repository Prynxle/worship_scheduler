import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient, requireStaff } from '@/lib/auth/server';
import { Service } from '@/lib/types/database';

export async function POST(request: NextRequest, context: { params: Promise<{ serviceId: string }> }) {
  const auth = await requireStaff(request);
  if (auth instanceof Response) return auth;
  try {
    const { serviceId } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    if (!Number.isInteger(body.expected_version)) return NextResponse.json({ error: 'A schedule version is required.' }, { status: 400 });
    const admin = getAdminClient();
    const { data: service, error: serviceError } = await admin.from('services').select('*')
      .eq('id', serviceId).eq('church_id', auth.churchId).maybeSingle<Service>();
    if (serviceError) return NextResponse.json({ error: 'Could not load the schedule.' }, { status: 500 });
    if (!service) return NextResponse.json({ error: 'Schedule not found.' }, { status: 404 });
    const { data, error } = await admin.rpc('create_service_revision', {
      p_church_id: auth.churchId,
      p_service_id: service.id,
      p_actor_id: auth.userId,
      p_expected_version: body.expected_version,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: error.code === '42501' ? 403 : error.code === '40001' ? 409 : 400 });
    return NextResponse.json({ service_id: data, revision_of: service.id, status: 'draft' }, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not create schedule revision.' }, { status: 500 });
  }
}
