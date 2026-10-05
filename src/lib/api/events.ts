export const MAX_EVENTS_PER_DAY = 4;

/** Kept in sync with the events_description_length check in the migration. */
export const MAX_EVENT_DESCRIPTION_LENGTH = 250;

export type EventInput = {
  title: string;
  date: string;
  time?: string | null;
  location?: string | null;
  description?: string | null;
  attendees?: number | null;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type EventValidationResult =
  | { ok: true; value: EventInput }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
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

  const description = asString(input.description);
  if (description !== null && description.length > MAX_EVENT_DESCRIPTION_LENGTH) {
    return {
      ok: false,
      error: `Event description must be ${MAX_EVENT_DESCRIPTION_LENGTH} characters or fewer.`,
    };
  }

  const attendees = input.attendees ?? 0;
  if (typeof attendees !== 'number' || !Number.isInteger(attendees) || attendees < 0) {
    return { ok: false, error: 'Attendees must be a non-negative integer.' };
  }

  return {
    ok: true,
    value: {
      title,
      date,
      time: asString(input.time),
      location: asString(input.location),
      description,
      attendees,
    },
  };
}