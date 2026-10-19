'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { getSupabaseClient } from '@/lib/supabase/client';
import { ArrowDown, ArrowUp, ExternalLink, Plus, Trash2 } from 'lucide-react';

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

type Props = { service: SongService; onRefresh: () => void };
const blankSong = (): SongItem => ({ title: '', song_url: '', musical_key: '', chords_url: '' });

async function authHeaders() {
  const session = (await getSupabaseClient().auth.getSession()).data.session;
  if (!session) throw new Error('Your session has expired. Please sign in again.');
  return { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' };
}

export function SongLineupPanel({ service, onRefresh }: Props) {
  const [songs, setSongs] = useState<SongItem[]>(() => service.lineup?.songs.length ? service.lineup.songs.map((song) => ({ ...song })) : [blankSong(), blankSong()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const leaderCanEdit = service.is_leader === true;
  const hasLineup = !!service.lineup;

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
      if (!response.ok) throw new Error(result.error ?? 'Could not save the lineup.');
      setNotice('Songs saved and shared with members assigned to this service.');
      onRefresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save the lineup.'); }
    finally { setBusy(false); }
  }

  const dateLabel = new Date(`${service.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const visibleSongs = leaderCanEdit ? songs : service.lineup?.songs ?? [];
  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 border-b border-border bg-muted/20 px-4 py-4 sm:px-5">
        <div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">Week {service.week_number} · worship songs</p><h3 className="mt-1 font-heading text-base font-semibold">{dateLabel}</h3></div>
        <Badge variant={!hasLineup ? 'outline' : 'secondary'}>{hasLineup ? 'Songs submitted' : 'Not submitted'}</Badge>
      </CardHeader>
      <CardContent className="space-y-4 p-4 sm:p-5">
        <p className="text-sm text-muted-foreground">Worship leader: <span className="font-medium text-foreground">{service.leader_name}</span></p>
        {!hasLineup && !leaderCanEdit ? <p className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">The worship leader has not added songs for this week yet.</p> : null}
        {visibleSongs.map((song, index) => (
          <div key={song.id ?? `song-${index}`} className="grid gap-3 rounded-xl border border-border p-3 sm:grid-cols-2">
            <div className="space-y-2">
              {leaderCanEdit ? <>
                <Label htmlFor={`song-title-${service.service_id}-${index}`}>Song {index + 1} title</Label>
                <Input id={`song-title-${service.service_id}-${index}`} value={song.title} onChange={(event) => updateSong(index, 'title', event.target.value)} placeholder="Song title" />
                <Label htmlFor={`song-url-${service.service_id}-${index}`}>Song URL</Label>
                <Input id={`song-url-${service.service_id}-${index}`} type="url" value={song.song_url} onChange={(event) => updateSong(index, 'song_url', event.target.value)} placeholder="https://…" />
              </> : <><p className="font-medium">{song.title}</p><a className="inline-flex items-center gap-1 break-all text-sm text-primary underline" href={song.song_url} target="_blank" rel="noreferrer">Open song link <ExternalLink className="h-3 w-3 shrink-0" /></a></>}
            </div>
            <div className="space-y-2">
              {leaderCanEdit ? <>
                <Label htmlFor={`song-key-${service.service_id}-${index}`}>Musical key</Label>
                <Input id={`song-key-${service.service_id}-${index}`} value={song.musical_key ?? ''} onChange={(event) => updateSong(index, 'musical_key', event.target.value)} placeholder="e.g. Bb, G, F#m" />
                <Label htmlFor={`song-chords-${service.service_id}-${index}`}>Chords URL <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Input id={`song-chords-${service.service_id}-${index}`} type="url" value={song.chords_url ?? ''} onChange={(event) => updateSong(index, 'chords_url', event.target.value)} placeholder="https://…" />
              </> : <>{song.musical_key ? <p className="text-sm text-muted-foreground">Key: {song.musical_key}</p> : null}{song.chords_url ? <a className="inline-flex items-center gap-1 text-sm text-primary underline" href={song.chords_url} target="_blank" rel="noreferrer">Chord chart <ExternalLink className="h-3 w-3" /></a> : null}</>}
            </div>
            {leaderCanEdit ? <div className="flex gap-1 sm:col-span-2 sm:justify-end"><Button type="button" size="icon-sm" className="size-11" variant="ghost" disabled={index === 0} aria-label={`Move song ${index + 1} up`} onClick={() => setSongs((items) => { const next = [...items]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })}><ArrowUp /></Button><Button type="button" size="icon-sm" className="size-11" variant="ghost" disabled={index === songs.length - 1} aria-label={`Move song ${index + 1} down`} onClick={() => setSongs((items) => { const next = [...items]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; return next; })}><ArrowDown /></Button><Button type="button" size="icon-sm" className="size-11" variant="ghost" disabled={songs.length <= 2} aria-label={`Remove song ${index + 1}`} onClick={() => setSongs((items) => items.filter((_, itemIndex) => itemIndex !== index))}><Trash2 /></Button></div> : null}
          </div>
        ))}
        {leaderCanEdit ? <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={() => setSongs((items) => [...items, blankSong()])} disabled={busy || songs.length >= 30}><Plus className="mr-1 h-4 w-4" />Add song</Button><Button type="button" onClick={() => void submit()} disabled={busy} aria-busy={busy}>{busy ? 'Saving…' : hasLineup ? 'Save changes' : 'Save songs'}</Button></div> : null}
        {notice ? <p role="status" className="text-sm text-primary">{notice}</p> : null}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      </CardContent>
    </Card>
  );
}
