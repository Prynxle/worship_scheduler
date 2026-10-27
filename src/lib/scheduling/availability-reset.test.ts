import { describe, expect, it } from 'vitest';
import { isStaleDraft } from './availability-reset';

describe('isStaleDraft', () => {
  const today = '2026-10-26';

  it('treats a stamped future-dated draft as stale', () => {
    expect(isStaleDraft({ availability_reset_at: '2026-10-26T12:00:00Z', date: '2026-10-26' }, today)).toBe(true);
    expect(isStaleDraft({ availability_reset_at: '2026-10-26T12:00:00Z', date: '2099-12-31' }, today)).toBe(true);
  });

  it('ignores a stamp on a week that has already passed', () => {
    // Regeneration only reaches future weeks, so a past stamp could never be
    // cleared; treating it as stale would permanently lock that service.
    expect(isStaleDraft({ availability_reset_at: '2026-10-26T12:00:00Z', date: '2026-10-25' }, today)).toBe(false);
    expect(isStaleDraft({ availability_reset_at: '2026-10-26T12:00:00Z', date: '2020-01-05' }, today)).toBe(false);
  });

  it('treats an unstamped service as fresh regardless of date', () => {
    expect(isStaleDraft({ availability_reset_at: null, date: '2099-12-31' }, today)).toBe(false);
    expect(isStaleDraft({ date: '2099-12-31' }, today)).toBe(false);
  });

  it('defaults to today when no cutoff is supplied', () => {
    expect(isStaleDraft({ availability_reset_at: '2026-10-26T12:00:00Z', date: '2099-12-31' })).toBe(true);
  });
});
