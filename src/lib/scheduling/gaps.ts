import type { ScheduleAssignment, ServiceActiveOverrides } from '../types/database';
import type { ScheduleContext, UnfilledPosition, ValidationResult } from '../types/scheduling';
import {
  backupRuleNumbers,
  isBackupAssignment,
  isDevotionAssignment,
  minSlotsFor,
  requiredInstruments,
  requiredPositions,
} from './required-roles';

/**
 * The WRITE-side gap authority: given a service's assignments, which ministry
 * positions are unfilled, and which validation findings a coordinator is
 * licensed to override.
 *
 * This is deliberately not the read path. `GET /api/schedule` serves the
 * persisted `services.unfilled_positions` column, so the editor shows exactly
 * what the last write computed. Two authorities on the read path would mean two
 * answers, and the second one would recompute against a context the client does
 * not have.
 *
 * Everything here is pure so the invariant is unit-testable without a database.
 */

const LEADER_ROLE_NAME = 'Worship Leader';
const BACKUP_ROLE_NAME = 'Backup';
const DEVOTION_ROLE_NAME = 'Devotion';

function gap(overrides: Omit<UnfilledPosition, 'eligible_candidates' | 'rejected_candidates'>): UnfilledPosition {
  // A recomputed gap has no solve-time search history to report, so the
  // rejection arrays are empty. That is the honest value: this gap was found by
  // reading a lineup, not by exhausting a candidate pool, and inventing a reason
  // here would be a fabricated explanation a coordinator acts on.
  return { ...overrides, eligible_candidates: [], rejected_candidates: [] };
}

/**
 * Recompute the unfilled positions for ONE service from its assignments.
 *
 * Driven by `requiredPositions` so a manual edit can never produce a gap list
 * describing a different set of positions than the generator tried to fill.
 */
export function unfilledFrom(context: ScheduleContext, assignments: ScheduleAssignment[]): UnfilledPosition[] {
  const service = context.service;
  const base = { service_id: service.id, week_number: service.week_number, date: service.date };
  const gaps: UnfilledPosition[] = [];

  if (!assignments.some((assignment) => assignment.is_leader)) {
    gaps.push(gap({ ...base, role_name: LEADER_ROLE_NAME, required_slots: 1, message: `No worship leader assigned for week ${service.week_number}.` }));
  }
  const { min } = backupRuleNumbers(context);
  const backupCount = assignments.filter(isBackupAssignment).length;
  if (backupCount < min) {
    gaps.push(gap({ ...base, role_name: BACKUP_ROLE_NAME, required_slots: min - backupCount, message: `Only ${backupCount} of ${min} backup singers assigned for week ${service.week_number}.` }));
  }
  const hasDevotionPosition = requiredPositions(context).some((position) => position.kind === 'devotion');
  if (hasDevotionPosition && !assignments.some(isDevotionAssignment)) {
    gaps.push(gap({ ...base, role_name: DEVOTION_ROLE_NAME, required_slots: 1, message: `Required Devotion role is not assigned for week ${service.week_number}.` }));
  }
  for (const instrument of requiredInstruments(context)) {
    // COUNT-based only when the catalogue row opted in. `minSlotsFor` returns 1
    // for every row without `slot_counts = true`, and `0 assigned < 1` is the
    // historical presence test, so a flag-off instrument's gap is the same row,
    // the same `required_slots`, and the same message it has always been.
    const required = minSlotsFor(instrument);
    const assigned = assignments.filter((assignment) => assignment.instrument_id === instrument.id).length;
    if (assigned < required) {
      gaps.push(gap({
        ...base,
        role_name: instrument.name,
        required_slots: Math.max(1, required - assigned),
        message: required <= 1
          ? `Required ${instrument.name} is not assigned for week ${service.week_number}.`
          : `Only ${assigned} of ${required} ${instrument.name} assigned for week ${service.week_number}.`,
      }));
    }
  }
  return gaps;
}

/**
 * The complete override surface. A flag not in this map cannot downgrade
 * anything, so adding a rule to the validator cannot accidentally make it
 * overridable.
 */
const OVERRIDE_TARGETS = {
  availability: 'availability',
  instrument_qualification: 'instrument_qualification',
} as const;

export type OverrideAxis = keyof typeof OVERRIDE_TARGETS;

export interface OverrideOutcome {
  results: ValidationResult[];
  /** The `check` names actually downgraded, for the audit payload. */
  overridden_checks: OverrideAxis[];
}

/**
 * Apply a coordinator's service-level override licences to validation results.
 *
 * SECURITY SCOPE. Only the two axes in `OVERRIDE_TARGETS` are ever downgraded,
 * and only a `critical`. Specifically NOT overridable, by construction rather
 * than by review: leader-role qualification (Rule 7), inactive members
 * (Rule 6), multiple leaders (Rule 5), backup overflow (Rule 4), dual role
 * (Rule 3) and the monthly limit (Rule 2). A coordinator who can reach a
 * `backup_count_min`, `required_instrument_missing` and `devotion_missing` (Rule 3),
 * and the monthly limit (Rule 2). A licence may never be used to book an
 * unqualified leader, an inactive member, or a double-booked month; the only thing
 * an override buys is a deliberate, recorded licence for a member's availability
 * and their instrument skill.
 *
 * The downgrade is disclosed, never silent: the result becomes a `warning` and
 * keeps a `deferred_until` value naming the transition that will re-assert it.
 */
export function applyOverrides(results: ValidationResult[], overrides: ServiceActiveOverrides | undefined): OverrideOutcome {
  if (!overrides) return { results, overridden_checks: [] };
  const licensed = new Set<OverrideAxis>(Object.keys(overrides).filter((axis): axis is OverrideAxis =>
    Object.prototype.hasOwnProperty.call(OVERRIDE_TARGETS, axis) && overrides[axis as OverrideAxis] === true));
  if (licensed.size === 0) return { results, overridden_checks: [] };

  const overridden_checks: OverrideAxis[] = [];
  const applied = results.map((result) => {
    const axis = [...licensed].find((candidate) => OVERRIDE_TARGETS[candidate] === result.check);
    // Only the two checks, and only while they are still blocking.
    if (!axis || result.severity !== 'critical') return result;
    if (!overridden_checks.includes(axis)) overridden_checks.push(axis);
    return { ...result, severity: 'warning' as const, deferred_until: 'publish' as const, recommendation: `${result.recommendation ?? ''} (coordinator override: ${axis})`.trim() };
  });
  return { results: applied, overridden_checks };
}

/** True when the service carries at least one active override licence. */
export function hasActiveOverrides(overrides: ServiceActiveOverrides | undefined): boolean {
  return Object.values(overrides ?? {}).some((value) => value === true);
}
