import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { getAuthContext, getAdminClient, rpc, maybeSingle } = vi.hoisted(() => ({ getAuthContext: vi.fn(), getAdminClient: vi.fn(), rpc: vi.fn(), maybeSingle: vi.fn() }));
vi.mock('@/lib/auth/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/server')>()),
  getAuthContext: (...args: unknown[]) => getAuthContext(...args),
  getAdminClient: (...args: unknown[]) => getAdminClient(...args),
}));
vi.mock('@/lib/song-lineups/urls', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/song-lineups/urls')>()),
  parseHttpUrl: (value: unknown) => typeof value === 'string' && value.startsWith('https://') ? value : null,
}));

import { PATCH } from './route';

const coordinator = { authId: 'auth-coordinator', userId: 'coordinator', memberId: null, churchId: 'church-1', fullName: 'Coordinator', memberName: null, phone: null, role: 'coordinator' as const };
function request(body: unknown) { return new NextRequest('http://localhost/api/song-lineups/service-1', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); }

describe('PATCH /api/song-lineups/[serviceId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthContext.mockResolvedValue(coordinator);
    maybeSingle.mockResolvedValue({ data: { id: 'service-1' }, error: null });
    rpc.mockResolvedValue({ data: null, error: null });
    const query = { select: vi.fn(() => query), eq: vi.fn(() => query), maybeSingle };
    getAdminClient.mockReturnValue({ from: vi.fn(() => query), rpc });
  });

  it('denies member accounts before accessing the service', async () => {
    getAuthContext.mockResolvedValue({ ...coordinator, role: 'member', memberId: 'member-1' });
    const response = await PATCH(request({ action: 'confirm' }), { params: Promise.resolve({ serviceId: 'service-1' }) });
    expect(response.status).toBe(403);
    expect(getAdminClient).not.toHaveBeenCalled();
  });

  it('validates the service against the authenticated church', async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    const response = await PATCH(request({ action: 'confirm' }), { params: Promise.resolve({ serviceId: 'service-other' }) });
    expect(response.status).toBe(404);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('confirms the service lineup without making submission a prerequisite', async () => {
    const response = await PATCH(request({ action: 'confirm' }), { params: Promise.resolve({ serviceId: 'service-1' }) });
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('review_song_lineup', expect.objectContaining({ p_church_id: 'church-1', p_service_id: 'service-1', p_action: 'confirm' }));
  });

  it('allows coordinators to clear a chords link with null', async () => {
    const response = await PATCH(request({ action: 'enrich', songs: [{ id: 'song-1', musical_key: 'Bb', chords_url: '' }] }), { params: Promise.resolve({ serviceId: 'service-1' }) });
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('review_song_lineup', expect.objectContaining({ p_songs: [{ id: 'song-1', musical_key: 'Bb', chords_url: null }] }));
  });

  it('rejects unsafe chords URLs before a database write', async () => {
    const response = await PATCH(request({ action: 'enrich', songs: [{ id: 'song-1', chords_url: 'javascript:alert(1)' }] }), { params: Promise.resolve({ serviceId: 'service-1' }) });
    expect(response.status).toBe(400);
    expect(getAdminClient).not.toHaveBeenCalled();
  });
});
