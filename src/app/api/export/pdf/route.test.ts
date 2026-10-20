import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './route';
import type { Service } from '@/lib/types/database';

/**
 * Route-level contract tests for `POST /api/export/pdf`.
 *
 * Beyond generating the PDF bytes, the route persists every successful export
 * to `church_exports` so the Exports page can list and re-download it. The
 * stored bytes are base64 TEXT (the route encodes them explicitly; PostgREST
 * does not decode JSON base64 into bytea). Recording is non-fatal: if the
 * insert fails the direct download must still succeed.
 */

const requireStaff = vi.fn();
const getAdminClient = vi.fn();
const loadScheduleData = vi.fn();
const transformServiceAssignments = vi.fn();
const generateSchedulePDF = vi.fn();

vi.mock('@/lib/auth/server', () => ({
  requireStaff: (request: Request) => requireStaff(request),
  getAdminClient: () => getAdminClient(),
}));

vi.mock('@/lib/scheduling/schedule-data', () => ({
  loadScheduleData: (churchId: string, month: number, year: number) =>
    loadScheduleData(churchId, month, year),
}));

vi.mock('@/lib/scheduling/service-transform', () => ({
  transformServiceAssignments: (service: Service, assignments: unknown[]) =>
    transformServiceAssignments(service, assignments),
}));

vi.mock('@/lib/export/pdf', () => ({
  generateSchedulePDF: (data: unknown) => generateSchedulePDF(data),
}));

const auth = { userId: 'user-1', churchId: 'church-1' } as never;

const insert = vi.fn();
const maybeSingle = vi.fn();
function mockAdmin() {
  getAdminClient.mockReturnValue({
    from: vi.fn((table: string) =>
      table === 'church_exports'
        ? { insert }
        : { select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle })) })) }
    ),
  });
}

function storedService(overrides: Partial<Service> = {}): Service {
  return {
    id: 'service-w1', church_id: 'church-1', ministry_id: 'ministry-1',
    date: '2026-10-04', week_number: 3, month: 9, year: 2026,
    service_type: 'sunday', status: 'published', schedule_version: 2,
    unfilled_positions: [], active_overrides: {}, created_at: '', updated_at: '',
    ...overrides,
  } as Service;
}

function postRequest(body: unknown) {
  return new Request('https://app.test/api/export/pdf', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }) as never;
}

function callPost(body: unknown = { month: 9, year: 2026 }) {
  return POST(postRequest(body));
}

function lastInsertCall() {
  return insert.mock.calls[0][0] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  requireStaff.mockResolvedValue(auth);
  loadScheduleData.mockResolvedValue({
    services: [storedService()],
    assignments: [],
    members: [], roles: [], instruments: [], rules: [], config: {}, monthlyAssignments: [],
  });
  transformServiceAssignments.mockImplementation((service: Service) => service);
  generateSchedulePDF.mockReturnValue({ output: vi.fn().mockReturnValue(new ArrayBuffer(6)) });
  insert.mockResolvedValue({ error: null });
  maybeSingle.mockResolvedValue({ data: { name: 'Test Church', logo_url: null }, error: null });
  mockAdmin();
});

describe('POST /api/export/pdf', () => {
  it('requires staff auth (403 before any parsing)', async () => {
    requireStaff.mockResolvedValue(new Response(null, { status: 403 }));
    const response = await callPost();
    expect(response.status).toBe(403);
    expect(insert).not.toHaveBeenCalled();
  });

  it('rejects an out-of-range month or missing year', async () => {
    expect((await callPost({ month: 12, year: 2026 })).status).toBe(400);
    expect((await callPost({ month: 9 })).status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });

  it('refuses to export when nothing is published or validated', async () => {
    loadScheduleData.mockResolvedValue({
      services: [storedService({ status: 'draft' })],
      assignments: [],
      members: [], roles: [], instruments: [], rules: [], config: {}, monthlyAssignments: [],
    });
    const response = await callPost();
    expect(response.status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });

  it('streams the PDF and persists a tenant-scoped export record', async () => {
    const response = await callPost();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect((await response.arrayBuffer()).byteLength).toBe(6);

    const record = lastInsertCall();
    expect(record).toMatchObject({
      church_id: 'church-1',
      created_by: 'user-1',
      month: 9,
      year: 2026,
      week_numbers: null,
      format: 'pdf',
      filename: 'schedule-10-2026.pdf',
      file_size: 6,
    });
    // The stored file survives a base64 round-trip back to the original bytes.
    expect(Buffer.from(String(record.file_data_base64), 'base64').byteLength).toBe(6);
  });

  it('records the exported week numbers when a week filter is applied', async () => {
    loadScheduleData.mockResolvedValue({
      services: [
        storedService({ id: 'w3', week_number: 3 }),
        storedService({ id: 'w4', week_number: 4, date: '2026-10-11' }),
      ],
      assignments: [],
      members: [], roles: [], instruments: [], rules: [], config: {}, monthlyAssignments: [],
    });
    const response = await callPost({ month: 9, year: 2026, week_numbers: [3] });
    expect(response.status).toBe(200);
    expect(lastInsertCall().week_numbers).toEqual([3]);
  });

  it('keeps the download working even when recording the export fails', async () => {
    insert.mockRejectedValue(new Error('database unavailable'));
    const response = await callPost();
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
  });
});