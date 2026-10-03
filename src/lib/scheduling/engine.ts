import {
  GeneratedService,
  ScheduleContext,
  SchedulingFailure,
  SchedulingFailureError,
  UnfilledPosition,
} from '../types/scheduling';
import { Availability, Instrument, Member, Role, ScheduleAssignment } from '../types/database';
import { formatLocalDate, getWeekDate } from '../utils/date-utils';
import { FairnessScorer, TemporaryMemberState } from './scorer';
import { isWeeklyUnavailable } from './availability';
import { isBackupRoleName, isWorshipLeaderRoleName } from './role-classifier';
import { requiredPositions } from './required-roles';

type SlotKind = 'leader' | 'backup' | 'devotion' | 'instrument';
interface AssignmentSlot { id: string; weekNumber: number; date: string; kind: SlotKind; roleName: string; role?: Role; instrument?: Instrument; isLeader: boolean; /**
   * A non-blocking extra slot for an opt-in count instrument.
   *
   * Optional slots are NEVER entered into `solve`, so they can never be
   * backtracked, never displace a hard-slot member, and never record a gap.
   * See `fillOptional`.
   */
  optional: boolean; }
interface AssignmentChoice { slot: AssignmentSlot; member: Member; score: number; previousState?: TemporaryMemberState; previousGapCount?: number; }
interface Rejection { member: Member; reason: string; }
interface ServiceState { choices: AssignmentChoice[]; usedMemberIds: Set<string>; }

export class SchedulingEngine {
  private readonly context: ScheduleContext;
  private readonly scorer: FairnessScorer;
  private readonly memberState: Map<string, TemporaryMemberState>;
  private readonly serviceStates = new Map<number, ServiceState>();
  private readonly failures: SchedulingFailure[] = [];
  /**
   * Positions the search could not fill, per week, with why each candidate was
   * rejected. This is the month's honest partial result: previously a single
   * unassignable slot aborted the entire generation and the coordinator saw
   * nothing at all.
   */
  private readonly gaps: UnfilledPosition[] = [];
  private searchNodes = 0;

  constructor(context: ScheduleContext) {
    this.context = context;
    this.scorer = new FairnessScorer(context.config);
    this.memberState = this.initializeState();
  }

  async generateSchedule(): Promise<GeneratedService[]> {
    const weeks = [...new Set(this.context.week_numbers ?? [this.context.service.week_number])].sort((a, b) => a - b);
    const slots = weeks.flatMap((weekNumber) => this.buildSlots(weekNumber));
    // TWO PHASES, and the phase boundary is a correctness requirement, not a
    // scheduling optimisation.
    //
    // Phase 1 (`solve`) sees ONLY hard slots. It is the full backtracking
    // search, and it is allowed to place anybody anywhere, because every slot
    // in it is a position the service cannot be published without.
    //
    // Phase 2 (`fillOptional`) then adds the opt-in extra players to the
    // ALREADY-ACCEPTED state. It never reopens a decision phase 1 made.
    //
    // Doing this in one pass is the trap: with `Guitar` at min 1 / max 2 a
    // single-pass search may hand the only available guitarist to the OPTIONAL
    // slot, leaving the HARD slot with an empty pool. The week then reports
    // `Guitar` unfilled - a critical the coordinator cannot do anything about -
    // while a guitarist is visibly sitting in that very service. Phase 1 makes
    // that state unreachable rather than merely unlikely.
    const hard = this.solve(slots.filter((slot) => !slot.optional));
    if (!hard) {
      throw new SchedulingFailureError(this.failures.length > 0 ? this.failures : [{
        service_id: this.context.service.id, week_number: this.context.week_number, date: this.context.service.date,
        role_name: 'schedule', required_slots: slots.filter((slot) => !slot.optional).length, eligible_candidates: [], rejected_candidates: [],
        message: 'No valid schedule satisfies the configured hard constraints.',
      }]);
    }
    this.fillOptional(slots.filter((slot) => slot.optional));
    const assignments = [...this.serviceStates.values()].flatMap((service) => service.choices);
    const services = weeks.map((weekNumber) => this.toGeneratedService(weekNumber, assignments));
    await this.validateGeneratedServices(services, assignments);
    return services;
  }

  private initializeState(): Map<string, TemporaryMemberState> {
    const historical = this.context.historical_assignments ?? [];
    const targetDate = new Date(this.context.service.date).getTime();
    const state = new Map<string, TemporaryMemberState>();
    for (const member of this.context.all_members) {
      const roleHistory = new Map<string, number>();
      for (const assignment of historical.filter((item) => item.member_id === member.id)) {
        const roleName = this.assignmentRoleName(assignment);
        roleHistory.set(roleName, (roleHistory.get(roleName) ?? 0) + 1);
      }
      const lastScheduled = member.last_scheduled_date ? new Date(member.last_scheduled_date).getTime() : 0;
      const recentFromLastDate = lastScheduled > 0 && targetDate >= lastScheduled && targetDate - lastScheduled <= 56 * 86_400_000 ? 1 : 0;
      const recentHistorical = historical.filter((item) => {
        if (item.member_id !== member.id) return false;
        const date = new Date(item.created_at).getTime();
        return Number.isFinite(date) && targetDate >= date && targetDate - date <= 56 * 86_400_000;
      }).length;
      state.set(member.id, {
        currentMonthAssignments: this.context.existing_assignments.filter((item) => item.member_id === member.id).length,
        totalAssignments: Math.max(member.total_assignments, historical.filter((item) => item.member_id === member.id).length),
        recentAssignments: Math.max(recentFromLastDate, recentHistorical),
        lastAssignedDate: member.last_scheduled_date,
        lastAssignedWeek: undefined,
        consecutiveAssignments: 0,
        roleHistory,
        leaderAssignments: historical.filter((item) => item.member_id === member.id && item.is_leader).length,
      });
    }
    return state;
  }

  private solve(unfilledSlots: AssignmentSlot[]): AssignmentChoice[] | null {
    if (++this.searchNodes > 25_000) return null;
    if (unfilledSlots.length === 0) return [...this.serviceStates.values()].flatMap((service) => service.choices);
    const evaluated = unfilledSlots.map((slot) => ({ slot, pool: this.getEligibleCandidates(slot) }));
    evaluated.sort((a, b) => a.pool.candidates.length - b.pool.candidates.length || this.slotPriority(a.slot) - this.slotPriority(b.slot) || a.slot.id.localeCompare(b.slot.id));
    const selected = evaluated[0];
    if (selected.pool.candidates.length === 0) {
      // Record the gap and SKIP the slot instead of failing the whole month.
      //
      // Skipping is sound, not a heuristic shortcut: every candidate-eligibility
      // test in `rejectionReason` is MONOTONICALLY WORSENING as the search
      // progresses. Assignment only ever adds to `usedMemberIds` and to the
      // monthly counters, and the other tests read fixed per-member data. So a
      // slot with an empty pool now has an empty pool at every later state
      // reachable from here, and retrying it could never succeed. Backtracking
      // past it would be wasted work, not a missed assignment.
      //
      // `optional` slots are excluded from this branch by construction
      // (`generateSchedule` filters them out before calling `solve`), and this
      // guard keeps that true if a future caller forgets: an optional slot must
      // never reach the gap log, whatever else changes.
      if (!selected.slot.optional) this.gaps.push(this.createFailure(selected.slot, selected.pool.rejections));
      return this.solve(unfilledSlots.filter((slot) => slot.id !== selected.slot.id));
    }
    const cooldownWeeks = this.cooldownWeeks();
    const ranked = this.rankCandidates(selected.slot, selected.pool.candidates, cooldownWeeks);
    const remaining = unfilledSlots.filter((slot) => slot.id !== selected.slot.id);
    for (const candidate of ranked) {
      const choice = { slot: selected.slot, member: candidate.member, score: candidate.score.total };
      this.apply(choice);
      const result = this.solve(remaining);
      if (result) return result;
      this.rollback(choice);
    }
    return null;
  }

  private cooldownWeeks(): number {
    return this.context.config?.cooldown_weeks ?? this.getRuleNumber('cooldown', 'weeks', 1);
  }

  /**
   * The one candidate ordering, shared by the backtracking search and the
   * optional-slot fill so a Phase 2 placement is scored identically to the
   * Phase 1 placement it sits beside. Fully deterministic: the last key is the
   * member id, so equal scores never resolve by map or query order.
   */
  private rankCandidates(slot: AssignmentSlot, candidates: Member[], cooldownWeeks: number): { member: Member; score: { total: number } }[] {
    return candidates.map((member) => {
      const score = this.scorer.score(member, this.memberState.get(member.id)!, slot.roleName,
        slot.weekNumber, slot.isLeader, cooldownWeeks, slot.date);
      return { member, score };
    }).sort((a, b) => {
      const byScore = a.score.total - b.score.total;
      if (byScore !== 0) return byScore;
      const recent = this.memberState.get(a.member.id)!.recentAssignments - this.memberState.get(b.member.id)!.recentAssignments;
      if (recent !== 0) return recent;
      const role = (this.memberState.get(a.member.id)!.roleHistory.get(slot.roleName) ?? 0) -
        (this.memberState.get(b.member.id)!.roleHistory.get(slot.roleName) ?? 0);
      return role || a.member.id.localeCompare(b.member.id);
    });
  }

  private apply(choice: AssignmentChoice): void {
    const service = this.getServiceState(choice.slot.weekNumber);
    service.choices.push(choice);
    service.usedMemberIds.add(choice.member.id);
    const state = this.memberState.get(choice.member.id)!;
    choice.previousState = { ...state, roleHistory: new Map(state.roleHistory) };
    state.currentMonthAssignments += 1;
    state.totalAssignments += 1;
    state.recentAssignments += 1;
    state.consecutiveAssignments = state.lastAssignedWeek === choice.slot.weekNumber - 1 ? state.consecutiveAssignments + 1 : 1;
    state.lastAssignedWeek = choice.slot.weekNumber;
    state.lastAssignedDate = choice.slot.date;
    state.roleHistory.set(choice.slot.roleName, (state.roleHistory.get(choice.slot.roleName) ?? 0) + 1);
    if (choice.slot.isLeader) state.leaderAssignments += 1;
    // The gap log is part of the search state this choice mutates: a branch
    // that records a gap must lose it when the branch is abandoned.
    choice.previousGapCount = this.gaps.length;
  }

  private rollback(choice: AssignmentChoice): void {
    const service = this.getServiceState(choice.slot.weekNumber);
    const index = service.choices.indexOf(choice);
    if (index >= 0) service.choices.splice(index, 1);
    if (!service.choices.some((item) => item.member.id === choice.member.id)) service.usedMemberIds.delete(choice.member.id);
    // Discard the gaps recorded while this branch was live. They describe why
    // the search could not fill a position UNDER THIS CANDIDATE; a sibling
    // candidate may well fill it, and keeping the row would report a phantom
    // gap on the accepted schedule.
    if (choice.previousGapCount !== undefined) this.gaps.length = choice.previousGapCount;
    const state = this.memberState.get(choice.member.id)!;
    if (choice.previousState) {
      Object.assign(state, choice.previousState);
      state.roleHistory = new Map(choice.previousState.roleHistory);
    }
  }

  private getEligibleCandidates(slot: AssignmentSlot): { candidates: Member[]; rejections: Rejection[] } {
    const service = this.getServiceState(slot.weekNumber);
    const candidates: Member[] = [];
    const rejections: Rejection[] = [];
    for (const member of [...this.context.all_members].sort((a, b) => a.id.localeCompare(b.id))) {
      const reason = this.rejectionReason(member, slot, service);
      if (reason) rejections.push({ member, reason }); else candidates.push(member);
    }
    return { candidates, rejections };
  }

  private rejectionReason(member: Member, slot: AssignmentSlot, service: ServiceState): string | null {
    if (member.status !== 'active') return 'inactive';
    if (this.isUnavailable(member, slot.weekNumber, slot.date)) return 'unavailable';
    const state = this.memberState.get(member.id);
    if (!state) return 'member state unavailable';
    if (state.currentMonthAssignments >= (member.max_monthly_assignments || this.getRuleNumber('assignment_limit', 'default_max', 3))) return 'monthly limit reached';
    if (!this.context.config?.allows_dual_role && service.usedMemberIds.has(member.id)) return 'already assigned in this service';
    if (slot.kind === 'leader' && !member.roles?.some((role) => role.role?.is_active !== false && role.role && isWorshipLeaderRoleName(role.role.name))) return 'not qualified for Worship Leader';
    if (slot.kind === 'backup' && !member.roles?.some((role) => role.role?.is_active !== false && role.role && isBackupRoleName(role.role.name))) return 'not qualified for Backup';
    if (slot.kind === 'instrument' && !member.skills?.some((skill) => skill.instrument_id === slot.instrument?.id)) return `not qualified for ${slot.instrument?.name ?? 'instrument'}`;
    return null;
  }

  /**
   * Slot construction is delegated to `requiredPositions` so the validator
   * reports gaps for exactly the positions the generator tried to fill. The two
   * used to derive that list independently, which is how a required instrument
   * with no skill-holder could be invisible to both.
   *
   * Per-week context is required because `requiredPositions` is month-scoped in
   * its rules and catalogue reads but returns the same list for every week.
   */
  private buildSlots(weekNumber: number): AssignmentSlot[] {
    const date = formatLocalDate(getWeekDate(weekNumber, this.context.month, this.context.year));
    const perWeek = { ...this.context, service: { ...this.context.service, week_number: weekNumber, date } };
    const slots: AssignmentSlot[] = [];
    let backupIndex = 0;
    for (const position of requiredPositions(perWeek)) {
      if (position.kind === 'leader') {
        slots.push({ id: `${weekNumber}:leader`, weekNumber, date, kind: 'leader', roleName: 'Worship Leader', isLeader: true, optional: false, role: this.findRoleByPredicate(isWorshipLeaderRoleName) });
      } else if (position.kind === 'backup') {
        backupIndex += 1;
        slots.push({ id: `${weekNumber}:backup:${backupIndex}`, weekNumber, date, kind: 'backup', roleName: 'Backup', role: this.findRoleByPredicate(isBackupRoleName), isLeader: false, optional: false });
      } else if (position.kind === 'devotion') {
        slots.push({ id: `${weekNumber}:devotion`, weekNumber, date, kind: 'devotion', roleName: 'Devotion', role: this.findRoleByPredicate(isBackupRoleName), isLeader: false, optional: false });
      } else {
        const instrument = position.instrument!;
        for (let index = 0; index < position.required_slots; index += 1) {
          // `solve` removes a selected slot by `id`, so ids must be unique or
          // `min_count > 1` would silently drop every hard slot sharing that id.
          // The FIRST slot keeps the historical id exactly, so a min-1
          // instrument's slot id - and therefore its gap rejection text and
          // ordering - is byte-identical to before this change.
          const suffix = index === 0 ? '' : `:${index + 1}`;
          slots.push({ id: `${weekNumber}:instrument:${instrument.id}${suffix}`, weekNumber, date, kind: 'instrument', roleName: instrument.name, instrument, isLeader: false, optional: false });
        }
        // The suffix is an id-uniqueness device, NOT a gap-suppression device.
        // `solve` removes a selected slot by `id`, so hard and optional slots
        // sharing an id would make the removal ambiguous - and `:2` is the same
        // problem one step further down, where `min_count > 1` puts several hard
        // slots on one instrument.
        //
        // What actually stops an unfilled optional slot from becoming a phantom
        // `Guitar` row is the phase boundary in `generateSchedule`:
        // `this.solve(slots.filter((slot) => !slot.optional))`. Optional slots
        // are excluded from the backtracking search entirely, so no optional
        // `SchedulingFailure` can ever be recorded for `gapsForWeek` to find and
        // sum into `required_slots`. (`fillOptional` additionally skips an empty
        // pool without recording a gap, which keeps the same guarantee on the
        // code path that runs without backtracking.)
        for (let index = 0; index < position.optional_slots; index += 1) {
          const suffix = index === 0 ? ':opt' : `:opt:${index + 1}`;
          slots.push({ id: `${weekNumber}:instrument:${instrument.id}${suffix}`, weekNumber, date, kind: 'instrument', roleName: instrument.name, instrument, isLeader: false, optional: true });
        }
      }
    }
    return slots;
  }

  /**
   * Phase 2: fill the opt-in extra slots against the accepted state.
   *
   * The guard the phase boundary buys, stated as a contract rather than left to
   * search ordering: this method NEVER calls `rollback` and NEVER passes an
   * optional slot to `solve`. Every candidate it places is drawn from a pool
   * recomputed from live state at this instant, so a hard-slot member is
   * already in `usedMemberIds` (excluded as "already assigned in this service")
   * and already counted against `currentMonthAssignments`. There is therefore
   * no branch for an optional slot to take, and no hard-slot assignment it can
   * undo or re-rank.
   *
   * An empty pool is skipped SILENTLY. "If not available at least 1" is the
   * product rule: the optional slot is a courtesy, so failing it is not a gap.
   * It must not reach `createFailure`, `this.gaps`, or any persisted
   * `rejected_candidates`, or a perfectly valid single-guitarist week would
   * arrive in the editor with a `Guitar` row the coordinator must dismiss.
   */
  private fillOptional(slots: AssignmentSlot[]): void {
    if (slots.length === 0) return;
    const cooldownWeeks = this.context.config?.cooldown_weeks ?? this.getRuleNumber('cooldown', 'weeks', 1);
    const order = [...slots].sort((a, b) => this.slotPriority(a) - this.slotPriority(b) || a.weekNumber - b.weekNumber || a.id.localeCompare(b.id));
    for (const slot of order) {
      const pool = this.getEligibleCandidates(slot);
      if (pool.candidates.length === 0) continue;
      const best = this.rankCandidates(slot, pool.candidates, cooldownWeeks)[0];
      this.apply({ slot, member: best.member, score: best.score.total });
    }
  }

  private toGeneratedService(weekNumber: number, assignments: AssignmentChoice[]): GeneratedService {
    const choices = assignments.filter((choice) => choice.slot.weekNumber === weekNumber);
    return {
      week_number: weekNumber,
      date: choices[0]?.slot.date ?? formatLocalDate(getWeekDate(weekNumber, this.context.month, this.context.year)),
      leader: choices.find((choice) => choice.slot.kind === 'leader')?.member ?? null,
      backup_singers: choices.filter((choice) => choice.slot.kind === 'backup').map((choice) => choice.member),
      instrumentalists: choices.filter((choice) => choice.slot.kind === 'instrument' && choice.slot.instrument).map((choice) => ({ instrument: choice.slot.instrument!, member: choice.member, is_fallback: false })),
      devotion: choices.find((choice) => choice.slot.kind === 'devotion')?.member ?? null,
      devotion_role: choices.find((choice) => choice.slot.kind === 'devotion')?.slot.role ?? null,
      conflicts: [],
      // Always an array, never absent: the persistence and read layers must not
      // each have to decide what a missing gap list means.
      unfilled_positions: this.gapsForWeek(weekNumber),
    };
  }

  /**
   * Collapse this week's skipped slots into one row per unfilled POSITION.
   *
   * The search skips slots, so a short backup count skips N slots and would
   * otherwise emit N identical `Backup` rows. `requiredPositions`/
   * `unfilledFrom` on the write path report the same shortfall as a single row
   * with `required_slots = N`, and the read path and the editor must not
   * disagree with the generator about how many rows a gap is.
   *
   * Rejections are deduped by member, keeping the first reason: the same member
   * rejected for the same reason once per skipped backup slot is one fact, and
   * repeating it N times would misrepresent the roster.
   */
  private gapsForWeek(weekNumber: number): UnfilledPosition[] {
    const byRole = new Map<string, UnfilledPosition>();
    for (const item of this.gaps) {
      if (item.week_number !== weekNumber) continue;
      const existing = byRole.get(item.role_name);
      if (!existing) {
        byRole.set(item.role_name, { ...item, rejected_candidates: [...item.rejected_candidates] });
        continue;
      }
      existing.required_slots += item.required_slots;
      for (const candidate of item.rejected_candidates) {
        if (!existing.rejected_candidates.some((other) => other.member_id === candidate.member_id)) {
          existing.rejected_candidates.push(candidate);
        }
      }
    }
    return [...byRole.values()];
  }

  /**
   * Independent re-validation of what the generator produced, run at `draft`
   * stage on purpose.
   *
   * Draft stage means the four gap criticals arrive already downgraded to
   * warnings carrying `deferred_until: 'validate'`, so a partial week is a
   * reportable result instead of a thrown error. Any remaining CRITICAL is one
   * of the never-deferrable invariants (multiple leaders, backup overflow,
   * inactive member, dual role, unqualified leader, monthly limit) and still
   * throws: the generator has produced something the product forbids, which is
   * a bug in the generator, not a gap a coordinator can resolve.
   */
  private async validateGeneratedServices(services: GeneratedService[], assignments: AssignmentChoice[]): Promise<void> {
    const { ScheduleValidator } = await import('./validator');
    for (const service of services) {
      const context: ScheduleContext = {
        ...this.context,
        service: { ...this.context.service, week_number: service.week_number, date: service.date },
        existing_assignments: this.toScheduleAssignments(service, assignments),
        validation_stage: 'draft',
      };
      const results = await new ScheduleValidator(context).validate();
      service.conflicts = results;
      if (results.some((result) => result.severity === 'critical')) {
        throw new SchedulingFailureError([{
          service_id: this.context.service.id, week_number: service.week_number, date: service.date,
          role_name: 'service validation', required_slots: assignments.filter((item) => item.slot.weekNumber === service.week_number).length,
          eligible_candidates: [], rejected_candidates: [], message: `Generated service for week ${service.week_number} failed independent validation.`,
        }]);
      }
    }
  }

  private toScheduleAssignments(service: GeneratedService, assignments: AssignmentChoice[]): ScheduleAssignment[] {
    return assignments.filter((choice) => choice.slot.weekNumber === service.week_number).map((choice, index) => ({
      id: `generated-${service.week_number}-${index}`, service_id: this.context.service.id, member_id: choice.member.id,
      role_id: choice.slot.role?.id ?? `generated-${choice.slot.roleName.toLowerCase().replace(/\s+/g, '-')}`,
      instrument_id: choice.slot.instrument?.id, is_leader: choice.slot.isLeader,
      is_devotion: choice.slot.kind === 'devotion', status: 'pending',
      created_at: service.date, updated_at: service.date, member: choice.member, role: choice.slot.role, instrument: choice.slot.instrument,
    }));
  }

  private createFailure(slot: AssignmentSlot, rejections: Rejection[]): SchedulingFailure {
    return {
      service_id: this.context.service.id, week_number: slot.weekNumber, date: slot.date, role_name: slot.roleName, required_slots: 1,
      eligible_candidates: [], rejected_candidates: rejections.map(({ member, reason }) => ({ member_id: member.id, member_name: member.full_name, reason })),
      message: `No eligible candidate for ${slot.roleName} in week ${slot.weekNumber}.`,
    };
  }

  /**
   * Ties only, so this is a fairness preference (Rules 8/10) rather than a hard
   * constraint, but the ordering is still stable.
   *
   * Optional slots rank AFTER every hard slot. This is a second line of defence
   * behind the phase boundary in `generateSchedule`: if an optional slot ever
   * reaches a comparator again, it loses the tie and the hard slot is resolved
   * first.
   */
  private slotPriority(slot: AssignmentSlot): number {
    if (slot.optional) return 4;
    return slot.kind === 'leader' ? 0 : slot.kind === 'instrument' ? 1 : slot.kind === 'devotion' ? 2 : 3;
  }

  private getServiceState(weekNumber: number): ServiceState {
    let state = this.serviceStates.get(weekNumber);
    if (!state) { state = { choices: [], usedMemberIds: new Set() }; this.serviceStates.set(weekNumber, state); }
    return state;
  }

  private isUnavailable(member: Member, weekNumber: number, date: string): boolean {
    return member.availability?.some((availability: Availability) => {
      if (!['pending', 'approved'].includes(availability.status)) return false;
      if (isWeeklyUnavailable(availability, weekNumber, this.context.month, this.context.year)) return true;
      if (availability.type === 'recurring' && availability.week_number === weekNumber &&
        (availability.month === undefined || availability.month === this.context.month) &&
        (availability.year === undefined || availability.year === this.context.year)) return true;
      const target = new Date(`${date}T00:00:00`);
      if (availability.type === 'date' && availability.date) return this.sameDate(availability.date, date);
      if (['vacation', 'temporary_leave', 'emergency_leave', 'recurring'].includes(availability.type) && availability.date) {
        const start = new Date(availability.date); const end = availability.end_date ? new Date(availability.end_date) : start;
        return target >= start && target <= end;
      }
      return false;
    }) ?? false;
  }

  private sameDate(left: string, right: string): boolean { return new Date(left).toISOString().slice(0, 10) === right; }
  private findRoleByPredicate(predicate: (name: string) => boolean): Role | undefined { return this.context.all_members.flatMap((member) => member.roles ?? []).map((item) => item.role).find((role): role is Role => role !== undefined && predicate(role.name)); }
  private getRuleNumber(ruleType: string, key: string, fallback: number): number { const value = this.context.rules.find((rule) => rule.rule_type === ruleType)?.rule_config[key]; return typeof value === 'number' ? value : fallback; }
  private assignmentRoleName(assignment: ScheduleAssignment): string { if (assignment.is_leader) return 'Worship Leader'; return assignment.role?.name ?? assignment.instrument?.name ?? 'Assignment'; }
}
