import { NextResponse } from 'next/server';
import type { PostgrestError } from '@supabase/supabase-js';
import { SchedulingFailureError } from '@/lib/types/scheduling';
import { UnresolvableRoleError } from '@/lib/scheduling/persistence';

/**
 * Typed HTTP error surface for the API routes.
 *
 * `toErrorResponse` is the ONLY place a status is decided. Before this module
 * the schedule route echoed `error.message` for ANY thrown value, so a raw
 * driver error could surface table, column and constraint detail to the client.
 *
 * Disclosure rule (deliberate, and the reason this file exists): a message is
 * echoed ONLY when it originates in this repository's own source -- that is,
 * from an `ApiError` we constructed here, or from the `failures` array of our
 * own `SchedulingFailureError`, which is built from domain data. Every other
 * value, including a value that merely LOOKS like it came from this repo (a
 * plain `Error`, a string, a driver error), collapses to a fixed generic body.
 */

/** The one generic body. Never interpolate anything into it. */
const INTERNAL_ERROR_MESSAGE = 'An unexpected error occurred. Please try again.';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra?: Record<string, unknown>;

  constructor(status: number, message: string, code: string, extra?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/**
 * SQLSTATE -> HTTP. Mirrors the contract documented in
 * supabase/migrations/20260928060003_replace_month_schedule_rpc.sql and
 * supabase/migrations/20260928084433_scheduler_workflow_hardening.sql.
 *
 * 23505 (unique_violation), 23503 (foreign_key_violation) and 23514
 * (check_violation) are DATA-INTEGRITY defects, not client errors, so they map
 * to 500. 23503 is the original bug in this repository: the audit trigger wrote
 * the all-zeros tenant and `audit_logs_church_id_fkey` rejected it. It is in
 * this table so that recurrence is diagnosable by code rather than by prose.
 *
 * 55000 (object_not_in_prerequisite_state) and 42501 (insufficient_privilege)
 * are the SQLSTATEs `persist_month_schedule` raises for its own domain
 * rejections -- readiness not met, a past month, draft-protection, legacy
 * ministry ownership, ministry-not-found and coordinator authorization. Both
 * are ordinary, expected outcomes of calling this endpoint. Before they were
 * listed here they fell through to the generic 500 branch, which is the exact
 * class of opaque failure this module exists to remove: a 409 the caller can act
 * on was reported as a server fault.
 */
const SQLSTATE_TO_HTTP: Record<string, { status: number; code: string; message: string }> = {
  '22023': { status: 400, code: 'invalid_parameter_value', message: 'The schedule request was malformed.' },
  W0001: { status: 409, code: 'protected_service', message: 'Published or validated services cannot be regenerated.' },
  W0002: { status: 403, code: 'tenant_mismatch', message: 'You are not permitted to modify this church schedule.' },
  W0003: { status: 422, code: 'rule_violation', message: 'The generated schedule violated a scheduling rule.' },
  '23P01': { status: 422, code: 'exclusion_violation', message: 'The generated schedule contained a conflicting assignment.' },
  '55000': { status: 409, code: 'object_not_in_prerequisite_state', message: "This month's schedule is not in a state that can be generated or replaced." },
  '42501': { status: 403, code: 'insufficient_privilege', message: 'Your account is not authorized to modify this church schedule.' },
  '23505': { status: 500, code: 'unique_violation', message: 'The schedule could not be saved because of a data integrity conflict.' },
  '23503': { status: 500, code: 'foreign_key_violation', message: 'The schedule could not be saved because of a data integrity conflict.' },
  '23514': { status: 500, code: 'check_violation', message: 'The schedule could not be saved because of a data integrity conflict.' },
  '40001': { status: 503, code: 'serialization_failure', message: 'The schedule is busy. Please retry in a moment.' },
};

export function jsonError(
  status: number,
  code: string,
  message: string,
  extra?: Record<string, unknown>
): NextResponse {
  return NextResponse.json({ error: message, code, ...(extra ?? {}) }, { status });
}

/**
 * Structural guard for a Supabase driver error. Matched on `code` rather than
 * `instanceof` so a driver error is recognised regardless of which copy of the
 * module produced it. `code` is a Postgres SQLSTATE.
 */
export function isPostgrestError(error: unknown): error is PostgrestError {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return typeof candidate.code === 'string' && typeof candidate.message === 'string';
}

export type ErrorContext = {
  /** Operation label used in the server-side log line, e.g. 'schedule.generate'. */
  operation: string;
  /** The CALLER's own tenant. Already known to them, and required to diagnose. */
  churchId: string;
  month?: number;
  year?: number;
};

function requestId(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * Maps a thrown value to a stable JSON response.
 *
 * Order matters and is the allow-list:
 *   ApiError                 -> its own status/code/message (constructed here)
 *   SyntaxError              -> 400 invalid_json
 *   SchedulingFailureError   -> 422, response shape preserved EXACTLY:
 *                              { services: [], validation: [], failures }
 *   UnresolvableRoleError    -> 422 with a fixed message; a generation defect,
 *                              not a transport error
 *   PostgrestError           -> the SQLSTATE table above
 *   anything else            -> 500 internal_error + a request_id, generic body
 *
 * Never logs a request body, a session token, a key value, or member PII.
 */
export function toErrorResponse(error: unknown, context: ErrorContext): NextResponse {
  if (error instanceof ApiError) {
    return jsonError(error.status, error.code, error.message, error.extra);
  }

  if (error instanceof SyntaxError) {
    return jsonError(400, 'invalid_json', 'Request body must be valid JSON.');
  }

  if (error instanceof SchedulingFailureError) {
    return NextResponse.json(
      { services: [], validation: [], failures: error.failures },
      { status: 422 }
    );
  }

  if (error instanceof UnresolvableRoleError) {
    return NextResponse.json(
      { services: [], validation: [], failures: [], error: 'Could not attribute a generated assignment to a saved role.', code: 'unresolvable_role' },
      { status: 422 }
    );
  }

  if (isPostgrestError(error)) {
    const mapped = SQLSTATE_TO_HTTP[error.code];
    if (mapped) {
      console.error(`[${context.operation}] failed`, {
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

  const id = requestId();
  console.error(`[${context.operation}] failed`, {
    operation: context.operation,
    churchId: context.churchId,
    month: context.month,
    year: context.year,
    requestId: id,
    errorName: error instanceof Error ? error.name : typeof error,
    errorMessage: error instanceof Error ? error.message : String(error),
  });
  return jsonError(500, 'internal_error', INTERNAL_ERROR_MESSAGE, { request_id: id });
}
