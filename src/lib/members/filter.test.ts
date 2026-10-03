import { describe, expect, it } from 'vitest';
import { filterMembers, isFiltering, type MemberFilterState } from './filter';
import type { Instrument, Member, MemberRole, MemberSkill, Role } from '@/lib/types/database';

/**
 * The Members page narrows the roster in the browser, so these predicates are
 * the whole of the filtering behaviour. The cases that matter are the ones
 * where the "obvious" implementation is subtly wrong: multiple selections in
 * one facet, a member with no roles at all, and a role whose display name has
 * been deleted.
 */

const ROLE_LEAD = 'role-leader';
const ROLE_GUITAR = 'role-guitar';
const ROLE_KEYS = 'role-keys';
const INSTRUMENT_GUITAR = 'inst-guitar';
const INSTRUMENT_KEYS = 'inst-keys';

function member(overrides: Partial<Member> & { id: string }): Member {
  return {
    church_id: 'church-1',
    full_name: 'Member',
    status: 'active',
    max_monthly_assignments: 3,
    priority_score: 50,
    total_assignments: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const role = (id: string, name: string): Role => ({
  id,
  ministry_id: 'ministry-1',
  name,
  min_required: 0,
  max_allowed: 99,
  priority: 50,
  is_active: true,
  created_at: '2026-01-01T00:00:00Z',
});

const instrument = (id: string, name: string): Instrument => ({
  id,
  ministry_id: 'ministry-1',
  name,
  is_required: false,
  min_count: 0,
  max_count: 99,
  slot_counts: false,
  created_at: '2026-01-01T00:00:00Z',
});

const memberRole = (id: string, memberId: string, roleId: string, name: string): MemberRole => ({
  id,
  member_id: memberId,
  role_id: roleId,
  skill_level: 'intermediate',
  is_preferred: false,
  created_at: '2026-01-01T00:00:00Z',
  role: role(roleId, name),
});

const memberSkill = (id: string, memberId: string, instrumentId: string, name: string): MemberSkill => ({
  id,
  member_id: memberId,
  instrument_id: instrumentId,
  skill_level: 'intermediate',
  is_primary: true,
  created_at: '2026-01-01T00:00:00Z',
  instrument: instrument(instrumentId, name),
});

const zedrick = member({
  id: 'm1',
  full_name: 'Zedrick Paul',
  nickname: 'Zed',
  roles: [
    memberRole('mr1', 'm1', ROLE_LEAD, 'Worship Leader'),
    memberRole('mr2', 'm1', ROLE_GUITAR, 'Guitarist'),
  ],
  skills: [memberSkill('ms1', 'm1', INSTRUMENT_GUITAR, 'Guitar')],
});

const heidi = member({
  id: 'm2',
  full_name: 'Heidi Mendoza',
  status: 'inactive',
  roles: [memberRole('mr3', 'm2', ROLE_GUITAR, 'Guitarist')],
  skills: [memberSkill('ms2', 'm2', INSTRUMENT_KEYS, 'Keys')],
});

const bong = member({ id: 'm3', full_name: 'Bong Kim' });
const maricar = member({ id: 'm4', full_name: 'Maricar Ramos' });

const ROSTER = [zedrick, heidi, bong, maricar];

const NONE: MemberFilterState = { searchQuery: '', status: 'all', roleIds: [], instrumentIds: [] };

const ids = (filters: Partial<MemberFilterState>) => filterMembers(ROSTER, { ...NONE, ...filters }).map((m) => m.id);

describe('filterMembers', () => {
  it('returns everyone when nothing is selected', () => {
    expect(ids({})).toEqual(['m1', 'm2', 'm3', 'm4']);
  });

  it('searches full name, nickname and role name, case insensitively', () => {
    expect(ids({ searchQuery: 'zed' })).toEqual(['m1']);
    expect(ids({ searchQuery: 'HEIDI' })).toEqual(['m2']);
    expect(ids({ searchQuery: 'worship leader' })).toEqual(['m1']);
    expect(ids({ searchQuery: 'bong' })).toEqual(['m3']);
  });

  it('ignores surrounding whitespace in the search box', () => {
    expect(ids({ searchQuery: '   maricar   ' })).toEqual(['m4']);
  });

  it('does not throw on a member with no nickname or no roles', () => {
    expect(() => filterMembers(ROSTER, { ...NONE, searchQuery: 'bong' })).not.toThrow();
    expect(ids({ searchQuery: 'bong' })).toEqual(['m3']);
  });

  it('unions multiple selections within the role facet', () => {
    expect(ids({ roleIds: [ROLE_LEAD, ROLE_KEYS] })).toEqual(['m1']);
  });

  it('unions multiple selections within the instrument facet', () => {
    expect(ids({ instrumentIds: [INSTRUMENT_GUITAR, INSTRUMENT_KEYS] })).toEqual(['m1', 'm2']);
  });

  it('intersects the role and instrument facets', () => {
    expect(ids({ roleIds: [ROLE_GUITAR], instrumentIds: [INSTRUMENT_KEYS] })).toEqual(['m2']);
    // Heidi plays keys and is a guitarist; Zedrick is a guitarist and plays
    // guitar. Neither is guitar AND keys.
    expect(ids({ roleIds: [ROLE_GUITAR], instrumentIds: [INSTRUMENT_GUITAR] })).toEqual(['m1']);
  });

  it('intersects the facets with the status tab', () => {
    expect(ids({ status: 'inactive' })).toEqual(['m2']);
    expect(ids({ status: 'active' })).toEqual(['m1', 'm3', 'm4']);
    // Heidi is the only keys player, and she is inactive.
    expect(ids({ status: 'active', instrumentIds: [INSTRUMENT_KEYS] })).toEqual([]);
  });

  it('intersects everything at once', () => {
    expect(ids({ searchQuery: 'eidi', status: 'inactive', roleIds: [ROLE_GUITAR], instrumentIds: [INSTRUMENT_KEYS] })).toEqual([
      'm2',
    ]);
    // Same person, but the status tab rules her out.
    expect(ids({ searchQuery: 'eidi', status: 'active', roleIds: [ROLE_GUITAR], instrumentIds: [INSTRUMENT_KEYS] })).toEqual([]);
  });

  it('matches on the join id, so a member with no roles can never match a role filter', () => {
    // Maricar has no role rows at all. Comparing against joined names would be
    // safe here, but comparing against an absent name is how a member with a
    // deleted role gets pinned into never appearing again.
    expect(ids({ roleIds: [ROLE_LEAD] })).toEqual(['m1']);
    expect(ids({ roleIds: [ROLE_KEYS] })).toEqual([]);
  });

  it('excludes members with no rows when a facet is active', () => {
    expect(ids({ instrumentIds: [INSTRUMENT_GUITAR] })).toEqual(['m1']);
  });
});

describe('isFiltering', () => {
  it('is false for an untouched page', () => {
    expect(isFiltering(NONE)).toBe(false);
  });

  it('is true for a whitespace-only search, because the list is still narrowed by tabs elsewhere', () => {
    expect(isFiltering({ ...NONE, searchQuery: '   ' })).toBe(false);
    expect(isFiltering({ ...NONE, status: 'active' })).toBe(true);
    expect(isFiltering({ ...NONE, roleIds: [ROLE_LEAD] })).toBe(true);
    expect(isFiltering({ ...NONE, instrumentIds: [INSTRUMENT_GUITAR] })).toBe(true);
  });
});
