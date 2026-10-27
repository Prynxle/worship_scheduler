'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SongLineupPanel, type SongService } from '@/components/schedule/song-lineup-panel';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { getSupabaseClient } from '@/lib/supabase/client';
import { parseMonthParam } from '@/lib/song-lineups/month-param';
import { Music2 } from 'lucide-react';

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export default function LineUpSongsPage() {
  const [monthValue, setMonthValue] = useState(currentMonth);
  const [services, setServices] = useState<SongService[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const requestNumber = useRef(0);
  const [year, month] = monthValue.split('-').map(Number);
  const monthLabel = new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // Seed the month from `?month=YYYY-MM` once, so the availability reset's
  // success link opens the month whose drafts it just invalidated instead of
  // whatever month the page opens on. Read in an effect, not during render:
  // the server render has no `window`, and a lazy initialiser reading it would
  // render a different month than the server and break hydration.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setMonthValue((current) => parseMonthParam(window.location.search, current)); }, []);

  const load = useCallback(async () => {
    const requestId = ++requestNumber.current;
    setLoading(true);
    setError('');
    try {
      const session = (await getSupabaseClient().auth.getSession()).data.session;
      if (!session) throw new Error('Your session has expired. Please sign in again.');
      const response = await fetch(`/api/song-lineups?month=${month - 1}&year=${year}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
      const result = await response.json() as { services?: SongService[]; error?: string };
      if (requestId !== requestNumber.current) return;
      if (!response.ok) throw new Error(result.error ?? 'Could not load song lineups.');
      setServices(result.services ?? []);
    } catch (cause) {
      if (requestId === requestNumber.current) setError(cause instanceof Error ? cause.message : 'Could not load song lineups.');
    } finally {
      if (requestId === requestNumber.current) setLoading(false);
    }
  }, [month, year]);

  useEffect(() => {
    const timer = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(timer);
  }, [load, refresh]);

  return (
    <div className="mx-auto max-w-[1440px] space-y-7 pb-10">
      <header className="relative overflow-hidden rounded-[1.75rem] border border-border bg-card px-6 py-7 shadow-sm sm:px-9 sm:py-9">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-primary">Worship preparation</p>
        <h1 className="font-display text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">Line Up Songs</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">Songs follow the generated schedule. Assigned worship leaders can add and update the links for their service.</p>
        <label className="mt-6 block max-w-xs space-y-2 text-sm font-medium" htmlFor="lineup-month">Month
          <input id="lineup-month" type="month" value={monthValue} onChange={(event) => { if (event.target.value) setMonthValue(event.target.value); }} className="h-11 w-full rounded-lg border border-input bg-background px-3 text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
        </label>
      </header>

      {loading ? <div role="status" aria-busy="true" className="rounded-xl border border-border p-5 text-sm text-muted-foreground">Loading {monthLabel} songs…</div> : null}
      {error ? <Card><CardContent className="flex flex-col items-start gap-3 p-5"><p role="alert" className="text-sm text-destructive">{error}</p><Button type="button" variant="outline" onClick={() => setRefresh((value) => value + 1)}>Try again</Button></CardContent></Card> : null}
      {!loading && !error && services.length ? <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">{services.map((service) => <SongLineupPanel key={`${service.service_id}-${service.lineup?.updated_at ?? 'empty'}-${service.is_leader}`} service={service} onRefresh={() => setRefresh((value) => value + 1)} />)}</div> : null}
      {!loading && !error && !services.length ? <Card><CardContent className="flex min-h-52 flex-col items-center justify-center text-center"><Music2 className="h-8 w-8 text-muted-foreground/50" aria-hidden="true" /><p className="mt-3 font-medium">No scheduled services for {monthLabel}</p><p className="mt-1 text-sm text-muted-foreground">Lineups appear here when a schedule has been generated.</p></CardContent></Card> : null}
    </div>
  );
}
