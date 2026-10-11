'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getSupabaseClient } from '@/lib/supabase/client';
import { ArrowDown, ArrowUp, Check, ExternalLink, Plus, Trash2 } from 'lucide-react';

export type SongItem = { id?: string; title: string; song_url: string; musical_key?: string | null; chords_url?: string | null; position?: number };
export type ServiceLineup = {
  id: string; status: 'submitted' | 'confirmed' | 'withdrawn'; submitted_at: string; updated_at: string;
  songs: SongItem[];
};
export type SongService = {
  service_id: string; date: string; week_number: number; leader_name: string;
  instrumentalists: { name: string; instrument: string }[]; backups: string[];
  is_leader?: boolean; lineup: ServiceLineup | null;
};

type Props = { service: SongService; canReview?: boolean; onRefresh: () => void };
const blankSong = (): SongItem => ({ title: '', song_url: '', musical_key: '', chords_url: '' });

async function authHeaders() {
  const session = (await getSupabaseClient().auth.getSession()).data.session;
  if (!session) throw new Error('Your session has expired. Please sign in again.');
  return { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' };
}

export function SongLineupPanel({ service, canReview = false, onRefresh }: Props) {
  const initialSongs = service.lineup?.songs.length ? service.lineup.songs : [blankSong(), blankSong()];
  const [songs, setSongs] = useState<SongItem[]>(initialSongs.map((song) => ({ ...song })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const leaderCanEdit = service.is_leader === true;
  const canEditDetails = leaderCanEdit || canReview;
  const hasLineup = !!service.lineup;
  const canReviewActive = canReview && hasLineup && service.lineup?.status !== 'withdrawn';

  function updateSong(index: number, key: keyof SongItem, value: string) {
    setSongs((items) => items.map((song, itemIndex) => itemIndex === index ? { ...song, [key]: value } : song));
  }

  async function submit() {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const headers = await authHeaders();
      const response = await fetch('/api/song-lineups', { method: 'POST', headers, body: JSON.stringify({ service_id: service.service_id, songs }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Could not submit the lineup.');
      setNotice('Lineup submitted and visible to the members assigned to this service.');
      onRefresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not submit the lineup.'); }
    finally { setBusy(false); }
  }

  async function review(action: 'confirm' | 'withdraw' | 'enrich') {
    if (busy) return;
    if (action === 'withdraw' && !window.confirm('Withdraw this lineup? Assigned members will no longer see it.')) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const headers = await authHeaders();
      const response = await fetch(`/api/song-lineups/${encodeURIComponent(service.service_id)}`, {
        method: 'PATCH', headers, body: JSON.stringify({ action, ...(action === 'enrich' ? { songs } : {}) }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Could not update the lineup.');
      setNotice(action === 'confirm' ? 'Lineup confirmed.' : action === 'withdraw' ? 'Lineup withdrawn.' : 'Song details saved.');
      onRefresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update the lineup.'); }
    finally { setBusy(false); }
  }

  const dateLabel = new Date(`${service.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 border-b border-border bg-muted/20 px-4 py-4 sm:px-5">
        <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Week {service.week_number} · worship songs</p><h3 className="mt-1 font-heading text-base font-semibold">{dateLabel}</h3></div>
        <Badge variant={!service.lineup ? 'outline' : service.lineup.status === 'confirmed' ? 'default' : service.lineup.status === 'withdrawn' ? 'destructive' : 'secondary'}>
          {!service.lineup ? 'Not submitted' : service.lineup.status[0].toUpperCase() + service.lineup.status.slice(1)}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Worship leader</p><p className="mt-1 text-sm font-medium">{service.leader_name}</p></div>
          <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Instrumentalists</p><p className="mt-1 text-sm">{service.instrumentalists.length ? service.instrumentalists.map((person) => `${person.name} · ${person.instrument}`).join(', ') : 'None assigned'}</p></div>
          <div><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Backups</p><p className="mt-1 text-sm">{service.backups.length ? service.backups.join(', ') : 'None assigned'}</p></div>
        </div>
        {hasLineup ? <p className="text-xs text-muted-foreground">Submitted lineups are visible to this service’s assigned members immediately. Confirmation records coordinator review.</p> : <p className="text-sm text-muted-foreground">The assigned worship leader can add and submit at least two songs for this service.</p>}
        {songs.map((song, index) => (
          <div key={song.id ?? `song-${index}`} className="grid gap-3 rounded-xl border border-border p-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`song-title-${service.service_id}-${index}`}>Song {index + 1} title</Label>
              <Input id={`song-title-${service.service_id}-${index}`} value={song.title} disabled={!leaderCanEdit} onChange={(event) => updateSong(index, 'title', event.target.value)} placeholder="Song title" />
              <Label htmlFor={`song-url-${service.service_id}-${index}`}>Song URL</Label>
              <Input id={`song-url-${service.service_id}-${index}`} type="url" value={song.song_url} disabled={!leaderCanEdit} onChange={(event) => updateSong(index, 'song_url', event.target.value)} placeholder="https://…" />
            </div>
            <div className="space-y-2">
              <Label htmlFor={`song-key-${service.service_id}-${index}`}>Musical key</Label>
              <Input id={`song-key-${service.service_id}-${index}`} value={song.musical_key ?? ''} disabled={!canEditDetails} onChange={(event) => updateSong(index, 'musical_key', event.target.value)} placeholder="e.g. Bb, G, F#m" />
              <Label htmlFor={`song-chords-${service.service_id}-${index}`}>Chords URL <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Input id={`song-chords-${service.service_id}-${index}`} type="url" value={song.chords_url ?? ''} disabled={!canEditDetails} onChange={(event) => updateSong(index, 'chords_url', event.target.value)} placeholder="https://…" />
              {hasLineup ? <p className="flex flex-wrap gap-3 text-xs"><a className="inline-flex items-center gap-1 text-primary underline" href={song.song_url} target="_blank" rel="noreferrer">Song link <ExternalLink className="h-3 w-3" /></a>{song.chords_url ? <a className="inline-flex items-center gap-1 text-primary underline" href={song.chords_url} target="_blank" rel="noreferrer">Chords <ExternalLink className="h-3 w-3" /></a> : null}</p> : null}
            </div>
            {leaderCanEdit ? <div className="flex gap-1 sm:col-span-2 sm:justify-end"><Button type="button" size="icon-sm" variant="ghost" disabled={index === 0} aria-label={`Move song ${index + 1} up`} onClick={() => setSongs((items) => { const next = [...items]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })}><ArrowUp /></Button><Button type="button" size="icon-sm" variant="ghost" disabled={index === songs.length - 1} aria-label={`Move song ${index + 1} down`} onClick={() => setSongs((items) => { const next = [...items]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; return next; })}><ArrowDown /></Button><Button type="button" size="icon-sm" variant="ghost" disabled={songs.length <= 2} aria-label={`Remove song ${index + 1}`} onClick={() => setSongs((items) => items.filter((_, itemIndex) => itemIndex !== index))}><Trash2 /></Button></div> : null}
          </div>
        ))}
        {leaderCanEdit ? <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => setSongs((items) => [...items, blankSong()])} disabled={busy || songs.length >= 30}><Plus className="mr-1 h-4 w-4" />Add song</Button><Button type="button" onClick={() => void submit()} disabled={busy} aria-busy={busy}>{busy ? 'Saving…' : hasLineup ? 'Save and resubmit' : 'Submit lineup'}</Button></div> : null}
        {canReviewActive ? <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => void review('enrich')} disabled={busy}>Save keys and chords</Button>{service.lineup?.status !== 'confirmed' ? <Button type="button" onClick={() => void review('confirm')} disabled={busy}><Check className="mr-1 h-4 w-4" />Confirm</Button> : null}<Button type="button" variant="destructive" onClick={() => void review('withdraw')} disabled={busy}>Withdraw</Button></div> : null}
        {notice ? <p role="status" className="text-sm text-primary">{notice}</p> : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
