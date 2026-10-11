import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { getAuthContext, getAdminClient, verifyReachableHttpUrl } = vi.hoisted(() => ({ getAuthContext: vi.fn(), getAdminClient: vi.fn(), verifyReachableHttpUrl: vi.fn() }));
vi.mock('@/lib/auth/server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/auth/server')>()),
  getAuthContext: (...args: unknown[]) => getAuthContext(...args),
  getAdminClient: (...args: unknown[]) => getAdminClient(...args),
}));
vi.mock('@/lib/song-lineups/urls', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/song-lineups/urls')>()), verifyReachableHttpUrl: (...args: unknown[]) => verifyReachableHttpUrl(...args) }));

import { POST } from './route';

const auth = { authId: 'auth-1', userId: 'user-1', memberId: 'member-1', churchId: 'church-1', fullName: 'Leader', memberName: 'Leader', phone: null, role: 'member' as const };
const songs = [
  { title: 'Song One', song_url: 'https://example.com/one' },
  { title: 'Song Two', song_url: 'https://example.com/two' },
];

function makeRequest(body: unknown) {
  return new NextRequest('http://localhost/api/song-lineups', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}

describe('POST /api/song-lineups', () => {
  const maybeSingle = vi.fn();
  const rpc = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    getAuthContext.mockResolvedValue(auth);
    verifyReachableHttpUrl.mockResolvedValue(true);
    maybeSingle.mockResolvedValue({ data: { service_id: 'service-1', member_id: 'member-1', is_leader: true, service: { church_id: 'church-1' } }, error: null });
    const query = { select: vi.fn(() => query), eq: vi.fn(() => query), maybeSingle };
    rpc.mockResolvedValue({ data: 'lineup-1', error: null });
    getAdminClient.mockReturnValue({ from: vi.fn(() => query), rpc });
  });

  it('requires a bearer-authenticated member', async () => {
    getAuthContext.mockResolvedValue(null);
    const response = await POST(makeRequest({ service_id: 'service-1', songs }));
    expect(response.status).toBe(401);
    expect(getAdminClient).not.toHaveBeenCalled();
  });

  it('rejects fewer than two songs before looking up an assignment', async () => {
    const response = await POST(makeRequest({ service_id: 'service-1', songs: songs.slice(0, 1) }));
    expect(response.status).toBe(400);
    expect(maybeSingle).not.toHaveBeenCalled();
  });

  it('rejects a leader assignment from another church', async () => {
    maybeSingle.mockResolvedValue({ data: { ...auth, is_leader: true, service: { church_id: 'church-other' } }, error: null });
    const response = await POST(makeRequest({ service_id: 'service-1', songs }));
    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('submits reachable songs for the assigned service using server-resolved tenant and member ids', async () => {
    const response = await POST(makeRequest({ service_id: 'service-1', church_id: 'church-other', member_id: 'member-other', songs }));
    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith('save_song_lineup', expect.objectContaining({ p_church_id: 'church-1', p_service_id: 'service-1', p_member_id: 'member-1' }));
  });

  it('does not save a song URL that fails safe reachability verification', async () => {
    verifyReachableHttpUrl.mockResolvedValue(false);
    const response = await POST(makeRequest({ service_id: 'service-1', songs }));
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});
