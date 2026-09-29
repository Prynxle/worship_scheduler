import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient, requireStaff } from '@/lib/auth/server';
import { isPostgrestError, jsonError, toErrorResponse, type ErrorContext } from '@/lib/api/errors';

/**
 * POST /api/availability/reset -- coordinator-gated, church-wide, month-scoped
 * reset of the unavailability recorded for one month.
 *
 * Trust boundary, and the reason this file is this small:
 *   - `p_church_id` is `auth.churchId` and `p_actor_id` is `auth.userId`, both
 *     taken from the resolved session. Neither is ever read from the body, so a
 *     caller cannot reset another tenant's month or forge a coordinator actor.
 *     The RPC re-verifies the actor against `users` (role IN
 *     ('admin','coordinator') AND is_active AND church_id) inside the
 *     transaction, mirroring `persist_month_schedule`, so the route check is
 *     defence in depth and not the authority.
 *   - Only `month`, `year` and `note` are accepted from the client. `ministry_id`
 *     is deliberately NOT a parameter: this action is church-wide by design, and
 *     a ministry-scoped reset would need a different RPC rather than a filter
 *     the client can choose.
 *
 * No availability or submission row is deleted. `is_current` and `version` are
 * never written; the RPC only moves a submission to 'revision_required' and
 * takes its absence rows out of the status IN ('pending','approved') set that
 * the scheduling engine reads, and it records one review-log row per submission
 * carrying the prior statuses so the action is reversible.
 */

/** The counts `reset_month_availability` returns, one row. */
type ResetCounts = {
  submissions_reset: number;
  availability_reset: number;
  legacy_availability_reset: number;
};

/**
 * SQLSTATE -> HTTP, constructed HERE and not delegated to `toErrorResponse`.
 *
 * The shared table in `@/lib/api/errors` is schedule-specific: its 22023 entry
 * says "The schedule request was malformed." and its 42501/55000 entries talk
 * about a schedule. Reusing it here would tell a coordinator who clicked
 * "reset availability" that their *schedule* was malformed, and would map any
 * unmapped driver SQLSTATE onto schedule-flavoured copy as well. Every message
 * below is fixed text; the driver message is logged server-side and never
 * echoed.
 */
const RESET_SQLSTATE_TO_HTTP: Record<string, { status: number; code: string; message: string }> = {
  '22023': {
    status: 400,
    code: 'invalid_parameter_value',
    message: 'A month between 0 and 11, a year between 2000 and 2100, and a note explaining the reset are required.',
  },
  '42501': {
    status: 403,
    code: 'insufficient_privilege',
    message: 'Your account is not authorized to reset availability for this church.',
  },
  '55000': {
    status: 409,
    code: 'object_not_in_prerequisite_state',
    message: "This month's availability cannot be reset while it has a validated or published schedule.",
  },
  '40P01': {
    status: 503,
    code: 'deadlock_detected',
    message: 'The availability reset is busy. Please retry in a moment.',
  },
};

function resetErrorResponse(error: unknown, context: ErrorContext): NextResponse {
  if (isPostgrestError(error)) {
    const mapped = RESET_SQLSTATE_TO_HTTP[error.code];
    if (mapped) {
      console.error(`[${context.operation}] rejected`, {
        operation: context.operation,
        churchId: context.churchId,
        month: context.month,
        year: context.year,
        pgCode: error.code,
        pgMessage: error.message,
      });
      return jsonError(mapped.status, mapped.code, mapped.message);
    }
  }
  // An unmapped driver error is a 500 with a fixed body and a request_id. It is
  // deliberately NOT routed through `toErrorResponse`: that module's table would
  // give an arbitrary SQLSTATE schedule-specific copy.
  const requestId = globalThis.crypto.randomUUID();
  console.error(`[${context.operation}] failed`, {
    operation: context.operation,
    churchId: context.churchId,
    month: context.month,
    year: context.year,
    requestId,
    pgCode: isPostgrestError(error) ? error.code : null,
    errorName: error instanceof Error ? error.name : typeof error,
  });
  return jsonError(500, 'internal_error', 'The availability reset could not be completed. Please try again.', {
    request_id: requestId,
  });
}

/** A count from the RPC row, defaulted so the response shape never carries NaN. */
function toCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export async function POST(request: NextRequest) {
  // OUTSIDE the try, deliberately, mirroring src/app/api/schedule/route.ts: a
  // 401/403 is decided before any parsing or I/O and must not be masked as a 400,
  // and the auth layer's own Response is returned VERBATIM.
  const auth = await requireStaff(request);
  if (auth instanceof Response) return auth;

  const context: ErrorContext = { operation: 'availability.reset', churchId: auth.churchId };

  try {
    const rawBody = await request.text();
    let body: Record<string, unknown> = {};
    if (rawBody.trim() !== '') {
      let parsed: unknown;
      try {
        parsed = JSON.parse(rawBody);
      } catch {
        return jsonError(400, 'invalid_json', 'Request body must be valid JSON.');
      }
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return jsonError(400, 'invalid_body', 'Request body must be an object.');
      }
      body = parsed as Record<string, unknown>;
    }

    const { month, year } = body;
    if (typeof month !== 'number' || !Number.isInteger(month) || month < 0 || month > 11) {
      return jsonError(400, 'invalid_month', 'Month must be between 0 and 11.');
    }
    if (typeof year !== 'number' || !Number.isInteger(year) || year < 2000 || year > 2100) {
      return jsonError(400, 'invalid_year', 'Year must be between 2000 and 2100.');
    }
    context.month = month;
    context.year = year;

    // Required, and required server-side too: the RPC raises 22023 on a blank
    // note, and the member-facing submission card renders "Revision requested:
    // {revision_note}", so a null note would show a dangling label.
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (!note) {
      return jsonError(400, 'note_required', 'Add a note explaining why this month is being reset.');
    }

    // `p_church_id` and `p_actor_id` come from the session only. A body
    // `church_id`, `userId` or `actor_id` is not read, so a cross-tenant
    // `church_id` in the payload is inert rather than merely ignored.
    const { data, error } = await getAdminClient()
      .rpc('reset_month_availability', {
        p_church_id: auth.churchId,
        p_month: month,
        p_year: year,
        p_actor_id: auth.userId,
        p_note: note,
      })
      .overrideTypes<ResetCounts[]>();
    if (error) return resetErrorResponse(error, context);

    // Arity check, mirroring the post-write invariant in the schedule route: the
    // RPC is atomic and always returns exactly one row, so a missing or unusable
    // row is a defect. Reporting it as success would let a repeat click read as
    // "reset happened" when nothing is known to have changed.
    const row = Array.isArray(data) ? data[0] : undefined;
    if (!row || typeof row !== 'object') {
      return resetErrorResponse(new Error('reset_month_availability returned no row'), context);
    }

    const submissionsReset = toCount(row.submissions_reset);
    const availabilityReset = toCount(row.availability_reset);
    const legacyAvailabilityReset = toCount(row.legacy_availability_reset);

    return NextResponse.json({
      // Explicit, so a repeat click reads honestly as "0 affected" instead of a
      // silent success: this is false when the month had nothing left to clear.
      reset: submissionsReset + availabilityReset + legacyAvailabilityReset > 0,
      submissions_reset: submissionsReset,
      availability_reset: availabilityReset,
      legacy_availability_reset: legacyAvailabilityReset,
      month,
      year,
      church_id: auth.churchId,
    });
  } catch (error) {
    return toErrorResponse(error, context);
  }
}
