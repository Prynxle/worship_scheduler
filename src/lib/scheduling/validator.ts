import {
  ScheduleContext,
  ValidationResult,
  ValidationStage,
} from '../types/scheduling';
import { Member } from '../types/database';
import { isWeeklyUnavailable } from './availability';
import { isBackupRoleName, isDevotionRoleName, isWorshipLeaderRoleName } from './role-classifier';
import {
  assignmentLimitFor,
  backupRuleNumbers,
  hasDevotionHolder,
  isBackupAssignment,
  isDevotionAssignment,
  minSlotsFor,
  requiredInstruments,
  stageOf,
} from './required-roles';

/**
 * The ONLY four criticals a `draft` may defer, enumerated in one place.
 *
 * A missing leader, a short backup count, an unassigned required instrument and
 * the Devotion role are the four gaps the product must be able to publish a
 * DRAFT around. Everything else in this file is absent from this set on
 * purpose, and the set is deliberately a literal rather than a per-call-site
 * flag: a new check is hard by default, so nobody can relax an invariant by
 * forgetting a boolean.
 *
 * Explicitly NOT deferrable, and never overridable: more than one leader
 * (Rule 5), more than `max_allowed` backups (Rule 4), inactive members
 * (Rule 6), dual role (Rule 3), and leader-role qualification (Rule 7).
 */
const DEFERABLE_DRAFT_CHECKS = new Set([
  'leader_count_missing',
  'backup_count_min',
  'devotion_missing',
  'required_instrument_missing',
]);

/** The only two checks a coordinator override may downgrade. */
const OVERRIDABLE_CHECKS = new Set(['availability', 'instrument_qualification']);

export class ScheduleValidator {
  private context: ScheduleContext;
  private stage: ValidationStage;

  constructor(context: ScheduleContext) {
    this.context = context;
    // Default 'final': a caller that does not think about stages must get the
    // strict behaviour, not the lenient one.
    this.stage = stageOf(context);
  }

  async validate(): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];
    results.push(...this.checkAvailability());
    results.push(...this.checkActiveMembers());
    results.push(...this.checkAssignmentLimits());
    results.push(...this.checkDualRoles());
    results.push(...this.checkLeaderCount());
    results.push(...this.checkBackupCount());
    results.push(...this.checkRequiredRoles());
    results.push(...this.checkRoleQualifications());
    results.push(...this.checkCooldown());
    results.push(...this.checkFairness());
    results.push(...this.checkLeaderRotation());

    return results;
  }

  /**
   * The single stage choke point. Every result passes through here, so the
   * complete set of invariant relaxations is enumerable by reading one
   * function plus `DEFERABLE_DRAFT_CHECKS`, and a new check cannot opt out of
   * it by accident.
   */
  private report(result: ValidationResult): ValidationResult {
    const overridable = OVERRIDABLE_CHECKS.has(result.check);
    if (this.stage === 'draft' && result.severity === 'critical' && DEFERABLE_DRAFT_CHECKS.has(result.check)) {
      return { ...result, severity: 'warning', deferred_until: 'validate', overridable };
    }
    return overridable ? { ...result, overridable } : result;
  }

  private checkAvailability(): ValidationResult[] {
    const results: ValidationResult[] = [];

    for (const assignment of this.context.existing_assignments) {
      const member = this.context.all_members.find((m) => m.id === assignment.member_id);
      if (!member) continue;

      const isUnavailable = member.availability?.some((a) => {
        if (!['pending', 'approved'].includes(a.status)) return false;
        if (isWeeklyUnavailable(a, this.context.service.week_number, this.context.service.month, this.context.service.year)) {
          return true;
        }
        if (a.type === 'recurring' && a.week_number === this.context.service.week_number &&
          (a.month === undefined || a.month === this.context.service.month) &&
          (a.year === undefined || a.year === this.context.service.year)) {
          return true;
        }
        if (a.type === 'date' && a.date) {
          return this.sameDate(a.date, this.context.service.date);
        }
        if (['vacation', 'temporary_leave', 'emergency_leave', 'recurring'].includes(a.type) && a.date) {
          const serviceDate = new Date(`${this.context.service.date.slice(0, 10)}T00:00:00`);
          const start = new Date(a.date);
          const end = a.end_date ? new Date(a.end_date) : start;
          return serviceDate >= start && serviceDate <= end;
        }
        return false;
      });

      if (isUnavailable) {
        results.push(this.report({
          rule_type: 'availability_check',
          check: 'availability',
          severity: 'critical',
          member_id: member.id,
          member_name: member.full_name,
          message: `${member.full_name} is unavailable for week ${this.context.service.week_number}`,
          recommendation: 'Find an available replacement',
        }));
      }
    }

    return results;
  }

  private checkActiveMembers(): ValidationResult[] {
    return this.context.existing_assignments.flatMap((assignment) => {
      const member = this.context.all_members.find((candidate) => candidate.id === assignment.member_id);
      if (!member || member.status === 'active') return [];
      return [this.report({
        rule_type: 'active_member_check',
        check: 'active_member',
        severity: 'critical' as const,
        member_id: member.id,
        member_name: member.full_name,
        message: `${member.full_name} is inactive and cannot be assigned`,
        recommendation: 'Assign an active member',
      })];
    });
  }

  private checkAssignmentLimits(): ValidationResult[] {
    const results: ValidationResult[] = [];
    const monthCounts = this.getMonthAssignmentCounts();

    for (const assignment of this.context.existing_assignments) {
      const member = this.context.all_members.find((m) => m.id === assignment.member_id);
      if (!member) continue;

      const count = monthCounts.get(member.id) || 0;
      const maxAllowed = assignmentLimitFor(this.context, member);

      if (count > maxAllowed) {
        results.push(this.report({
          rule_type: 'assignment_limit',
          check: 'assignment_limit',
          severity: 'critical',
          member_id: member.id,
          member_name: member.full_name,
          message: `${member.full_name} has ${count} assignments (max: ${maxAllowed})`,
          recommendation: 'Remove an assignment or increase member limit',
        }));
      }
    }

    return results;
  }

  private checkDualRoles(): ValidationResult[] {
    const results: ValidationResult[] = [];
    const roleCounts = new Map<string, { member: Member; count: number }>();

    for (const assignment of this.context.existing_assignments) {
      const member = this.context.all_members.find((m) => m.id === assignment.member_id);
      if (!member) continue;

      const existing = roleCounts.get(member.id);
      if (existing) {
        results.push(this.report({
          rule_type: 'dual_role_check',
          check: 'dual_role',
          severity: 'critical',
          member_id: member.id,
          member_name: member.full_name,
          message: `${member.full_name} is assigned to multiple roles`,
          recommendation: 'Remove one of the duplicate assignments',
        }));
      } else {
        roleCounts.set(member.id, { member, count: 1 });
      }
    }

    return results;
  }

  private checkLeaderCount(): ValidationResult[] {
    const results: ValidationResult[] = [];
    const leaders = this.context.existing_assignments.filter((a) => a.is_leader);

    if (leaders.length === 0) {
      // Deferrable: a draft may have no leader yet. Rule 5 is still enforced at
      // validate and publish.
      results.push(this.report({
        rule_type: 'leader_count',
        check: 'leader_count_missing',
        severity: 'critical',
        message: 'No worship leader assigned',
        recommendation: 'Assign exactly one worship leader',
      }));
    } else if (leaders.length > 1) {
      // NEVER deferrable. An over-assigned month is a real double-booking, not
      // an unfilled gap; deferring it would let a draft claim a valid lineup.
      results.push(this.report({
        rule_type: 'leader_count',
        check: 'leader_count_multiple',
        severity: 'critical',
        message: `Multiple worship leaders assigned (${leaders.length})`,
        recommendation: 'Assign exactly one worship leader',
      }));
    }

    return results;
  }

  private checkBackupCount(): ValidationResult[] {
    const results: ValidationResult[] = [];
    const backups = this.context.existing_assignments.filter(isBackupAssignment);
    const { min: minRequired, max: maxAllowed } = backupRuleNumbers(this.context);

    if (backups.length < minRequired) {
      // Deferrable: this is a shortfall, the canonical unfilled position.
      results.push(this.report({
        rule_type: 'backup_count',
        check: 'backup_count_min',
        severity: 'critical',
        message: `Only ${backups.length} backup singers assigned (minimum: ${minRequired})`,
        recommendation: 'Add more backup singers',
      }));
    }

    if (backups.length > maxAllowed) {
      // NEVER deferrable. Overflow is an over-subscription, not a gap.
      results.push(this.report({
        rule_type: 'backup_count',
        check: 'backup_count_max',
        severity: 'critical',
        message: `${backups.length} backup singers assigned (maximum: ${maxAllowed})`,
        recommendation: 'Remove excess backup singers',
      }));
    }

    return results;
  }

  private checkRequiredRoles(): ValidationResult[] {
    const results: ValidationResult[] = [];
    const assignments = this.context.existing_assignments;

    if (hasDevotionHolder(this.context.all_members) && !assignments.some(isDevotionAssignment)) {
      results.push(this.report({
        rule_type: 'role_validation', check: 'devotion_missing', severity: 'critical', role_name: 'Devotion',
        message: 'Required Devotion role is not assigned', recommendation: 'Assign a qualified devotion member',
      }));
    }
    // Catalogue-derived (H1): a required instrument nobody holds a skill for
    // now produces a finding here instead of vanishing.
    for (const instrument of requiredInstruments(this.context)) {
      // COUNT-based only when the row opted in. `minSlotsFor` is 1 without
      // `slot_counts = true`, so for every existing instrument this is still the
      // presence test and the emitted finding is unchanged. The check name,
      // severity, and `DEFERABLE_DRAFT_CHECKS` membership are deliberately the
      // same for a shortfall as for an absence: "one of two guitarists" is the
      // same defect the coordinator resolves by adding a guitarist, and a
      // shortfall must not become a new, harder critical that a draft cannot
      // publish around.
      const required = minSlotsFor(instrument);
      const assigned = this.context.existing_assignments.filter((assignment) => assignment.instrument_id === instrument.id).length;
      if (assigned < required) {
        results.push(this.report({
          rule_type: 'instrument_constraint', check: 'required_instrument_missing', severity: 'critical', role_name: instrument.name,
          message: `Required ${instrument.name} is not assigned`, recommendation: `Assign a qualified ${instrument.name} player`,
        }));
      }
    }
    return results;
  }

  private checkRoleQualifications(): ValidationResult[] {
    const results: ValidationResult[] = [];

    for (const assignment of this.context.existing_assignments) {
      const member = this.context.all_members.find((m) => m.id === assignment.member_id);
      if (!member) continue;

      if (assignment.is_leader) {
        const hasLeaderRole = member.roles?.some((r) => r.role && isWorshipLeaderRoleName(r.role.name));
        if (!hasLeaderRole) {
          // Rule 7. Not deferrable and NOT overridable: a coordinator override
          // for availability must never be able to license an unqualified leader.
          results.push(this.report({
            rule_type: 'role_validation',
            check: 'leader_qualification',
            severity: 'critical',
            member_id: member.id,
            member_name: member.full_name,
            message: `${member.full_name} is not qualified as Worship Leader`,
            recommendation: 'Assign a qualified worship leader',
          }));
        }
      } else if (assignment.role && (isBackupRoleName(assignment.role.name) || isDevotionRoleName(assignment.role.name))) {
        const roleName = assignment.role.name.toLowerCase();
        const qualified = member.roles?.some((role) => role.role_id === assignment.role_id || role.role?.name.toLowerCase() === roleName);
        if (!qualified) {
          results.push(this.report({
            rule_type: 'role_validation',
            check: 'role_qualification',
            severity: 'critical',
            member_id: member.id,
            member_name: member.full_name,
            role_name: assignment.role.name,
            message: `${member.full_name} is not qualified for ${assignment.role.name}`,
            recommendation: `Assign a member qualified for ${assignment.role.name}`,
          }));
        }
      } else if (assignment.instrument_id) {
        const hasSkill = member.skills?.some((skill) => skill.instrument_id === assignment.instrument_id);
        if (!hasSkill) {
          // The one qualification axis a coordinator MAY override.
          results.push(this.report({
            rule_type: 'role_validation',
            check: 'instrument_qualification',
            severity: 'critical',
            member_id: member.id,
            member_name: member.full_name,
            role_name: assignment.instrument?.name,
            message: `${member.full_name} is not qualified for ${assignment.instrument?.name ?? 'the assigned instrument'}`,
            recommendation: 'Assign a member with the required instrument skill',
          }));
        }
      }
    }

    return results;
  }

  private checkCooldown(): ValidationResult[] {
    const results: ValidationResult[] = [];
    const cooldownWeeks = this.context.rules.find(
      (r) => r.rule_type === 'cooldown'
    )?.rule_config.weeks as number || 1;

    for (const assignment of this.context.existing_assignments) {
      const member = this.context.all_members.find((m) => m.id === assignment.member_id);
      if (!member) continue;

      if (member.last_scheduled_date) {
        const lastDate = new Date(member.last_scheduled_date);
        const currentDate = new Date(this.context.service.date);
        const weeksDiff = Math.floor(
          (currentDate.getTime() - lastDate.getTime()) / (7 * 24 * 60 * 60 * 1000)
        );

        if (weeksDiff < cooldownWeeks && weeksDiff > 0) {
          // Rule 9 is advisory by product definition, and stays a warning.
          results.push(this.report({
            rule_type: 'cooldown',
            check: 'cooldown',
            severity: 'warning',
            member_id: member.id,
            member_name: member.full_name,
            message: `${member.full_name} was scheduled ${weeksDiff} week(s) ago`,
            recommendation: 'Consider a different member for better rotation',
          }));
        }
      }
    }

    return results;
  }

  private checkFairness(): ValidationResult[] {
    const results: ValidationResult[] = [];
    const monthCounts = this.getMonthAssignmentCounts();
    const avgCount = Array.from(monthCounts.values()).reduce((a, b) => a + b, 0) / monthCounts.size;

    for (const [memberId, count] of monthCounts) {
      if (count > avgCount * 1.5) {
        const member = this.context.all_members.find((m) => m.id === memberId);
        results.push(this.report({
          rule_type: 'fairness',
          check: 'fairness',
          severity: 'suggestion',
          member_id: memberId,
          member_name: member?.full_name,
          message: `${member?.full_name} has more assignments than average`,
          recommendation: 'Consider redistributing assignments',
        }));
      }
    }

    return results;
  }

  private checkLeaderRotation(): ValidationResult[] {
    const results: ValidationResult[] = [];

    const leaders = this.context.existing_assignments.filter((a) => a.is_leader);
    if (leaders.length > 0) {
      const leaderId = leaders[0].member_id;
      const recentLeaders = this.context.existing_assignments
        .filter((a) => a.is_leader && a.member_id === leaderId)
        .length;

      if (recentLeaders > 2) {
        const member = this.context.all_members.find((m) => m.id === leaderId);
        // Rule 10 is advisory, and stays a warning.
        results.push(this.report({
          rule_type: 'leader_rotation',
          check: 'leader_rotation',
          severity: 'warning',
          member_id: leaderId,
          member_name: member?.full_name,
          message: `${member?.full_name} has been leader ${recentLeaders} times recently`,
          recommendation: 'Rotate to a different worship leader',
        }));
      }
    }

    return results;
  }

  private getMonthAssignmentCounts(): Map<string, number> {
    const counts = new Map<string, number>();

    for (const assignment of this.context.monthly_assignments ?? this.context.existing_assignments) {
      const current = counts.get(assignment.member_id) || 0;
      counts.set(assignment.member_id, current + 1);
    }

    return counts;
  }

  private sameDate(left: string, right: string): boolean {
    return new Date(left).toISOString().slice(0, 10) === new Date(right).toISOString().slice(0, 10);
  }
}
