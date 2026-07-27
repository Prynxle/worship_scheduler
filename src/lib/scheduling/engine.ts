import {
  ScheduleContext,
  ValidationResult,
  ReplacementSuggestion,
  FairnessReport,
  GeneratedService,
  InstrumentAssignment,
} from '../types/scheduling';
import { Member, Role, Service, ScheduleAssignment } from '../types/database';

export class SchedulingEngine {
  private context: ScheduleContext;

  constructor(context: ScheduleContext) {
    this.context = context;
  }

  async generateSchedule(): Promise<GeneratedService[]> {
    const services: GeneratedService[] = [];

    for (const weekNumber of this.context.service.week_number
      ? [this.context.service.week_number]
      : [1, 2, 3, 4]) {
      const service = await this.generateWeekService(weekNumber);
      services.push(service);
    }

    return services;
  }

  private async generateWeekService(weekNumber: number): Promise<GeneratedService> {
    const availableMembers = this.getAvailableMembers(weekNumber);

    const leader = this.selectLeader(availableMembers);
    const backupSingers = this.selectBackupSingers(availableMembers, leader);
    const instrumentalists = this.selectInstrumentalists(availableMembers);
    const devotion = this.selectDevotionMember(availableMembers);

    const conflicts = this.validateService({
      leader,
      backup_singers: backupSingers,
      instrumentalists,
      devotion,
      week_number: weekNumber,
    });

    return {
      week_number: weekNumber,
      date: this.getWeekDate(weekNumber),
      leader,
      backup_singers: backupSingers,
      instrumentalists,
      devotion,
      conflicts,
    };
  }

  private getAvailableMembers(weekNumber: number): Member[] {
    return this.context.available_members.filter((member) => {
      if (member.status !== 'active') return false;

      const hasUnavailableWeek = member.availability?.some(
        (a) => a.type === 'weekly' && a.week_number === weekNumber
      );
      if (hasUnavailableWeek) return false;

      const hasUnavailableDate = member.availability?.some((a) => {
        if (a.type !== 'date' || !a.date) return false;
        const date = new Date(a.date);
        const weekDate = new Date(this.context.service.date);
        return date.getFullYear() === weekDate.getFullYear() &&
          date.getMonth() === weekDate.getMonth() &&
          this.getWeekOfMonth(date) === weekNumber;
      });
      if (hasUnavailableDate) return false;

      return true;
    });
  }

  private selectLeader(availableMembers: Member[]): Member | null {
    const eligible = availableMembers.filter((member) =>
      member.roles?.some((r) => r.role?.name === 'Worship Leader')
    );

    if (eligible.length === 0) return null;

    const monthAssignments = this.getMonthAssignments();
    const sorted = eligible.sort((a, b) => {
      const aCount = monthAssignments.get(a.id) || 0;
      const bCount = monthAssignments.get(b.id) || 0;
      if (aCount !== bCount) return aCount - bCount;

      const aLastDate = a.last_scheduled_date ? new Date(a.last_scheduled_date) : new Date(0);
      const bLastDate = b.last_scheduled_date ? new Date(b.last_scheduled_date) : new Date(0);
      return aLastDate.getTime() - bLastDate.getTime();
    });

    return sorted[0];
  }

  private selectBackupSingers(availableMembers: Member[], leader: Member | null): Member[] {
    const eligible = availableMembers.filter((member) => {
      if (leader && member.id === leader.id) return false;
      return member.roles?.some((r) => r.role?.name === 'Singer');
    });

    const monthAssignments = this.getMonthAssignments();
    const sorted = eligible.sort((a, b) => {
      const aCount = monthAssignments.get(a.id) || 0;
      const bCount = monthAssignments.get(b.id) || 0;
      return aCount - bCount;
    });

    const minRequired = this.context.rules.find(
      (r) => r.rule_type === 'backup_count'
    )?.rule_config.min_required as number || 3;

    const maxAllowed = this.context.rules.find(
      (r) => r.rule_type === 'backup_count'
    )?.rule_config.max_allowed as number || 5;

    return sorted.slice(0, Math.min(maxAllowed, Math.max(minRequired, sorted.length)));
  }

  private selectInstrumentalists(availableMembers: Member[]): InstrumentAssignment[] {
    const assignments: InstrumentAssignment[] = [];
    const usedMembers = new Set<string>();

    const instruments = this.getInstruments();

    for (const instrument of instruments) {
      const eligible = availableMembers.filter((member) => {
        if (usedMembers.has(member.id)) return false;
        return member.skills?.some(
          (s) => s.instrument_id === instrument.id && s.is_primary
        );
      });

      if (eligible.length > 0) {
        const monthAssignments = this.getMonthAssignments();
        const sorted = eligible.sort((a, b) => {
          const aCount = monthAssignments.get(a.id) || 0;
          const bCount = monthAssignments.get(b.id) || 0;
          return aCount - bCount;
        });

        assignments.push({
          instrument,
          member: sorted[0],
          is_fallback: false,
        });
        usedMembers.add(sorted[0].id);
      } else {
        const fallback = availableMembers.filter((member) => {
          if (usedMembers.has(member.id)) return false;
          return member.skills?.some((s) => s.instrument_id === instrument.id);
        });

        if (fallback.length > 0) {
          assignments.push({
            instrument,
            member: fallback[0],
            is_fallback: true,
          });
          usedMembers.add(fallback[0].id);
        } else {
          assignments.push({
            instrument,
            member: null,
            is_fallback: false,
          });
        }
      }
    }

    return assignments;
  }

  private selectDevotionMember(availableMembers: Member[]): Member | null {
    const eligible = availableMembers.filter((member) =>
      member.roles?.some((r) => r.role?.name === 'Devotion')
    );

    if (eligible.length === 0) return null;

    const monthAssignments = this.getMonthAssignments();
    const sorted = eligible.sort((a, b) => {
      const aCount = monthAssignments.get(a.id) || 0;
      const bCount = monthAssignments.get(b.id) || 0;
      return aCount - bCount;
    });

    return sorted[0];
  }

  private validateService(service: {
    leader: Member | null;
    backup_singers: Member[];
    instrumentalists: InstrumentAssignment[];
    devotion: Member | null;
    week_number: number;
  }): ValidationResult[] {
    const results: ValidationResult[] = [];

    if (!service.leader) {
      results.push({
        rule_type: 'leader_count',
        severity: 'critical',
        message: 'No worship leader assigned',
        recommendation: 'Assign a qualified worship leader',
      });
    }

    const minBackup = this.context.rules.find(
      (r) => r.rule_type === 'backup_count'
    )?.rule_config.min_required as number || 3;

    if (service.backup_singers.length < minBackup) {
      results.push({
        rule_type: 'backup_count',
        severity: 'critical',
        message: `Only ${service.backup_singers.length} backup singers assigned (minimum: ${minBackup})`,
        recommendation: 'Add more backup singers',
      });
    }

    const guitarCount = service.instrumentalists.filter(
      (i) => i.instrument.name.toLowerCase().includes('guitar') && i.member
    ).length;

    if (guitarCount === 0) {
      results.push({
        rule_type: 'instrument_constraint',
        severity: 'critical',
        message: 'No guitarist assigned',
        recommendation: 'Assign at least one guitarist',
      });
    }

    if (service.devotion === null) {
      results.push({
        rule_type: 'role_validation',
        severity: 'warning',
        message: 'No devotion leader assigned',
        recommendation: 'Assign a devotion leader',
      });
    }

    const allAssigned = [
      service.leader,
      ...service.backup_singers,
      ...service.instrumentalists.filter((i) => i.member).map((i) => i.member),
      service.devotion,
    ].filter(Boolean);

    const memberIds = allAssigned.map((m) => m!.id);
    const duplicates = memberIds.filter((id, index) => memberIds.indexOf(id) !== index);

    if (duplicates.length > 0) {
      results.push({
        rule_type: 'dual_role_check',
        severity: 'critical',
        member_id: duplicates[0],
        message: 'Member assigned to multiple roles',
        recommendation: 'Remove duplicate assignment',
      });
    }

    return results;
  }

  private getMonthAssignments(): Map<string, number> {
    const counts = new Map<string, number>();

    for (const assignment of this.context.existing_assignments) {
      const current = counts.get(assignment.member_id) || 0;
      counts.set(assignment.member_id, current + 1);
    }

    return counts;
  }

  private getInstruments() {
    return this.context.available_members
      .flatMap((m) => m.skills?.map((s) => s.instrument) || [])
      .filter((inst): inst is NonNullable<typeof inst> => inst !== undefined && inst !== null)
      .filter((inst, index, self) => self.findIndex((i) => i.id === inst.id) === index);
  }

  private getWeekDate(weekNumber: number): string {
    const date = new Date(this.context.service.date);
    const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
    const firstMonday = new Date(firstDay);
    while (firstMonday.getDay() !== 1) {
      firstMonday.setDate(firstMonday.getDate() + 1);
    }
    const targetDate = new Date(firstMonday);
    targetDate.setDate(targetDate.getDate() + (weekNumber - 1) * 7);
    return targetDate.toISOString().split('T')[0];
  }

  private getWeekOfMonth(date: Date): number {
    const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
    const firstMonday = new Date(firstDay);
    while (firstMonday.getDay() !== 1) {
      firstMonday.setDate(firstMonday.getDate() + 1);
    }
    const diffDays = Math.floor((date.getTime() - firstMonday.getTime()) / (1000 * 60 * 60 * 24));
    return Math.floor(diffDays / 7) + 1;
  }
}
