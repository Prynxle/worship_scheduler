import { describe, expect, it } from 'vitest';
import { formatUpcomingEventCount, getUpcomingEventsQueryStart } from './upcoming';

describe('formatUpcomingEventCount', () => {
  it('renders nothing when there are no upcoming events', () => {
    // Zero is a real answer, so the line is omitted rather than filled with a
    // placeholder that reads as scheduling activity.
    expect(formatUpcomingEventCount(0)).toBeNull();
  });

  it('renders nothing for a negative or non-finite count', () => {
    expect(formatUpcomingEventCount(-1)).toBeNull();
    expect(formatUpcomingEventCount(Number.NaN)).toBeNull();
  });

  it('uses the singular for exactly one event', () => {
    expect(formatUpcomingEventCount(1)).toBe('1 upcoming event');
  });

  it('uses the plural for more than one event', () => {
    expect(formatUpcomingEventCount(2)).toBe('2 upcoming events');
    expect(formatUpcomingEventCount(17)).toBe('17 upcoming events');
  });
});

describe('getUpcomingEventsQueryStart', () => {
  it('returns the local calendar date, not the UTC date', () => {
    // 00:30 local on 4 October is still 3 October in UTC. A UTC-derived string
    // would exclude today's events for the first eight hours of the day on a
    // UTC+8 machine, so this asserts on local components.
    expect(getUpcomingEventsQueryStart(new Date(2026, 9, 4, 0, 30))).toBe('2026-10-04');
  });

  it('matches the local date late in the day', () => {
    expect(getUpcomingEventsQueryStart(new Date(2026, 9, 4, 23, 45))).toBe('2026-10-04');
  });

  it('pads single-digit months and days', () => {
    expect(getUpcomingEventsQueryStart(new Date(2026, 0, 9))).toBe('2026-01-09');
  });

  it('includes today rather than starting tomorrow', () => {
    // An event on today's date must be counted as upcoming.
    const now = new Date(2026, 5, 15, 12, 0);
    expect(getUpcomingEventsQueryStart(now)).toBe('2026-06-15');
  });
});
