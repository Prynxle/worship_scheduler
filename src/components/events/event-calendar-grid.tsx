'use client';

import { useEffect, useMemo, useRef } from 'react';
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

import { cn } from '@/lib/utils';
import type { ChurchEvent } from '@/lib/types/database';

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

interface EventCalendarGridProps {
  events: ChurchEvent[];
  year: number;
  month: number;
  selectedDate: string;
  onSelectDate: (date: Date) => void;
}

/**
 * Lazy chunk: this is the only module that imports FullCalendar. State, auth
 * headers, fetch guards and realtime cleanup stay in EventCalendar.
 */
export function EventCalendarGrid({
  events,
  year,
  month,
  selectedDate,
  onSelectDate,
}: EventCalendarGridProps) {
  const calendarRef = useRef<CalendarRef>(null);
  const cellKeydowns = useRef(new Map<HTMLElement, (event: KeyboardEvent) => void>());

  const fcEvents = useMemo(
    () =>
      events.map((event) => ({
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
    [events],
  );

  useEffect(() => {
    calendarRef.current?.getApi().gotoDate(new Date(year, month, 1));
  }, [year, month]);

  useEffect(() => {
    const handlers = cellKeydowns.current;
    return () => {
      handlers.forEach((handler, element) => element.removeEventListener('keydown', handler));
      handlers.clear();
    };
  }, []);

  function handleDayCellMount(info: DayCellInfo & { el: HTMLElement }) {
    info.el.tabIndex = 0;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onSelectDate(info.date);
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
        dateClick={(info: DateClickInfo) => onSelectDate(info.date)}
        eventClick={(info: EventClickInfo) =>
          info.event.start
            ? onSelectDate(info.event.start)
            : onSelectDate(new Date(`${info.event.startStr.slice(0, 10)}T00:00:00`))
        }
        dayCellDidMount={handleDayCellMount}
        dayCellWillUnmount={handleDayCellUnmount}
      />
    </div>
  );
}
