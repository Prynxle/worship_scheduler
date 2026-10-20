import { describe, expect, it } from 'vitest';
import {
  activeMonthServices,
  deriveMonthStatus,
  isServiceValidatedForVersion,
  serviceNeedsValidation,
  summarizeMonth,
  type MonthServiceLike,
} from './month-workflow';

/**
 * Contract tests for the CLIENT-SIDE month derivation.
 *
 * These rules must mirror `month_active_service_ids` / `month_derive_status`
 * in `supabase/migrations/20261012100000_month_schedule_workflow.sql` exactly:
 * the UI badge and the RPC gates must never disagree. `summarizeMonth` in
 * particular feeds the publish button state, so a drift here means the button
 * says "publishable" while the RPC returns 'unvalidated'.
 */

function service(overrides: Partial<MonthServiceLike> & Pick<MonthServiceLike, 'id' | 'week_number' | 'status'>): MonthServiceLike {
  return {
    schedule_version: 1,
    validated_version: 1,
    unfilled_positions: [],
    ...overrides,
  };
}

describe('activeMonthServices', () => {
  it('drops archived rows (superseded originals are not active lineups)', () => {
    const active = activeMonthServices([
      service({ id: 's1', week_number: 1, status: 'published' }),
      service({ id: 's2-old', week_number: 2, status: 'archived' }),
      service({ id: 's2', week_number: 2, status: 'published', revision_of: 's2-old' }),
    ]);
    expect(active.map((item) => item.id)).toEqual(['s1', 's2']);
  });

  it('keeps one service per logical week, preferring the amendment over its original', () => {
    const active = activeMonthServices([
      service({ id: 'original', week_number: 3, status: 'published' }),
      service({ id: 'amendment', week_number: 3, status: 'draft', revision_of: 'original' }),
      service({ id: 's4', week_number: 4, status: 'validated' }),
    ]);
    expect(active.map((item) => item.id)).toEqual(['amendment', 's4']);
  });

  it('keeps the original when no amendment exists', () => {
    const active = activeMonthServices([
      service({ id: 'original', week_number: 3, status: 'published' }),
    ]);
    expect(active.map((item) => item.id)).toEqual(['original']);
  });

  it('returns the empty set for an empty month', () => {
    expect(activeMonthServices([])).toEqual([]);
  });
});

describe('deriveMonthStatus', () => {
  it('is null when the month has no active services', () => {
    expect(deriveMonthStatus([])).toBeNull();
  });

  it("is 'published' only when every active service is published", () => {
    expect(deriveMonthStatus([
      service({ id: 's1', week_number: 1, status: 'published' }),
      service({ id: 's2', week_number: 2, status: 'published' }),
    ])).toBe('published');
  });

  it("is 'validated' when every service is published or validated for its current version", () => {
    expect(deriveMonthStatus([
      service({ id: 's1', week_number: 1, status: 'published' }),
      service({ id: 's2', week_number: 2, status: 'validated', validated_version: 4, schedule_version: 4 }),
    ])).toBe('validated');
  });

  it("is 'draft' when any service is a draft", () => {
    expect(deriveMonthStatus([
      service({ id: 's1', week_number: 1, status: 'published' }),
      service({ id: 's2', week_number: 2, status: 'validated', validated_version: 2, schedule_version: 2 }),
      service({ id: 's3', week_number: 3, status: 'draft' }),
    ])).toBe('draft');
  });

  it('auto-downshifts to draft when a validated service version drifts after an edit', () => {
    // The edit bumped schedule_version to 4; validated_version 3 is now stale.
    expect(deriveMonthStatus([
      service({ id: 's1', week_number: 1, status: 'validated', validated_version: 3, schedule_version: 4 }),
    ])).toBe('draft');
  });

  it("is 'draft' when a validated service has no recorded validated_version", () => {
    expect(deriveMonthStatus([
      service({ id: 's1', week_number: 1, status: 'validated', validated_version: null, schedule_version: 1 }),
    ])).toBe('draft');
  });
});

describe('summarizeMonth', () => {
  it('counts services by status', () => {
    const summary = summarizeMonth([
      service({ id: 's1', week_number: 1, status: 'published' }),
      service({ id: 's2', week_number: 2, status: 'validated', validated_version: 2, schedule_version: 2 }),
      service({ id: 's3', week_number: 3, status: 'draft' }),
    ]);
    expect(summary.status).toBe('draft');
    expect(summary.counts).toEqual({ draft: 1, validated: 1, published: 1 });
    expect(summary.total).toBe(3);
  });

  it('flags unvalidated drafts and version-drifted services as notReady with reasons', () => {
    const summary = summarizeMonth([
      service({ id: 's1', week_number: 1, status: 'draft' }),
      service({ id: 's2', week_number: 2, status: 'validated', validated_version: 1, schedule_version: 2 }),
      service({ id: 's3', week_number: 3, status: 'validated', validated_version: 3, schedule_version: 3 }),
    ]);
    expect(summary.notReady).toEqual([
      { id: 's1', week_number: 1, status: 'draft', reason: 'not_validated' },
      { id: 's2', week_number: 2, status: 'validated', reason: 'version_drifted' },
    ]);
  });

  it('flags non-published services with unfilled positions as incomplete with the gap roles', () => {
    const summary = summarizeMonth([
      service({ id: 's1', week_number: 1, status: 'validated', validated_version: 1, schedule_version: 1, unfilled_positions: [
        { role_name: 'Worship Leader' },
        { role_name: 'Keyboard' },
      ] }),
      service({ id: 's2', week_number: 2, status: 'published', unfilled_positions: [{ role_name: 'Trombone' }] }),
    ]);
    expect(summary.incomplete).toEqual([
      { id: 's1', week_number: 1, role_names: ['Worship Leader', 'Keyboard'] },
    ]);
    // Version-based derivation says 'validated' (s1 validates its current
    // version); the GAP-based publish gate blocks separately via `incomplete`.
    expect(summary.status).toBe('validated');
  });

  it('treats an all-validated month with no gaps as publishable (status validated, nothing blocking)', () => {
    const summary = summarizeMonth([
      service({ id: 's1', week_number: 1, status: 'validated', validated_version: 2, schedule_version: 2, unfilled_positions: [] }),
      service({ id: 's2', week_number: 2, status: 'published' }),
    ]);
    expect(summary.status).toBe('validated');
    expect(summary.notReady).toEqual([]);
    expect(summary.incomplete).toEqual([]);
  });
});

describe('serviceNeedsValidation / isServiceValidatedForVersion', () => {
  it('treats a draft as needing validation', () => {
    const draft = service({ id: 's1', week_number: 1, status: 'draft' });
    expect(serviceNeedsValidation(draft)).toBe(true);
    expect(isServiceValidatedForVersion(draft)).toBe(false);
  });

  it('treats a validated row stamped for its current version as publishable, not re-needing validation', () => {
    const fresh = service({ id: 's1', week_number: 1, status: 'validated', schedule_version: 4, validated_version: 4 });
    expect(isServiceValidatedForVersion(fresh)).toBe(true);
    expect(serviceNeedsValidation(fresh)).toBe(false);
  });

  it('treats a validated row with a stale stamp as drift, not a dead end', () => {
    const drifted = service({ id: 's1', week_number: 1, status: 'validated', schedule_version: 4, validated_version: 3 });
    expect(isServiceValidatedForVersion(drifted)).toBe(false);
    expect(serviceNeedsValidation(drifted)).toBe(true);
  });

  it('treats a validated row with no recorded stamp as drift, so it can be re-validated', () => {
    // This is the production shape: status flipped to 'validated' outside the
    // app, validated_version left NULL. It is neither publishable nor, before
    // this rule, re-validatable.
    const stamp_less = service({ id: 's1', week_number: 1, status: 'validated', schedule_version: 1, validated_version: null });
    expect(isServiceValidatedForVersion(stamp_less)).toBe(false);
    expect(serviceNeedsValidation(stamp_less)).toBe(true);
  });

  it('never treats a published or archived row as needing validation', () => {
    expect(serviceNeedsValidation(service({ id: 's1', week_number: 1, status: 'published' }))).toBe(false);
    expect(serviceNeedsValidation(service({ id: 's1', week_number: 1, status: 'archived' }))).toBe(false);
  });
});