import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient, requireStaff } from '@/lib/auth/server';
import { SchedulingEngine } from '@/lib/scheduling/engine';
import { loadScheduleData } from '@/lib/scheduling/schedule-data';
import { buildMonthSchedulePayload, type MonthSchedulePayload } from '@/lib/scheduling/persistence';
import { ApiError, toErrorResponse, type ErrorContext } from '@/lib/api/errors';
import { formatLocalDate, getMonthName, getWeeksInMonth, getWeekDate } from '@/lib/utils/date-utils';
import { ScheduleContext } from '@/lib/types/scheduling';
import { ScheduleAssignment, Service } from '@/lib/types/database';
import { isBackupRoleName, isDevotionRoleName } from '@/lib/scheduling/role-classifier';
import { loadAvailabilityReadiness } from '@/lib/scheduling/availability-readiness';

/**
 * Thin HTTP handler. It parses and validates input, enforces auth/tenant scope
 * (via `requireStaff` and `auth.churchId` ONLY), calls domain logic, and
 * delegates persistence to the transactional `persist_month_schedule` RPC.
 *
 * There is deliberately no `admin.from('services')` / `admin.from(
 * 'schedule_assignments')` write in this file. The previous non-transactional
 * delete-then-insert loop is what left duplicate draft services behind on every
 * failed generation; the RPC makes a partial month unrepresentable.
 *
 * `church_id` is read ONLY from `auth.churchId`. No client-supplied tenant id
 * is accepted anywhere in this file. The ministry likewise is resolved through
 * `loadAvailabilityReadiness`, which filters active ministries by
 * `church_id`; the raw `ministry_id` query/body value is only ever a *request*
 * for one of those, never an authority.
 */

function parseMonthYear(request: Request, body?: Record<string, unknown>) {
  const url = new URL(request.url);
  const monthValue = body?.month ?? (url.searchParams.get('month') === null ? new Date().getMonth() : Number(url.searchParams.get('month')));
  const yearValue = body?.year ?? (url.searchParams.get('year') === null ? new Date().getFullYear() : Number(url.searchParams.get('year')));
  if (typeof monthValue !== 'number' || !Number.isInteger(monthValue) || monthValue < 0 || monthValue > 11 || typeof yearValue !== 'number' || !Number.isInteger(yearValue) || yearValue < 2000 || yearValue > 2100) {
    throw new ApiError(400, 'Month must be 0-11 and year must be between 2000 and 2100.', 'invalid_month_year');
  }
  return { month: monthValue, year: yearValue };
}

function serviceAssignments(service: Service, assignments: ScheduleAssignment[]) {
  const own = assignments.filter((assignment) => assignment.service_id === service.id);
  const leader = own.find((assignment) => assignment.is_leader)?.member;
  // SERVED, NOT RECOMPUTED. `unfilled_positions` is the persisted write-side
  // authority (`engine.ts` on generate, `gaps.ts` on manual edit). This read
  // path deliberately does not re-derive it: a recompute here would be a second
  // answer computed from a context the client never had, and the two could
  // disagree about a month the coordinator already acted on.
  const unfilledPositions = service.unfilled_positions ?? [];
  return {
    id: service.id,
    church_id: service.church_id,
    ministry_id: service.ministry_id ?? null,
    legacy_unscoped: !service.ministry_id,
    date: service.date,
    week_number: service.week_number,
    leader_name: leader?.full_name ?? 'Unassigned',
    leader_avatar: leader?.avatar_url,
    backup_singers: own.filter((assignment) => !assignment.is_leader && assignment.role && isBackupRoleName(assignment.role.name)).map((assignment) => ({ name: assignment.member?.full_name ?? 'Unassigned', avatar: assignment.member?.avatar_url })),
    instrumentalists: own.filter((assignment) => assignment.instrument).map((assignment) => ({ instrument: assignment.instrument?.name ?? 'Instrument', name: assignment.member?.full_name ?? 'Unassigned' })),
    devotion_name: own.find((assignment) => assignment.role && isDevotionRoleName(assignment.role.name))?.member?.full_name,
    assignments: own.map((assignment) => ({ id: assignment.id, member_id: assignment.member_id, member_name: assignment.member?.full_name ?? 'Unknown member', role_id: assignment.role_id, role_name: assignment.role?.name ?? 'Unknown role', instrument_id: assignment.instrument_id ?? null, instrument_name: assignment.instrument?.name ?? null, is_leader: assignment.is_leader })),
    // `archived` is a storage lifecycle state, not a lineup state; the editor
    // and the filters only ever deal in draft/validated/published.
    status: service.status === 'archived' ? 'draft' : service.status,
    schedule_version: service.schedule_version ?? 1,
    validated_version: service.validated_version ?? null,
    validated_by: service.validated_by ?? null,
    validated_at: service.validated_at ?? null,
    generated_at: service.generated_at ?? null,
    published_at: service.published_at ?? null,
    published_by: service.published_by ?? null,
    revision_of: service.revision_of ?? null,
    conflict_count: 0,
    unfilled_positions: unfilledPositions,
    /**
     * Drives the coordinator-facing "incomplete" affordance. Derived from the
     * stored gap list, so the badge can never disagree with the rows beneath it.
     */
    is_complete: unfilledPositions.length === 0,
    active_overrides: service.active_overrides ?? {},
  };
}

export async function GET(request: NextRequest) {
  // OUTSIDE the try, deliberately: 401/403 are returned before any parsing or
  // I/O, and a missing Supabase config must not be masked as a 400.
  const auth = await requireStaff(request);
  if (auth instanceof Response) return auth;

  const context: ErrorContext = { operation: 'schedule.get', churchId: auth.churchId };

  try {
    const { month, year } = parseMonthYear(request);
    context.month = month;
    context.year = year;
    const requestedMinistryId = new URL(request.url).searchParams.get('ministry_id') ?? undefined;
    // Readiness runs first and is the ONLY ministry authority: it resolves the
    // ministry against this church's active ministries, and the schedule read
    // below is then scoped by that resolved id rather than by client input.
    const readiness = await loadAvailabilityReadiness(auth.churchId, month, year, requestedMinistryId);
    const data = await loadScheduleData(auth.churchId, month, year, readiness.ministry_id);
    return NextResponse.json({
      services: data.services.map((service) => serviceAssignments(service, data.assignments)),
      members: data.members.filter((member) => member.status === 'active').map((member) => ({ id: member.id, full_name: member.full_name, roles: member.roles?.map((item) => item.role).filter(Boolean), skills: member.skills?.map((item) => item.instrument).filter(Boolean) })),
      roles: data.roles,
      instruments: data.instruments,
      month,
      year,
      ministry_id: readiness.ministry_id,
      ministry_name: readiness.ministry_name,
      church_id: auth.churchId,
    });
  } catch (error) {
    return toErrorResponse(error, context);
  }
}

export async function POST(request: NextRequest) {
  // OUTSIDE the try, deliberately: 401/403 are returned before any parsing or
  // I/O, and a missing Supabase config must not be masked as a 400.
  const auth = await requireStaff(request);
  if (auth instanceof Response) return auth;

  const body = await readJsonObject(request);
  if (body instanceof ApiError) return toErrorResponse(body, { operation: 'schedule.generate', churchId: auth.churchId });

  // Enriched with month/year once parsed, so the catch always has full context.
  const context: ErrorContext = { operation: 'schedule.generate', churchId: auth.churchId };

  try {
    const { month, year } = parseMonthYear(request, body ?? undefined);
    context.month = month;
    context.year = year;
    if (body?.regenerate !== undefined && typeof body.regenerate !== 'boolean') {
      throw new ApiError(400, 'regenerate must be a boolean.', 'invalid_regenerate');
    }

    const today = new Date();
    const todayString = formatLocalDate(today);
    if (year < today.getFullYear() || (year === today.getFullYear() && month < today.getMonth())) {
      throw new ApiError(400, 'Schedules can only be generated for the current or a future month.', 'past_month');
    }

    const count = getWeeksInMonth(month, year);
    const futureWeeks = Array.from({ length: count }, (_, index) => index + 1)
      .filter((week) => formatLocalDate(getWeekDate(week, month, year)) >= todayString);
    // Checked BEFORE readiness, and deliberately: a month whose Sundays have all
    // passed can never be generated whatever the availability state is, so
    // reporting it first is the only message that tells the coordinator what to
    // do. Without this the empty `futureWeeks` fell through to the generic
    // `week_numbers` complaint, which reads as a malformed client payload.
    if (futureWeeks.length === 0) {
      throw new ApiError(400, `${getMonthName(month)} ${year} has no upcoming Sundays left. Choose a future month.`, 'no_upcoming_sundays');
    }

    const requestedMinistryId = typeof body?.ministry_id === 'string' ? body.ministry_id : undefined;
    const readiness = await loadAvailabilityReadiness(auth.churchId, month, year, requestedMinistryId);
    if (!readiness.ready) {
      throw new ApiError(409, 'Monthly availability is not approved for every required member.', 'availability_not_ready', { readiness });
    }

    const requested = body?.week_numbers;
    const weekNumbers = requested === undefined ? futureWeeks : requested;
    if (!Array.isArray(weekNumbers) || weekNumbers.length === 0 || weekNumbers.some((week) => typeof week !== 'number' || !Number.isInteger(week) || week < 1 || week > count)) {
      throw new ApiError(400, 'week_numbers must contain valid weeks for the requested month.', 'invalid_week_numbers');
    }
    if (new Set(weekNumbers).size !== weekNumbers.length) {
      throw new ApiError(400, 'Each service week can only be generated once.', 'duplicate_week');
    }
    if (weekNumbers.some((week) => !futureWeeks.includes(week))) {
      throw new ApiError(400, 'Schedules can only be generated for service dates that have not passed.', 'past_service_date');
    }

    // `readiness.ministry_id`, never `body.ministry_id`: readiness filtered the
    // ministries by `church_id`, so this value cannot cross a tenant boundary.
    const data = await loadScheduleData(auth.churchId, month, year, readiness.ministry_id);

    // Fast 409 for the immediate, service_ids-bearing response. The RPC repeats
    // this check INSIDE its transaction, so it is not the authority.
    const selected = new Set(weekNumbers);
    const protectedServices = data.services.filter((service) => selected.has(service.week_number) && ['published', 'validated'].includes(service.status));
    if (protectedServices.length) {
      return NextResponse.json({ error: 'Published or validated services cannot be regenerated.', service_ids: protectedServices.map((service) => service.id) }, { status: 409 });
    }

    const replaceable = new Set(data.services.filter((service) => selected.has(service.week_number)).map((service) => service.id));
    // `monthlyAssignments`, never `assignments`: the monthly-limit ledger (Rule 2)
    // must count every non-archived service in the month, including a legacy
    // ministry-unscoped one that `assignments` filters out.
    const monthlyAssignments = data.monthlyAssignments;
    const historicalAssignments = monthlyAssignments.filter((assignment) => !replaceable.has(assignment.service_id));
    const firstWeek = weekNumbers[0];
    const now = new Date().toISOString();
    const scheduleContext: ScheduleContext = {
      service: { id: 'generation', church_id: auth.churchId, date: formatLocalDate(getWeekDate(firstWeek, month, year)), week_number: firstWeek, month, year, service_type: 'sunday', status: 'draft', created_at: now, updated_at: now },
      church_id: auth.churchId,
      month,
      year,
      week_number: firstWeek,
      week_numbers: weekNumbers,
      existing_assignments: historicalAssignments,
      historical_assignments: monthlyAssignments,
      available_members: data.members,
      all_members: data.members,
      rules: data.rules,
      config: data.config,
      // C1: the ministry instrument catalogue, so a required instrument with no
      // skill-holder becomes a REPORTED gap instead of a silently absent one.
      instruments: data.instruments,
    };
    const generated = await new SchedulingEngine(scheduleContext).generateSchedule();

    // Pure, and BEFORE any database write: an unresolvable role throws here, so
    // the RPC is never called with a month we cannot fully attribute.
    const payload = buildMonthSchedulePayload(generated);

    const written = await persistMonthSchedule({
      userId: auth.userId,
      churchId: auth.churchId,
      ministryId: readiness.ministry_id,
      month,
      year,
      payload,
      replaceExisting: body?.regenerate === true,
    });

    // Post-write invariant, as an arity check: `persist_month_schedule` returns
    // the `UUID[]` of services it inserted, so the only thing provable without a
    // second query is that every requested week produced a row. A silent partial
    // month must never read as success, so a mismatch is a 500, not a 201.
    if (written.length !== weekNumbers.length) {
      return toErrorResponse(
        new ApiError(500, 'The schedule was written but did not match the request.', 'post_write_invariant_failed', {
          request_id: globalThis.crypto.randomUUID(),
          requested_weeks: weekNumbers,
          written_services: written.length,
        }),
        context
      );
    }

    const unfilledPositions = generated.flatMap((service) => service.unfilled_positions ?? []);
    return NextResponse.json({
      services: generated,
      validation: generated.flatMap((service) => service.conflicts),
      // The month was generated. Whether it is COMPLETE is a separate fact, and
      // a 201 with gaps must be readable as success-with-gaps rather than as a
      // partial failure the caller has to infer.
      unfilled_positions: unfilledPositions,
      is_complete: unfilledPositions.length === 0,
      readiness,
      month,
      year,
      ministry_id: readiness.ministry_id,
    }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error, context);
  }
}

interface PersistMonthScheduleInput {
  userId: string;
  churchId: string;
  ministryId: string;
  month: number;
  year: number;
  payload: MonthSchedulePayload;
  replaceExisting: boolean;
}

/**
 * The one write path. `persist_month_schedule` is the only entry point that
 * enforces ministry ownership, actor role, readiness and past dates INSIDE a
 * transaction; `replace_month_schedule` predates the ministry column and does
 * none of that. Returns the service UUIDs the RPC inserted.
 */
async function persistMonthSchedule(input: PersistMonthScheduleInput): Promise<string[]> {
  const admin = getAdminClient();
  const { data, error } = await admin
    .rpc('persist_month_schedule', {
      p_church_id: input.churchId,
      p_ministry_id: input.ministryId,
      p_month: input.month,
      p_year: input.year,
      p_actor_id: input.userId,
      p_services: input.payload.services,
      p_replace_existing: input.replaceExisting,
    })
    .overrideTypes<string[]>();
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

/**
 * Parse the request body as a JSON object. Returns an `ApiError` for a
 * malformed body instead of throwing, so the caller can map it uniformly.
 */
async function readJsonObject(request: NextRequest): Promise<Record<string, unknown> | ApiError | null> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) return new ApiError(400, 'Request body must be valid JSON.', 'invalid_json');
    throw error;
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return new ApiError(400, 'Request body must be an object.', 'invalid_body');
  }
  return raw as Record<string, unknown>;
}
