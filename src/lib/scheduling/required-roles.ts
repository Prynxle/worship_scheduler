import type { Instrument, Member, ScheduleAssignment } from '../types/database';
import type { ScheduleContext, ValidationStage } from '../types/scheduling';
import { isBackupRoleName, isDevotionRoleName, isWorshipLeaderRoleName } from './role-classifier';

/**
 * THE single owner of "which ministry positions must be filled".
 *
 * This module exists because the required-instrument definition was previously
 * derived independently in TWO places, from `member.skills[].instrument`:
 *
 *   engine.ts     (getInstruments) - created the slots
 *   validator.ts  (checkRequiredRoles) - reported the misses
 *
 * Both derivations are wrong in the same way. A required instrument with ZERO
 * skill-holders does not appear in `member.skills` at all, so it produced no
 * slot AND no validation finding: the gap was invisible rather than merely
 * failing. `ScheduleContext.instruments` carries the ministry's real catalogue
 * (`loadScheduleData` already loads it and `GET /api/schedule` already serves
 * it), so the fix is to read the catalogue instead of the skill rows.
 *
 * The skills-derived list survives ONLY as the `instruments === undefined`
 * fallback, which is why the check is `=== undefined` and not a truthiness or
 * length test: `route.test.ts` mocks `instruments: []`, and an empty catalogue
 * is a real answer (no required instruments), not an absent one.
 *
 * Deliberate scope limit: `instruments.is_required` is the sole source of
 * "required", and `min_count` is NOT swept into a slot count. A required
 * instrument demanding two players is a schema/configuration decision, not one
 * this module may make for the product.
 */

export type RequiredPositionKind = 'leader' | 'backup' | 'devotion' | 'instrument';

export interface RequiredPosition {
  kind: RequiredPositionKind;
  /** Slot label, and the `role_name` a coordinator reads in `unfilled_positions`. */
  role_name: string;
  required_slots: number;
  instrument?: Instrument;
}

const LEADER_ROLE_NAME = 'Worship Leader';
const DEVOTION_ROLE_NAME = 'Devotion';
const BACKUP_ROLE_NAME = 'Backup';
const DEFAULT_BACKUP_MIN = 3;
const DEFAULT_ASSIGNMENT_MAX = 3;

export function backupRuleNumbers(context: ScheduleContext): { min: number; max: number } {
  const config = context.rules.find((rule) => rule.rule_type === 'backup_count')?.rule_config ?? {};
  const min = typeof config.min_required === 'number' ? config.min_required : DEFAULT_BACKUP_MIN;
  const rawMax = typeof config.max_allowed === 'number' ? config.max_allowed : DEFAULT_BACKUP_MIN;
  return { min, max: Math.max(min, rawMax) };
}

/**
 * The single `isBackupAssignment` predicate.
 *
 * `validator.checkBackupCount` and the gap computation here MUST agree on what
 * counts as a backup, or the editor will refuse a lineup the engine reported as
 * complete. Exported so the validator uses this definition rather than keeping
 * its own copy.
 */
export function isBackupAssignment(assignment: ScheduleAssignment): boolean {
  if (assignment.is_leader) return false;
  if (assignment.instrument_id) return false;
  return !assignment.role || isBackupRoleName(assignment.role.name);
}

/** Shared with the validator so "is this the Devotion slot?" has one answer. */
export function isDevotionAssignment(assignment: ScheduleAssignment): boolean {
  return !assignment.is_leader && Boolean(assignment.role) && isDevotionRoleName(assignment.role!.name);
}

/**
 * Does the roster contain a member who could hold the Devotion role at all?
 *
 * Uses the shared classifier rather than the exact `=== 'devotion'` compare and
 * the exact `hasRole(member,'Devotion')` compare this replaces, so the seeded
 * 'Devotion Leader' name and any church-defined 'devotion ...' name are treated
 * identically everywhere.
 */
export function hasDevotionHolder(members: Member[]): boolean {
  return members.some((member) => member.roles?.some((item) => item.role?.is_active !== false && item.role && isDevotionRoleName(item.role.name)));
}

/** Required instruments, from the ministry catalogue, with the legacy fallback. */
export function requiredInstruments(context: ScheduleContext): Instrument[] {
  // `=== undefined` and nothing looser. See the module header.
  if (context.instruments !== undefined) {
    return context.instruments.filter((instrument) => instrument.is_required).sort((a, b) => a.id.localeCompare(b.id));
  }
  // Two passes: a type predicate cannot narrow the value it inspects, so the
  // `is_required` read has to happen after the undefined rows are gone.
  const skilled = context.all_members.flatMap((member) => member.skills?.map((skill) => skill.instrument) ?? []).filter((instrument): instrument is Instrument => instrument !== undefined && instrument !== null);
  return dedupeById(skilled.filter((instrument) => instrument.is_required));
}

function dedupeById(instruments: Instrument[]): Instrument[] {
  return instruments.filter((instrument, index, all) => all.findIndex((candidate) => candidate.id === instrument.id) === index).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Every position one service must fill, in a stable order.
 *
 * The engine turns these straight into assignment slots, so this is the only
 * definition of the slot set; `unfilledFrom` turns the same list into gaps.
 * They cannot drift because they are the same list.
 */
export function requiredPositions(context: ScheduleContext): RequiredPosition[] {
  const positions: RequiredPosition[] = [
    { kind: 'leader', role_name: LEADER_ROLE_NAME, required_slots: 1 },
  ];
  const { min } = backupRuleNumbers(context);
  for (let index = 0; index < min; index += 1) {
    positions.push({ kind: 'backup', role_name: BACKUP_ROLE_NAME, required_slots: 1 });
  }
  if (hasDevotionHolder(context.all_members)) {
    positions.push({ kind: 'devotion', role_name: DEVOTION_ROLE_NAME, required_slots: 1 });
  }
  for (const instrument of requiredInstruments(context)) {
    positions.push({ kind: 'instrument', role_name: instrument.name, required_slots: 1, instrument });
  }
  return positions;
}

export function assignmentLimitFor(context: ScheduleContext, member: Member): number {
  const configured = context.rules.find((rule) => rule.rule_type === 'assignment_limit')?.rule_config.default_max;
  return member.max_monthly_assignments || (typeof configured === 'number' ? configured : DEFAULT_ASSIGNMENT_MAX);
}

export function stageOf(context: ScheduleContext): ValidationStage {
  return context.validation_stage ?? 'final';
}

/** Is `name` a Worship Leader role name? Re-exported so callers need one import. */
export { isWorshipLeaderRoleName };
