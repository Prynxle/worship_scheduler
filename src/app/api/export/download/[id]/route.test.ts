import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

/**
 * Route-level contract tests for `GET /api/export/download/[id]`.
 *
 * The route streams a previously generated PDF back to the authenticated user.
 * The row is looked up by id AND church_id: an export belonging to another
 * church is indistinguishable from one that does not exist (404), so the
 * tenant boundary cannot be crossed by guessing an id.
 */

const requireStaff = vi.fn();
const getAdminClient = vi.fn();

vi.mock('@/lib/auth/server', () => ({
  requireStaff: (request: Request) => requireStaff(request),
  getAdminClient: () => getAdminClient(),
}));

const auth = { userId: 'user-1', churchId: 'church-1' } as never;

const maybeSingle = vi.fn();
const eq = vi.fn(() => ({ eq, maybeSingle }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));
function mockAdmin() {
  getAdminClient.mockReturnValue({ from });
}

function getRequest(id: string) {
  return GET(new Request('https://app.test/api/export/download/' + id) as never, {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireStaff.mockResolvedValue(auth);
  maybeSingle.mockResolvedValue({ data: null, error: null });
  mockAdmin();
});

describe('GET /api/export/download/[id]', () => {
  it('requires staff auth (403)', async () => {
    requireStaff.mockResolvedValue(new Response(null, { status: 403 }));
    const response = await getRequest('3f8a9b0c-1111-4222-8333-444455556666');
    expect(response.status).toBe(403);
    expect(from).not.toHaveBeenCalled();
  });

  it('returns 404 for a malformed id without querying', async () => {
    const response = await getRequest('not-a-uuid');
    expect(response.status).toBe(404);
    expect(from).not.toHaveBeenCalled();
  });

  it('returns 404 when the export does not belong to the church', async () => {
    // A foreign-church row is never returned, so maybeSingle resolves null.
    const response = await getRequest('3f8a9b0c-1111-4222-8333-444455556666');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Export not found.' });
    // The tenant scope is enforced at query time, not just at response time.
    expect(eq).toHaveBeenCalledWith('church_id', 'church-1');
  });

  it('streams the stored PDF bytes back with a download filename', async () => {
    const bytes = [1, 2, 3, 4];
    maybeSingle.mockResolvedValue({
      data: {
        filename: 'schedule-10-2026.pdf',
        file_size: 4,
        file_data_base64: Buffer.from(bytes).toString('base64'),
      },
      error: null,
    });

    const response = await getRequest('3f8a9b0c-1111-4222-8333-444455556666');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('content-disposition')).toContain('filename="schedule-10-2026.pdf"');
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual(bytes);
  });

  it('maps a database error to 500', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const response = await getRequest('3f8a9b0c-1111-4222-8333-444455556666');
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Could not load the export.' });
  });
});