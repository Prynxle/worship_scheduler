'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import FullCalendar, {
  type CalendarRef,
  type DateClickInfo,
  type DayCellInfo,
  type DayHeaderInfo,
  type EventClickInfo,
  type EventDisplayInfo,
  type MoreLinkInfo,
} from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/react/daygrid';
import interactionPlugin from '@fullcalendar/react/interaction';
import classicThemePlugin from '@fullcalendar/react/themes/classic';
import '@fullcalendar/react/skeleton.css';
import '@fullcalendar/react/themes/classic/theme.css';
import '@fullcalendar/react/themes/classic/palette.css';
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
import { MAX_EVENTS_PER_DAY } from '@/lib/api/events';
import type { ChurchEvent, EventColor, EventKind } from '@/lib/types/database';

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

function timeTo24h(time: string): string {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(time);
  if (!match) return '';
  let hours = Number(match[1]);
  const minutes = match[2];
  if (match[3].toUpperCase() === 'PM' && hours !== 12) hours += 12;
  if (match[3].toUpperCase() === 'AM' && hours === 12) hours = 0;
  return `${String(hours).padStart(2, '0')}:${minutes}`;
}

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
  const calendarRef = useRef<CalendarRef>(null);
  const cellKeydowns = useRef(new Map<HTMLElement, (event: KeyboardEvent) => void>());

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

  const fcEvents = useMemo(
    () =>
      visibleEvents.map((event) => ({
        id: event.id,
        title: event.title,
        start: event.time ? `${event.date}T${timeTo24h(event.time)}` : event.date,
        allDay: !event.time,
        extendedProps: {
          date: event.date,
          time: event.time,
          location: event.location,
          kind: event.kind,
          color: event.color,
          attendees: event.attendees,
        },
      })),
    [visibleEvents]
  );

  useEffect(() => {
    calendarRef.current?.getApi().gotoDate(new Date(year, month, 1));
  }, [year, month]);

  const selectedEvents = visibleEvents.filter((event) => event.date === selectedDate);
  const dayEventCount = events.filter((event) => event.date === selectedDate).length;
  const atDayLimit = dayEventCount >= MAX_EVENTS_PER_DAY;
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
    if (!title || !canManage || atDayLimit) return;
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
    } else {
      const result = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(result?.error ?? 'Could not add the event.');
    }
  }

  async function deleteEvent(event: ChurchEvent) {
    if (!canManage || !window.confirm(`Delete "${event.title}"?`)) return;
    const headers = await getAuthHeaders();
    if (!headers) return;
    const response = await fetch(`/api/events?id=${encodeURIComponent(event.id)}`, { method: 'DELETE', headers });
    if (response.ok) await loadEvents();
  }

  function selectDate(date: Date) {
    setSelectedDate(toIso(date));
  }

  function handleDayCellMount(info: DayCellInfo & { el: HTMLElement }) {
    info.el.tabIndex = 0;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectDate(info.date);
      }
    };
    info.el.addEventListener('keydown', handler);
    cellKeydowns.current.set(info.el, handler);
  }

  function handleDayCellUnmount(info: DayCellInfo & { el: HTMLElement }) {
    const handler = cellKeydowns.current.get(info.el);
    if (handler) info.el.removeEventListener('keydown', handler);
    cellKeydowns.current.delete(info.el);
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
            <div className="event-calendar-fc p-3 sm:p-5">
              <FullCalendar
                ref={calendarRef}
                plugins={[dayGridPlugin, interactionPlugin, classicThemePlugin]}
                initialView="dayGridMonth"
                initialDate={new Date(year, month, 1)}
                headerToolbar={false}
                height="auto"
                timeZone="local"
                dayMaxEvents={2}
                events={fcEvents}
                dayCellClass={(info) =>
                  cn('evc-cell', info.isOther && 'evc-out', toIso(info.date) === selectedDate && 'evc-selected')
                }
                dayCellTopClass={() => 'evc-top'}
                dayCellTopInnerClass={() => 'evc-num-wrap'}
                dayCellTopContent={(info: DayCellInfo) => (
                  <span className={cn('evc-daynum', info.isToday && 'evc-today', toIso(info.date) === selectedDate && 'evc-num-selected')}>
                    {info.dayNumberText}
                  </span>
                )}
                dayHeaderContent={(info: DayHeaderInfo) => <span className="evc-dow">{info.weekdayText}</span>}
                eventClass={() => 'evc-event-slot'}
                eventContent={(info: EventDisplayInfo) => {
                  const color = info.event.extendedProps.color as EventColor | undefined;
                  return (
                    <span className="evc-event">
                      <span className={cn('evc-dot', color ? colorClasses[color] : colorClasses.primary)} />
                      <span className="evc-event-title">{info.event.title}</span>
                    </span>
                  );
                }}
                moreLinkClass={() => 'evc-more-static'}
                moreLinkDidMount={(info) => {
                  info.el.tabIndex = -1;
                }}
                moreLinkContent={(info: MoreLinkInfo) => <span className="evc-more">+{info.num} more</span>}
                dateClick={(info: DateClickInfo) => selectDate(info.date)}
                eventClick={(info: EventClickInfo) =>
                  info.event.start ? selectDate(info.event.start) : setSelectedDate(info.event.startStr.slice(0, 10))
                }
                dayCellDidMount={handleDayCellMount}
                dayCellWillUnmount={handleDayCellUnmount}
              />
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
                atDayLimit ? (
                  <span className="rounded-full bg-secondary px-3 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">Full · max {MAX_EVENTS_PER_DAY}/day</span>
                ) : (
                  <Button size="sm" onClick={() => setDialogOpen(true)}><Plus data-icon="inline-start" /> Add event</Button>
                )
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 pt-5">
            {canManage && atDayLimit ? (
              <p className="rounded-lg border border-border/70 bg-secondary/25 px-3 py-2 text-xs text-muted-foreground">
                This day has reached its {MAX_EVENTS_PER_DAY}-event limit.
              </p>
            ) : null}
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
