import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Route contract tests for /api/announcements.
 *
 * Modelled on src/app/api/members/route.test.ts: collaborators are mocked and
 * only observable behaviour is asserted -- auth passthrough, tenant scoping,
 * audience validation, recipient resolution, and the shape of the rows that
 * get written. Audience resolution itself runs for real against the PostgREST
 * double, so these tests exercise the same path production takes.
 */

const requireStaff = vi.fn();
const getAuthContext = vi.fn();

vi.mock('@/lib/auth/server', () => ({
  requireStaff: (request: Request) => requireStaff(request),
  getAuthContext: (request: Request) => getAuthContext(request),
  getAdminClient: () => buildClient(),
}));

const { GET, POST, PATCH, DELETE } = await import('./route');

const auth = {
  authId: 'auth-1', userId: 'user-1', memberId: 'member-1', churchId: 'church-1',
  fullName: 'Zed', memberName: 'Zed', phone: null, role: 'coordinator' as const,
};

const MEMBER_ID_A = '11111111-1111-4111-8111-111111111111';
const MEMBER_ID_B = '22222222-2222-4222-8222-222222222222';
const MINISTRY_ID = '44444444-4444-4444-8444-444444444444';

type Call = { op: string; args: unknown[] };
type Result = { data?: unknown; error?: { message: string } | null; count?: number | null };
type Handler = (calls: Call[]) => Result;

const lastCall = (calls: Call[], op: string) => [...calls].reverse().find((call) => call.op === op);

/**
 * Chainable PostgREST double. `then` makes the builder awaitable so the route
 * can `await query`, and `single()`/`maybeSingle()` resolve the same result.
 */
function builder(table: string, handler: Handler) {
  const calls: Call[] = [{ op: 'from', args: [table] }];
  const self: Record<string, unknown> = {
    calls,
    select: (...args: unknown[]) => { calls.push({ op: 'select', args }); return self; },
    eq: (...args: unknown[]) => { calls.push({ op: 'eq', args }); return self; },
    in: (...args: unknown[]) => { calls.push({ op: 'in', args }); return self; },
    is: (...args: unknown[]) => { calls.push({ op: 'is', args }); return self; },
    not: (...args: unknown[]) => { calls.push({ op: 'not', args }); return self; },
    lt: (...args: unknown[]) => { calls.push({ op: 'lt', args }); return self; },
    order: (...args: unknown[]) => { calls.push({ op: 'order', args }); return self; },
    limit: (...args: unknown[]) => { calls.push({ op: 'limit', args }); return self; },
    insert: (...args: unknown[]) => { calls.push({ op: 'insert', args }); return self; },
    update: (...args: unknown[]) => { calls.push({ op: 'update', args }); return self; },
    delete: () => { calls.push({ op: 'delete', args: [] }); return self; },
    single: () => { calls.push({ op: 'single', args: [] }); return self; },
    maybeSingle: () => { calls.push({ op: 'maybeSingle', args: [] }); return self; },
    then: (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(handler(calls)).then(resolve, reject),
  };
  return self;
}

let handlers: Record<string, Handler>;
let clientCalls: Call[][];

function buildClient() {
  return {
    from(table: string) {
      const handler = handlers[table] ?? (() => ({ data: [], error: null }));
      const built = builder(table, handler);
      clientCalls.push(built.calls as unknown as Call[]);
      return built;
    },
  };
}

function track(table: string, result: Result) {
  handlers[table] = () => result;
}

/** Every call recorded on the builders opened for one table. */
function flattened(table: string): Call[] {
  return clientCalls
    .filter((calls) => calls[0]?.op === 'from' && calls[0].args[0] === table)
    .flat();
}

function get(url: string): never {
  return { url: new URL(url).toString() } as never;
}

function jsonRequest(method: string, body: unknown): never {
  return new Request('https://app.test/api/announcements', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }) as never;
}

const post = (body: unknown) => jsonRequest('POST', body);
const patch = (body: unknown) => jsonRequest('PATCH', body);
const del = (body: unknown) => jsonRequest('DELETE', body);

const rows = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    id: `n-${index}`,
    type: 'announcement',
    title: `Title ${index}`,
    message: 'Body',
    is_read: false,
    created_at: `2026-10-0${(index % 9) + 1}T0${(index % 9) + 1}:00:00.000Z`,
    created_by: 'user-9',
    audience_type: 'church',
  }));

beforeEach(() => {
  vi.clearAllMocks();
  clientCalls = [];
  handlers = {};
  requireStaff.mockResolvedValue(auth);
  getAuthContext.mockResolvedValue(auth);

  // Audience resolution for the default { type: 'church' } publish path.
  handlers['members'] = (calls) => {
    if (lastCall(calls, 'in')) {
      // Named-members lookup: every requested id must come back.
      return { data: [{ id: MEMBER_ID_A, user_id: 'user-2' }] };
    }
    return { data: [{ user_id: 'user-2' }, { user_id: 'user-3' }] };
  };
  handlers['users'] = (calls) => ({
    data: lastCall(calls, 'in')
      ? [{ id: 'user-2' }, { id: 'user-3' }]
      : [],
  });

  handlers['notifications'] = (calls) => {
    const select = lastCall(calls, 'select');
    if (lastCall(calls, 'insert')) return { error: null };
    if (lastCall(calls, 'update')) return { data: [{ id: 'n-1' }] };
    if (select?.args[1] && typeof select.args[1] === 'object' && (select.args[1] as { count?: string }).count === 'exact') {
      return { count: 3, data: null };
    }
    return { data: rows(3), error: null };
  };
});

describe('GET /api/announcements — auth and tenant scope', () => {
  it('returns 401 without a session and never opens a client', async () => {
    getAuthContext.mockResolvedValue(null);

    const response = await GET(get('https://app.test/api/announcements'));

    expect(response.status).toBe(401);
    expect(clientCalls).toHaveLength(0);
  });

  it('scopes the feed to the authenticated user and church', async () => {
    await GET(get('https://app.test/api/announcements'));

    const calls = flattened('notifications');
    expect(calls.some((call) => call.op === 'eq' && call.args[0] === 'user_id' && call.args[1] === 'user-1')).toBe(true);
    expect(calls.some((call) => call.op === 'eq' && call.args[0] === 'church_id' && call.args[1] === 'church-1')).toBe(true);
  });

  it('hides removed rows from the feed and from the unread badge', async () => {
    await GET(get('https://app.test/api/announcements'));

    const calls = flattened('notifications');
    const dismissedFilters = calls.filter((call) => call.op === 'is' && call.args[0] === 'dismissed_at');
    // One on the feed query, one on the badge count query.
    expect(dismissedFilters).toHaveLength(2);
    expect(dismissedFilters.every((call) => call.args[1] === null)).toBe(true);
  });

  it('never reads a client-provided tenant id', async () => {
    await GET(get('https://app.test/api/announcements?church_id=church-evil'));

    expect(JSON.stringify(flattened('notifications'))).not.toContain('church-evil');
  });

  it('orders newest-first and asks for one row beyond the page', async () => {
    await GET(get('https://app.test/api/announcements'));

    const calls = flattened('notifications');
    expect(lastCall(calls, 'order')?.args).toEqual(['created_at', { ascending: false }]);
    expect(lastCall(calls, 'limit')?.args).toEqual([21]);
  });

  it('clamps an oversized limit instead of forwarding it', async () => {
    await GET(get('https://app.test/api/announcements?limit=500'));

    expect(lastCall(flattened('notifications'), 'limit')?.args).toEqual([51]);
  });

  it('rejects a malformed pagination cursor before touching the database', async () => {
    const response = await GET(get('https://app.test/api/announcements?before=not-a-date'));

    expect(response.status).toBe(400);
    expect(clientCalls).toHaveLength(0);
  });

  it('applies the cursor as a strict upper bound on created_at', async () => {
    await GET(get('https://app.test/api/announcements?before=2026-10-01T00:00:00.000Z'));

    const calls = flattened('notifications');
    expect(lastCall(calls, 'lt')?.args).toEqual(['created_at', '2026-10-01T00:00:00.000Z']);
  });

  it('counts unread rows separately so the badge is not limited to the page', async () => {
    await GET(get('https://app.test/api/announcements'));

    const calls = flattened('notifications');
    const countQuery = calls.find(
      (call) => call.op === 'select'
        && typeof call.args[1] === 'object'
        && (call.args[1] as { count?: string }).count === 'exact',
    );
    expect(countQuery).toBeDefined();
    expect(calls.some((call) => call.op === 'eq' && call.args[0] === 'is_read' && call.args[1] === false)).toBe(true);
  });

  it('trims the over-fetched row and reports the next cursor', async () => {
    handlers['notifications'] = (calls) => {
      const select = lastCall(calls, 'select');
      if (select?.args[1] && (select.args[1] as { count?: string }).count === 'exact') return { count: 40, data: null };
      return { data: rows(21), error: null };
    };

    const response = await GET(get('https://app.test/api/announcements'));
    const payload = await response.json() as { notifications: unknown[]; nextCursor: string; unreadCount: number };

    expect(response.status).toBe(200);
    expect(payload.notifications).toHaveLength(20);
    expect(payload.nextCursor).toBe(rows(21)[19].created_at);
    expect(payload.unreadCount).toBe(40);
  });

  it('reports no cursor when the last page fits', async () => {
    const response = await GET(get('https://app.test/api/announcements'));
    const payload = await response.json() as { notifications: unknown[]; nextCursor: string | null };

    expect(payload.notifications).toHaveLength(3);
    expect(payload.nextCursor).toBeNull();
  });

  it('returns 500 when the feed query fails', async () => {
    track('notifications', { data: null, error: { message: 'boom' } });

    const response = await GET(get('https://app.test/api/announcements'));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Could not load notifications.' });
  });
});

describe('POST /api/announcements — auth', () => {
  it('returns the requireStaff rejection untouched and never opens a client', async () => {
    const denied = Response.json({ error: 'Staff access required.' }, { status: 403 });
    requireStaff.mockResolvedValue(denied);

    const response = await POST(post({ title: 'T', message: 'M', audience: { type: 'church' } }));

    expect(response).toBe(denied);
    expect(clientCalls).toHaveLength(0);
  });
});

describe('POST /api/announcements — validation', () => {
  it('rejects malformed JSON with a 400 rather than a 500', async () => {
    const response = await POST(post('{not json'));

    expect(response.status).toBe(400);
    expect(clientCalls).toHaveLength(0);
  });

  it.each([
    ['a missing title', { message: 'M', audience: { type: 'church' } }],
    ['a whitespace-only title', { title: '   ', message: 'M', audience: { type: 'church' } }],
    ['a missing message', { title: 'T', audience: { type: 'church' } }],
    ['an unknown audience', { title: 'T', message: 'M', audience: { type: 'everyone' } }],
    ['an absent audience', { title: 'T', message: 'M' }],
    ['a ministry audience without a uuid', { title: 'T', message: 'M', audience: { type: 'ministry', ministry_id: 'nope' } }],
    ['a role audience with an invented role', { title: 'T', message: 'M', audience: { type: 'role', role: 'pastor' } }],
    ['a members audience with no ids', { title: 'T', message: 'M', audience: { type: 'members', member_ids: [] } }],
  ])('rejects %s before touching the database', async (_label, body) => {
    const response = await POST(post(body));

    expect(response.status).toBe(400);
    expect(clientCalls).toHaveLength(0);
  });

  it('rejects an over-long title and an over-long message', async () => {
    const tooLongTitle = await POST(post({ title: 'x'.repeat(256), message: 'M', audience: { type: 'church' } }));
    expect(tooLongTitle.status).toBe(400);

    const tooLongMessage = await POST(post({ title: 'T', message: 'x'.repeat(5001), audience: { type: 'church' } }));
    expect(tooLongMessage.status).toBe(400);
  });

  it('rejects a named member id that is not a uuid', async () => {
    const response = await POST(post({
      title: 'T', message: 'M', audience: { type: 'members', member_ids: ['not-a-uuid'] },
    }));

    expect(response.status).toBe(400);
    expect(lastCall(flattened('notifications'), 'insert')).toBeUndefined();
  });
});

describe('POST /api/announcements — publishing', () => {
  it('writes one row per recipient with church, type, author, and audience from the session', async () => {
    const response = await POST(post({ title: '  Hello  ', message: '  Body  ', audience: { type: 'church' } }));

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ announcement: { recipients: 2 } });

    const rowsWritten = lastCall(flattened('notifications'), 'insert')?.args[0] as Record<string, unknown>[];
    expect(rowsWritten).toHaveLength(2);
    expect(rowsWritten[0]).toEqual({
      user_id: 'user-2',
      church_id: 'church-1',
      type: 'announcement',
      title: 'Hello',
      message: 'Body',
      created_by: 'user-1',
      audience_type: 'church',
      announcement_id: expect.any(String),
    });
    expect(rowsWritten.map((row) => row.user_id)).toEqual(['user-2', 'user-3']);

    // Every recipient row of the broadcast shares one announcement_id, which
    // is what makes a whole-announcement delete possible later.
    expect(rowsWritten[0].announcement_id).toBeTruthy();
    expect(rowsWritten[0].announcement_id).toEqual(rowsWritten[1].announcement_id);

    // Coordinators are unioned into whole-church recipients server-side.
    expect(flattened('users').some((call) =>
      call.op === 'eq' && call.args[0] === 'role' && call.args[1] === 'coordinator',
    )).toBe(true);
  });

  it('takes the church from the auth context, never from the body', async () => {
    await POST(post({ title: 'T', message: 'M', audience: { type: 'church' }, church_id: 'church-evil' }));

    const rowsWritten = lastCall(flattened('notifications'), 'insert')?.args[0] as Record<string, unknown>[];
    expect(rowsWritten.every((row) => row.church_id === 'church-1')).toBe(true);
    expect(JSON.stringify(rowsWritten)).not.toContain('church-evil');
  });

  it('rejects a cross-tenant named member before writing anything', async () => {
    // The member lookup is church-scoped, so one foreign or inactive id means
    // fewer rows come back than were requested -- that mismatch is the reject.
    handlers['members'] = () => ({ data: [{ id: MEMBER_ID_A, user_id: 'user-2' }] });

    const response = await POST(post({
      title: 'T', message: 'M', audience: { type: 'members', member_ids: [MEMBER_ID_A, MEMBER_ID_B] },
    }));

    expect(response.status).toBe(400);
    expect(lastCall(flattened('notifications'), 'insert')).toBeUndefined();
  });

  it('rejects a ministry that belongs to another church before writing anything', async () => {
    handlers['ministries'] = () => ({ data: null, error: null });

    const response = await POST(post({
      title: 'T', message: 'M', audience: { type: 'ministry', ministry_id: MINISTRY_ID },
    }));

    expect(response.status).toBe(400);
    expect(lastCall(flattened('notifications'), 'insert')).toBeUndefined();
  });

  it('rejects an audience that resolves to nobody', async () => {
    handlers['members'] = () => ({ data: [] });

    const response = await POST(post({ title: 'T', message: 'M', audience: { type: 'church' } }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'The selected audience has no recipients.' });
    expect(lastCall(flattened('notifications'), 'insert')).toBeUndefined();
  });

  it('returns 500 when the insert fails', async () => {
    handlers['notifications'] = (calls) =>
      lastCall(calls, 'insert') ? { data: null, error: { message: 'boom' } } : { data: [], error: null };

    const response = await POST(post({ title: 'T', message: 'M', audience: { type: 'church' } }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Could not publish the announcement.' });
  });
});

describe('PATCH /api/announcements — marking read', () => {
  it('returns 401 without a session and never opens a client', async () => {
    getAuthContext.mockResolvedValue(null);

    const response = await PATCH(patch({ ids: [MEMBER_ID_A] }));

    expect(response.status).toBe(401);
    expect(clientCalls).toHaveLength(0);
  });

  it('scopes the update to the caller own rows', async () => {
    const response = await PATCH(patch({ ids: [MEMBER_ID_A] }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ updated: 1 });

    const calls = flattened('notifications');
    expect(lastCall(calls, 'update')?.args).toEqual([{ is_read: true }]);
    expect(calls.some((call) => call.op === 'eq' && call.args[0] === 'user_id' && call.args[1] === 'user-1')).toBe(true);
    expect(calls.some((call) => call.op === 'eq' && call.args[0] === 'church_id' && call.args[1] === 'church-1')).toBe(true);
    expect(lastCall(calls, 'in')?.args).toEqual(['id', [MEMBER_ID_A]]);
  });

  it('marks every unread row when all is set, without an id filter', async () => {
    const response = await PATCH(patch({ all: true }));

    expect(response.status).toBe(200);
    const calls = flattened('notifications');
    expect(lastCall(calls, 'update')?.args).toEqual([{ is_read: true }]);
    expect(lastCall(calls, 'in')).toBeUndefined();
  });

  it.each([
    ['an empty body', {}],
    ['an empty id list', { ids: [] }],
    ['a non-array id list', { ids: 'everything' }],
    ['a non-uuid id', { ids: ['not-a-uuid'] }],
    ['neither ids nor all', { nonsense: true }],
  ])('rejects %s with a 400 before touching the database', async (_label, body) => {
    const response = await PATCH(patch(body));

    expect(response.status).toBe(400);
    expect(clientCalls).toHaveLength(0);
  });

  it('rejects malformed JSON with a 400', async () => {
    const response = await PATCH(patch('{not json'));

    expect(response.status).toBe(400);
    expect(clientCalls).toHaveLength(0);
  });

  it('returns 500 when the update fails', async () => {
    track('notifications', { data: null, error: { message: 'boom' } });

    const response = await PATCH(patch({ all: true }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Could not update the notifications.' });
  });
});

describe('PATCH /api/announcements — removing from the list', () => {
  it('stamps dismissed_at on the caller own rows instead of deleting them', async () => {
    const response = await PATCH(patch({ action: 'dismiss', ids: [MEMBER_ID_A] }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ updated: 1 });

    const calls = flattened('notifications');
    const update = lastCall(calls, 'update')?.args[0] as Record<string, unknown>;
    expect(update.is_read).toBeUndefined();
    expect(typeof update.dismissed_at).toBe('string');
    expect(calls.some((call) => call.op === 'eq' && call.args[0] === 'user_id' && call.args[1] === 'user-1')).toBe(true);
    expect(calls.some((call) => call.op === 'eq' && call.args[0] === 'church_id' && call.args[1] === 'church-1')).toBe(true);
    expect(lastCall(calls, 'in')?.args).toEqual(['id', [MEMBER_ID_A]]);
    expect(lastCall(calls, 'delete')).toBeUndefined();
  });

  it('rejects a dismiss-all request, because removal is always per selected item', async () => {
    const response = await PATCH(patch({ action: 'dismiss', all: true }));

    expect(response.status).toBe(400);
    expect(clientCalls).toHaveLength(0);
  });

  it('rejects a dismiss without ids', async () => {
    const response = await PATCH(patch({ action: 'dismiss' }));

    expect(response.status).toBe(400);
    expect(clientCalls).toHaveLength(0);
  });

  it('returns 500 when the dismiss update fails', async () => {
    track('notifications', { data: null, error: { message: 'boom' } });

    const response = await PATCH(patch({ action: 'dismiss', ids: [MEMBER_ID_A] }));

    expect(response.status).toBe(500);
  });
});

describe('DELETE /api/announcements — staff hard delete', () => {
  it('returns the requireStaff rejection untouched and never opens a client', async () => {
    const denied = Response.json({ error: 'Staff access required.' }, { status: 403 });
    requireStaff.mockResolvedValue(denied);

    const response = await DELETE(del({ announcement_ids: [MEMBER_ID_A] }));

    expect(response).toBe(denied);
    expect(clientCalls).toHaveLength(0);
  });

  it('deletes every row of the announcement within the caller church only', async () => {
    handlers['notifications'] = (calls) =>
      lastCall(calls, 'delete') ? { data: [{ id: 'n-1' }, { id: 'n-2' }], error: null } : { data: [], error: null };

    const response = await DELETE(del({ announcement_ids: [MEMBER_ID_A, MEMBER_ID_A, MEMBER_ID_B] }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ deleted: 2 });

    const calls = flattened('notifications');
    expect(lastCall(calls, 'delete')).toBeDefined();
    expect(calls.some((call) => call.op === 'eq' && call.args[0] === 'church_id' && call.args[1] === 'church-1')).toBe(true);
    // Duplicate ids collapse to one in-list entry.
    const inCall = lastCall(calls, 'in');
    expect(inCall?.args?.[0]).toBe('announcement_id');
    expect(inCall?.args?.[1]).toEqual([MEMBER_ID_A, MEMBER_ID_B]);
    expect(JSON.stringify(calls)).not.toContain('church-evil');
  });

  it.each([
    ['an empty body', {}],
    ['an empty id list', { announcement_ids: [] }],
    ['a non-array id list', { announcement_ids: 'everything' }],
    ['a non-uuid id', { announcement_ids: ['not-a-uuid'] }],
  ])('rejects %s with a 400 before touching the database', async (_label, body) => {
    const response = await DELETE(del(body));

    expect(response.status).toBe(400);
    expect(clientCalls).toHaveLength(0);
  });

  it('rejects malformed JSON with a 400', async () => {
    const response = await DELETE(del('{not json'));

    expect(response.status).toBe(400);
    expect(clientCalls).toHaveLength(0);
  });

  it('returns 500 when the delete fails', async () => {
    track('notifications', { data: null, error: { message: 'boom' } });

    const response = await DELETE(del({ announcement_ids: [MEMBER_ID_A] }));

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: 'Could not delete the announcement.' });
  });
});
