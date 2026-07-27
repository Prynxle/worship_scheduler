import {
  ScheduleContext,
  ValidationResult,
} from '../types/scheduling';
import { Member, ScheduleAssignment } from '../types/database';

export class ScheduleValidator {
  private context: ScheduleContext;

  constructor(context: ScheduleContext) {
    this.context = context;
  }

  async validate(): Promise<ValidationResult[]> {
    const results: ValidationResult[] = [];

    results.push(...this.checkAvailability());
    results.push(...this.checkAssignmentLimits());
    results.push(...this.checkDualRoles());
    results.push(...this.checkLeaderCount());
    results.push(...this.checkBackupCount());
    results.push(...this.checkRoleQualifications());
    results.push(...this.checkCooldown());
    results.push(...this.checkFairness());
    results.push(...this.checkLeaderRotation());

    return results;
  }

  private checkAvailability(): ValidationResult[] {
    const results: ValidationResult[] = [];

    for (const assignment of this.context.existing_assignments) {
      const member = this.context.all_members.find((m) => m.id === assignment.member_id);
      if (!member) continue;

      const isUnavailable = member.availability?.some((a) => {
        if (a.type === 'weekly' && a.week_number === this.context.service.week_number) {
          return true;
        }
        if (a.type === 'date' && a.date) {
          const date = new Date(a.date);
          const serviceDate = new Date(this.context.service.date);
          return date.toDateString() === serviceDate.toDateString();
        }
        return false;
      });

      if (isUnavailable) {
        results.push({
          rule_type: 'availability_check',
          severity: 'critical',
          member_id: member.id,
          member_name: member.full_name,
          message: `${member.full_name} is unavailable for week ${this.context.service.week_number}`,
          recommendation: 'Find an available replacement',
        });
      }
    }

    return results;
  }

  private checkAssignmentLimits(): ValidationResult[] {
    const results: ValidationResult[] = [];
    const monthCounts = this.getMonthAssignmentCounts();

    for (const assignment of this.context.existing_assignments) {
      const member = this.context.all_members.find((m) => m.id === assignment.member_id);
      if (!member) continue;

      const count = monthCounts.get(member.id) || 0;
      const maxAllowed = member.max_monthly_assignments || this.context.rules.find(
        (r) => r.rule_type === 'assignment_limit'
      )?.rule_config.default_max as number || 3;

      if (count > maxAllowed) {
        results.push({
          rule_type: 'assignment_limit',
          severity: 'critical',
          member_id: member.id,
          member_name: member.full_name,
          message: `${member.full_name} has ${count} assignments (max: ${maxAllowed})`,
          recommendation: 'Remove an assignment or increase member limit',
        });
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
        results.push({
          rule_type: 'dual_role_check',
          severity: 'critical',
          member_id: member.id,
          member_name: member.full_name,
          message: `${member.full_name} is assigned to multiple roles`,
          recommendation: 'Remove one of the duplicate assignments',
        });
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
      results.push({
        rule_type: 'leader_count',
        severity: 'critical',
        message: 'No worship leader assigned',
        recommendation: 'Assign exactly one worship leader',
      });
    } else if (leaders.length > 1) {
      results.push({
        rule_type: 'leader_count',
        severity: 'critical',
        message: `Multiple worship leaders assigned (${leaders.length})`,
        recommendation: 'Assign exactly one worship leader',
      });
    }

    return results;
  }

  private checkBackupCount(): ValidationResult[] {
    const results: ValidationResult[] = [];
    const backups = this.context.existing_assignments.filter((a) => !a.is_leader);

    const minRequired = this.context.rules.find(
      (r) => r.rule_type === 'backup_count'
    )?.rule_config.min_required as number || 3;

    const maxAllowed = this.context.rules.find(
      (r) => r.rule_type === 'backup_count'
    )?.rule_config.max_allowed as number || 5;

    if (backups.length < minRequired) {
      results.push({
        rule_type: 'backup_count',
        severity: 'critical',
        message: `Only ${backups.length} backup singers assigned (minimum: ${minRequired})`,
        recommendation: 'Add more backup singers',
      });
    }

    if (backups.length > maxAllowed) {
      results.push({
        rule_type: 'backup_count',
        severity: 'warning',
        message: `${backups.length} backup singers assigned (maximum: ${maxAllowed})`,
        recommendation: 'Remove excess backup singers',
      });
    }

    return results;
  }

  private checkRoleQualifications(): ValidationResult[] {
    const results: ValidationResult[] = [];

    for (const assignment of this.context.existing_assignments) {
      const member = this.context.all_members.find((m) => m.id === assignment.member_id);
      if (!member) continue;

      if (assignment.is_leader) {
        const hasLeaderRole = member.roles?.some((r) => r.role?.name === 'Worship Leader');
        if (!hasLeaderRole) {
          results.push({
            rule_type: 'role_validation',
            severity: 'critical',
            member_id: member.id,
            member_name: member.full_name,
            message: `${member.full_name} is not qualified as Worship Leader`,
            recommendation: 'Assign a qualified worship leader',
          });
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
          results.push({
            rule_type: 'cooldown',
            severity: 'warning',
            member_id: member.id,
            member_name: member.full_name,
            message: `${member.full_name} was scheduled ${weeksDiff} week(s) ago`,
            recommendation: 'Consider a different member for better rotation',
          });
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
        results.push({
          rule_type: 'fairness',
          severity: 'suggestion',
          member_id: memberId,
          member_name: member?.full_name,
          message: `${member?.full_name} has more assignments than average`,
          recommendation: 'Consider redistributing assignments',
        });
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
        results.push({
          rule_type: 'leader_rotation',
          severity: 'warning',
          member_id: leaderId,
          member_name: member?.full_name,
          message: `${member?.full_name} has been leader ${recentLeaders} times recently`,
          recommendation: 'Rotate to a different worship leader',
        });
      }
    }

    return results;
  }

  private getMonthAssignmentCounts(): Map<string, number> {
    const counts = new Map<string, number>();

    for (const assignment of this.context.existing_assignments) {
      const current = counts.get(assignment.member_id) || 0;
      counts.set(assignment.member_id, current + 1);
    }

    return counts;
  }
}
