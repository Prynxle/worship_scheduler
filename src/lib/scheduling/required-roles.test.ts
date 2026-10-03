import { describe, expect, it } from 'vitest';
import {
  maxSlotsFor,
  minSlotsFor,
  requiredPositions,
  slotCountsFor,
} from './required-roles';
import type { ScheduleContext } from '../types/scheduling';
import type { Instrument, Member, Service } from '../types/database';

/**
 * The count contract lives or dies here, and this file is deliberately mostly
 * NEGATIVE.
 *
 * Multi-slot behaviour is opt-in through `instruments.slot_counts`. The failure
 * mode that matters is not "Guitar got one player when two were asked for"; it
 * is some unrelated instrument silently acquiring a second slot the week a
 * maintainer changed `max_count`. So every test below that is not explicitly
 * about the opted-in row asserts that the legacy 1/1 answer survives.
 */

const service: Service = {
  id: 'service', church_id: 'church', date: '2026-09-06', week_number: 1,
  month: 8, year: 2026, service_type: 'sunday', status: 'draft', created_at: '', updated_at: '',
};

function instrument(overrides: Partial<Instrument> = {}): Instrument {
  return {
    id: 'inst-1', ministry_id: 'min1', name: 'Guitar', is_required: true,
    min_count: 1, max_count: 2, slot_counts: false, created_at: '', ...overrides,
  };
}

function context(instruments: Instrument[], allMembers: Member[] = []): ScheduleContext {
  return {
    service, church_id: 'church', month: 8, year: 2026, week_number: 1,
    existing_assignments: [], available_members: allMembers, all_members: allMembers,
    rules: [], instruments,
  };
}

describe('slot count helpers', () => {
  it('reports the opt-in flag as exactly true, never as truthiness', () => {
    expect(slotCountsFor(instrument({ slot_counts: true }))).toBe(true);
    expect(slotCountsFor(instrument({ slot_counts: false }))).toBe(false);
    // A row written before the column existed, or an untyped DB object cast to
    // Instrument, must be INERT rather than accidentally count-driven.
    expect(slotCountsFor(instrument({ slot_counts: undefined as unknown as boolean }))).toBe(false);
    expect(slotCountsFor(instrument({ slot_counts: 1 as unknown as boolean }))).toBe(false);
    expect(slotCountsFor(undefined)).toBe(false);
  });

  it('keeps min and max at 1/1 for every row that has not opted in', () => {
    for (const row of [
      instrument({ slot_counts: false, min_count: 1, max_count: 1 }),
      instrument({ slot_counts: false, min_count: 2, max_count: 4 }),
      instrument({ slot_counts: false, min_count: 0, max_count: 99 }),
    ]) {
      expect(minSlotsFor(row)).toBe(1);
      expect(maxSlotsFor(row)).toBe(1);
    }
  });

  it('sweeps the counts into slots only once the row has opted in', () => {
    const guitar = instrument({ slot_counts: true, min_count: 1, max_count: 2 });
    expect(minSlotsFor(guitar)).toBe(1);
    expect(maxSlotsFor(guitar)).toBe(2);

    const pair = instrument({ slot_counts: true, min_count: 2, max_count: 2 });
    expect(minSlotsFor(pair)).toBe(2);
    expect(maxSlotsFor(pair)).toBe(2);
  });

  it('honours min_count 0 on an opted-in row instead of demanding one player', () => {
    // The CHECK admits `min_count >= 0`, so "up to 4, none required" is a legal
    // configuration. Folding 0 to 1 would schedule a guitarist nobody asked for
    // and then report a gap for a position that is not required.
    const section = instrument({ slot_counts: true, min_count: 0, max_count: 4 });
    expect(minSlotsFor(section)).toBe(0);
    expect(maxSlotsFor(section)).toBe(4);

    const none = instrument({ slot_counts: true, min_count: 0, max_count: 0 });
    expect(minSlotsFor(none)).toBe(0);
    expect(maxSlotsFor(none)).toBe(0);
  });

  it('degrades a malformed opted-in row to the legacy answer instead of a negative count', () => {
    // The database CHECK rejects these, but the engine reads whatever the query
    // returned. `max_count` below `min_count` must not produce a negative number
    // of optional slots, which would silently drop the hard slots too.
    const inverted = instrument({ slot_counts: true, min_count: 3, max_count: 1 });
    expect(maxSlotsFor(inverted)).toBe(3);
    expect(minSlotsFor(inverted)).toBe(3);
    for (const bad of [-2, Number.NaN, Number.POSITIVE_INFINITY]) {
      const row = instrument({ slot_counts: true, min_count: bad, max_count: 2 });
      expect(minSlotsFor(row)).toBe(1);
    }
  });

  it('never invents an optional slot out of an absent max_count', () => {
    const row = instrument({ slot_counts: true, min_count: 1, max_count: undefined as unknown as number });
    expect(minSlotsFor(row)).toBe(1);
    expect(maxSlotsFor(row)).toBe(1);
    expect(requiredPositions(context([row])).filter((position) => position.kind === 'instrument')).toEqual([
      expect.objectContaining({ required_slots: 1, optional_slots: 0 }),
    ]);
  });
});

describe('requiredPositions', () => {
  it('emits one hard slot and one optional slot for an opted-in min-1/max-2 instrument', () => {
    const positions = requiredPositions(context([instrument({ slot_counts: true, min_count: 1, max_count: 2 })]));
    const guitar = positions.filter((position) => position.kind === 'instrument');
    expect(guitar).toHaveLength(1);
    expect(guitar[0]).toMatchObject({ role_name: 'Guitar', required_slots: 1, optional_slots: 1 });
  });

  it('emits no optional slots for a legacy row, whatever max_count says', () => {
    // The single most important line in this file: a pre-existing `max_count: 2`
    // row with the flag off contributes ONE required slot and ZERO optional.
    const positions = requiredPositions(context([instrument({ slot_counts: false, min_count: 1, max_count: 2 })]));
    expect(positions.filter((position) => position.kind === 'instrument')).toEqual([
      expect.objectContaining({ role_name: 'Guitar', required_slots: 1, optional_slots: 0 }),
    ]);
  });

  it('emits zero optional slots when an opted-in row has max_count equal to min_count', () => {
    const positions = requiredPositions(context([instrument({ slot_counts: true, min_count: 1, max_count: 1 })]));
    expect(positions.filter((position) => position.kind === 'instrument')).toEqual([
      expect.objectContaining({ required_slots: 1, optional_slots: 0 }),
    ]);
  });

  it('carries optional_slots: 0 on every non-instrument position', () => {
    const positions = requiredPositions(context([], []));
    expect(positions.length).toBeGreaterThan(0);
    for (const position of positions) expect(position.optional_slots).toBe(0);
  });

  it('never turns a max_count gap into optional slots for an instrument that is not required', () => {
    // Optional_slots is a function of the COUNT contract, which only applies to
    // required instruments. A non-required row contributes no position at all.
    const positions = requiredPositions(context([instrument({ is_required: false, slot_counts: true, min_count: 1, max_count: 2 })]));
    expect(positions.filter((position) => position.kind === 'instrument')).toEqual([]);
  });
});
