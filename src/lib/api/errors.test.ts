import { describe, expect, it, vi } from 'vitest';
import { SchedulingFailureError } from '@/lib/types/scheduling';
import { UnresolvableRoleError } from '@/lib/scheduling/persistence';
import { ApiError, isPostgrestError, jsonError, toErrorResponse } from './errors';

/**
 * R9 regression tests.
 *
 * Before this module the schedule route did `NextResponse.json({ error:
 * error.message })` for ANY thrown value. A Supabase driver error therefore
 * reached the client verbatim -- table names, column names, constraint names,
 * and row values included. These tests pin the allow-list that replaced it.
 */

const context = { operation: 'schedule.generate', churchId: 'church-1', month: 8, year: 2026 };

function pgError(code: string, message: string) {
  return { code, message, details: null, hint: null };
}

async function bodyOf(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

describe('toErrorResponse SQLSTATE mapping', () => {
  it.each([
    ['22023', 400, 'invalid_parameter_value'],
    ['W0001', 409, 'protected_service'],
    ['W0002', 403, 'tenant_mismatch'],
    ['W0003', 422, 'rule_violation'],
    ['23P01', 422, 'exclusion_violation'],
    ['55000', 409, 'object_not_in_prerequisite_state'],
    ['42501', 403, 'insufficient_privilege'],
    ['23505', 500, 'unique_violation'],
    ['23503', 500, 'foreign_key_violation'],
    ['23514', 500, 'check_violation'],
    ['40001', 503, 'serialization_failure'],
  ])('maps %s to %i %s', async (sqlstate, status, code) => {
    const response = toErrorResponse(pgError(sqlstate, 'raw driver text'), context);

    expect(response.status).toBe(status);
    expect(await bodyOf(response)).toMatchObject({ code });
  });

  // 55000 and 42501 are the SQLSTATEs `persist_month_schedule` raises for its own
  // domain rejections: readiness not met, a past month, draft protection, legacy
  // ministry ownership, ministry-not-found and coordinator authorization. Both
  // are expected outcomes of calling the endpoint, so before they were listed
  // they fell through to the generic 500 -- an actionable 409 or 403 reported as
  // a server fault, which is the exact class of opaque failure this module exists
  // to remove.
  it('maps a persist_month_schedule readiness rejection to 409 without disclosing the counts', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const leak = 'Availability is not ready: 18 of 19 required submissions approved';
    const response = toErrorResponse(pgError('55000', leak), context);
    const body = await bodyOf(response);

    expect(response.status).toBe(409);
    expect(body).toMatchObject({ code: 'object_not_in_prerequisite_state' });
    expect(JSON.stringify(body)).not.toContain('18 of 19');
  });

  it('maps a persist_month_schedule authorization failure to 403 without echoing it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const leak = 'Coordinator authorization could not be verified';
    const response = toErrorResponse(pgError('42501', leak), context);
    const body = await bodyOf(response);

    expect(response.status).toBe(403);
    expect(body).toMatchObject({ code: 'insufficient_privilege' });
    expect(JSON.stringify(body)).not.toContain('Coordinator authorization');
  });

  it('maps an unknown SQLSTATE to 500', async () => {
    const response = toErrorResponse(pgError('42P01', 'relation "nope" does not exist'), context);

    expect(response.status).toBe(500);
    expect(await bodyOf(response)).toMatchObject({ code: 'internal_error' });
  });
});

describe('toErrorResponse disclosure allow-list', () => {
  it('does not disclose a driver message for a MAPPED SQLSTATE', async () => {
    // The exact leak this module exists to close: 23503 is how the original
    // audit-trigger bug surfaced, and the constraint name identified the
    // broken FK to any caller.
    const leak = 'insert or update on table "audit_logs" violates foreign key constraint "audit_logs_church_id_fkey"';
    const response = toErrorResponse(pgError('23503', leak), context);
    const serialised = JSON.stringify(await bodyOf(response));

    expect(response.status).toBe(500);
    expect(serialised).not.toContain('audit_logs');
    expect(serialised).not.toContain('church_id_fkey');
    expect(serialised).not.toContain('foreign key constraint');
  });

  it('collapses a plain Error to a generic 500 and does not echo its message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = toErrorResponse(new Error('PGHACK: connection string postgres://u:p@h/db leaked'), context);
    const body = await bodyOf(response);

    expect(response.status).toBe(500);
    expect(body.error).toBe('An unexpected error occurred. Please try again.');
    expect(JSON.stringify(body)).not.toContain('PGHACK');
    expect(body.request_id).toEqual(expect.any(String));
  });

  it('collapses a thrown string to a generic 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = toErrorResponse('select * from secrets', context);

    expect(response.status).toBe(500);
    expect(JSON.stringify(await bodyOf(response))).not.toContain('secrets');
  });

  it('collapses an unmapped driver error to a generic 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = toErrorResponse(pgError('XX000', 'internal detail nobody should see'), context);
    const serialised = JSON.stringify(await bodyOf(response));

    expect(response.status).toBe(500);
    expect(serialised).not.toContain('internal detail');
  });
});

describe('toErrorResponse domain errors', () => {
  it('passes an ApiError through with its own status and code', async () => {
    const response = toErrorResponse(new ApiError(400, 'Month must be 0-11.', 'invalid_month_year'), context);

    expect(response.status).toBe(400);
    expect(await bodyOf(response)).toMatchObject({ error: 'Month must be 0-11.', code: 'invalid_month_year' });
  });

  it('preserves the SchedulingFailureError response shape exactly', async () => {
    // Backward compatibility: the page reads `failures[].message` to explain a
    // rule violation, so the shape must stay { services, validation, failures }.
    const response = toErrorResponse(
      new SchedulingFailureError([{ rule: 'Rule 1', message: 'Sam is unavailable Week 1', service_id: 's1', severity: 'error' } as never]),
      context
    );
    const body = await bodyOf(response);

    expect(response.status).toBe(422);
    expect(body.services).toEqual([]);
    expect(body.validation).toEqual([]);
    expect(body.failures).toEqual([{ rule: 'Rule 1', message: 'Sam is unavailable Week 1', service_id: 's1', severity: 'error' }]);
  });

  it('maps UnresolvableRoleError to 422 with a fixed message', async () => {
    const response = toErrorResponse(new UnresolvableRoleError('Guitarist'), context);
    const body = await bodyOf(response);

    expect(response.status).toBe(422);
    expect(body.code).toBe('unresolvable_role');
    expect(body.services).toEqual([]);
  });

  it('maps a SyntaxError to 400 invalid_json', async () => {
    const response = toErrorResponse(new SyntaxError('Unexpected token < in JSON at position 0'), context);

    expect(response.status).toBe(400);
    expect(await bodyOf(response)).toMatchObject({ code: 'invalid_json' });
  });
});

describe('helpers', () => {
  it('recognises a driver error structurally, without instanceof', () => {
    expect(isPostgrestError(pgError('W0001', 'x'))).toBe(true);
    expect(isPostgrestError(new Error('x'))).toBe(false);
    expect(isPostgrestError(null)).toBe(false);
    expect(isPostgrestError({ code: 'W0001' })).toBe(false);
  });

  it('jsonError merges extras and omits them when absent', async () => {
    expect(await bodyOf(jsonError(400, 'code', 'message'))).toEqual({ error: 'message', code: 'code' });
    expect(await bodyOf(jsonError(500, 'code', 'message', { request_id: 'r1' }))).toEqual({ error: 'message', code: 'code', request_id: 'r1' });
  });
});
