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
  Loader2,
  Plus,
  Search,
  Trash2,
  UsersRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { getSupabaseClient } from '@/lib/supabase/client';
import { cn } from '@/lib/utils';
import { MAX_EVENTS_PER_DAY, MAX_EVENT_DESCRIPTION_LENGTH } from '@/lib/api/events';
import type { ChurchEvent } from '@/lib/types/database';

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
  const [month, setMonth] = useState(today.getMonth());
  const [year, setYear] = useState(today.getFullYear());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');
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
        (event) => event.title.toLowerCase().includes(search.toLowerCase())
      ),
    [events, search]
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

  // `saving` covers the whole click-to-response window. The Create button used to
  // stay live for the entire round trip, so a double-click issued two POSTs and
  // the second created a duplicate event; the server-side 4/day cap only catches
  // that on a day that is already full.
  //
  // try/finally, not a trailing setSaving(false): the button is disabled while
  // `saving`, so a thrown fetch (dead network, aborted request) would otherwise
  // leave the coordinator looking at a permanently spinning button with no way
  // forward. The `catch` is here for the same reason -- this is called as
  // `void addEvent()`, so nobody observes the rejection, and without it a network
  // failure is indistinguishable from the button simply doing nothing.
  async function addEvent() {
    const title = newTitle.trim();
    if (!title || !canManage || atDayLimit || saving) return;
    setSaving(true);
    try {
      const headers = await getAuthHeaders();
      if (!headers) {
        setError('Your session has expired. Please sign in again.');
        return;
      }
      const response = await fetch('/api/events', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          date: selectedDate,
          description: newDescription.trim(),
          time: timeValue ? `${timeValue} ${meridiem}` : '',
        }),
      });
      if (response.ok) {
        setNewTitle('');
        setNewDescription('');
        setTimeValue('6:00');
        setMeridiem('PM');
        setDialogOpen(false);
        await loadEvents();
      } else {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(result?.error ?? 'Could not add the event.');
      }
    } catch {
      setError('Could not reach the server to create this event. Check your connection and try again.');
    } finally {
      setSaving(false);
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
    <div className="space-y-2.5">
      {/* One wrapper element so this component owns the gap between the search
          field and the two Cards below it. Returning a fragment handed those
          children straight to the embedder, so the embedder's own vertical
          rhythm (`space-y-6` in the member workspace, `gap-6` in EventManager)
          landed on each of them: the field's 10px `pb-2.5` was added on top of
          that 24px sibling gap and the rendered space read as 34px. The wrapper
          makes this block a single child, so `space-y-2.5` is the whole gap
          between the input and the calendar, and the embedder's 24px now
          applies once, to the block as a whole. */}
      <div className="relative w-full pt-1 sm:max-w-xs">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input aria-label="Search events" placeholder="Search events" className="bg-secondary/40 pl-9" value={search} onChange={(event) => setSearch(event.target.value)} />
      </div>

      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

      {/* The two Cards share a row and stretch to the same height, so their bottom edges
          align. Only one of them may have a say in that height, and it is this one: the
          month grid is content-sized, so its height is what the row should take. The
          events Card opts out with `contain: size` (`.evc-event-panel`), which removes its
          contribution to the row -- stretch then matches it to this Card rather than the
          other way round. Without that opt-out the row follows whichever side has the
          longer list, and the month grid gets stretched with empty space under it.

          Below `xl` this grid is a single column, each Card is its own auto-height row,
          and stretching is a no-op. */}
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
          {/* This Card is the height anchor for the row: `min-h-0` on the events Card
              below stops the events list from inflating the row, so the row height is the
              month grid's own height and this Card is never stretched. That is what makes
              the negative margin correct rather than the cause of the bug -- it extends
              the content box past the Card's `py-(--card-spacing)` so the last week row
              meets the bottom border, with no leftover height collecting after that box to
              reopen the gap. The Card is `overflow-hidden` with rounded corners, so the
              grid is clipped to the border rather than bleeding past it. Horizontal padding
              is untouched, so the day cells keep their inset from the Card's sides. */}
          <CardContent className="p-0 -mb-(--card-spacing)">
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
                eventContent={(info: EventDisplayInfo) => (
                  <span className="evc-event">
                    <span className="evc-event-title">{info.event.title}</span>
                  </span>
                )}
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

        <Card className="evc-event-panel min-h-0 border-border/70 shadow-layered">
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
          {/* `flex-1 min-h-0` lets this column claim the Card's leftover height. The Card is
                `flex flex-col`, so without `min-h-0` the child refuses to shrink below
                its content and the list could never be bounded. */}
          {/* `-mb-(--card-spacing)` cancels the Card's own bottom padding on this column only,
                so the scroll region reaches the Card's bottom edge instead of stopping
                `var(--card-spacing)` short and leaving a visible gap. The Card is
                `overflow-hidden` with rounded corners, so the extended region is clipped
                to the rounded border rather than bleeding past it. Horizontal padding is
                untouched, so the events keep their inset from the Card's sides. */}
          <CardContent className="flex min-h-0 flex-1 flex-col gap-3 pt-5 -mb-(--card-spacing)">
            {canManage && atDayLimit ? (
              <p className="rounded-lg border border-border/70 bg-secondary/25 px-3 py-2 text-xs text-muted-foreground">
                This day has reached its {MAX_EVENTS_PER_DAY}-event limit.
              </p>
            ) : null}
            {/* The list fills the height the Card has left, so the events area spans the whole
                Card and its bottom edge lands level with the calendar's.

                At `xl` the Card carries `.evc-event-panel` (`contain: size`, see globals.css).
                That is what actually decouples the two heights: it drops this Card's
                contribution to the grid row to nothing, so the row is sized by the month
                grid alone and this Card is merely stretched to match it. `min-h-0` alone
                was not enough -- it only removes the automatic *minimum* size, while an
                auto-height `flex-col` still folds the list's content into the Card's own
                intrinsic size, which let a long list size the row and stretch the calendar.

                `flex-1` claims the leftover height and `min-h-0` allows the list to shrink
                below its content, so it scrolls rather than pushing the Card taller.
                `max-h-[60vh]` applies below `xl` only, where the grid is a single column
                and the Card is auto-height with no containment to bound it; without the cap
                the list would grow unbounded with the event count. Two earlier attempts at
                this cap are recorded in git history: applying it at every breakpoint left
                the stretched list stopping short of the Card's bottom edge, and removing it
                everywhere let events spill past that edge. `contain: size` is what makes
                lifting it at `xl` safe.

                `snap-y snap-proximity` with `snap-start` on each card stops a card resting
                sliced mid-height: `proximity` rather than `mandatory` because event cards
                vary in height with description length, and mandatory can trap a card
                taller than the region and make its bottom unreachable.

                `overscroll-contain` stops the page behind from scrolling once this list
                reaches its end. The themed scrollbar is `.evc-event-scroll` in
                globals.css, and `pr-2` keeps card content clear of the bar.

                No bottom padding on the region: it runs flush to the Card's inner edge so
                the list ends exactly level with the Card. An earlier `pb-1` here left a
                gap above the bottom border, which read as the content stopping short. */}
            {selectedEvents.length ? (
              <div className="evc-event-scroll min-h-0 flex-1 snap-y snap-proximity space-y-3 overflow-y-scroll overscroll-contain pr-2 max-h-[60vh] xl:max-h-none">
              {selectedEvents.map((event) => (
                <div key={event.id} className="snap-start rounded-xl border border-border/70 bg-secondary/25 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <p className="break-words font-medium">{event.title}</p>
                      </div>
                      {event.description ? (
                        <p className="mt-2 break-words text-sm leading-6 text-muted-foreground">{event.description}</p>
                      ) : null}
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
                    <span className="flex min-w-0 items-center gap-2 break-words"><Clock3 className="size-3.5 shrink-0 text-primary" />{event.time}</span>
                    <span className="flex min-w-0 items-center gap-2 break-words"><UsersRound className="size-3.5 shrink-0 text-primary" />{event.attendees ? `${event.attendees} people attending` : 'Attendance not set'}</span>
                  </div>
                </div>
              ))}
              </div>
            ) : (
              /* `flex-1` so the empty state also spans the Card rather than sitting at
                 the top with the Card's height left below it. */
              <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-border p-6 text-center">
                <CalendarDays className="mx-auto size-7 text-muted-foreground" />
                <p className="mt-3 text-sm font-medium">Nothing scheduled yet</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{canManage ? 'Add an event to keep the team aligned.' : 'Check back soon for the latest ministry moments.'}</p>
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
            <div className="min-w-0">
              <Textarea
                placeholder="Description (optional)"
                aria-label="Event description"
                rows={3}
                maxLength={MAX_EVENT_DESCRIPTION_LENGTH}
                value={newDescription}
                onChange={(event) => setNewDescription(event.target.value)}
              />
              <p className="mt-1 text-right text-xs text-muted-foreground">
                {newDescription.trim().length}/{MAX_EVENT_DESCRIPTION_LENGTH}
              </p>
            </div>
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
              {/* `saving` joins the disabled condition so the button cannot be
                  pressed again while the POST is in flight, and the label states
                  the pending state instead of leaving the dialog looking idle.
                  `aria-hidden` on the icon because "Creating…" already carries
                  it to a screen reader; the spinner is the same lucide mark the
                  sign-in submit uses. */}
              <Button onClick={() => void addEvent()} disabled={!newTitle.trim() || saving || atDayLimit}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
                {saving ? 'Creating…' : 'Create event'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
