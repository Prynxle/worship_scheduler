import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient, requireStaff } from '@/lib/auth/server';
import { loadScheduleData } from '@/lib/scheduling/schedule-data';
import { ScheduleValidator } from '@/lib/scheduling/validator';
import { applyOverrides, unfilledFrom } from '@/lib/scheduling/gaps';
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
    if (service.status !== 'validated' || !service.ministry_id || service.validated_version !== service.schedule_version) {
      return NextResponse.json({ error: 'Only a schedule validated for its current version can be published.' }, { status: 409 });
    }
    if (service.schedule_version !== body.expected_version) return NextResponse.json({ error: 'The schedule changed. Refresh before publishing.' }, { status: 409 });
    const data = await loadScheduleData(auth.churchId, service.month, service.year, service.ministry_id);
    const assignments = data.assignments.filter((assignment) => assignment.service_id === service.id);
    // FINAL stage, and explicitly so: publishing is the second re-assertion point
    // for every rule a draft was allowed to defer.
    const proposed = await new ScheduleValidator({
      service,
      church_id: auth.churchId,
      month: service.month,
      year: service.year,
      week_number: service.week_number,
      existing_assignments: assignments,
      monthly_assignments: data.monthlyAssignments.filter((item) => item.service_id !== service.revision_of),
      available_members: data.members,
      all_members: data.members,
      rules: data.rules,
      config: data.config,
      instruments: data.instruments,
      validation_stage: 'final',
    }).validate();
    const { results, overridden_checks } = applyOverrides(proposed, service.active_overrides);
    const unfilledPositions = unfilledFrom({ service, church_id: auth.churchId, month: service.month, year: service.year, week_number: service.week_number, existing_assignments: assignments, available_members: data.members, all_members: data.members, rules: data.rules, config: data.config, instruments: data.instruments }, assignments);
    const critical = results.filter((item) => item.severity === 'critical');
    if (critical.length) return NextResponse.json({ error: 'The schedule now has hard constraint conflicts and must be revised and validated again.', results, overridden_checks, unfilled_positions: unfilledPositions }, { status: 422 });
    const { error } = await admin.rpc('publish_service_schedule', {
      p_church_id: auth.churchId,
      p_service_id: service.id,
      p_actor_id: auth.userId,
      p_expected_version: body.expected_version,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: error.code === '42501' ? 403 : 409 });
    return NextResponse.json({ status: 'published', published_by: auth.userId, published_at: new Date().toISOString(), results, overridden_checks, active_overrides: service.active_overrides ?? {} });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not publish the schedule.' }, { status: 500 });
  }
}
