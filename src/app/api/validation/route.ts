import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient, requireStaff } from '@/lib/auth/server';
import { loadScheduleData } from '@/lib/scheduling/schedule-data';
import { ScheduleValidator } from '@/lib/scheduling/validator';
import { Service } from '@/lib/types/database';

export async function POST(request: NextRequest) {
  const auth = await requireStaff(request);
  if (auth instanceof Response) return auth;
  try {
    const body = await request.json() as { service_id?: unknown };
    if (typeof body.service_id !== 'string' || !body.service_id) return NextResponse.json({ error: 'service_id is required.' }, { status: 400 });
    const admin = getAdminClient();
    const { data: service, error: serviceError } = await admin.from('services').select('*').eq('id', body.service_id).eq('church_id', auth.churchId).maybeSingle<Service>();
    if (serviceError) return NextResponse.json({ error: 'Could not load service.' }, { status: 500 });
    if (!service) return NextResponse.json({ error: 'Service not found.' }, { status: 404 });
    const data = await loadScheduleData(auth.churchId, service.month, service.year);
    const assignments = data.assignments.filter((assignment) => assignment.service_id === service.id);
    const results = await new ScheduleValidator({ service, church_id: auth.churchId, month: service.month, year: service.year, week_number: service.week_number, existing_assignments: assignments, available_members: data.members, all_members: data.members, rules: data.rules, config: data.config }).validate();
    const critical = results.filter((result) => result.severity === 'critical');
    const warnings = results.filter((result) => result.severity === 'warning');
    const suggestions = results.filter((result) => result.severity === 'suggestion');
    return NextResponse.json({ valid: critical.length === 0, results, summary: { total: results.length, critical: critical.length, warnings: warnings.length, suggestions: suggestions.length } });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not validate service.' }, { status: 400 });
  }
}
