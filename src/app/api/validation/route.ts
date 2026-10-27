import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient, requireStaff } from '@/lib/auth/server';
import { jsonError } from '@/lib/api/errors';
import { isStaleDraft } from '@/lib/scheduling/availability-reset';
import { loadScheduleData } from '@/lib/scheduling/schedule-data';
import { ScheduleValidator } from '@/lib/scheduling/validator';
import { applyOverrides, unfilledFrom } from '@/lib/scheduling/gaps';
import { serviceNeedsValidation } from '@/lib/scheduling/month-workflow';
import { Service } from '@/lib/types/database';

/**
 * `schedule_pending_regeneration`: the month's availability was reset after
 * this draft was generated. Fixed copy, byte-identical to the other lifecycle
 * routes that refuse the same state.
 */
const STALE_DRAFT_MESSAGE = 'The availability for this month was reset. Regenerate the schedule after availability is approved again before validating it.';

export async function POST(request: NextRequest) {
  const auth = await requireStaff(request);
  if (auth instanceof Response) return auth;
  try {
    const body = await request.json() as { service_id?: unknown; expected_version?: unknown };
    if (typeof body.service_id !== 'string' || !body.service_id || typeof body.expected_version !== 'number' || !Number.isInteger(body.expected_version)) return NextResponse.json({ error: 'service_id and expected_version are required.' }, { status: 400 });
    const admin = getAdminClient();
    const { data: service, error: serviceError } = await admin.from('services').select('*').eq('id', body.service_id).eq('church_id', auth.churchId).maybeSingle<Service>();
    if (serviceError) return NextResponse.json({ error: 'Could not load service.' }, { status: 500 });
    if (!service) return NextResponse.json({ error: 'Service not found.' }, { status: 404 });
    // ORDER IS LOAD-BEARING: a stamped draft is refused BEFORE the state gate
    // and before the validator runs, so a coordinator never sees a 422 about a
    // lineup's details for a schedule that cannot be validated at all.
    // `validate_service_schedule` re-asserts the same refusal as W0004.
    if (isStaleDraft(service)) return jsonError(409, 'schedule_pending_regeneration', STALE_DRAFT_MESSAGE);
    // A draft, or a `validated` row whose stamp no longer matches its current
    // version (an edit re-opens validation; a row marked validated without ever
    // running the validator is the same drifted state). Anything else — notably
    // published — cannot be validated here. `validate_service_schedule` re-checks
    // this in SQL.
    if (!serviceNeedsValidation(service) || !service.ministry_id) return NextResponse.json({ error: 'Only a ministry-scoped draft or version-drifted schedule can be validated.' }, { status: 409 });
    if ((service.schedule_version ?? 1) !== body.expected_version) return NextResponse.json({ error: 'The schedule changed. Refresh before validating.' }, { status: 409 });
    const data = await loadScheduleData(auth.churchId, service.month, service.year, service.ministry_id);
    const assignments = data.assignments.filter((assignment) => assignment.service_id === service.id);
    // FINAL stage: this is where every draft-deferred rule comes back as a hard
    // critical. Validation is the re-assertion point, so running this surface at
    // draft stage would let a partial month be marked validated.
    const proposed = await new ScheduleValidator({ service, church_id: auth.churchId, month: service.month, year: service.year, week_number: service.week_number, existing_assignments: assignments, monthly_assignments: data.monthlyAssignments.filter((item) => item.service_id !== service.revision_of), available_members: data.members, all_members: data.members, rules: data.rules, config: data.config, instruments: data.instruments, validation_stage: 'final' }).validate();
    // The service's recorded licences are honoured here, so a lineup a coordinator
    // deliberately overrode can still be validated. Only the two allowlisted axes
    // are affected, and `validate_service_schedule` independently re-asserts the
    // non-overridable rules in SQL, so this is a second line of defence, not the only one.
    const { results, overridden_checks } = applyOverrides(proposed, service.active_overrides);
    const critical = results.filter((result) => result.severity === 'critical');
    const warnings = results.filter((result) => result.severity === 'warning');
    const suggestions = results.filter((result) => result.severity === 'suggestion');
    const unfilledPositions = unfilledFrom({ service, church_id: auth.churchId, month: service.month, year: service.year, week_number: service.week_number, existing_assignments: assignments, available_members: data.members, all_members: data.members, rules: data.rules, config: data.config, instruments: data.instruments }, assignments);
    if (critical.length) return NextResponse.json({ valid: false, results, overridden_checks, unfilled_positions: unfilledPositions, summary: { total: results.length, critical: critical.length, warnings: warnings.length, suggestions: suggestions.length } }, { status: 422 });
    const { error: transitionError } = await admin.rpc('validate_service_schedule', {
      p_church_id: auth.churchId,
      p_service_id: service.id,
      p_actor_id: auth.userId,
      p_expected_version: body.expected_version,
      p_validation_results: results,
    });
    if (transitionError) {
      // W0004 is the SQL half re-asserting the stale-draft refusal above; it is
      // reported with the same fixed copy and code, never the driver message.
      if (transitionError.code === 'W0004') return jsonError(409, 'schedule_pending_regeneration', STALE_DRAFT_MESSAGE);
      return NextResponse.json({ error: transitionError.message }, { status: transitionError.code === '42501' ? 403 : 409 });
    }
    return NextResponse.json({ valid: true, results, status: 'validated', validated_by: auth.userId, validated_at: new Date().toISOString(), overridden_checks, unfilled_positions: unfilledPositions, is_complete: unfilledPositions.length === 0, summary: { total: results.length, critical: critical.length, warnings: warnings.length, suggestions: suggestions.length } });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not validate service.' }, { status: 400 });
  }
}
