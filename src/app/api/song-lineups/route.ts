import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient, getAuthContext, isStaff } from '@/lib/auth/server';
import { jsonError as apiJsonError } from '@/lib/api/errors';
import { isStaleDraft } from '@/lib/scheduling/availability-reset';
import { formatLocalDate } from '@/lib/utils/date-utils';
import { parseHttpUrl, verifyReachableHttpUrl } from '@/lib/song-lineups/urls';
import { checkRateLimit } from '@/lib/api/rate-limit';

/**
 * `schedule_pending_regeneration`: the month's availability was reset after
 * this service's draft was generated, so the schedule is out of date. Fixed
 * copy, shared with the other lifecycle routes byte for byte.
 */
const STALE_SERVICE_MESSAGE = 'The availability for this month was reset. This schedule is out of date and does not accept songs until it is regenerated.';

type SongInput = { title: string; song_url: string; musical_key?: string | null; chords_url?: string | null };

function jsonError(error: string, status: number) { return NextResponse.json({ error }, { status }); }
function firstRelation<T>(value: T | T[] | null | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value ?? undefined;
}

function parseSongs(value: unknown): SongInput[] | null {
  if (!Array.isArray(value) || value.length < 2 || value.length > 30) return null;
  const songs: SongInput[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return null;
    const song = raw as Record<string, unknown>;
    if (typeof song.title !== 'string' || song.title.trim().length < 1 || song.title.trim().length > 200) return null;
    const songUrl = parseHttpUrl(song.song_url);
    const chordsUrl = song.chords_url == null || song.chords_url === '' ? null : parseHttpUrl(song.chords_url);
    if (!songUrl || (song.chords_url != null && song.chords_url !== '' && !chordsUrl)) return null;
    if (song.musical_key != null && (typeof song.musical_key !== 'string' || song.musical_key.trim().length > 32)) return null;
    songs.push({ title: song.title.trim(), song_url: songUrl, musical_key: typeof song.musical_key === 'string' ? song.musical_key.trim() || null : null, chords_url: chordsUrl });
  }
  return songs;
}

export async function GET(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) return jsonError('Authentication required.', 401);
  if (!isStaff(auth.role) && (!auth.memberId || auth.role !== 'member')) return jsonError('Member access required.', 403);
  const params = request.nextUrl.searchParams;
  const month = Number(params.get('month'));
  const year = Number(params.get('year'));
  if (!Number.isInteger(month) || month < 0 || month > 11 || !Number.isInteger(year) || year < 2000 || year > 2100) return jsonError('Month and year are required.', 400);

  const admin = getAdminClient();
  // Exactly the complement of `isStaleDraft`: a service is hidden only while its
  // stamp is a live, future-dated invalidation. Once the date passes the stamp can
  // no longer be cleared by regeneration, so the week becomes readable again — the
  // same scope every write guard and `isStaleDraft` already applies. PostgREST
  // ANDs this top-level `or` with the `.eq()`/`.neq()` filters above. The date is
  // server-generated, never client input, so it adds no injection surface.
  let serviceQuery = admin.from('services').select('id, date, week_number, status').eq('church_id', auth.churchId).eq('month', month).eq('year', year).neq('status', 'archived').or(`availability_reset_at.is.null,date.lt.${formatLocalDate(new Date())}`);
  if (!isStaff(auth.role)) {
    const { data: assignments, error } = await admin.from('schedule_assignments').select('service_id').eq('member_id', auth.memberId!);
    if (error) return jsonError('Could not load your assigned services.', 500);
    const ids = [...new Set((assignments ?? []).map((item) => item.service_id))];
    if (!ids.length) return NextResponse.json({ services: [] });
    serviceQuery = serviceQuery.in('id', ids);
  }
  const { data: services, error: serviceError } = await serviceQuery.order('date');
  if (serviceError) return jsonError('Could not load service lineups.', 500);
  if (!services?.length) return NextResponse.json({ services: [] });
  const serviceIds = services.map((service) => service.id);
  const [{ data: lineups, error: lineupError }, { data: assignments, error: assignmentError }] = await Promise.all([
    admin.from('song_lineups').select('id, service_id, submitted_by_member_id, status, submitted_at, confirmed_at, withdrawn_at, updated_at, songs:song_lineup_songs(id, title, song_url, musical_key, chords_url, position)').eq('church_id', auth.churchId).in('service_id', serviceIds),
    admin.from('schedule_assignments').select('service_id, member_id, is_leader, instrument_id, member:members(full_name), role:roles(name), instrument:instruments(name)').in('service_id', serviceIds),
  ]);
  if (lineupError || assignmentError) return jsonError('Could not load service lineups.', 500);
  const assignmentGroups = new Map<string, typeof assignments>();
  for (const assignment of assignments ?? []) assignmentGroups.set(assignment.service_id, [...(assignmentGroups.get(assignment.service_id) ?? []), assignment]);
  const lineupByServiceId = new Map((lineups ?? []).map((lineup) => [lineup.service_id, lineup]));
  return NextResponse.json({ services: services.map((service) => {
    const rawLineup = lineupByServiceId.get(service.id);
    const lineup = rawLineup && (isStaff(auth.role) || rawLineup.status !== 'withdrawn') ? rawLineup : null;
    const people = assignmentGroups.get(service.id) ?? [];
    return {
      service_id: service.id,
      date: service.date,
      week_number: service.week_number,
      schedule_status: service.status,
      is_leader: auth.memberId ? people.some((item) => item.member_id === auth.memberId && item.is_leader) : false,
      leader_name: firstRelation(people.find((item) => item.is_leader)?.member)?.full_name ?? 'Unassigned',
      instrumentalists: people.filter((item) => item.instrument_id).map((item) => ({ name: firstRelation(item.member)?.full_name ?? 'Unknown', instrument: firstRelation(item.instrument)?.name ?? 'Instrument' })),
      backups: people.filter((item) => !item.is_leader && !item.instrument_id && /backup|singer/i.test(firstRelation(item.role)?.name ?? '')).map((item) => firstRelation(item.member)?.full_name ?? 'Unknown'),
      lineup: lineup ? { ...lineup, songs: [...(lineup.songs ?? [])].sort((a, b) => a.position - b.position) } : null,
    };
  }) });
}

export async function POST(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) return jsonError('Authentication required.', 401);
  if (!auth.memberId) return jsonError('An active member profile is required.', 403);
  const rateLimit = checkRateLimit(`song-lineup:${auth.authId}`);
  if (!rateLimit.ok) return NextResponse.json({ error: 'Too many lineup submissions. Please wait before trying again.' }, { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfterSeconds) } });
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return jsonError('The request body must be valid JSON.', 400); }
  if (typeof body.service_id !== 'string') return jsonError('A service is required.', 400);
  const songs = parseSongs(body.songs);
  if (!songs) return jsonError('Add at least two songs with a title and valid HTTP or HTTPS URL.', 400);

  const admin = getAdminClient();
  const { data: assignment, error: assignmentError } = await admin.from('schedule_assignments').select('service_id, member_id, is_leader, service:services(church_id, availability_reset_at, date)').eq('service_id', body.service_id).eq('member_id', auth.memberId).eq('is_leader', true).maybeSingle();
  if (assignmentError) return jsonError('Could not verify your worship leader assignment.', 500);
  const assignedService = firstRelation(assignment?.service);
  if (!assignment || assignedService?.church_id !== auth.churchId) return jsonError('You are not assigned to lead this service.', 403);
  // `date` travels with the stamp so the predicate can apply its date scope: a
  // stamp on a week that has already passed is ignored everywhere, because
  // regeneration cannot reach a past week and would never clear it.
  if (isStaleDraft({
    availability_reset_at: assignedService?.availability_reset_at ?? null,
    date: assignedService?.date ?? '',
  })) {
    return apiJsonError(409, 'schedule_pending_regeneration', STALE_SERVICE_MESSAGE);
  }

  if (!(await Promise.all(songs.map((song) => verifyReachableHttpUrl(song.song_url)))).every(Boolean)) return jsonError('A song link could not be verified as reachable. Check the URL and try again.', 400);
  const { data: lineupId, error } = await admin.rpc('save_song_lineup', {
    p_church_id: auth.churchId, p_service_id: body.service_id, p_member_id: auth.memberId, p_songs: songs,
  });
  if (error || !lineupId) {
    // W0004 is `save_song_lineup` re-asserting the same stale-schedule refusal in
    // SQL, so both layers answer with the same 409 and the same code.
    if (error?.code === 'W0004') return apiJsonError(409, 'schedule_pending_regeneration', STALE_SERVICE_MESSAGE);
    return jsonError(error?.code === '42501' ? 'You cannot edit this lineup.' : 'Could not save the song lineup.', error?.code === '42501' ? 403 : 500);
  }
  return NextResponse.json({ lineup_id: lineupId, status: 'submitted' }, { status: 201 });
}
