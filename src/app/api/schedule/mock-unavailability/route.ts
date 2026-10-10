import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient, requireStaff } from '@/lib/auth/server';
import { isPostgrestError, jsonError, type ErrorContext } from '@/lib/api/errors';
import {
  buildMockSubmissionEntries,
  planMockUnavailability,
  soleQualifiedMemberIds,
} from '@/lib/scheduling/mock-unavailability';
import { getCurrentMonth, getMonthName } from '@/lib/utils/date-utils';

/**
 * Mock-unavailability test tool, workflow-native.
 *
 * A single RPC (public.mock_month_availability) owns the whole write as one
 * transaction. For every active member it creates a source='mock' monthly
 * submission at status 'submitted' with its weekly unavailability row linked
 * at status 'pending', so mock fixtures now flow through the same
 * submissions/approval workflow as real member responses and the readiness
 * gate reflects mock data.
 *
 *   - A member with a current MEMBER submission is skipped (reported in
 *     skipped_members); their own response always wins over a fixture.
 *   - A previous MOCK submission is superseded: the old version is kept with
 *     is_current = FALSE, its availability rows are rejected, and a new
 *     version is inserted. Repeated runs converge.
 *   - Sole-qualified members (never mocked out of a week) still get an EMPTY
 *     submission, so the readiness gate can complete for the month.
 *   - Legacy unlinked mock rows (reason LIKE 'Mock unavailability (%',
 *     submission_id IS NULL) are stamped 'rejected', never hard-deleted, and
 *     reported as deleted_legacy.
 *
 * Trust boundary: p_church_id and p_actor_id come from the resolved session
 * only; the RPC re-verifies the actor as an active admin/coordinator inside
 * the transaction. Member ids are resolved church-side and are never accepted
 * from the client.
 */

/** The counts `mock_month_availability` returns as one jsonb object. */
type MockCounts = {
  submissions_created?: unknown;
  entries_added?: unknown;
  empty_submissions?: unknown;
  skipped_members?: unknown;
  deleted_legacy?: unknown;
};

/**
 * SQLSTATE -> HTTP, constructed HERE, mirroring the availability reset route:
 * the shared table in `@/lib/api/errors` is schedule-specific and would tell
 * a coordinator their *schedule* was malformed. Every message is fixed text;
 * the driver message is logged server-side and never echoed.
 */
const MOCK_SQLSTATE_TO_HTTP: Record<string, { status: number; code: string; message: string }> = {
  '22023': {
    status: 400,
    code: 'invalid_parameter_value',
    message: 'The mock unavailability request was malformed.',
  },
  '42501': {
    status: 403,
    code: 'insufficient_privilege',
    message: 'Your account is not authorized to mock availability for this church.',
  },
  // A concurrent member submission or mock run collided with this write. The
  // month changed under the run, so the honest answer is "conflict, retry".
  '23505': {
    status: 409,
    code: 'unique_violation',
    message: "This month's availability changed while the mock ran. Please retry.",
  },
  '40P01': {
    status: 503,
    code: 'deadlock_detected',
    message: 'Mock unavailability is busy. Please retry in a moment.',
  },
};

function mockErrorResponse(error: unknown, context: ErrorContext): NextResponse {
  if (isPostgrestError(error)) {
    const mapped = MOCK_SQLSTATE_TO_HTTP[error.code];
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
  return jsonError(500, 'internal_error', 'The mock unavailability could not be completed. Please try again.', {
    request_id: requestId,
  });
}

/** A count from the RPC result, defaulted so the response never carries NaN. */
function toCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export async function POST(request: NextRequest) {
  // OUTSIDE the try, deliberately, mirroring the reset route: a 401/403 is
  // decided before any parsing or I/O and must not be masked as a 400, and the
  // auth layer's own Response is returned VERBATIM.
  const auth = await requireStaff(request);
  if (auth instanceof Response) return auth;

  const context: ErrorContext = { operation: 'schedule.mock-unavailability', churchId: auth.churchId };

  try {
    let body: Record<string, unknown> = {};
    const rawBody = await request.text();
    if (rawBody.trim() !== '') {
      try {
        const parsed: unknown = JSON.parse(rawBody);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return NextResponse.json({ error: 'Request body must be an object.' }, { status: 400 });
        }
        body = parsed as Record<string, unknown>;
      } catch {
        return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
      }
    }

    // Default to the CURRENT month, 0-indexed, rather than a hardcoded literal.
    // The caller (the schedule page) always sends its own { month, year } so
    // the fixtures always land in the month actually being generated.
    const current = getCurrentMonth();
    const rawMonth: unknown = body.month === undefined ? current.month : body.month;
    const rawYear: unknown = body.year === undefined ? current.year : body.year;
    if (typeof rawMonth !== 'number' || !Number.isInteger(rawMonth) ||
        typeof rawYear !== 'number' || !Number.isInteger(rawYear)) {
      return NextResponse.json({ error: 'Month and year must be whole numbers.' }, { status: 400 });
    }
    const month = rawMonth;
    const year = rawYear;
    if (month < 0 || month > 11) {
      return NextResponse.json({ error: 'Month must be between 0 and 11.' }, { status: 400 });
    }
    if (year < 2000 || year > 2100) {
      return NextResponse.json({ error: 'Year must be between 2000 and 2100.' }, { status: 400 });
    }
    context.month = month;
    context.year = year;

    const admin = getAdminClient();

    // Active members are always resolved church-side from the authenticated
    // caller. Member ids and church_id are never accepted from the client.
    const { data: members, error: membersError } = await admin
      .from('members')
      .select('id, full_name')
      .eq('church_id', auth.churchId)
      .eq('status', 'active');
    if (membersError) {
      return NextResponse.json({ error: 'Could not load members.' }, { status: 500 });
    }

    // Same join pattern as schedule-data.ts: member roles and instrument
    // skills feed the sole-qualified-member exclusion set below.
    const memberIds = (members ?? []).map((member) => member.id);
    const [{ data: roleRows, error: rolesError }, { data: skillRows, error: skillsError }] = await Promise.all([
      admin.from('member_roles').select('*, role:roles(*)').in('member_id', memberIds),
      admin.from('member_skills').select('*, instrument:instruments(*)').in('member_id', memberIds),
    ]);
    if (rolesError || skillsError) {
      return NextResponse.json({ error: 'Could not load member qualifications.' }, { status: 500 });
    }

    // Members who are the only active holder of a leader/backup/devotion/
    // required-instrument slot are never mocked into unavailability: mocking
    // them would make routine generation fail (e.g. Simone is the sole Drums
    // holder). The helper mirrors engine.buildSlots. They still receive an
    // EMPTY submission so the readiness gate can complete.
    const excluded = soleQualifiedMemberIds({
      memberIds,
      roles: roleRows ?? [],
      skills: skillRows ?? [],
    });

    // The deterministic plan (id-sorted rotation) is still reported to the
    // caller; the write itself is performed by the RPC from `entries`.
    const records = planMockUnavailability(members ?? [], month, year, excluded);
    const entries = buildMockSubmissionEntries(members ?? [], month, year, excluded);
    const reason = `Mock unavailability (${getMonthName(month)} ${year} test)`;

    // One transactional write. p_church_id and p_actor_id come from the
    // session only; a body church_id/actor is not read, so a cross-tenant
    // value in the payload is inert rather than merely ignored.
    const { data, error } = await admin.rpc('mock_month_availability', {
      p_church_id: auth.churchId,
      p_actor_id: auth.userId,
      p_month: month,
      p_year: year,
      p_reason: reason,
      p_entries: entries,
    });
    if (error) return mockErrorResponse(error, context);

    // The RPC is atomic and always returns one jsonb object, so a missing or
    // unusable result is a defect. Reporting it as success would let a repeat
    // click read as "mock happened" when nothing is known to have changed.
    if (data === null || typeof data !== 'object' || Array.isArray(data)) {
      return mockErrorResponse(new Error('mock_month_availability returned no result'), context);
    }
    const counts = data as MockCounts;

    const skippedMembers = Array.isArray(counts.skipped_members)
      ? counts.skipped_members.filter((value): value is string => typeof value === 'string')
      : [];

    return NextResponse.json({
      success: true,
      // Backward-compatible keys: added/skipped/deleted keep their names.
      // `skipped` now counts MEMBERS left alone because their own submission
      // governs the month, and `deleted` counts legacy rows stamped 'rejected'
      // (stamped, not deleted -- the key name is kept for the caller).
      added: toCount(counts.entries_added),
      skipped: skippedMembers.length,
      deleted: toCount(counts.deleted_legacy),
      submissions_created: toCount(counts.submissions_created),
      empty_submissions: toCount(counts.empty_submissions),
      skipped_members: skippedMembers,
      excluded_sole_qualified: [...excluded].sort(),
      total_members: (members ?? []).length,
      month,
      year,
      records,
    }, { status: 201 });
  } catch (error) {
    return mockErrorResponse(error, context);
  }
}
