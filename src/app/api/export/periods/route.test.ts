import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

/**
 * Route-level contract tests for `GET /api/export/periods`.
 *
 * The picker's options must come from real schedule data: only services that
 * the export will actually accept (published/validated), scoped to the
 * authenticated church, with the week numbers grouped under their year+month so
 * the year can never be assumed.
 */

const requireStaff = vi.fn();
const getAdminClient = vi.fn();

vi.mock('@/lib/auth/server', () => ({
  requireStaff: (request: Request) => requireStaff(request),
  getAdminClient: () => getAdminClient(),
}));

const auth = { userId: 'user-1', churchId: 'church-1' } as never;

const inRows = vi.fn();
const eq = vi.fn(() => ({ in: inRows }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));
function mockAdmin() {
  getAdminClient.mockReturnValue({ from });
}

function getRequest() {
  return GET(new Request('https://app.test/api/export/periods') as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  requireStaff.mockResolvedValue(auth);
  inRows.mockResolvedValue({ data: [], error: null });
  mockAdmin();
});

describe('GET /api/export/periods', () => {
  it('requires staff auth (403 before any query)', async () => {
    requireStaff.mockResolvedValue(new Response(null, { status: 403 }));
    const response = await getRequest();
    expect(response.status).toBe(403);
    expect(from).not.toHaveBeenCalled();
  });

  it('returns no periods when nothing is validated or published', async () => {
    const response = await getRequest();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ periods: [] });
  });

  it('scopes to the church and to published/validated services only', async () => {
    await getRequest();
    expect(eq).toHaveBeenCalledWith('church_id', 'church-1');
    expect(inRows).toHaveBeenCalledWith('status', ['published', 'validated']);
  });

  it('groups distinct weeks under their year and month, sorted', async () => {
    inRows.mockResolvedValue({
      data: [
        { month: 9, year: 2026, week_number: 1 },
        { month: 8, year: 2026, week_number: 2 },
        { month: 8, year: 2026, week_number: 1 },
        { month: 8, year: 2026, week_number: 1 },
      ],
      error: null,
    });
    const response = await getRequest();
    const body = (await response.json()) as { periods: { month: number; year: number; weeks: number[] }[] };

    expect(response.status).toBe(200);
    expect(body.periods).toEqual([
      { month: 8, year: 2026, weeks: [1, 2] },
      { month: 9, year: 2026, weeks: [1] },
    ]);
  });

  it('keeps different years of the same month distinct', async () => {
    inRows.mockResolvedValue({
      data: [
        { month: 8, year: 2027, week_number: 1 },
        { month: 8, year: 2026, week_number: 1 },
      ],
      error: null,
    });
    const response = await getRequest();
    const body = (await response.json()) as { periods: { month: number; year: number }[] };
    expect(body.periods).toEqual([
      { month: 8, year: 2026, weeks: [1] },
      { month: 8, year: 2027, weeks: [1] },
    ]);
  });

  it('maps a database error to 500', async () => {
    inRows.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const response = await getRequest();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Could not load the months available for export.' });
  });
});
