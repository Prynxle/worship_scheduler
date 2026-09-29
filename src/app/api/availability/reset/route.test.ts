import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Route contract tests for POST /api/availability/reset.
 *
 * Modelled on src/app/api/schedule/mock-unavailability/route.test.ts: the
 * collaborators are mocked and only observable behaviour is asserted -- auth
 * passthrough, body parsing, month/year bounds, tenant scoping, the SQLSTATE
 * mapping, and the response shape. No assertion reads route.ts source text,
 * with ONE deliberate exception in the final describe block, which pins an
 * invariant that lives in SQL and therefore cannot be reached from here.
 */

const requireStaff = vi.fn();
const getAdminClient = vi.fn();
const rpc = vi.fn();

vi.mock('@/lib/auth/server', () => ({
  requireStaff: (request: Request) => requireStaff(request),
  getAdminClient: () => getAdminClient(),
}));

const { POST } = await import('./route');

const auth = {
  authId: 'auth-1', userId: 'user-1', memberId: 'member-1', churchId: 'church-1',
  fullName: 'Zed', memberName: 'Zed', phone: null, role: 'coordinator' as const,
};

/** What the RPC resolves to on success. */
const counts = { submissions_reset: 2, availability_reset: 5, legacy_availability_reset: 19 };

type RpcResult = { data?: unknown; error?: unknown };

/**
 * `admin.rpc(...)` returns a PostgrestFilterBuilder, not a promise: the route
 * calls `.overrideTypes()` on it and awaits THAT. The double therefore returns
 * the builder synchronously, with `overrideTypes` resolving to the result.
 */
function resolveRpc(result: RpcResult) {
  rpc.mockReturnValue({ ...result, overrideTypes: () => Promise.resolve(result) });
}

function post(body: unknown): Request {
  return new Request('https://app.test/api/availability/reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireStaff.mockResolvedValue(auth);
  getAdminClient.mockReturnValue({ rpc: (name: string, args: unknown) => rpc(name, args) });
  resolveRpc({ data: [counts] });
});

describe('POST /api/availability/reset — auth', () => {
  it('returns the requireStaff rejection untouched and never opens a client', async () => {
    const denied = Response.json({ error: 'Forbidden' }, { status: 403 });
    requireStaff.mockResolvedValue(denied);

    const response = await POST(post({ month: 2, year: 2026, note: 'x' }) as never);

    // Identity, not just shape: the auth layer's own Response is returned
    // verbatim rather than re-wrapped, matching src/app/api/schedule/route.ts.
    expect(response).toBe(denied);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Forbidden' });
    expect(getAdminClient).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated caller with 401 before any parsing or I/O', async () => {
    requireStaff.mockResolvedValue(Response.json({ error: 'Authentication required.' }, { status: 401 }));

    const response = await POST(post('{not json') as never);

    expect(response.status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('POST /api/availability/reset — tenant and actor scoping', () => {
  it('ignores a body church_id and passes auth.churchId to the RPC', async () => {
    const response = await POST(post({ month: 2, year: 2026, note: 'Retreat moved.', church_id: 'attacker-church' }) as never);

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('reset_month_availability', expect.objectContaining({
      p_church_id: 'church-1',
    }));
    const [, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(JSON.stringify(args)).not.toContain('attacker-church');
  });

  it('takes p_actor_id from the session user id, never from the body', async () => {
    await POST(post({
      month: 2, year: 2026, note: 'Retreat moved.',
      userId: 'attacker-user', actor_id: 'attacker-user', p_actor_id: 'attacker-user', p_church_id: 'attacker-church',
    }) as never);

    const [, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(args.p_actor_id).toBe('user-1');
    expect(args.p_church_id).toBe('church-1');
    expect(JSON.stringify(args)).not.toContain('attacker-user');
  });

  it('sends no ministry, so the action cannot be narrowed by client input', async () => {
    await POST(post({ month: 2, year: 2026, note: 'Retreat moved.', ministry_id: 'attacker-ministry' }) as never);

    const [name, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    // The reset is church-wide by design; a ministry parameter would let the
    // caller scope an action whose label says it is not scoped.
    expect(name).toBe('reset_month_availability');
    expect(Object.keys(args).sort()).toEqual(['p_actor_id', 'p_church_id', 'p_month', 'p_note', 'p_year']);
  });
});

describe('POST /api/availability/reset — body parsing', () => {
  it.each([
    ['malformed JSON', '{not json', 'Request body must be valid JSON.'],
    ['a JSON array', '[]', 'Request body must be an object.'],
    ['a JSON null', 'null', 'Request body must be an object.'],
    ['a JSON string', '"nope"', 'Request body must be an object.'],
    ['a JSON number', '5', 'Request body must be an object.'],
  ])('returns 400 for %s and never calls the RPC', async (_label, raw, message) => {
    const response = await POST(post(raw) as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: message, code: expect.any(String) });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects an empty body because a month is required', async () => {
    const response = await POST(post('   ') as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'invalid_month' });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('POST /api/availability/reset — month and year bounds', () => {
  it.each([
    ['month 12', { month: 12, year: 2026, note: 'x' }, 'Month must be between 0 and 11.'],
    ['a negative month', { month: -1, year: 2026, note: 'x' }, 'Month must be between 0 and 11.'],
    ['a non-integer month', { month: 1.5, year: 2026, note: 'x' }, 'Month must be between 0 and 11.'],
    ['a non-numeric month', { month: '3', year: 2026, note: 'x' }, 'Month must be between 0 and 11.'],
    ['year 1999', { month: 2, year: 1999, note: 'x' }, 'Year must be between 2000 and 2100.'],
    ['a year above 2100', { month: 2, year: 2101, note: 'x' }, 'Year must be between 2000 and 2100.'],
    ['a non-integer year', { month: 2, year: 2026.5, note: 'x' }, 'Year must be between 2000 and 2100.'],
    ['a non-numeric year', { month: 2, year: '2026', note: 'x' }, 'Year must be between 2000 and 2100.'],
    ['a missing month', { year: 2026, note: 'x' }, 'Month must be between 0 and 11.'],
    ['a missing year', { month: 2, note: 'x' }, 'Year must be between 2000 and 2100.'],
  ])('returns 400 for %s and never calls the RPC', async (_label, body, message) => {
    const response = await POST(post(body) as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: message });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([
    ['the lower bounds', { month: 0, year: 2000 }],
    ['the upper bounds', { month: 11, year: 2100 }],
  ])('accepts %s inclusively', async (_label, bounds) => {
    const response = await POST(post({ ...bounds, note: 'x' }) as never);

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('reset_month_availability', expect.objectContaining({
      p_month: bounds.month, p_year: bounds.year,
    }));
  });
});

describe('POST /api/availability/reset — note is required', () => {
  // The note is stored on the submission as revision_note and rendered to the
  // member as "Revision requested: {revision_note}", so a blank one is both a
  // dangling label and an unauditable action.
  it.each([
    ['a missing note', { month: 2, year: 2026 }],
    ['an empty note', { month: 2, year: 2026, note: '' }],
    ['a whitespace-only note', { month: 2, year: 2026, note: '   \n\t ' }],
    ['a non-string note', { month: 2, year: 2026, note: 42 }],
  ])('returns 400 for %s and never calls the RPC', async (_label, body) => {
    const response = await POST(post(body) as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'note_required' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('trims the note before sending it', async () => {
    await POST(post({ month: 2, year: 2026, note: '  Retreat moved.  ' }) as never);

    const [, args] = rpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(args.p_note).toBe('Retreat moved.');
  });
});

describe('POST /api/availability/reset — SQLSTATE mapping', () => {
  const leak = 'Coordinator authorization could not be verified at users_pkey on (e1ee) for church 0000';
  const mapped: Array<[string, number, string]> = [
    ['42501', 403, 'insufficient_privilege'],
    ['55000', 409, 'object_not_in_prerequisite_state'],
    ['40P01', 503, 'deadlock_detected'],
  ];

  /**
   * The exact messages SQLSTATE_TO_HTTP in `@/lib/api/errors` would have
   * produced for these SQLSTATEs. They are transcribed here so a regression that
   * routes the reset through `toErrorResponse` is caught by identity, not by a
   * loose keyword search.
   */
  const SHARED_TABLE_COPY = [
    "This month's schedule is not in a state that can be generated or replaced.",
    'Your account is not authorized to modify this church schedule.',
    'The schedule request was malformed.',
    'The schedule could not be saved because of a data integrity conflict.',
    'The schedule is busy. Please retry in a moment.',
    'Published or validated services cannot be regenerated.',
  ];

  it.each(mapped)('maps %s to %i %s without disclosing the driver message', async (sqlstate, status, code) => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    resolveRpc({ data: null, error: { code: sqlstate, message: leak, details: null, hint: null } });

    const response = await POST(post({ month: 2, year: 2026, note: 'Retreat moved.' }) as never);
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(status);
    expect(body).toMatchObject({ code });
    expect(JSON.stringify(body)).not.toContain(leak);
    expect(JSON.stringify(body)).not.toContain('users_pkey');
  });

  it.each(mapped)('never returns the shared schedule-specific copy for %s', async (sqlstate) => {
    // toErrorResponse's table in @/lib/api/errors is schedule-specific, so
    // reusing it here would tell a coordinator who reset availability that their
    // *schedule* was malformed. The subject of these messages is the availability
    // reset, even where a schedule is named as the reason it is refused.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    resolveRpc({ data: null, error: { code: sqlstate, message: 'raw driver text' } });

    const body = await (await POST(post({ month: 2, year: 2026, note: 'x' }) as never)).json() as Record<string, unknown>;
    const message = String(body.error);

    for (const shared of SHARED_TABLE_COPY) {
      expect(message).not.toBe(shared);
    }
    expect(message.toLowerCase()).toContain('availability');
  });

  it('maps a blank-note 22023 from the database to 400 with route-owned copy', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    resolveRpc({ data: null, error: { code: '22023', message: 'A month between 0 and 11 ... are required' } });

    const response = await POST(post({ month: 2, year: 2026, note: 'x' }) as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'invalid_parameter_value' });
  });

  it('fails closed with an opaque 500 and a request id for an unmapped SQLSTATE', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    resolveRpc({ data: null, error: { code: 'P0001', message: 'plpgsql: internal detail about a table' } });

    const response = await POST(post({ month: 2, year: 2026, note: 'x' }) as never);
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(500);
    expect(body).toMatchObject({ code: 'internal_error' });
    expect(typeof body.request_id).toBe('string');
    expect(JSON.stringify(body)).not.toContain('plpgsql');
  });

  it('does not let a data-integrity SQLSTATE surface schedule-flavoured copy', async () => {
    // 23514 has a schedule-flavoured entry in the shared table; a constraint
    // failure here must still be a plain 500, not "the schedule could not be
    // saved".
    vi.spyOn(console, 'error').mockImplementation(() => {});
    resolveRpc({ data: null, error: { code: '23514', message: 'check constraint detail' } });

    const body = await (await POST(post({ month: 2, year: 2026, note: 'x' }) as never)).json() as Record<string, unknown>;
    const message = String(body.error);

    for (const shared of SHARED_TABLE_COPY) {
      expect(message).not.toBe(shared);
    }
  });
});

describe('POST /api/availability/reset — success shape', () => {
  it('reports the three per-category counts with the caller month and church', async () => {
    const response = await POST(post({ month: 2, year: 2026, note: 'Retreat moved.' }) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      reset: true,
      submissions_reset: 2,
      availability_reset: 5,
      legacy_availability_reset: 19,
      month: 2,
      year: 2026,
      church_id: 'church-1',
    });
  });

  it('reports reset: false on a repeat click so zero affected never reads as success', async () => {
    resolveRpc({ data: [{ submissions_reset: 0, availability_reset: 0, legacy_availability_reset: 0 }] });

    const response = await POST(post({ month: 2, year: 2026, note: 'Retreat moved.' }) as never);
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    // The boolean is the honest signal: a completed RPC over a month with
    // nothing recorded is NOT "a reset happened".
    expect(body.reset).toBe(false);
    expect(body).toMatchObject({ submissions_reset: 0, availability_reset: 0, legacy_availability_reset: 0 });
  });

  it('reports reset: true when only legacy rows were cleared', async () => {
    resolveRpc({ data: [{ submissions_reset: 0, availability_reset: 0, legacy_availability_reset: 19 }] });

    const body = await (await POST(post({ month: 2, year: 2026, note: 'x' }) as never)).json() as Record<string, unknown>;

    expect(body.reset).toBe(true);
  });

  it('never reports a success it cannot account for when the RPC returns no row', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    resolveRpc({ data: [] });

    const response = await POST(post({ month: 2, year: 2026, note: 'x' }) as never);

    // The RPC is atomic and always returns one row, so a missing row is a
    // defect. A silent 200 would let a repeat click read as "done".
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({ code: 'internal_error' });
  });
});

/**
 * The reset's load-bearing integrity invariant lives in the SQL function body,
 * which no unit test in this suite can execute. It is therefore pinned here at
 * the source level and, separately, exercised against the live database inside
 * BEGIN/ROLLBACK. This is the one describe block that reads the migration text,
 * and it reads it to assert an ABSENCE: `is_current` and `version` must never be
 * written, and the one `UPDATE public.availability_submissions` in the function
 * must not mention either column.
 */
describe('reset_month_availability migration — submission integrity invariant', () => {
  const migrationPath = fileURLToPath(new URL('../../../../../supabase/migrations/20260929120000_reset_month_availability.sql', import.meta.url));
  const sql = readFileSync(migrationPath, 'utf8');

  const functionBody = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.reset_month_availability'));

  it('never writes is_current or version anywhere in the function', () => {
    // is_current: unsetting it breaks availability_submissions_one_current and
    // contradicts the review-log row the function writes. version: bumping it
    // would claim a resubmission that never happened. submit_month_availability
    // is the only legitimate writer of both.
    expect(functionBody).not.toMatch(/is_current\s*=/);
    expect(functionBody).not.toMatch(/version\s*=(?!=)/);
    expect(functionBody).toContain('SET status = \'revision_required\'');
  });

  it('sets only status and the review columns on the submission row', () => {
    const update = functionBody.match(/UPDATE public\.availability_submissions\s+SET([^;]+);/);
    expect(update).not.toBeNull();
    const columns = (update?.[1] ?? '').split(',').map((part) => part.trim().split(/\s/)[0]);
    expect(columns.sort()).toEqual(['reviewed_at', 'reviewed_by', 'revision_note', 'status']);
  });

  it('declares SECURITY INVOKER with an empty search_path, like every sibling', () => {
    expect(functionBody).toContain('SECURITY INVOKER');
    expect(functionBody).toContain("SET search_path = ''");
    expect(functionBody).not.toContain('SECURITY DEFINER');
  });

  it('serializes with row locks on the submissions and takes no other lock', () => {
    // persist_month_schedule locks submissions then services, so locking
    // services here would invert the order and deadlock; a church+month
    // advisory key would not collide with persist's ministry-keyed lock and
    // would only look like serialization.
    expect(functionBody).toMatch(/ORDER BY s\.id\s+FOR UPDATE OF s/);
    expect(functionBody).not.toMatch(/pg_advisory/);
    expect(functionBody).not.toMatch(/FROM public\.services s[^;]*FOR UPDATE/);
  });

  it('logs one review-log row per affected submission with the prior state', () => {
    expect(functionBody).toContain('INSERT INTO public.availability_submission_review_log');
    expect(functionBody).toContain("'prior_submission_status'");
    expect(functionBody).toContain("'availability', v_affected");
  });

  it('refuses only validated and published months, leaving draft and archived resettable', () => {
    const guard = functionBody.match(/IF EXISTS \(([\s\S]*?)\) THEN\s+RAISE EXCEPTION 'This month has/);
    expect(guard).not.toBeNull();
    expect(guard?.[1]).toContain("s.status IN ('validated', 'published')");
  });

  it('is idempotent: skips re-stamping and re-logging an already reset submission', () => {
    // Found by the live BEGIN/ROLLBACK run, not by review: because `is_current`
    // must stay true it cannot mark a submission as already reset, so a second
    // call re-selected the same rows, overwrote reviewed_by/reviewed_at/
    // revision_note, appended a duplicate 'reset' audit row, and reported 2/0/0
    // again. A double-clicked button or client retry must be a no-op.
    expect(functionBody).toContain(
      "CONTINUE WHEN v_submission.status = 'revision_required'"
    );
  });

  it('snapshots prior availability state BEFORE rejecting it, and guards AFTER', () => {
    // The sweep sets every live row to 'rejected'. Snapshotting after it would
    // always find nothing, zeroing both the log payload and availability_reset,
    // so the ordering is load-bearing: snapshot -> sweep -> guard.
    const loop = functionBody.slice(functionBody.indexOf('FOR v_submission IN'));
    const snapshotAt = loop.indexOf('INTO v_affected');
    const sweepAt = loop.indexOf("SET status = 'rejected'");
    const guardAt = loop.indexOf('CONTINUE WHEN');

    expect(snapshotAt).toBeGreaterThan(-1);
    expect(sweepAt).toBeGreaterThan(snapshotAt);
    // After the sweep, so a submission already at revision_required still has
    // its availability rows released even though it is not re-stamped.
    expect(guardAt).toBeGreaterThan(sweepAt);
  });
});
