import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

/**
 * Route-level contract tests for `GET /api/export/list`.
 *
 * The list is metadata only: it must never select `file_data_base64` (the
 * stored bytes only leave the server through the download route), it must be
 * scoped to the authenticated church, and it returns newest-first.
 */

const requireStaff = vi.fn();
const getAdminClient = vi.fn();

vi.mock('@/lib/auth/server', () => ({
  requireStaff: (request: Request) => requireStaff(request),
  getAdminClient: () => getAdminClient(),
}));

const auth = { userId: 'user-1', churchId: 'church-1' } as never;

const limit = vi.fn();
const order = vi.fn(() => ({ limit }));
const eq = vi.fn(() => ({ order }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));
function mockAdmin() {
  getAdminClient.mockReturnValue({ from });
}

const row = {
  id: 'exp-1', month: 9, year: 2026, week_numbers: [3], format: 'pdf',
  filename: 'schedule-10-2026.pdf', file_size: 128, created_by: 'user-1',
  created_at: '2026-10-12T00:00:00.000Z',
};

function getRequest() {
  return GET(new Request('https://app.test/api/export/list') as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  requireStaff.mockResolvedValue(auth);
  limit.mockResolvedValue({ data: [], error: null });
  mockAdmin();
});

describe('GET /api/export/list', () => {
  it('requires staff auth (403 before any query)', async () => {
    requireStaff.mockResolvedValue(new Response(null, { status: 403 }));
    const response = await getRequest();
    expect(response.status).toBe(403);
    expect(from).not.toHaveBeenCalled();
  });

  it('returns an empty list when the church has no exports', async () => {
    const response = await getRequest();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ exports: [] });
  });

  it('returns the church exports newest first, scoped to the church', async () => {
    limit.mockResolvedValue({ data: [row, { ...row, id: 'exp-2' }], error: null });
    const response = await getRequest();
    const body = (await response.json()) as { exports: unknown[] };

    expect(response.status).toBe(200);
    expect(body.exports).toHaveLength(2);
    expect(eq).toHaveBeenCalledWith('church_id', 'church-1');
    expect(order).toHaveBeenCalledWith('created_at', { ascending: false });
  });

  it('never selects the stored file bytes', () => {
    const selectArgs = select.mock.calls.map((call) => String(call[0]));
    expect(selectArgs.join(',')).not.toContain('file_data_base64');
  });

  it('maps a database error to 500', async () => {
    limit.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const response = await getRequest();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Could not load recent exports.' });
  });
});