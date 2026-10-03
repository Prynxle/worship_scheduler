import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient, requireStaff } from '@/lib/auth/server';
import { loadScheduleData } from '@/lib/scheduling/schedule-data';
import { ScheduleValidator } from '@/lib/scheduling/validator';
import { applyOverrides, hasActiveOverrides, unfilledFrom } from '@/lib/scheduling/gaps';
import { ScheduleAssignment, Service, ServiceActiveOverrides } from '@/lib/types/database';

type AssignmentInput = { member_id: string; role_id: string; instrument_id: string | null; is_leader: boolean; is_devotion?: boolean };

/** The complete override allowlist, mirroring `services_active_overrides_allowlist`. */
const OVERRIDE_AXES = ['availability', 'instrument_qualification'] as const;

function validAssignments(value: unknown): value is AssignmentInput[] {
  if (!Array.isArray(value) || value.length > 40) return false;
  return value.every((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
    const input = item as Record<string, unknown>;
    return typeof input.member_id === 'string' && input.member_id.length > 0
      && typeof input.role_id === 'string' && input.role_id.length > 0
      && (input.instrument_id === null || typeof input.instrument_id === 'string')
      && typeof input.is_leader === 'boolean'
      && (input.is_devotion === undefined || typeof input.is_devotion === 'boolean');
  });
}

/**
 * Trust-boundary validation of the override payload.
 *
 * An unrecognised key or a non-boolean value is REJECTED, never ignored: silently
 * dropping `{"leader_qualification": true}` would tell the coordinator their licence
 * was recorded when no such licence exists, and the next save would fail for a reason
 * they cannot see. This is the same allowlist the database CHECK enforces, checked
 * here as well so a bad request is a 400 and not a 500 from a constraint violation.
 *
 * A `false` axis is dropped rather than stored. `services_active_overrides_allowlist`
 * is an equality against four literals, none of which contains a `false`, so
 * forwarding `{"availability": false}` would pass here and then be refused by the
 * database as a 23514. Normalising on the way in keeps the two authorities in
 * agreement by construction: an unchecked box is the ABSENCE of a licence.
 */
function readOverrides(value: unknown): ServiceActiveOverrides | null {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.some(([axis, flag]) => !OVERRIDE_AXES.includes(axis as (typeof OVERRIDE_AXES)[number]) || typeof flag !== 'boolean')) return null;
  return Object.fromEntries(entries.filter(([, flag]) => flag === true)) as ServiceActiveOverrides;
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
    const overrides = readOverrides(body.overrides);
    if (overrides === null) {
      return NextResponse.json({ error: `Overrides may only license: ${OVERRIDE_AXES.join(', ')}.` }, { status: 400 });
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
        is_devotion: input.is_devotion === true,
        status: 'pending',
        assigned_by: auth.userId,
        created_at: now,
        updated_at: now,
        member,
        role,
        instrument,
      });
    }
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    // A licence is an audited decision, so it may not be recorded without a stated
    // reason. Checked BEFORE validation so a coordinator cannot save the override
    // and be told only afterwards that the reason was missing.
    if (hasActiveOverrides(overrides) && !reason) {
      return NextResponse.json({ error: 'A reason is required to record a coordinator override.' }, { status: 400 });
    }

    const proposed = await new ScheduleValidator({
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
      // C1: the catalogue, so an unassigned required instrument is a reported gap.
      instruments: data.instruments,
      // DRAFT stage: a manual edit may leave a service partial. The four gap rules
      // come back as warnings; the never-deferrable ones stay critical and are
      // refused below.
      validation_stage: 'draft',
    }).validate();
    // Only the two allowlisted axes are downgraded, and only while critical. A
    // critical that survives this is a hard invariant no override can reach.
    const overrideOutcome = applyOverrides(proposed, overrides);
    const validation = overrideOutcome.results;
    const critical = validation.filter((item) => item.severity === 'critical');
    if (critical.length) return NextResponse.json({ error: 'The edited lineup has hard constraint conflicts.', validation }, { status: 422 });
    // A reason is required for a warning EXCEPT a disclosed stage-deferral.
    // Saving a partial lineup is the entire point of draft stage, so demanding an
    // override justification for an unfilled position would make the feature
    // unusable. Every other warning is a decision taken on purpose: an
    // advisory cooldown/rotation finding, or a critical the coordinator just
    // downgraded (which carries `deferred_until: 'publish'`).
    const needsReason = validation.some((item) => item.severity === 'warning' && item.deferred_until !== 'validate');
    if (needsReason && !reason) {
      return NextResponse.json({ error: 'Add a reason to override the scheduling warnings.', validation }, { status: 400 });
    }

    // The write-side gap authority: recomputed from the lineup about to be written,
    // so `services.unfilled_positions` and the stored assignments cannot disagree.
    const unfilledPositions = unfilledFrom({
      service,
      church_id: auth.churchId,
      month: service.month,
      year: service.year,
      week_number: service.week_number,
      existing_assignments: assignments,
      available_members: data.members,
      all_members: data.members,
      rules: data.rules,
      config: data.config,
      instruments: data.instruments,
    }, assignments);

    const { data: version, error } = await admin.rpc('replace_service_assignments', {
      p_church_id: auth.churchId,
      p_service_id: service.id,
      p_actor_id: auth.userId,
      p_expected_version: body.expected_version,
      p_assignments: body.assignments,
      p_reason: reason || null,
      p_unfilled_positions: unfilledPositions,
      p_active_overrides: overrides,
    });
    if (error) {
      const status = error.code === '42501' ? 403 : error.code === '40001' || error.code === '55000' ? 409 : 422;
      return NextResponse.json({ error: error.message }, { status });
    }
    return NextResponse.json({
      schedule_version: version,
      status: 'draft',
      validation,
      unfilled_positions: unfilledPositions,
      is_complete: unfilledPositions.length === 0,
      // Echoed so the client can render the licence it just recorded instead of
      // optimistically assuming its checkboxes were saved.
      active_overrides: overrides,
      overridden_checks: overrideOutcome.overridden_checks,
    });
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Could not save schedule assignments.' }, { status: 500 });
  }
}
