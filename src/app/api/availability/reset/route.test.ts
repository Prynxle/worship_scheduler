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
const counts = { submissions_reset: 2, availability_reset: 5, unscoped_availability_reset: 19, remaining_blocking_dates: 3 };

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
  it('reports the per-category counts and the disclosure with the caller month and church', async () => {
    const response = await POST(post({ month: 2, year: 2026, note: 'Retreat moved.' }) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      reset: true,
      submissions_reset: 2,
      availability_reset: 5,
      unscoped_availability_reset: 19,
      // A disclosure about blockers the reset did NOT touch. It is reported
      // separately so a caller can disclose the limitation, and it is not part
      // of the `reset` sum.
      remaining_blocking_dates: 3,
      month: 2,
      year: 2026,
      church_id: 'church-1',
    });
  });

  it('reports reset: false on a repeat click so zero affected never reads as success', async () => {
    resolveRpc({ data: [{ submissions_reset: 0, availability_reset: 0, unscoped_availability_reset: 0, remaining_blocking_dates: 0 }] });

    const response = await POST(post({ month: 2, year: 2026, note: 'Retreat moved.' }) as never);
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    // The boolean is the honest signal: a completed RPC over a month with
    // nothing recorded is NOT "a reset happened".
    expect(body.reset).toBe(false);
    expect(body).toMatchObject({ submissions_reset: 0, availability_reset: 0, unscoped_availability_reset: 0 });
  });

  it('reports reset: true when only unscoped rows were cleared', async () => {
    resolveRpc({ data: [{ submissions_reset: 0, availability_reset: 0, unscoped_availability_reset: 19, remaining_blocking_dates: 0 }] });

    const body = await (await POST(post({ month: 2, year: 2026, note: 'x' }) as never)).json() as Record<string, unknown>;

    expect(body.reset).toBe(true);
  });

  it('never reports reset: true for a disclosure alone', async () => {
    // F-02: remaining_blocking_dates counts rows the reset deliberately does
    // NOT clear. If it were summed into `reset`, a call that changed nothing
    // would answer `reset: true` and the coordinator would read it as "a reset
    // happened" while a blocker survives.
    resolveRpc({ data: [{ submissions_reset: 0, availability_reset: 0, unscoped_availability_reset: 0, remaining_blocking_dates: 7 }] });

    const response = await POST(post({ month: 2, year: 2026, note: 'x' }) as never);
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.reset).toBe(false);
    // The count is still disclosed, so the UI can qualify "nothing to reset".
    expect(body.remaining_blocking_dates).toBe(7);
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
 * The reset's load-bearing integrity invariants live in the SQL function body,
 * which no unit test in this suite can execute. They are therefore pinned here
 * at the source level and, separately, exercised against the live database
 * inside BEGIN/ROLLBACK. This is the one describe block that reads the
 * migration text.
 *
 * Where a regression is a deleted clause or a boolean operator, the assertion
 * is on the PROPERTY and not on a substring: an earlier assertion pinned
 * "CONTINUE WHEN v_submission.status = 'revision_required'", which asserted a
 * spelling and passed straight over the F-01 hole underneath it. Each mutation
 * below has been confirmed to fail the suite.
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

  it('is idempotent without hiding a real change: the guard is an AND of both conditions', () => {
    // Property, not token. The earlier assertion pinned the bare string
    // "CONTINUE WHEN v_submission.status = 'revision_required'", which asserted a
    // spelling rather than a behaviour and would have passed over the F-01 hole.
    //
    // F-01: review_month_availability sets 'revision_required' and never touches
    // availability rows, so such a submission can still own live rows. The sweep
    // above has already flipped them to 'rejected' by the time the guard runs, so
    // a bare status test skipped the stamp and the log for a call that DID change
    // data, and reported `reset: false`. The empty-snapshot conjunct is what makes
    // "nothing left to change" mean "nothing left to change".
    const guard = functionBody.match(/CONTINUE WHEN([\s\S]*?);/);
    expect(guard).not.toBeNull();

    const condition = (guard?.[1] ?? '').replace(/\s+/g, ' ');
    expect(condition).toContain("v_submission.status = 'revision_required'");
    expect(condition).toMatch(/AND\s+pg_catalog\.jsonb_array_length\(v_affected\) = 0/);

    // A regression to a bare status test is the exact F-01 defect, so it is
    // asserted negatively as well as positively.
    expect(condition).not.toMatch(/^v_submission\.status = 'revision_required'$/);
    // Guard must remain AFTER the sweep: the snapshot must be taken while the
    // rows are still live, and the guard must see the post-sweep state.
    const loop = functionBody.slice(functionBody.indexOf('FOR v_submission IN'));
    expect(loop.indexOf('CONTINUE WHEN')).toBeGreaterThan(loop.indexOf("SET status = 'rejected'"));
  });

  it('scopes the unscoped sweep to exactly this month and year (M-01)', () => {
    // M-01. This UPDATE is the only place rows are cleared without a submission
    // behind them, so its predicate is the whole scoping of the action. Widening
    // it -- dropping `a.year = p_year AND a.month = p_month`, or replacing it
    // with an `a.month IS NULL` clause -- would silently destroy rows that were
    // never scoped to this month, under a button whose label names one month.
    const sweep = functionBody.match(/UPDATE public\.availability a\s+SET status = 'rejected'([\s\S]*?);/);
    expect(sweep).not.toBeNull();

    const where = sweep?.[1] ?? '';
    expect(where).toContain('a.year = p_year');
    expect(where).toContain('a.month = p_month');
    expect(where).toContain("a.status IN ('pending', 'approved')");
    // The defensive "still pending on a superseded submission" case, and the
    // guarantee that a row behind a current submission is not double counted.
    expect(where).toContain('NOT EXISTS');
    expect(where).toContain('s.is_current');
    // Explicitly NOT widened to an unscoped sweep.
    expect(where).not.toContain('IS NULL');
  });

  it('discloses date rows that can still block without clearing them (F-02)', () => {
    // F-02. The premise that a `month IS NULL` row blocks scheduling was FALSE
    // and is deliberately not implemented: isWeeklyUnavailable gates on
    // `record.month === undefined`, a SQL NULL arrives as JSON null, and
    // `null === undefined` is false. Instead of clearing such rows, the function
    // counts the date/range rows that really can still block and returns the
    // number, so the UI can disclose the limitation.
    const disclosure = functionBody.match(/SELECT count\(\*\)::int\s+INTO v_remaining_blocking_dates([\s\S]*?);/);
    expect(disclosure).not.toBeNull();

    const where = disclosure?.[1] ?? '';
    // IS DISTINCT FROM, never NOT (... = ...). Three-valued logic returns NULL
    // for a NULL month, and `WHERE NULL` is not true, so the `NOT` form would
    // silently drop exactly the rows this count exists to surface.
    expect(where).toContain('IS DISTINCT FROM');
    expect(where).not.toContain('NOT (');
    // Catches a date span stamped with its start month's scope that crosses a
    // month boundary, which a narrower `a.month IS NULL` test would miss.
    expect(where).toContain('a.month IS DISTINCT FROM p_month');
    expect(where).toContain('a.year IS DISTINCT FROM p_year');
    // Weekly rows are excluded: they can never match a month, so counting or
    // clearing them would be a false signal or a real deletion for a non-problem.
    expect(where).not.toContain("'weekly'");
    expect(where).toContain("'recurring'");
    // `recurring` is in the type list ONLY because of this guard.
    expect(where).toContain('a.date IS NOT NULL');
    // Still counted while live, and gone once the sweep rejected it.
    expect(where).toContain("a.status IN ('pending','approved')");
    // December must not overflow: p_month = 11 rolls into p_year + 1.
    expect(where).toContain('pg_catalog.make_date(p_year, p_month + 1, 1)');
  });

  it('returns the disclosure as a fourth column and never folds it into the cleared counts', () => {
    expect(functionBody).toContain('remaining_blocking_dates INTEGER');
    expect(functionBody).toContain('v_remaining_blocking_dates INTEGER := 0');
    expect(functionBody).toMatch(
      /RETURN QUERY SELECT v_submissions_reset, v_availability_reset, v_unscoped_availability_reset, v_remaining_blocking_dates;/
    );
  });

  it('stamps, logs and counts a revision_required submission that still owns live rows (F-01)', () => {
    // F-01, the three cases the guard decides. Evaluated as a model of the
    // guard's AND, because plpgsql cannot run from here; the live
    // BEGIN/ROLLBACK run exercises the same three cases for real.
    const guard = functionBody.match(/CONTINUE WHEN([\s\S]*?);/)?.[1]?.replace(/\s+/g, ' ') ?? '';
    const skips = (status: string, affected: string[]) =>
      guard.includes("v_submission.status = 'revision_required'")
        && guard.includes('pg_catalog.jsonb_array_length(v_affected) = 0')
        && status === 'revision_required'
        && affected.length === 0;

    // A repeat: already reset, its rows already released. Nothing changed, so
    // it must be a 0/0/0 no-op that adds nothing to the audit trail.
    expect(skips('revision_required', [])).toBe(true);
    // F-01: a revision-requested submission reached through the ordinary review
    // path still owns live rows. The sweep already rejected them, so skipping
    // here would change real data with no stamp, no log row, and a reported
    // `reset: false`.
    expect(skips('revision_required', ['a-1', 'a-2'])).toBe(false);
    // A first reset of a live submission is never skipped.
    expect(skips('approved', ['a-1'])).toBe(false);
    expect(skips('submitted', [])).toBe(false);

    // The stamp and the audit row must both sit after the guard, or a
    // revision_required submission would be counted without being recorded.
    const loop = functionBody.slice(functionBody.indexOf('FOR v_submission IN'));
    const guardAt = loop.indexOf('CONTINUE WHEN');
    expect(loop.indexOf("SET status = 'revision_required'")).toBeGreaterThan(guardAt);
    expect(loop.indexOf('INSERT INTO public.availability_submission_review_log')).toBeGreaterThan(guardAt);
    // And the count is incremented on the same path, so a stamped reset is
    // reported as one.
    expect(loop.indexOf('v_submissions_reset := v_submissions_reset + 1')).toBeGreaterThan(guardAt);
  });

  it('names the no-submission sweep unscoped, not legacy (L-01)', () => {
    // The predicate is literally `a.year = p_year AND a.month = p_month`: the
    // rows are stamped with this month and have no current submission behind
    // them and no submission at all. "legacy" described an era, not a predicate.
    expect(functionBody).toContain('v_unscoped_availability_reset');
    expect(functionBody).not.toContain('legacy_availability_reset');
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
