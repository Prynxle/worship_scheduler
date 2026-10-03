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
 * Deliberate scope limit, REVERSED 2026-10-02. This used to read: "`is_required`
 * is the sole source of 'required', and `min_count` is NOT swept into a slot
 * count." That was the wrong call for the product, because a coordinator's only
 * way to ask for two guitarists a week was to add a second catalogue row
 * (`Guitar 1`, `Guitar 2`), which the engine could not honour anyway: the slot
 * builder keyed slots on the instrument id, so `max_count` never produced a
 * second player and a `Guitar 2` row marked `is_required = false` was never
 * emitted at all. The count was configuration the product could not express.
 *
 * The replacement is an OPT-IN column, `instruments.slot_counts`, not a
 * change in default behaviour:
 *
 *   - `slot_counts` absent or false -> `slotCountsFor` false, `minSlotsFor`
 *     and `maxSlotsFor` 1. Byte-identical to the previous behaviour, for every
 *     row that exists today.
 *   - `slot_counts = true` -> `required_slots = min_count`, and
 *     `optional_slots = max_count - min_count` extra non-blocking slots.
 *
 * Two properties of that choice are load-bearing. First, opt-in means this
 * module is safe to deploy BEFORE the migration that adds the column and safe
 * to keep running AFTER rows opt in; neither ordering can mis-schedule a week.
 * Second, the behaviour must never be inferred from `max_count > min_count`, a
 * name allowlist, or a default-on flag. Every instrument that has ever been
 * configured with `max_count` above `min_count` was reading `max_count` as a
 * hand-off ceiling for one slot, and silently doubling those weeks would be a
 * scheduling change nobody asked for.
 */

export type RequiredPositionKind = 'leader' | 'backup' | 'devotion' | 'instrument';

export interface RequiredPosition {
  kind: RequiredPositionKind;
  /** Slot label, and the `role_name` a coordinator reads in `unfilled_positions`. */
  role_name: string;
  required_slots: number;
  /**
   * Extra NON-BLOCKING slots for this position. Always 0 outside the
   * opt-in count contract, so every pre-existing caller that reads only
   * `required_slots` keeps its current meaning: the number of slots that, when
   * unfilled, become a gap row.
   */
  optional_slots: number;
  instrument?: Instrument;
}

const LEADER_ROLE_NAME = 'Worship Leader';
const DEVOTION_ROLE_NAME = 'Devotion';
const BACKUP_ROLE_NAME = 'Backup';
const DEFAULT_BACKUP_MIN = 3;
const DEFAULT_ASSIGNMENT_MAX = 3;
const SINGLE_SLOT = 1;

/**
 * Has this instrument opted into count-driven slots?
 *
 * `=== true`, deliberately: a row written before the column existed, or any
 * object that reached this module without it (a cast DB row, a hand-built
 * context), is INERT. See the module header.
 */
export function slotCountsFor(instrument: Instrument | undefined): boolean {
  return instrument?.slot_counts === true;
}

/**
 * A non-negative integer count, or `null` when the value is missing or is not a
 * finite number.
 *
 * `0` is a VALID count and must survive: the database CHECK admits
 * `min_count >= 0`, so `min_count = 0, slot_counts = true` is a coordinator
 * saying "up to `max_count`, none required". Folding that to 1 would schedule a
 * guitarist nobody asked for and report a gap for a position that is not
 * required -- the exact silent mis-scheduling the opt-in flag exists to avoid.
 * Only a value the CHECK could never have stored degrades, and it degrades to
 * the legacy 1, not to 0.
 */
function countOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

/**
 * Hard slots this instrument demands. `1` unless the row opted in, which is
 * what makes a legacy `max_count = 2` row still emit exactly one slot.
 *
 * Opted in, this is `min_count` verbatim: the contract in the module header.
 */
export function minSlotsFor(instrument: Instrument | undefined): number {
  if (!slotCountsFor(instrument)) return SINGLE_SLOT;
  return countOrNull(instrument!.min_count) ?? SINGLE_SLOT;
}

/** Ceiling on players for this instrument. `1` unless the row opted in. */
export function maxSlotsFor(instrument: Instrument | undefined): number {
  if (!slotCountsFor(instrument)) return SINGLE_SLOT;
  const min = minSlotsFor(instrument);
  // `maxSlotsFor` can never be BELOW `minSlotsFor`: the database CHECK
  // enforces `max_count >= min_count` on opted-in rows, and clamping here means
  // a malformed row degrades to "no optional slots" instead of a negative count.
  // A missing `max_count` degrades to `min`, so an opted-in row can never grow
  // an optional slot out of absent data.
  return Math.max(min, countOrNull(instrument!.max_count) ?? min);
}

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
    { kind: 'leader', role_name: LEADER_ROLE_NAME, required_slots: 1, optional_slots: 0 },
  ];
  const { min } = backupRuleNumbers(context);
  for (let index = 0; index < min; index += 1) {
    positions.push({ kind: 'backup', role_name: BACKUP_ROLE_NAME, required_slots: 1, optional_slots: 0 });
  }
  if (hasDevotionHolder(context.all_members)) {
    positions.push({ kind: 'devotion', role_name: DEVOTION_ROLE_NAME, required_slots: 1, optional_slots: 0 });
  }
  for (const instrument of requiredInstruments(context)) {
    positions.push({
      kind: 'instrument', role_name: instrument.name, instrument,
      required_slots: minSlotsFor(instrument),
      optional_slots: maxSlotsFor(instrument) - minSlotsFor(instrument),
    });
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
