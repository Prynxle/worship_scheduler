import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient, requireStaff } from '@/lib/auth/server';
import { SchedulingEngine } from '@/lib/scheduling/engine';
import { loadScheduleData } from '@/lib/scheduling/schedule-data';
import { buildMonthSchedulePayload } from '@/lib/scheduling/persistence';
import { ApiError, toErrorResponse, type ErrorContext } from '@/lib/api/errors';
import { formatLocalDate, getWeeksInMonth, getWeekDate } from '@/lib/utils/date-utils';
import { ScheduleContext } from '@/lib/types/scheduling';
import { ScheduleAssignment, Service } from '@/lib/types/database';
import { isBackupRoleName, isDevotionRoleName } from '@/lib/scheduling/role-classifier';

/**
 * Thin HTTP handler. It parses and validates input, enforces auth/tenant scope
 * (via `requireStaff` and `auth.churchId` ONLY), calls domain logic, and
 * delegates persistence to the transactional `replace_month_schedule` RPC.
 *
 * There is deliberately no `admin.from('services')` / `admin.from(
 * 'schedule_assignments')` write in this file. The previous non-transactional
 * delete-then-insert loop is what left duplicate draft services behind on every
 * failed generation; the RPC makes a partial month unrepresentable.
 *
 * `church_id` is read ONLY from `auth.churchId`. No client-supplied tenant id
 * is accepted anywhere in this file.
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
  return { id: service.id, church_id: service.church_id, date: service.date, week_number: service.week_number, leader_name: leader?.full_name ?? 'Unassigned', leader_avatar: leader?.avatar_url, backup_singers: own.filter((assignment) => !assignment.is_leader && assignment.role && isBackupRoleName(assignment.role.name)).map((assignment) => ({ name: assignment.member?.full_name ?? 'Unassigned', avatar: assignment.member?.avatar_url })), instrumentalists: own.filter((assignment) => assignment.instrument).map((assignment) => ({ instrument: assignment.instrument?.name ?? 'Instrument', name: assignment.member?.full_name ?? 'Unassigned' })), devotion_name: own.find((assignment) => assignment.role && isDevotionRoleName(assignment.role.name))?.member?.full_name, status: service.status === 'archived' ? 'draft' : service.status, conflict_count: 0 };
}

export async function GET(request: NextRequest) {
  const auth = await requireStaff(request);
  if (auth instanceof Response) return auth;
  const context = { operation: 'schedule.get', churchId: auth.churchId };
  try {
    const { month, year } = parseMonthYear(request);
    const data = await loadScheduleData(auth.churchId, month, year);
    return NextResponse.json({ services: data.services.map((service) => serviceAssignments(service, data.assignments)), month, year, church_id: auth.churchId });
  } catch (error) {
    return toErrorResponse(error, context);
  }
}

interface ReplaceMonthScheduleRow {
  service_id: string;
  week_number: number;
  service_date: string;
  assignment_count: number;
}

/**
 * Narrows the RPC result without a cast. `overrideTypes` intersects with the
 * builder's inferred single/array discriminant, so the success path is proven
 * at runtime here rather than asserted at the type level.
 */
function isRowArray(value: unknown): value is ReplaceMonthScheduleRow[] {
  return Array.isArray(value);
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
    const count = getWeeksInMonth(month, year);
    const requested = body?.week_numbers;
    const weekNumbers = requested === undefined ? Array.from({ length: count }, (_, index) => index + 1) : requested;
    if (!Array.isArray(weekNumbers) || weekNumbers.length === 0 || weekNumbers.some((week) => typeof week !== 'number' || !Number.isInteger(week) || week < 1 || week > count)) {
      throw new ApiError(400, 'week_numbers must contain valid weeks for the requested month.', 'invalid_week_numbers');
    }
    const ministryId = typeof body?.ministry_id === 'string' ? body.ministry_id : undefined;
    const data = await loadScheduleData(auth.churchId, month, year, ministryId);

    // Fast 409 for the immediate, service_ids-bearing response. The RPC repeats
    // this check INSIDE its transaction, so it is not the authority.
    const selected = new Set(weekNumbers);
    const protectedServices = data.services.filter((service) => selected.has(service.week_number) && ['published', 'validated'].includes(service.status));
    if (protectedServices.length) {
      return NextResponse.json({ error: 'Published or validated services cannot be regenerated.', service_ids: protectedServices.map((service) => service.id) }, { status: 409 });
    }

    const replaceable = new Set(data.services.filter((service) => selected.has(service.week_number)).map((service) => service.id));
    const historicalAssignments = data.assignments.filter((assignment) => !replaceable.has(assignment.service_id));
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
      historical_assignments: data.assignments,
      available_members: data.members,
      all_members: data.members,
      rules: data.rules,
      config: data.config,
    };
    const generated = await new SchedulingEngine(scheduleContext).generateSchedule();

    // Pure, and BEFORE any database write: an unresolvable role throws here, so
    // the RPC is never called with a month we cannot fully attribute.
    const payload = buildMonthSchedulePayload(generated);

    const admin = getAdminClient();
    const { data: written, error } = await admin
      .rpc('replace_month_schedule', {
        p_church_id: auth.churchId,
        p_month: month,
        p_year: year,
        p_user_id: auth.userId,
        p_week_numbers: weekNumbers,
        p_services: payload.services,
        p_service_type: payload.service_type,
      })
      .overrideTypes<ReplaceMonthScheduleRow[]>();
    if (error) throw error;

    // Post-write invariant assertion: every requested week must have come back
    // with at least one assignment. A mismatch is a 500, not a success.
    const writtenRows = isRowArray(written) ? written : [];
    const weeksWritten = new Set(writtenRows.map((row) => row.week_number));
    const missing = weekNumbers.filter((week) => !weeksWritten.has(week));
    const empty = writtenRows.filter((row) => row.assignment_count < 1);
    if (missing.length > 0 || empty.length > 0) {
      console.error('[schedule.generate] post-write invariant failed', {
        churchId: auth.churchId,
        month,
        year,
        requestedWeeks: weekNumbers,
        writtenWeeks: [...weeksWritten],
        missingWeeks: missing,
        servicesWithZeroAssignments: empty.map((row) => row.service_id),
      });
      return toErrorResponse(
        new ApiError(500, 'The schedule was written but did not match the request.', 'post_write_invariant_failed', { request_id: globalThis.crypto.randomUUID() }),
        context
      );
    }

    return NextResponse.json({ services: generated, validation: generated.flatMap((service) => service.conflicts), month, year }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error, context);
  }
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
