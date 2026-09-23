import { EventColor, EventKind } from '@/lib/types/database';

export const EVENT_KINDS: EventKind[] = ['Service', 'Rehearsal', 'Gathering'];
export const EVENT_COLORS: EventColor[] = ['primary', 'sky', 'violet'];

export type EventInput = {
  title: string;
  date: string;
  time?: string | null;
  location?: string | null;
  kind?: EventKind | null;
  color?: EventColor | null;
  attendees?: number | null;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type EventValidationResult =
  | { ok: true; value: EventInput }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isValidDate(isoDate: string): boolean {
  if (!DATE_PATTERN.test(isoDate)) return false;
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function validateEventInput(input: unknown): EventValidationResult {
  if (!isRecord(input)) return { ok: false, error: 'Invalid event payload.' };

  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title) return { ok: false, error: 'Event title is required.' };
  if (title.length > 200) return { ok: false, error: 'Event title must be 200 characters or fewer.' };

  const date = typeof input.date === 'string' ? input.date : '';
  if (!isValidDate(date)) return { ok: false, error: 'A valid event date (YYYY-MM-DD) is required.' };

  const kind = input.kind ?? null;
  if (kind !== null && !EVENT_KINDS.includes(kind as EventKind)) {
    return { ok: false, error: 'Event kind must be Service, Rehearsal, or Gathering.' };
  }

  const color = input.color ?? null;
  if (color !== null && !EVENT_COLORS.includes(color as EventColor)) {
    return { ok: false, error: 'Invalid event color.' };
  }

  const attendees = input.attendees ?? 0;
  if (typeof attendees !== 'number' || !Number.isInteger(attendees) || attendees < 0) {
    return { ok: false, error: 'Attendees must be a non-negative integer.' };
  }

  const asString = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() ? value.trim() : null;

  return {
    ok: true,
    value: {
      title,
      date,
      time: asString(input.time),
      location: asString(input.location),
      kind: kind as EventKind | null,
      color: color as EventColor | null,
      attendees,
    },
  };
}