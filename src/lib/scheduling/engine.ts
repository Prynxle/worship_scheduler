import {
  GeneratedService,
  ScheduleContext,
  SchedulingFailure,
  SchedulingFailureError,
} from '../types/scheduling';
import { Availability, Instrument, Member, Role, ScheduleAssignment } from '../types/database';
import { formatLocalDate, getWeekDate } from '../utils/date-utils';
import { FairnessScorer, TemporaryMemberState } from './scorer';
import { isWeeklyUnavailable } from './availability';

type SlotKind = 'leader' | 'backup' | 'devotion' | 'instrument';
interface AssignmentSlot { id: string; weekNumber: number; date: string; kind: SlotKind; roleName: string; role?: Role; instrument?: Instrument; isLeader: boolean; }
interface AssignmentChoice { slot: AssignmentSlot; member: Member; score: number; previousState?: TemporaryMemberState; }
interface Rejection { member: Member; reason: string; }
interface ServiceState { choices: AssignmentChoice[]; usedMemberIds: Set<string>; }

const BACKUP_NAMES = new Set(['singer', 'singers', 'vocalist', 'vocal', 'backup', 'backup singer', 'backup singers']);

export class SchedulingEngine {
  private readonly context: ScheduleContext;
  private readonly scorer: FairnessScorer;
  private readonly memberState: Map<string, TemporaryMemberState>;
  private readonly serviceStates = new Map<number, ServiceState>();
  private readonly failures: SchedulingFailure[] = [];
  private searchNodes = 0;

  constructor(context: ScheduleContext) {
    this.context = context;
    this.scorer = new FairnessScorer(context.config);
    this.memberState = this.initializeState();
  }

  async generateSchedule(): Promise<GeneratedService[]> {
    const weeks = [...new Set(this.context.week_numbers ?? [this.context.service.week_number])].sort((a, b) => a - b);
    const slots = weeks.flatMap((weekNumber) => this.buildSlots(weekNumber));
    const assignments = this.solve(slots);
    if (!assignments) {
      throw new SchedulingFailureError(this.failures.length > 0 ? this.failures : [{
        service_id: this.context.service.id, week_number: this.context.week_number, date: this.context.service.date,
        role_name: 'schedule', required_slots: slots.length, eligible_candidates: [], rejected_candidates: [],
        message: 'No valid schedule satisfies the configured hard constraints.',
      }]);
    }
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
      this.failures.push(this.createFailure(selected.slot, selected.pool.rejections));
      return null;
    }
    const cooldownWeeks = this.context.config?.cooldown_weeks ?? this.getRuleNumber('cooldown', 'weeks', 1);
    const ranked = selected.pool.candidates.map((member) => {
      const score = this.scorer.score(member, this.memberState.get(member.id)!, selected.slot.roleName,
        selected.slot.weekNumber, selected.slot.isLeader, cooldownWeeks, selected.slot.date);
      return { member, score };
    }).sort((a, b) => {
      const byScore = a.score.total - b.score.total;
      if (byScore !== 0) return byScore;
      const recent = this.memberState.get(a.member.id)!.recentAssignments - this.memberState.get(b.member.id)!.recentAssignments;
      if (recent !== 0) return recent;
      const role = (this.memberState.get(a.member.id)!.roleHistory.get(selected.slot.roleName) ?? 0) -
        (this.memberState.get(b.member.id)!.roleHistory.get(selected.slot.roleName) ?? 0);
      return role || a.member.id.localeCompare(b.member.id);
    });
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
  }

  private rollback(choice: AssignmentChoice): void {
    const service = this.getServiceState(choice.slot.weekNumber);
    const index = service.choices.indexOf(choice);
    if (index >= 0) service.choices.splice(index, 1);
    if (!service.choices.some((item) => item.member.id === choice.member.id)) service.usedMemberIds.delete(choice.member.id);
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
    if (slot.kind === 'leader' && !this.hasRole(member, 'Worship Leader')) return 'not qualified for Worship Leader';
    if (slot.kind === 'backup' && !this.hasAnyRole(member, BACKUP_NAMES)) return 'not qualified for Backup';
    if (slot.kind === 'devotion' && !this.hasRole(member, 'Devotion')) return 'not qualified for Devotion';
    if (slot.kind === 'instrument' && !member.skills?.some((skill) => skill.instrument_id === slot.instrument?.id)) return `not qualified for ${slot.instrument?.name ?? 'instrument'}`;
    return null;
  }

  private buildSlots(weekNumber: number): AssignmentSlot[] {
    const date = formatLocalDate(getWeekDate(weekNumber, this.context.month, this.context.year));
    const slots: AssignmentSlot[] = [{ id: `${weekNumber}:leader`, weekNumber, date, kind: 'leader', roleName: 'Worship Leader', isLeader: true, role: this.findRole('Worship Leader') }];
    for (let index = 1; index <= this.getRuleNumber('backup_count', 'min_required', 3); index += 1) {
      slots.push({ id: `${weekNumber}:backup:${index}`, weekNumber, date, kind: 'backup', roleName: 'Backup', role: this.findRoleByNames(BACKUP_NAMES), isLeader: false });
    }
    if (this.context.all_members.some((member) => this.hasRole(member, 'Devotion'))) {
      slots.push({ id: `${weekNumber}:devotion`, weekNumber, date, kind: 'devotion', roleName: 'Devotion', role: this.findRole('Devotion'), isLeader: false });
    }
    for (const instrument of this.getInstruments()) {
      if (instrument.is_required) slots.push({ id: `${weekNumber}:instrument:${instrument.id}`, weekNumber, date, kind: 'instrument', roleName: instrument.name, instrument, isLeader: false });
    }
    return slots;
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
      conflicts: [],
    };
  }

  private async validateGeneratedServices(services: GeneratedService[], assignments: AssignmentChoice[]): Promise<void> {
    const { ScheduleValidator } = await import('./validator');
    for (const service of services) {
      const context: ScheduleContext = {
        ...this.context,
        service: { ...this.context.service, week_number: service.week_number, date: service.date },
        existing_assignments: this.toScheduleAssignments(service, assignments),
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
      instrument_id: choice.slot.instrument?.id, is_leader: choice.slot.isLeader, status: 'pending',
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

  private slotPriority(slot: AssignmentSlot): number {
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
  private hasRole(member: Member, roleName: string): boolean { return member.roles?.some((role) => role.role?.is_active !== false && role.role?.name.toLowerCase() === roleName.toLowerCase()) ?? false; }
  private hasAnyRole(member: Member, roleNames: Set<string>): boolean { return member.roles?.some((role) => role.role?.is_active !== false && roleNames.has(role.role?.name.toLowerCase() ?? '')) ?? false; }
  private findRole(roleName: string): Role | undefined { return this.context.all_members.flatMap((member) => member.roles ?? []).map((item) => item.role).find((role): role is Role => role?.name.toLowerCase() === roleName.toLowerCase()); }
  private findRoleByNames(names: Set<string>): Role | undefined { return this.context.all_members.flatMap((member) => member.roles ?? []).map((item) => item.role).find((role): role is Role => role !== undefined && names.has(role.name.toLowerCase())); }
  private getInstruments(): Instrument[] { return this.context.all_members.flatMap((member) => member.skills?.map((skill) => skill.instrument) ?? []).filter((instrument): instrument is Instrument => Boolean(instrument)).filter((instrument, index, all) => all.findIndex((candidate) => candidate.id === instrument.id) === index).sort((a, b) => a.id.localeCompare(b.id)); }
  private getRuleNumber(ruleType: string, key: string, fallback: number): number { const value = this.context.rules.find((rule) => rule.rule_type === ruleType)?.rule_config[key]; return typeof value === 'number' ? value : fallback; }
  private assignmentRoleName(assignment: ScheduleAssignment): string { if (assignment.is_leader) return 'Worship Leader'; return assignment.role?.name ?? assignment.instrument?.name ?? 'Assignment'; }
}
