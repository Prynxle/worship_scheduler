'use client';

import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  ChevronDown,
  Clock3,
  MapPin,
  Plus,
  Search,
  Sparkles,
  UsersRound,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type EventKind = 'Service' | 'Rehearsal' | 'Gathering';
type EventItem = { id: number; title: string; date: string; time: string; location: string; kind: EventKind; attendees: number; color: string };

const initialEvents: EventItem[] = [
  { id: 1, title: 'Sunday Worship Service', date: '2026-09-20', time: '9:00 AM', location: 'Main sanctuary', kind: 'Service', attendees: 42, color: 'bg-primary' },
  { id: 2, title: 'Band rehearsal', date: '2026-09-22', time: '7:00 PM', location: 'Music room', kind: 'Rehearsal', attendees: 11, color: 'bg-sky-400' },
  { id: 3, title: 'Volunteer huddle', date: '2026-09-24', time: '6:30 PM', location: 'Fellowship hall', kind: 'Gathering', attendees: 18, color: 'bg-violet-400' },
  { id: 4, title: 'Sunday Worship Service', date: '2026-09-27', time: '9:00 AM', location: 'Main sanctuary', kind: 'Service', attendees: 44, color: 'bg-primary' },
  { id: 5, title: 'Leadership prayer', date: '2026-09-29', time: '6:30 PM', location: 'Prayer room', kind: 'Gathering', attendees: 8, color: 'bg-violet-400' },
];

const monthDays = Array.from({ length: 35 }, (_, index) => {
  const date = new Date(Date.UTC(2026, 8, 1 - 2 + index));
  return date.toISOString().slice(0, 10);
});

const formatDate = (date: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', ...options }).format(new Date(`${date}T00:00:00Z`));

export function EventManager() {
  const [events, setEvents] = useState(initialEvents);
  const [selectedDate, setSelectedDate] = useState('2026-09-20');
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState<'All' | EventKind>('All');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');

  const visibleEvents = useMemo(() => events.filter((event) => (kind === 'All' || event.kind === kind) && event.title.toLowerCase().includes(search.toLowerCase())), [events, kind, search]);
  const selectedEvents = visibleEvents.filter((event) => event.date === selectedDate);
  const monthLabel = formatDate('2026-09-01', { month: 'long', year: 'numeric' });

  function addEvent() {
    const title = newTitle.trim();
    if (!title) return;
    setEvents((current) => [...current, { id: Date.now(), title, date: selectedDate, time: '6:00 PM', location: 'To be confirmed', kind: 'Gathering', attendees: 0, color: 'bg-violet-400' }]);
    setNewTitle('');
    setDialogOpen(false);
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="relative overflow-hidden rounded-2xl border border-border/70 bg-card p-6 shadow-layered sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-24 size-64 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
          <div>
            <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-primary"><Sparkles className="size-3.5" /> Ministry calendar</div>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Keep everyone in step.</h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">One shared rhythm for services, rehearsals, and the moments that make ministry happen.</p>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger render={<Button><Plus data-icon="inline-start" /> Add event</Button>} />
            <DialogContent>
              <DialogHeader><DialogTitle>Add an event</DialogTitle><DialogDescription>Create a quick gathering for {formatDate(selectedDate, { month: 'long', day: 'numeric' })}.</DialogDescription></DialogHeader>
              <Input autoFocus placeholder="Event name" value={newTitle} onChange={(event) => setNewTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') addEvent(); }} />
              <DialogFooter><Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button><Button onClick={addEvent} disabled={!newTitle.trim()}>Create event</Button></DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </section>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="Search events" placeholder="Search events" className="pl-9 bg-secondary/40" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
        <div className="flex items-center gap-2 overflow-x-auto">
          {(['All', 'Service', 'Rehearsal', 'Gathering'] as const).map((option) => <Button key={option} size="sm" variant={kind === option ? 'secondary' : 'ghost'} className={cn('rounded-full', kind === option && 'bg-primary/15 text-primary')} onClick={() => setKind(option)}>{option}</Button>)}
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.6fr)]">
        <Card className="border-border/70 shadow-layered">
          <CardHeader className="flex flex-row items-center justify-between border-b border-border/60">
            <div><CardTitle className="text-base">{monthLabel}</CardTitle><p className="mt-1 text-sm text-muted-foreground">Your ministry at a glance</p></div>
            <div className="flex items-center gap-1"><Button size="icon-sm" variant="ghost" aria-label="Previous month"><ArrowLeft /></Button><Button size="icon-sm" variant="ghost" aria-label="Next month"><ArrowRight /></Button><Button size="sm" variant="outline" className="ml-1 hidden sm:flex">Today</Button></div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="grid grid-cols-7 border-b border-border/60 px-3 py-3 text-center text-[10px] font-semibold uppercase tracking-[0.15em] text-muted-foreground sm:px-5">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span key={day}>{day}</span>)}</div>
            <div className="grid grid-cols-7 p-3 sm:p-5">{monthDays.map((date) => { const dayEvents = visibleEvents.filter((event) => event.date === date); const isCurrentMonth = date.slice(0, 7) === '2026-09'; const isSelected = selectedDate === date; return <button type="button" key={date} onClick={() => setSelectedDate(date)} className={cn('group min-h-24 border-b border-r border-border/50 p-2 text-left transition-colors hover:bg-secondary/50 sm:min-h-28 sm:p-3', isSelected && 'bg-primary/[0.07] ring-1 ring-inset ring-primary/50', !isCurrentMonth && 'opacity-40')}><span className={cn('flex size-7 items-center justify-center rounded-full text-xs font-medium', date === '2026-09-18' && 'bg-foreground text-background', isSelected && 'bg-primary text-primary-foreground')}>{formatDate(date, { day: 'numeric' })}</span><span className="mt-2 flex flex-col gap-1">{dayEvents.slice(0, 2).map((event) => <span key={event.id} className="flex items-center gap-1 truncate text-[10px] font-medium text-foreground sm:text-xs"><span className={cn('size-1.5 shrink-0 rounded-full', event.color)} />{event.title}</span>)}{dayEvents.length > 2 && <span className="text-[10px] text-muted-foreground">+{dayEvents.length - 2} more</span>}</span></button>; })}</div>
          </CardContent>
        </Card>

        <Card className="border-border/70 shadow-layered">
          <CardHeader className="border-b border-border/60"><p className="text-xs font-medium uppercase tracking-[0.16em] text-primary">Selected day</p><CardTitle className="mt-1 text-xl">{formatDate(selectedDate, { weekday: 'long', month: 'long', day: 'numeric' })}</CardTitle></CardHeader>
          <CardContent className="flex flex-col gap-3 pt-5">{selectedEvents.length ? selectedEvents.map((event) => <div key={event.id} className="rounded-xl border border-border/70 bg-secondary/25 p-4"><div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><span className={cn('size-2 rounded-full', event.color)} /><p className="font-medium">{event.title}</p></div><Badge variant="secondary" className="mt-3 rounded-full">{event.kind}</Badge></div><ChevronDown className="size-4 text-muted-foreground" /></div><div className="mt-4 grid gap-2 text-xs text-muted-foreground"><span className="flex items-center gap-2"><Clock3 className="size-3.5 text-primary" />{event.time}</span><span className="flex items-center gap-2"><MapPin className="size-3.5 text-primary" />{event.location}</span><span className="flex items-center gap-2"><UsersRound className="size-3.5 text-primary" />{event.attendees ? `${event.attendees} people attending` : 'Attendance not set'}</span></div></div>) : <div className="rounded-xl border border-dashed border-border p-6 text-center"><CalendarDays className="mx-auto size-7 text-muted-foreground" /><p className="mt-3 text-sm font-medium">Nothing scheduled yet</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Add a gathering to keep the team aligned.</p><Button size="sm" className="mt-4" onClick={() => setDialogOpen(true)}><Plus data-icon="inline-start" /> Add event</Button></div>}</CardContent>
        </Card>
      </div>
    </div>
  );
}
