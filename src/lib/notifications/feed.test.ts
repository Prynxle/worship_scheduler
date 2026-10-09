import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatRelativeTime, parseAnnouncementPage } from './feed';

describe('parseAnnouncementPage', () => {
  it('returns the notifications, cursor and unread count from a valid payload', () => {
    const notifications = [
      { id: 'n1', title: 'Hello', message: 'Body', is_read: false, created_at: '2026-01-01T00:00:00.000Z' },
    ];
    expect(parseAnnouncementPage({ notifications, nextCursor: '2026-01-01T00:00:00.000Z', unreadCount: 3 }))
      .toEqual({ notifications, nextCursor: '2026-01-01T00:00:00.000Z', unreadCount: 3 });
  });

  it('defaults a missing cursor and unread count', () => {
    expect(parseAnnouncementPage({ notifications: [] }))
      .toEqual({ notifications: [], nextCursor: null, unreadCount: 0 });
  });

  it('rejects a payload that is not an object or has no notification array', () => {
    expect(() => parseAnnouncementPage(null)).toThrow('invalid');
    expect(() => parseAnnouncementPage({ notifications: 'nope' })).toThrow('invalid');
  });
});

describe('formatRelativeTime', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function at(now: string) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
  }

  it('returns an empty string for an unparseable timestamp', () => {
    expect(formatRelativeTime('not-a-date')).toBe('');
  });

  it('reports sub-minute events as just now', () => {
    at('2026-01-01T12:00:20.000Z');
    expect(formatRelativeTime('2026-01-01T12:00:00.000Z')).toBe('Just now');
  });

  it('reports minutes, hours and days', () => {
    at('2026-01-01T12:00:00.000Z');
    expect(formatRelativeTime('2026-01-01T11:35:00.000Z')).toBe('25m ago');
    expect(formatRelativeTime('2026-01-01T09:00:00.000Z')).toBe('3h ago');
    expect(formatRelativeTime('2025-12-29T12:00:00.000Z')).toBe('3d ago');
  });

  it('falls back to a calendar date beyond a week', () => {
    at('2026-01-15T12:00:00.000Z');
    const iso = '2026-01-01T12:00:00.000Z';
    expect(formatRelativeTime(iso)).toBe(new Date(iso).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
    }));
  });
});
