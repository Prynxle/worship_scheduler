import { describe, it, expect } from 'vitest';
import { validateEventInput } from './events';

describe('validateEventInput', () => {
  it('accepts a minimal valid event', () => {
    const result = validateEventInput({ title: 'Band rehearsal', date: '2026-09-22' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toMatchObject({ title: 'Band rehearsal', date: '2026-09-22', attendees: 0 });
      expect(result.value.kind).toBeNull();
      expect(result.value.color).toBeNull();
    }
  });

  it('trims and maps optional fields', () => {
    const result = validateEventInput({
      title: '  Sunday Worship  ',
      date: '2026-09-20',
      time: '9:00 AM',
      location: ' Main sanctuary ',
      kind: 'Service',
      color: 'primary',
      attendees: 42,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.title).toBe('Sunday Worship');
      expect(result.value.location).toBe('Main sanctuary');
      expect(result.value.kind).toBe('Service');
      expect(result.value.color).toBe('primary');
    }
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

  it('rejects an unknown kind, color, or negative attendees', () => {
    expect(validateEventInput({ title: 'Event', date: '2026-09-20', kind: 'Conference' }).ok).toBe(false);
    expect(validateEventInput({ title: 'Event', date: '2026-09-20', color: 'red' }).ok).toBe(false);
    expect(validateEventInput({ title: 'Event', date: '2026-09-20', attendees: -1 }).ok).toBe(false);
    expect(validateEventInput({ title: 'Event', date: '2026-09-20', attendees: 1.5 }).ok).toBe(false);
  });
});