import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient, requireStaff } from '@/lib/auth/server';
import { loadScheduleData } from '@/lib/scheduling/schedule-data';
import { ScheduleValidator } from '@/lib/scheduling/validator';
import { ScheduleAssignment, Service } from '@/lib/types/database';

type AssignmentInput = { member_id: string; role_id: string; instrument_id: string | null; is_leader: boolean };

function validAssignments(value: unknown): value is AssignmentInput[] {
  if (!Array.isArray(value) || value.length > 40) return false;
  return value.every((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const input = item as Record<string, unknown>;
    return typeof input.member_id === 'string' && input.member_id.length > 0
      && typeof input.role_id === 'string' && input.role_id.length > 0
      && (input.instrument_id === null || typeof input.instrument_id === 'string')
      && typeof input.is_leader === 'boolean';
  });
}

export async function PUT(request: NextRequest, context: { params: Promise<{ serviceId: string }> }) {
  const auth = await requireStaff(request);
  if (auth instanceof Response) return auth;
  try {
    const { serviceId } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    if (!Number.isInteger(body.expected_version) || !validAssignments(body.assignments)) {
      return NextResponse.json({ error: 'A schedule version and complete assignment list are required.' }, { status: 400 });
    }
    const admin = getAdminClient();
    const { data: service, error: serviceError } = await admin.from('services').select('*')
      .eq('id', serviceId).eq('church_id', auth.churchId).maybeSingle<Service>();
    if (serviceError) return NextResponse.json({ error: 'Could not load the schedule.' }, { status: 500 });
    if (!service) return NextResponse.json({ error: 'Schedule not found.' }, { status: 404 });
    if (!['draft', 'validated'].includes(service.status) || !service.ministry_id) return NextResponse.json({ error: 'Only ministry-scoped draft or validated schedules can be edited. Create an amendment for a published schedule.' }, { status: 409 });
    if ((service.schedule_version ?? 1) !== body.expected_version) return NextResponse.json({ error: 'The schedule changed. Refresh before saving.' }, { status: 409 });

    const data = await loadScheduleData(auth.churchId, service.month, service.year, service.ministry_id);
    const now = new Date().toISOString();
    const assignments: ScheduleAssignment[] = [];
    for (const [index, input] of body.assignments.entries()) {
      const member = data.members.find((item) => item.id === input.member_id);
      const role = data.roles.find((item) => item.id === input.role_id);
      const instrument = input.instrument_id ? data.instruments.find((item) => item.id === input.instrument_id) : undefined;
      if (!member || !role || (input.instrument_id && !instrument)) return NextResponse.json({ error: 'An assignment references a member, role, or instrument outside this ministry.' }, { status: 400 });
      assignments.push({
        id: `proposed-${index}`,
        service_id: service.id,
        member_id: member.id,
        role_id: role.id,
        instrument_id: instrument?.id,
        is_leader: input.is_leader,
        status: 'pending',
        assigned_by: auth.userId,
        created_at: now,
        updated_at: now,
        member,
        role,
        instrument,
      });
    }
    const validation = await new ScheduleValidator({
      service,
      church_id: auth.churchId,
      month: service.month,
      year: service.year,
      week_number: service.week_number,
      existing_assignments: assignments,
      monthly_assignments: [...data.monthlyAssignments.filter((item) => item.service_id !== service.id && item.service_id !== service.revision_of), ...assignments],
      available_members: data.members,
      all_members: data.members,
      rules: data.rules,
      config: data.config,
    }).validate();
    const critical = validation.filter((item) => item.severity === 'critical');
    if (critical.length) return NextResponse.json({ error: 'The edited lineup has hard constraint conflicts.', validation }, { status: 422 });
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (validation.some((item) => item.severity === 'warning') && !reason) {
      return NextResponse.json({ error: 'Add a reason to override the scheduling warnings.', validation }, { status: 400 });
    }

    const { data: version, error } = await admin.rpc('replace_service_assignments', {
      p_church_id: auth.churchId,
      p_service_id: service.id,
      p_actor_id: auth.userId,
      p_expected_version: body.expected_version,
      p_assignments: body.assignments,
      p_reason: reason || null,
    });
    if (error) {
      const status = error.code === '42501' ? 403 : error.code === '40001' || error.code === '55000' ? 409 : 422;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({ schedule_version: version, status: 'draft', validation });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not save schedule assignments.' }, { status: 500 });
  }
}
