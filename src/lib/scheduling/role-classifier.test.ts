import { describe, expect, it } from 'vitest';
import {
  isBackupRoleName,
  isInstrumentalistRoleName,
  isWorshipLeaderRoleName,
  matchesInstrumentName,
} from './role-classifier';
import { ScheduleValidator } from './validator';
import { assignmentRows } from './persistence';
import type { ScheduleContext } from '../types/scheduling';
import type { Instrument, Member, MemberRole, Role, ScheduleAssignment, Service } from '../types/database';

// Role names that exist in the seeded schema (20260727213900_seed_data.sql) plus
// the two added by 20260916090000_member_truth_values.sql.
const REAL_ROLE_NAMES = [
  'Worship Leader', 'Vocalist', 'Guitarist', 'Drummer', 'Pianist/Keyboard',
  'Sound Engineer', 'Devotion Leader', 'Backup', 'Back Up', 'Instrumentalist',
  // Church-defined names the pre-classifier display/persistence predicates
  // accepted and that must stay accepted (widening, never narrowing).
  'Lead Vocalist', 'Vocalist 2', 'Soprano Singer', 'Acoustic Guitar', 'Piano', 'Keyboard',
];

const service: Service = {
  id: 'service', church_id: 'church', date: '2026-09-06', week_number: 1,
  month: 8, year: 2026, service_type: 'sunday', status: 'draft', created_at: '', updated_at: '',
};
const guitar: Instrument = {
  id: 'guitar-1', ministry_id: 'ministry', name: 'Guitar 1', is_required: true,
  min_count: 1, max_count: 1, slot_counts: false, created_at: '',
};

function roleNamed(name: string): Role {
  return { id: `role-${name}`, ministry_id: 'ministry', name, min_required: 0, max_allowed: 10, priority: 2, is_active: true, created_at: '' };
}

function memberWith(role: Role, id = `member-${role.id}`): Member {
  const memberRole: MemberRole = { id: `mr-${id}`, member_id: id, role_id: role.id, skill_level: 'advanced', is_preferred: true, created_at: '', role };
  return { id, church_id: 'church', full_name: id, status: 'active', max_monthly_assignments: 3, priority_score: 1, total_assignments: 0, created_at: '', updated_at: '', roles: [memberRole] };
}

// Writer probe: does POST /api/schedule resolve `roleName` for a backup slot?
function writerAcceptsBackup(roleName: string): boolean {
  const member = memberWith(roleNamed(roleName));
  try {
    assignmentRows(service, { week_number: 1, date: service.date, leader: null, backup_singers: [member], devotion: null, instrumentalists: [], conflicts: [] }, 'user');
    return true;
  } catch {
    return false;
  }
}

// Validator probe: does Rule 4 (validator.ts checkBackupCount) count one
// non-leader, non-instrument assignment carrying `roleName` as a backup?
// min_required === max_allowed === 1, so "not a backup" is the only way to fail.
async function validatorCountsAsBackup(roleName: string): Promise<boolean> {
  const role = roleNamed(roleName);
  const member = memberWith(role, 'member-1');
  const assignment: ScheduleAssignment = { id: 'a1', service_id: service.id, member_id: member.id, role_id: role.id, is_leader: false, status: 'pending', created_at: '', updated_at: '', member, role };
  const context: ScheduleContext = {
    service, church_id: 'church', month: 8, year: 2026, week_number: 1,
    existing_assignments: [assignment], available_members: [member], all_members: [member],
    rules: [{ rule_type: 'backup_count', rule_config: { min_required: 1, max_allowed: 1 }, severity: 'critical' }],
  };
  const results = await new ScheduleValidator(context).validate();
  return !results.some((result) => result.rule_type === 'backup_count' && result.severity === 'critical');
}

describe('role classifier', () => {
  it('classifies the seeded role names identically across reader, writer, and validator', async () => {
    for (const roleName of REAL_ROLE_NAMES) {
      // Reader predicate is isBackupRoleName (role-classifier.ts), imported at
      // src/app/api/schedule/route.ts:10 and used by the GET reader at :39.
      const reader = isBackupRoleName(roleName);
      const writer = writerAcceptsBackup(roleName);
      const validator = await validatorCountsAsBackup(roleName);
      // Anti-asymmetry: nothing may be persisted as a backup that the reader
      // hides, and nothing the validator counts as a backup may be unpersistable.
      expect(writer).toBe(validator);
      expect(reader).toBe(validator);
    }
  });

  it('keeps pre-classifier backup names resolvable, persistable, and visible', async () => {
    // Display predicate: name.includes('vocal') || name.includes('singer').
    // Persistence predicate: /vocal|singer|backup/.test(name).
    for (const roleName of ['Lead Vocalist', 'Vocalist 2', 'Soprano Singer']) {
      expect(isBackupRoleName(roleName)).toBe(true);
      expect(writerAcceptsBackup(roleName)).toBe(true);
      expect(await validatorCountsAsBackup(roleName)).toBe(true);
    }
  });

  it('resolves instrumental roles from the union of both pre-classifier clauses', () => {
    // Second clause the writer always had: /guitar|drum|pian|keyboard/.
    for (const roleName of ['Guitarist', 'Acoustic Guitar', 'Drummer', 'Piano', 'Pianist', 'Keyboard', 'Pianist/Keyboard']) {
      expect(isInstrumentalistRoleName(roleName)).toBe(true);
    }
    // The role that clause missed, which dropped every instrumentalist assignment.
    expect(isInstrumentalistRoleName('Instrumentalist')).toBe(true);
    // Non-instrument roles stay non-instrument.
    for (const roleName of ['Worship Leader', 'Vocalist', 'Backup', 'Back Up', 'Sound Engineer', 'Devotion Leader']) {
      expect(isInstrumentalistRoleName(roleName)).toBe(false);
    }
  });

  it('persists a Guitarist member assigned instrument "Guitar 1"', () => {
    const guitaristRole = roleNamed('Guitarist');
    const member = memberWith(guitaristRole);
    const rows = assignmentRows(service, {
      week_number: 1, date: service.date, leader: null, backup_singers: [], devotion: null, conflicts: [],
      instrumentalists: [{ instrument: guitar, member, is_fallback: false }],
    }, 'user');

    expect(rows).toEqual([expect.objectContaining({ member_id: member.id, role_id: guitaristRole.id, instrument_id: guitar.id })]);
  });

  it('prefers the specific instrument-name match over the generic instrument role', () => {
    const named = roleNamed('Acoustic Guitar');
    const genericMember = memberWith(roleNamed('Instrumentalist'), 'member-1');
    const namedMember = memberWith(named, 'member-2');
    const member: Member = { ...genericMember, roles: [...(genericMember.roles ?? []), ...(namedMember.roles ?? [])] };
    const rows = assignmentRows(service, {
      week_number: 1, date: service.date, leader: null, backup_singers: [], devotion: null, conflicts: [],
      instrumentalists: [{ instrument: { ...guitar, name: 'Acoustic Guitar' }, member, is_fallback: false }],
    }, 'user');

    expect(rows).toEqual([expect.objectContaining({ role_id: named.id })]);
    expect(matchesInstrumentName('Acoustic Guitar', 'Acoustic Guitar')).toBe(true);
    expect(matchesInstrumentName('Instrumentalist', 'Guitar 1')).toBe(false);
  });

  it('normalizes case and surrounding whitespace', () => {
    expect(isBackupRoleName('  bAcKuP sInGeR  ')).toBe(true);
    expect(isBackupRoleName(' Back Up ')).toBe(true);
    expect(isBackupRoleName('\tSinger\n')).toBe(true);
    expect(isWorshipLeaderRoleName(' Worship LEADER ')).toBe(true);
    expect(isInstrumentalistRoleName(' gUiTaRiSt ')).toBe(true);
    expect(matchesInstrumentName('  acoustic GUITAR ', 'Acoustic Guitar')).toBe(true);
  });

  it('keeps the worship leader predicate exact-match and case-insensitive', () => {
    expect(isWorshipLeaderRoleName('Worship Leader')).toBe(true);
    expect(isWorshipLeaderRoleName(' Lead Worship Leader ')).toBe(false);
    for (const roleName of REAL_ROLE_NAMES) {
      expect(isWorshipLeaderRoleName(roleName)).toBe(roleName === 'Worship Leader');
    }
  });
});

/**
 * The `Guitar` collapse renames four catalogue rows into one instrument named
 * `Guitar`, so every role name that resolved against `Guitar 1` / `Guitar 2` /
 * `Acoustic Guitar` / `Electric Guitar` must still resolve against `Guitar`.
 *
 * The important property is the ANTI-ASYMMETRY, and it is asserted rather than
 * tolerated: `matchesInstrumentName` is the strict clause and may legitimately
 * return false for a generic role, but the consumer must then WIDEN. If the two
 * ever agree on false, an instrumentalist assignment is dropped at the write
 * layer. `role-classifier.ts` may only ever widen a predicate, so this test
 * fails if a future change makes the two clauses symmetric in the narrowing
 * direction.
 */
describe('guitar collapse: every legacy guitar role still resolves against the collapsed instrument', () => {
  const collapsed: Instrument = {
    id: 'guitar-collapsed', ministry_id: 'ministry', name: 'Guitar', is_required: true,
    min_count: 1, max_count: 2, slot_counts: true, created_at: '',
  };

  // The instrument roles the live roster actually carries, per the seeded schema
  // plus the church-defined names in REAL_ROLE_NAMES.
  const GUITAR_ROLE_NAMES = ['Guitar 1', 'Guitar 2', 'Acoustic Guitar', 'Electric Guitar', 'Guitarist', 'Instrumentalist'];

  function persistsFor(roleName: string): boolean {
    const member = memberWith(roleNamed(roleName), `member-${roleName.replace(/\s+/g, '-')}`);
    try {
      const rows = assignmentRows(service, {
        week_number: 1, date: service.date, leader: null, backup_singers: [], devotion: null, conflicts: [],
        instrumentalists: [{ instrument: collapsed, member, is_fallback: false }],
      }, 'user');
      return rows.length === 1 && rows[0].instrument_id === collapsed.id;
    } catch {
      return false;
    }
  }

  it('persists every legacy guitar role against the collapsed instrument', () => {
    for (const roleName of GUITAR_ROLE_NAMES) {
      expect(persistsFor(roleName)).toBe(true);
    }
  });

  it('widens the strict name match through the Instrumentalist fallback rather than narrowing it', () => {
    // The asymmetry is real and asserted: 'Instrumentalist' does not contain the
    // string 'guitar', so the strict clause is false while the consumer accepts
    // it. That is the ONLY permitted direction for a disagreement.
    for (const roleName of GUITAR_ROLE_NAMES) {
      const strict = matchesInstrumentName(roleName, collapsed.name);
      const fallback = isInstrumentalistRoleName(roleName);
      // Consumer behaviour is `strict || fallback`, i.e. never narrower.
      expect(persistsFor(roleName)).toBe(strict || fallback);
      expect(strict || fallback).toBe(true);
    }
    // The exact disagreement the collapse introduces, pinned rather than left
    // to inference: a member whose role is the generic 'Instrumentalist' does
    // not match the new name by string match, and is saved by the fallback.
    expect(matchesInstrumentName('Instrumentalist', 'Guitar')).toBe(false);
    expect(isInstrumentalistRoleName('Instrumentalist')).toBe(true);
  });

  it('keeps every legacy guitar role resolving by name match as well as by fallback', () => {
    // The four collapsed rows all contained the substring 'guitar', so renaming
    // the instrument to 'Guitar' keeps their specific match intact - unlike the
    // reverse direction, which would have narrowed.
    for (const roleName of ['Guitar 1', 'Guitar 2', 'Acoustic Guitar', 'Electric Guitar', 'Guitarist']) {
      expect(matchesInstrumentName(roleName, collapsed.name)).toBe(true);
    }
  });

  it('still prefers the specific instrument-name match over the generic instrument role', () => {
    // Unchanged by the collapse: a member holding BOTH must resolve to the
    // specific role, or every instrumentalist would be persisted as
    // 'Instrumentalist' and the editor's role filter would break.
    const named = roleNamed('Acoustic Guitar');
    const generic = memberWith(roleNamed('Instrumentalist'), 'member-1');
    const specific = memberWith(named, 'member-2');
    const both: Member = { ...generic, roles: [...(generic.roles ?? []), ...(specific.roles ?? [])] };

    const rows = assignmentRows(service, {
      week_number: 1, date: service.date, leader: null, backup_singers: [], devotion: null, conflicts: [],
      instrumentalists: [{ instrument: collapsed, member: both, is_fallback: false }],
    }, 'user');

    expect(rows).toEqual([expect.objectContaining({ role_id: named.id, instrument_id: collapsed.id })]);
  });
});
