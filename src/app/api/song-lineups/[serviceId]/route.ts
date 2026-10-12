import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient, getAuthContext, isStaff } from '@/lib/auth/server';
import { parseHttpUrl } from '@/lib/song-lineups/urls';

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ serviceId: string }> }) {
  const auth = await getAuthContext(request);
  if (!auth) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
  if (!isStaff(auth.role)) return NextResponse.json({ error: 'Coordinator access required.' }, { status: 403 });
  const { serviceId } = await params;
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return NextResponse.json({ error: 'The request body must be valid JSON.' }, { status: 400 }); }
  const action = body.action;
  if (!['confirm', 'withdraw', 'enrich'].includes(String(action))) return NextResponse.json({ error: 'Choose a valid lineup action.' }, { status: 400 });
  let songs: Array<{ id: string; musical_key: string | null; chords_url: string | null }> | null = null;
  if (action === 'enrich') {
    if (!Array.isArray(body.songs) || body.songs.length > 30) return NextResponse.json({ error: 'Song details are invalid.' }, { status: 400 });
    songs = [];
    for (const raw of body.songs) {
      if (!raw || typeof raw !== 'object') return NextResponse.json({ error: 'Song details are invalid.' }, { status: 400 });
      const song = raw as Record<string, unknown>;
      const chords = song.chords_url === '' || song.chords_url == null ? null : parseHttpUrl(song.chords_url);
      if (typeof song.id !== 'string' || (song.chords_url != null && song.chords_url !== '' && !chords)
        || (song.musical_key != null && typeof song.musical_key !== 'string')
        || (typeof song.musical_key === 'string' && song.musical_key.trim().length > 32)) {
        return NextResponse.json({ error: 'Enter a valid musical key and optional HTTP or HTTPS chords URL.' }, { status: 400 });
      }
      songs.push({ id: song.id, musical_key: typeof song.musical_key === 'string' ? song.musical_key.trim() || null : null, chords_url: chords });
    }
  }
  const admin = getAdminClient();
  const { data: service, error: serviceError } = await admin.from('services').select('id').eq('id', serviceId).eq('church_id', auth.churchId).maybeSingle();
  if (serviceError) return NextResponse.json({ error: 'Could not verify the service.' }, { status: 500 });
  if (!service) return NextResponse.json({ error: 'Service not found.' }, { status: 404 });
  const { error } = await admin.rpc('review_song_lineup', {
    p_church_id: auth.churchId, p_service_id: serviceId, p_action: action, p_songs: songs,
  });
  if (error) return NextResponse.json({ error: error.code === 'P0002' ? 'Active lineup not found.' : 'Could not update the song lineup.' }, { status: error.code === 'P0002' ? 404 : 500 });
  return NextResponse.json({ status: 'ok' });
}
