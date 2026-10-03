import { describe, expect, it } from 'vitest';
import { applyOverrides, hasActiveOverrides, unfilledFrom } from './gaps';
import type { ScheduleContext, ValidationResult } from '../types/scheduling';
import type {
  Instrument,
  Member,
  MemberRole,
  Role,
  ScheduleAssignment,
  Service,
} from '../types/database';

/**
 * Two authorities are tested here.
 *
 * `unfilledFrom` is the WRITE-side gap authority: it is what the assignments route
 * persists, so a test failure here means a stored gap list can disagree with the
 * lineup sitting next to it.
 *
 * `applyOverrides` is the coordinator licence surface, and it is the highest-risk
 * code in the change: it is the one place where a `critical` deliberately becomes a
 * `warning`. The tests below are mostly negative on purpose, because the failure
 * mode that matters is a licence silently reaching a rule it was never scoped to.
 */

const leaderRole: Role = {
  id: 'role-leader',
  ministry_id: 'min1',
  name: 'Worship Leader',
  description: '',
  min_required: 1,
  max_allowed: 1,
  priority: 1,
  is_active: true,
  created_at: '',
};

const backupRole: Role = { ...leaderRole, id: 'role-backup', name: 'Backup Singer', min_required: 0, max_allowed: 10, priority: 2 };

const devotionRole: Role = { ...leaderRole, id: 'role-devotion', name: 'Devotion', min_required: 0, max_allowed: 10, priority: 3 };

const guitar: Instrument = { id: 'inst-guitar', ministry_id: 'min1', name: 'Guitar', is_required: true, min_count: 1, max_count: 1, slot_counts: false, created_at: '' };
const bass: Instrument = { id: 'inst-bass', ministry_id: 'min1', name: 'Bass', is_required: true, min_count: 1, max_count: 1, slot_counts: false, created_at: '' };
const optionalKeys: Instrument = { ...guitar, id: 'inst-keys', name: 'Keys', is_required: false };

function member(overrides: Partial<Member> = {}): Member {
  return {
    id: 'm1',
    church_id: 'church1',
    full_name: 'Test Member',
    status: 'active',
    max_monthly_assignments: 3,
    priority_score: 1,
    total_assignments: 0,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

function memberRole(role: Role, overrides: Partial<MemberRole> = {}): MemberRole {
  return {
    id: `mr-${role.id}`,
    member_id: 'm1',
    role_id: role.id,
    skill_level: 'expert',
    is_preferred: true,
    created_at: '',
    role,
    ...overrides,
  };
}

function assignment(overrides: Partial<ScheduleAssignment> = {}): ScheduleAssignment {
  return {
    id: 'a1',
    service_id: 'svc1',
    member_id: 'm1',
    role_id: backupRole.id,
    is_leader: false,
    status: 'pending',
    created_at: '',
    updated_at: '',
    role: backupRole,
    ...overrides,
  };
}

function service(overrides: Partial<Service> = {}): Service {
  return {
    id: 'svc1',
    church_id: 'church1',
    date: '2026-09-06',
    week_number: 1,
    month: 9,
    year: 2026,
    service_type: 'Sunday Worship',
    status: 'draft',
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

function context(overrides: Partial<ScheduleContext> = {}): ScheduleContext {
  return {
    service: service(),
    church_id: 'church1',
    month: 9,
    year: 2026,
    week_number: 1,
    existing_assignments: [],
    available_members: [],
    all_members: [],
    rules: [],
    // Explicit empty catalogue is authoritative: this roster requires no
    // instruments unless a test says otherwise.
    instruments: [],
    ...overrides,
  };
}

const backupRule = (min: number, max = 3) => [{ rule_type: 'backup_count', severity: 'critical' as const, rule_config: { min_required: min, max_allowed: max } }];

/** A leader plus `count` backup singers, the common "complete" shape. */
function fullLineup(count = 3): ScheduleAssignment[] {
  return [
    assignment({ id: 'a-leader', member_id: 'm-leader', is_leader: true, role_id: leaderRole.id, role: leaderRole }),
    ...Array.from({ length: count }, (_, index) => assignment({ id: `a-backup-${index}`, member_id: `m-backup-${index}` })),
  ];
}

function result(overrides: Partial<ValidationResult> = {}): ValidationResult {
  return {
    rule_type: 'availability_check',
    check: 'availability',
    severity: 'critical',
    message: 'Member is unavailable for week 1',
    ...overrides,
  };
}

describe('unfilledFrom: the write-side gap authority', () => {
  it('reports nothing for a complete lineup', () => {
    const ctx = context({ rules: backupRule(3) });
    expect(unfilledFrom(ctx, fullLineup(3))).toEqual([]);
  });

  it('reports the missing leader as one slot, stamped with the service it belongs to', () => {
    const ctx = context({ rules: backupRule(3) });
    const gaps = unfilledFrom(ctx, fullLineup(3).filter((item) => !item.is_leader));

    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      service_id: 'svc1',
      week_number: 1,
      date: '2026-09-06',
      role_name: 'Worship Leader',
      required_slots: 1,
    });
    expect(gaps[0].message).toMatch(/No worship leader assigned for week 1/);
  });

  it('reports a backup shortfall as the numeric number of slots still needed', () => {
    const ctx = context({ rules: backupRule(3) });
    const gaps = unfilledFrom(ctx, fullLineup(1));

    expect(gaps).toHaveLength(1);
    // 1 of 3 filled is TWO unfilled positions, not one vague "short backup" row.
    expect(gaps[0]).toMatchObject({ role_name: 'Backup', required_slots: 2 });
    expect(gaps[0].message).toMatch(/Only 1 of 3 backup singers assigned/);
  });

  it('respects a configured backup minimum instead of assuming three', () => {
    const ctx = context({ rules: backupRule(1) });
    expect(unfilledFrom(ctx, fullLineup(1))).toEqual([]);
    expect(unfilledFrom(ctx, fullLineup(0)).map((gap) => gap.required_slots)).toEqual([1]);
  });

  it('reports a required instrument the lineup never filled', () => {
    const ctx = context({ rules: backupRule(3), instruments: [guitar] });
    const gaps = unfilledFrom(ctx, fullLineup(3));

    expect(gaps.map((gap) => gap.role_name)).toEqual(['Guitar']);
  });

  it('does not report an instrument position once it is assigned', () => {
    const ctx = context({ rules: backupRule(3), instruments: [guitar] });
    const lineup = [...fullLineup(3), assignment({ id: 'a-guitar', member_id: 'm-guitar', role_id: 'role-inst', role: { ...backupRole, id: 'role-inst', name: 'Instrumentalist' }, instrument_id: guitar.id })];

    expect(unfilledFrom(ctx, lineup)).toEqual([]);
  });

  it('treats an empty catalogue as "no required instruments", not as a missing catalogue', () => {
    // The regression this guards: a fallback keyed on falsiness would read `[]` as
    // absent and invent instrument requirements from member.skills.
    const skilled = member({ skills: [{ id: 's1', member_id: 'm1', instrument_id: guitar.id, skill_level: 'expert', is_primary: false, created_at: '', instrument: guitar }] });
    const ctx = context({ rules: backupRule(3), instruments: [], all_members: [skilled] });

    expect(unfilledFrom(ctx, fullLineup(3))).toEqual([]);
  });

  it('falls back to member skills only when the catalogue is undefined', () => {
    const skilled = member({ skills: [{ id: 's1', member_id: 'm1', instrument_id: guitar.id, skill_level: 'expert', is_primary: false, created_at: '', instrument: guitar }] });
    const ctx = context({ rules: backupRule(3), instruments: undefined, all_members: [skilled] });

    expect(unfilledFrom(ctx, fullLineup(3)).map((gap) => gap.role_name)).toEqual(['Guitar']);
  });

  it('ignores an optional instrument', () => {
    const ctx = context({ rules: backupRule(3), instruments: [optionalKeys] });
    expect(unfilledFrom(ctx, fullLineup(3))).toEqual([]);
  });

  it('requires Devotion only when the roster has someone who can hold it', () => {
    const withoutHolder = context({ rules: backupRule(3) });
    expect(unfilledFrom(withoutHolder, fullLineup(3))).toEqual([]);

    const holder = member({ id: 'm-dev', roles: [memberRole(devotionRole)] });
    const withHolder = context({ rules: backupRule(3), all_members: [holder] });
    const gaps = unfilledFrom(withHolder, fullLineup(3));
    expect(gaps.map((gap) => gap.role_name)).toEqual(['Devotion']);

    const filled = [...fullLineup(3), assignment({ id: 'a-dev', member_id: 'm-dev', role: devotionRole, role_id: devotionRole.id })];
    expect(unfilledFrom(withHolder, filled)).toEqual([]);
  });

  it('never invents a reason a coordinator would act on', () => {
    // A recomputed gap has no solve-time search history. Reporting a fabricated
    // "rejected: already assigned elsewhere" would be worse than reporting nothing.
    const ctx = context({ rules: backupRule(3), instruments: [guitar, bass] });
    const gaps = unfilledFrom(ctx, []);

    expect(gaps.length).toBeGreaterThan(0);
    for (const gap of gaps) {
      expect(gap.eligible_candidates).toEqual([]);
      expect(gap.rejected_candidates).toEqual([]);
    }
  });
});

/**
 * `unfilledFrom` is the WRITE-side authority: it is what gets persisted into
 * `services.unfilled_positions`, so a mistake here is a gap row the coordinator
 * sees next to a lineup that contradicts it.
 */
describe('unfilledFrom with an opted-in instrument count', () => {
  const countGuitar: Instrument = { ...guitar, min_count: 1, max_count: 2, slot_counts: true };
  const pairGuitar: Instrument = { ...guitar, min_count: 2, max_count: 2, slot_counts: true };

  function guitaristAssignments(instrumentId: string, ids: string[]): ScheduleAssignment[] {
    return ids.map((id, index) => assignment({
      id: `g-${index}`, member_id: id, role_id: 'role-inst',
      role: { ...backupRole, id: 'role-inst', name: 'Instrumentalist' },
      instrument_id: instrumentId,
    }));
  }

  it('reports no gap for one guitarist when the row asks for min 1 / max 2', () => {
    const ctx = context({ rules: backupRule(3), instruments: [countGuitar] });
    const lineup = [...fullLineup(3), ...guitaristAssignments(countGuitar.id, ['m-g1'])];

    expect(unfilledFrom(ctx, lineup)).toEqual([]);
  });

  it('reports the numeric shortfall as required_slots when a count is missed', () => {
    const ctx = context({ rules: backupRule(3), instruments: [pairGuitar] });
    const lineup = [...fullLineup(3), ...guitaristAssignments(pairGuitar.id, ['m-g1'])];

    expect(unfilledFrom(ctx, lineup)).toEqual([
      expect.objectContaining({ role_name: 'Guitar', required_slots: 1, message: expect.stringContaining('Only 1 of 2 Guitar assigned') }),
    ]);
  });

  it('keeps the presence test and its message byte-identical when the flag is off', () => {
    // Same `max_count: 2`, no opt-in: the row is an absence, not a shortfall, and
    // reads exactly as it did before counts existed.
    const legacy = { ...countGuitar, slot_counts: false };
    const ctx = context({ rules: backupRule(3), instruments: [legacy] });

    expect(unfilledFrom(ctx, fullLineup(3))).toEqual([
      expect.objectContaining({ role_name: 'Guitar', required_slots: 1, message: 'Required Guitar is not assigned for week 1.' }),
    ]);
    // And a min_count of 2 with the flag off still demands only ONE.
    const legacyPair = { ...pairGuitar, slot_counts: false };
    const pairCtx = context({ rules: backupRule(3), instruments: [legacyPair] });
    expect(unfilledFrom(pairCtx, fullLineup(3))).toEqual([
      expect.objectContaining({ role_name: 'Guitar', required_slots: 1 }),
    ]);
  });

  it('never reports required_slots below 1', () => {
    const ctx = context({ rules: backupRule(3), instruments: [pairGuitar] });
    const zero = unfilledFrom(ctx, fullLineup(3));
    expect(zero).toEqual([expect.objectContaining({ role_name: 'Guitar', required_slots: 2 })]);
    for (const gap of zero) expect(gap.required_slots).toBeGreaterThanOrEqual(1);
  });

  it('ignores assignments for a different instrument when counting', () => {
    const ctx = context({ rules: backupRule(3), instruments: [countGuitar] });
    const lineup = [...fullLineup(3), ...guitaristAssignments('some-other-instrument', ['m-g1'])];

    expect(unfilledFrom(ctx, lineup)).toEqual([
      expect.objectContaining({ role_name: 'Guitar', required_slots: 1 }),
    ]);
  });

  it('reports no gap at all for an opted-in row that requires none of the instrument', () => {
    // `min_count: 0` with the flag on is a legal, legal-to-store configuration
    // ("up to max, none required"). The position is not required, so an empty
    // slot is not a gap: reporting one would put a coordinator in the position of
    // filling a role the catalogue does not actually demand.
    const noneRequired: Instrument = { ...guitar, min_count: 0, max_count: 2, slot_counts: true };
    const ctx = context({ rules: backupRule(3), instruments: [noneRequired] });

    expect(unfilledFrom(ctx, fullLineup(3))).toEqual([]);
    // Nor does a shortfall in the OPTIONAL part become a gap: one of two is the
    // configured happy path for min 0 / max 2.
    expect(unfilledFrom(ctx, [...fullLineup(3), ...guitaristAssignments(noneRequired.id, ['m-g1'])])).toEqual([]);
  });
});

describe('applyOverrides: the coordinator licence surface', () => {
  it('downgrades an availability conflict to a warning that names where it is re-asserted', () => {
    const outcome = applyOverrides([result()], { availability: true });

    expect(outcome.overridden_checks).toEqual(['availability']);
    expect(outcome.results[0].severity).toBe('warning');
    // Disclosed, not silent: the warning says publish will re-check it.
    expect(outcome.results[0].deferred_until).toBe('publish');
    expect(outcome.results[0].recommendation).toContain('coordinator override: availability');
    // The original finding text survives so the audit still shows what was ignored.
    expect(outcome.results[0].message).toBe('Member is unavailable for week 1');
  });

  it('downgrades an instrument-qualification conflict', () => {
    const outcome = applyOverrides(
      [result({ check: 'instrument_qualification', rule_type: 'role_validation' })],
      { instrument_qualification: true },
    );

    expect(outcome.overridden_checks).toEqual(['instrument_qualification']);
    expect(outcome.results[0].severity).toBe('warning');
  });

  it('reports each axis once even when several members trip it', () => {
    const outcome = applyOverrides(
      [result({ member_id: 'm1' }), result({ member_id: 'm2' }), result({ member_id: 'm3' })],
      { availability: true },
    );

    expect(outcome.overridden_checks).toEqual(['availability']);
    expect(outcome.results.every((item) => item.severity === 'warning')).toBe(true);
  });

  it('leaves a result that is already non-critical alone and claims no axis for it', () => {
    const warning = result({ severity: 'warning', deferred_until: 'validate' });
    const outcome = applyOverrides([warning], { availability: true });

    // Claiming the axis here would write "the coordinator overrode availability"
    // into the audit trail for a finding that was never blocking.
    expect(outcome.overridden_checks).toEqual([]);
    expect(outcome.results[0]).toBe(warning);
  });

  it('ignores a licence key that is not one of the two allowlisted axes', () => {
    // A `leader_qualification: true` key is a client bug or an attempt to widen the
    // surface. It must downgrade nothing and, critically, be reported as unused
    // rather than quietly honoured.
    const outcome = applyOverrides(
      [result({ check: 'leader_qualification', rule_type: 'role_validation' })],
      { leader_qualification: true } as never,
    );

    expect(outcome.overridden_checks).toEqual([]);
    expect(outcome.results[0].severity).toBe('critical');
  });

  it('never downgrades a hard check, whatever the licence object claims', () => {
    // Rule 2, 3, 5, 6 and 7, plus the non-deferrable half of Rule 4. A licence
    // exists for availability and instrument skill only; if this list ever grows a
    // name, the test is what stops the product shipping that hole.
    const hard: ValidationResult[] = [
      result({ check: 'active_member', rule_type: 'active_member_check' }),
      result({ check: 'assignment_limit', rule_type: 'assignment_limit' }),
      result({ check: 'dual_role', rule_type: 'dual_role_check' }),
      result({ check: 'leader_count_multiple', rule_type: 'leader_count' }),
      result({ check: 'leader_count_missing', rule_type: 'leader_count' }),
      result({ check: 'backup_count_max', rule_type: 'backup_count' }),
      result({ check: 'leader_qualification', rule_type: 'role_validation' }),
      result({ check: 'role_qualification', rule_type: 'role_validation' }),
      result({ check: 'devotion_missing', rule_type: 'role_validation' }),
      result({ check: 'required_instrument_missing', rule_type: 'instrument_constraint' }),
    ];

    const outcome = applyOverrides(hard, { availability: true, instrument_qualification: true });

    expect(outcome.overridden_checks).toEqual([]);
    expect(outcome.results.map((item) => item.severity)).toEqual(hard.map(() => 'critical'));
    expect(outcome.results.every((item) => item.deferred_until === undefined)).toBe(true);
  });

  it('is a no-op for a false or absent licence', () => {
    const finding = result();
    for (const overrides of [undefined, {}, { availability: false }]) {
      const outcome = applyOverrides([finding], overrides);
      expect(outcome.results[0]).toBe(finding);
      expect(outcome.overridden_checks).toEqual([]);
    }
  });

  it('applies the licence to the findings it covers without touching the rest', () => {
    const hard = result({ check: 'leader_qualification', rule_type: 'role_validation' });
    const outcome = applyOverrides([hard, result()], { availability: true });

    expect(outcome.results[0]).toBe(hard);
    expect(outcome.results[1].severity).toBe('warning');
    expect(outcome.results).toHaveLength(2);
  });
});

describe('hasActiveOverrides', () => {
  it('is false for absent, empty, and all-false licences', () => {
    expect(hasActiveOverrides(undefined)).toBe(false);
    expect(hasActiveOverrides({})).toBe(false);
    expect(hasActiveOverrides({ availability: false, instrument_qualification: false })).toBe(false);
  });

  it('is true when at least one axis is licensed', () => {
    expect(hasActiveOverrides({ availability: true })).toBe(true);
    expect(hasActiveOverrides({ availability: false, instrument_qualification: true })).toBe(true);
  });
});
