import { Member, Role, Instrument, Service, ScheduleAssignment } from './database';

/**
 * Enforcement stage for validation severity.
 *
 * `draft`   - generation and manual editing. The four *gap* criticals (Rule 5
 *             zero leaders, Rule 4 backup minimum, a required instrument, the
 *             Devotion role) are reported as `warning` with `deferred_until`
 *             set, so an unfillable position no longer fails the whole month.
 * `final`   - the validate and publish surfaces. Nothing is deferred, so every
 *             invariant is a hard `critical` again.
 *
 * This is a change in enforcement TIMING, not a relaxation. More than one
 * leader and more than `max_allowed` backups are never degradable at any stage.
 */
export type ValidationStage = 'draft' | 'final';

export interface ScheduleContext {
  service: Service;
  church_id: string;
  month: number;
  year: number;
  week_number: number;
  existing_assignments: ScheduleAssignment[];
  /** Full month assignments for monthly limits and fairness when validating one service. */
  monthly_assignments?: ScheduleAssignment[];
  available_members: Member[];
  all_members: Member[];
  rules: SchedulingRuleConfig[];
  /** Assignments already committed in the target month/service scope. */
  historical_assignments?: ScheduleAssignment[];
  /** Generate these weeks as one optimization problem. */
  week_numbers?: number[];
  /** Optional ministry-level scheduling settings. */
  config?: SchedulingConfig;
  /**
   * The ministry's full instrument list, INCLUDING instruments nobody holds a
   * skill for.
   *
   * Required, not cosmetic: the pre-existing derivation walked
   * `all_members[].skills[].instrument`, so a required instrument with zero
   * skill-holders produced no slot at all and the gap was invisible rather than
   * merely failing. `undefined` means "no instrument catalogue was supplied" and
   * selects the legacy skills-derived fallback; an empty array is a real
   * catalogue with no required instruments and must NOT fall back.
   */
  instruments?: Instrument[];
  /** Defaults to `'final'`. Only the engine's draft pass sets `'draft'`. */
  validation_stage?: ValidationStage;
}

export interface FairnessWeights {
  monthly_workload: number;
  historical_workload: number;
  recent_workload: number;
  consecutive_assignment: number;
  role_workload: number;
  cooldown: number;
  leader_rotation: number;
}

export interface SchedulingConfig {
  allows_dual_role?: boolean;
  fairness_weights?: Partial<FairnessWeights>;
  cooldown_weeks?: number;
}

export interface SchedulingRuleConfig {
  rule_type: string;
  rule_config: Record<string, unknown>;
  severity: 'critical' | 'warning' | 'suggestion';
}

/**
 * One ministry position that could not be filled for a given service week.
 *
 * This is the domain shape behind both the `unfilled_positions` database column
 * and the `failures` array of `SchedulingFailureError`. It is deliberately the
 * SAME shape on both so a coordinator sees identical detail whether the month
 * failed outright or only partially filled.
 */
export interface UnfilledPosition {
  service_id?: string;
  week_number: number;
  date: string;
  /** Position label: 'Worship Leader', 'Backup', an instrument name, 'Devotion'. */
  role_name: string;
  required_slots: number;
  eligible_candidates: string[];
  rejected_candidates: Array<{ member_id: string; member_name: string; reason: string }>;
  message: string;
}

export interface ValidationResult {
  rule_type: string;
  /**
   * The single specific finding this result reports, and the ONLY key that
   * stage-deferral and override-downgrade may be keyed on.
   *
   * `rule_type` is far too coarse to be safe here: a missing Devotion role and a
   * member who is not qualified for their role both emit
   * `rule_type: 'role_validation'`, so degrading or downgrading by `rule_type`
   * would silently convert the Rule 7 qualification critical (hard, never
   * overridable) into a pass. `check` separates them.
   */
  check: string;
  severity: 'critical' | 'warning' | 'suggestion';
  member_id?: string;
  member_name?: string;
  role_name?: string;
  message: string;
  recommendation?: string;
  /**
   * Set when a `draft`-stage critical was downgraded to `warning`. Its
   * presence is the disclosure that keeps the downgrade from being silent: the
   * invariant is re-asserted at the named lifecycle transition instead.
   */
  deferred_until?: 'validate' | 'publish';
  /**
   * Marks the two axes a coordinator manual-assignment override may downgrade:
   * `availability` (Rule 1) and `instrument_qualification` (instrument skill)
   * ONLY. Set on the check regardless of severity so the override path can
   * match on it; `leader_qualification` and every other critical never carry it.
   */
  overridable?: boolean;
}

/**
 * A hard rejection that made the whole month ungeneratable.
 *
 * Structurally identical to `UnfilledPosition` and aliased rather than
 * redeclared: the same detail describes both a position the engine could not
 * fill and a month it could not generate at all, and two independent
 * declarations of one shape are exactly the drift this feature must not
 * introduce.
 */
export type SchedulingFailure = UnfilledPosition;

export class SchedulingFailureError extends Error {
  readonly failures: SchedulingFailure[];

  constructor(failures: SchedulingFailure[]) {
    super(failures.map((failure) => failure.message).join('; '));
    this.name = 'SchedulingFailureError';
    this.failures = failures;
  }
}

export interface ReplacementSuggestion {
  member: Member;
  role: Role;
  instrument?: Instrument;
  confidence_score: number;
  reasons: string[];
  fairness_score: number;
  skill_match: boolean;
  below_limit: boolean;
  no_cooldown: boolean;
}

export interface FairnessReport {
  member_id: string;
  member_name: string;
  assignment_count: number;
  max_allowed: number;
  utilization: number;
  fairness_score: number;
  status: 'underutilized' | 'balanced' | 'overutilized';
}

export interface DevotionSlot {
  member_id: string;
  member_name: string;
  position: number;
  week_available: boolean;
  already_scheduled: boolean;
  confidence_score: number;
}

export interface ScheduleGenerationRequest {
  church_id: string;
  month: number;
  year: number;
  service_type: string;
  ministry_id: string;
  week_numbers: number[];
}

export interface ScheduleGenerationResult {
  services: GeneratedService[];
  validation_results: ValidationResult[];
  warnings: ValidationResult[];
  suggestions: ValidationResult[];
}

export interface GeneratedService {
  week_number: number;
  date: string;
  leader: Member | null;
  backup_singers: Member[];
  instrumentalists: InstrumentAssignment[];
  devotion: Member | null;
  conflicts: ValidationResult[];
  /**
   * Optional so the existing typed `GeneratedService` literals in the test
   * harness keep compiling; every production producer sets it, and the read
   * boundary normalises with `?? []`.
   */
  unfilled_positions?: UnfilledPosition[];
}

export interface InstrumentAssignment {
  instrument: Instrument;
  member: Member | null;
  is_fallback: boolean;
}

export interface AnalyticsData {
  assignment_counts: MemberAssignmentCount[];
  availability_heatmap: AvailabilityHeatmapEntry[];
  fairness_score: number;
  workload_distribution: WorkloadEntry[];
  leader_distribution: LeaderDistribution[];
  conflict_summary: ConflictSummary;
}

export interface MemberAssignmentCount {
  member_id: string;
  member_name: string;
  count: number;
  max_allowed: number;
  roles: string[];
}

export interface AvailabilityHeatmapEntry {
  week_number: number;
  unavailable_count: number;
  unavailable_members: string[];
}

export interface WorkloadEntry {
  member_id: string;
  member_name: string;
  assignments: number;
  percentage: number;
}

export interface LeaderDistribution {
  leader_id: string;
  leader_name: string;
  count: number;
}

export interface ConflictSummary {
  total: number;
  critical: number;
  warnings: number;
  suggestions: number;
}
