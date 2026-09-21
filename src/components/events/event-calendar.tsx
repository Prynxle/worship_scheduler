'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  ChevronDown,
  Clock3,
  Plus,
  Search,
  Trash2,
  UsersRound,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { getSupabaseClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import type { ChurchEvent, EventColor, EventKind } from '@/lib/types/database';
import { getCalendarGrid } from '@/lib/utils/calendar-grid';

const colorClasses: Record<EventColor, string> = {
  primary: 'bg-primary',
  sky: 'bg-sky-400',
  violet: 'bg-violet-400',
};
const kindColors: Record<EventKind, EventColor> = {
  Service: 'primary',
  Rehearsal: 'sky',
  Gathering: 'violet',
};
const timeNumbers = ['12:00', '12:30', '1:00', '1:30', '2:00', '2:30', '3:00', '3:30', '4:00', '4:30', '5:00', '5:30', '6:00', '6:30', '7:00', '7:30', '8:00', '8:30', '9:00', '9:30', '10:00', '10:30', '11:00', '11:30'];

const toIso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const formatDate = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options }).format(new Date(`${date}T00:00:00Z`));

async function getAuthHeaders(): Promise<Record<string, string> | null> {
  const session = (await getSupabaseClient().auth.getSession()).data.session;
  return session ? { Authorization: `Bearer ${session.access_token}` } : null;
}

export function EventCalendar({ canManage }: { canManage: boolean }) {
  const today = useMemo(() => new Date(), []);
  const [events, setEvents] = useState<ChurchEvent[]>([]);
  const [selectedDate, setSelectedDate] = useState(toIso(today));
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<'All' | EventKind>('All');
  const [month, setMonth] = useState(today.getMonth());
  const [year, setYear] = useState(today.getFullYear());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newKind, setNewKind] = useState<EventKind>('Gathering');
  const [timeValue, setTimeValue] = useState('6:00');
  const [meridiem, setMeridiem] = useState<'AM' | 'PM'>('PM');
  const [error, setError] = useState<string | null>(null);

  const loadEvents = useCallback(async () => {
    const headers = await getAuthHeaders();
    if (!headers) return;
    const response = await fetch('/api/events', { headers });
    if (!response.ok) {
      setError('Could not load events. Try refreshing.');
      return;
    }
    const result = (await response.json()) as { events: ChurchEvent[] };
    setEvents(result.events);
    setError(null);
  }, []);

  useEffect(() => {
    const refresh = async () => {
      await loadEvents();
    };
    void refresh();
  }, [loadEvents]);

  useEffect(() => {
    const supabase = getSupabaseClient();
    const channel = supabase
      .channel('events-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'events' }, () => void loadEvents())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadEvents]);

  const visibleEvents = useMemo(
    () =>
      events.filter(
        (event) => (kind === 'All' || event.kind === kind) && event.title.toLowerCase().includes(search.toLowerCase())
      ),
    [events, kind, search]
  );

  const selectedEvents = visibleEvents.filter((event) => event.date === selectedDate);
  const grid = getCalendarGrid(month, year, today);
  const monthLabel = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date(year, month, 1));

  function changeMonth(delta: number) {
    const next = new Date(year, month + delta, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth());
  }

  function goToToday() {
    setYear(today.getFullYear());
    setMonth(today.getMonth());
    setSelectedDate(toIso(today));
  }

  async function addEvent() {
    const title = newTitle.trim();
    if (!title || !canManage) return;
    const headers = await getAuthHeaders();
    if (!headers) return;
    const response = await fetch('/api/events', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, date: selectedDate, kind: newKind, color: kindColors[newKind], time: timeValue ? `${timeValue} ${meridiem}` : '' }),
    });
    if (response.ok) {
      setNewTitle('');
      setNewKind('Gathering');
      setTimeValue('6:00');
      setMeridiem('PM');
      setDialogOpen(false);
      await loadEvents();
    }
  }

  async function deleteEvent(event: ChurchEvent) {
    if (!canManage || !window.confirm(`Delete "${event.title}"?`)) return;
    const headers = await getAuthHeaders();
    if (!headers) return;
    const response = await fetch(`/api/events?id=${encodeURIComponent(event.id)}`, { method: 'DELETE', headers });
    if (response.ok) await loadEvents();
  }

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Search events" placeholder="Search events" className="bg-secondary/40 pl-9" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <div className="flex items-center gap-2 overflow-x-auto">
          {(['All', 'Service', 'Rehearsal', 'Gathering'] as const).map((option) => (
            <Button key={option} size="sm" variant={kind === option ? 'secondary' : 'ghost'} className={cn('rounded-full', kind === option && 'bg-primary/15 text-primary')} onClick={() => setKind(option)}>
              {option}
            </Button>
          ))}
        </div>
      </div>

      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.6fr)]">
        <Card className="border-border/70 shadow-layered">
          <CardHeader className="flex flex-row items-center justify-between border-b border-border/60">
            <div>
              <CardTitle className="text-base">{monthLabel}</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">Your ministry at a glance</p>
            </div>
            <div className="flex items-center gap-1">
              <Button size="icon-sm" variant="ghost" aria-label="Previous month" onClick={() => changeMonth(-1)}><ArrowLeft /></Button>
              <Button size="icon-sm" variant="ghost" aria-label="Next month" onClick={() => changeMonth(1)}><ArrowRight /></Button>
              <Button size="sm" variant="outline" className="ml-1 hidden sm:flex" onClick={goToToday}>Today</Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="grid grid-cols-7 border-b border-border/60 px-3 py-3 text-center text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground sm:px-5">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span key={day}>{day}</span>)}
            </div>
            <div className="grid grid-cols-7 p-3 sm:p-5">
              {grid.map((cell) => {
                const dayEvents = visibleEvents.filter((event) => event.date === cell.iso);
                const isSelected = selectedDate === cell.iso;
                return (
                  <button
                    type="button"
                    key={cell.iso}
                    onClick={() => setSelectedDate(cell.iso)}
                    className={cn(
                      'group min-h-24 border-b border-r border-border/50 p-2 text-left transition-colors hover:bg-secondary/50 sm:min-h-28 sm:p-3',
                      isSelected && 'bg-primary/[0.07] ring-1 ring-inset ring-primary/50',
                      !cell.inMonth && 'opacity-40'
                    )}
                  >
                    <span className={cn('flex size-7 items-center justify-center rounded-full text-xs font-medium', cell.isToday && 'bg-foreground text-background', isSelected && 'bg-primary text-primary-foreground')}>
                      {formatDate(cell.iso, { day: 'numeric' })}
                    </span>
                    <span className="mt-2 flex flex-col gap-1">
                      {dayEvents.slice(0, 2).map((event) => (
                        <span key={event.id} className="flex items-center gap-1 truncate text-[10px] font-medium text-foreground sm:text-xs">
                          <span className={cn('size-1.5 shrink-0 rounded-full', colorClasses[event.color])} />
                          {event.title}
                        </span>
                      ))}
                      {dayEvents.length > 2 && <span className="text-[10px] text-muted-foreground">+{dayEvents.length - 2} more</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card className="border-border/70 shadow-layered">
          <CardHeader className="border-b border-border/60">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-primary">Selected day</p>
                <CardTitle className="mt-1 text-xl">{formatDate(selectedDate, { weekday: 'long', month: 'long', day: 'numeric' })}</CardTitle>
              </div>
              {canManage ? (
                <Button size="sm" onClick={() => setDialogOpen(true)}><Plus data-icon="inline-start" /> Add event</Button>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 pt-5">
            {selectedEvents.length ? (
              selectedEvents.map((event) => (
                <div key={event.id} className="rounded-xl border border-border/70 bg-secondary/25 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className={cn('size-2 rounded-full', colorClasses[event.color])} />
                        <p className="font-medium">{event.title}</p>
                      </div>
                      <Badge variant="secondary" className="mt-3 rounded-full">{event.kind}</Badge>
                    </div>
                    {canManage ? (
                      <Button size="icon-sm" variant="ghost" aria-label={`Delete ${event.title}`} onClick={() => void deleteEvent(event)}>
                        <Trash2 className="size-4 text-muted-foreground" />
                      </Button>
                    ) : (
                      <ChevronDown className="size-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="mt-4 grid gap-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-2"><Clock3 className="size-3.5 text-primary" />{event.time}</span>
                    <span className="flex items-center gap-2"><UsersRound className="size-3.5 text-primary" />{event.attendees ? `${event.attendees} people attending` : 'Attendance not set'}</span>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-border p-6 text-center">
                <CalendarDays className="mx-auto size-7 text-muted-foreground" />
                <p className="mt-3 text-sm font-medium">Nothing scheduled yet</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{canManage ? 'Add a gathering to keep the team aligned.' : 'Check back soon for the latest ministry moments.'}</p>
                {canManage ? (
                  <Button size="sm" className="mt-4" onClick={() => setDialogOpen(true)}><Plus data-icon="inline-start" /> Add event</Button>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {canManage ? (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add an event</DialogTitle>
              <DialogDescription>Create an event for {formatDate(selectedDate, { month: 'long', day: 'numeric' })}.</DialogDescription>
            </DialogHeader>
            <Input autoFocus placeholder="Event name" value={newTitle} onChange={(event) => setNewTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void addEvent(); }} />
<Select value={newKind} onValueChange={(value) => setNewKind((value || 'Gathering') as EventKind)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Event type" />
                </SelectTrigger>
                <SelectContent>
                  {(['Service', 'Rehearsal', 'Gathering'] as const).map((option) => (
                    <SelectItem key={option} value={option}>{option}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex gap-2">
                <Select value={timeValue} onValueChange={(value) => setTimeValue(value ?? '')}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Time" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">No time (T.B.A.)</SelectItem>
                    {timeNumbers.map((option) => (
                      <SelectItem key={option} value={option}>{option}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={meridiem} onValueChange={(value) => setMeridiem((value === 'AM' ? 'AM' : 'PM'))} disabled={!timeValue}>
                  <SelectTrigger className="w-24">
                    <SelectValue placeholder="AM/PM" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AM">AM</SelectItem>
                    <SelectItem value="PM">PM</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={() => void addEvent()} disabled={!newTitle.trim()}>Create event</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
