import { describe, it, expect } from 'vitest';
import { MAX_EVENT_DESCRIPTION_LENGTH, validateEventInput } from './events';

describe('validateEventInput', () => {
  it('accepts a minimal valid event', () => {
    const result = validateEventInput({ title: 'Band rehearsal', date: '2026-09-22' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({ title: 'Band rehearsal', date: '2026-09-22', attendees: 0 });
      expect(result.value.description).toBeNull();
    }
  });

  it('trims and maps optional fields', () => {
    const result = validateEventInput({
      title: '  Sunday Worship  ',
      date: '2026-09-20',
      time: '9:00 AM',
      location: ' Main sanctuary ',
      description: '  Bring the folding chairs.  ',
      attendees: 42,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toBe('Sunday Worship');
      expect(result.value.location).toBe('Main sanctuary');
      expect(result.value.description).toBe('Bring the folding chairs.');
    }
  });

  it('treats a blank description as absent', () => {
    const result = validateEventInput({ title: 'Event', date: '2026-09-20', description: '   ' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.description).toBeNull();
  });

  it('accepts any free-text description, including the retired kind values', () => {
    for (const description of ['Rehearsal', 'Gathering', 'anything at all']) {
      const result = validateEventInput({ title: 'Event', date: '2026-09-20', description });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.description).toBe(description);
    }
  });

  it('rejects a description longer than the database allows', () => {
    const ok = validateEventInput({
      title: 'Event',
      date: '2026-09-20',
      description: 'x'.repeat(MAX_EVENT_DESCRIPTION_LENGTH),
    });
    expect(ok.ok).toBe(true);

    const tooLong = validateEventInput({
      title: 'Event',
      date: '2026-09-20',
      description: 'x'.repeat(MAX_EVENT_DESCRIPTION_LENGTH + 1),
    });
    expect(tooLong.ok).toBe(false);
  });

  it('rejects a missing or blank title', () => {
    expect(validateEventInput({ title: '', date: '2026-09-20' }).ok).toBe(false);
    expect(validateEventInput({ title: '   ', date: '2026-09-20' }).ok).toBe(false);
    expect(validateEventInput({ date: '2026-09-20' }).ok).toBe(false);
  });

  it('rejects invalid or calendar-impossible dates', () => {
    expect(validateEventInput({ title: 'Event', date: '2026-09-32' }).ok).toBe(false);
    expect(validateEventInput({ title: 'Event', date: '2026-02-30' }).ok).toBe(false);
    expect(validateEventInput({ title: 'Event', date: '20/09/2026' }).ok).toBe(false);
    expect(validateEventInput({ title: 'Event', date: 'next-week' }).ok).toBe(false);
  });

  it('rejects negative or fractional attendees', () => {
    expect(validateEventInput({ title: 'Event', date: '2026-09-20', attendees: -1 }).ok).toBe(false);
    expect(validateEventInput({ title: 'Event', date: '2026-09-20', attendees: 1.5 }).ok).toBe(false);
  });
});