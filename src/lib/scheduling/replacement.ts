import {
  ScheduleContext,
  ReplacementSuggestion,
} from '../types/scheduling';
import { Member, Role, Instrument } from '../types/database';

export class ReplacementEngine {
  private context: ScheduleContext;

  constructor(context: ScheduleContext) {
    this.context = context;
  }

  async suggestReplacements(
    conflictedMemberId: string,
    targetRole: Role,
    targetInstrument?: Instrument
  ): Promise<ReplacementSuggestion[]> {
    const eligible = this.getEligibleMembers(targetRole, targetInstrument);
    const suggestions: ReplacementSuggestion[] = [];

    for (const member of eligible) {
      if (member.id === conflictedMemberId) continue;

      const suggestion = this.evaluateMember(member, targetRole, targetInstrument);
      if (suggestion) {
        suggestions.push(suggestion);
      }
    }

    return suggestions.sort((a, b) => b.confidence_score - a.confidence_score);
  }

  private getEligibleMembers(role: Role, instrument?: Instrument): Member[] {
    return this.context.all_members.filter((member) => {
      if (member.status !== 'active') return false;

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
      if (isUnavailable) return false;

      const monthCount = this.getMonthAssignmentCount(member.id);
      const maxAllowed = member.max_monthly_assignments || 3;
      if (monthCount >= maxAllowed) return false;

      const alreadyAssigned = this.context.existing_assignments.some(
        (a) => a.member_id === member.id
      );
      if (alreadyAssigned) return false;

      if (instrument) {
        const hasSkill = member.skills?.some(
          (s) => s.instrument_id === instrument.id
        );
        if (!hasSkill) return false;
      }

      if (role.name === 'Worship Leader') {
        const hasLeaderRole = member.roles?.some((r) => r.role?.name === 'Worship Leader');
        if (!hasLeaderRole) return false;
      }

      return true;
    });
  }

  private evaluateMember(
    member: Member,
    role: Role,
    instrument?: Instrument
  ): ReplacementSuggestion | null {
    const reasons: string[] = [];
    let score = 0;

    const monthCount = this.getMonthAssignmentCount(member.id);
    const maxAllowed = member.max_monthly_assignments || 3;
    const fairnessScore = 1 - monthCount / maxAllowed;
    score += fairnessScore * 30;
    if (fairnessScore > 0.7) reasons.push('Low assignment count');

    if (instrument) {
      const skill = member.skills?.find((s) => s.instrument_id === instrument.id);
      if (skill) {
        const skillBonus = skill.skill_level === 'expert' ? 20 :
          skill.skill_level === 'advanced' ? 15 :
          skill.skill_level === 'intermediate' ? 10 : 5;
        score += skillBonus;
        reasons.push(`${skill.skill_level} skill in ${instrument.name}`);
      }
    }

    if (role.name === 'Worship Leader') {
      const leaderSkill = member.roles?.find((r) => r.role?.name === 'Worship Leader');
      if (leaderSkill) {
        const levelBonus = leaderSkill.skill_level === 'expert' ? 20 :
          leaderSkill.skill_level === 'advanced' ? 15 :
          leaderSkill.skill_level === 'intermediate' ? 10 : 5;
        score += levelBonus;
        reasons.push(`${leaderSkill.skill_level} worship leader`);
      }
    }

    if (member.last_scheduled_date) {
      const lastDate = new Date(member.last_scheduled_date);
      const now = new Date();
      const weeksSince = Math.floor(
        (now.getTime() - lastDate.getTime()) / (7 * 24 * 60 * 60 * 1000)
      );
      if (weeksSince >= 2) {
        score += 15;
        reasons.push('No recent assignments');
      }
    } else {
      score += 20;
      reasons.push('Never scheduled before');
    }

    const hasConflict = this.context.existing_assignments.some(
      (a) => a.member_id === member.id
    );
    if (!hasConflict) {
      score += 10;
      reasons.push('No scheduling conflicts');
    }

    const confidence = Math.min(score / 100, 1);

    return {
      member,
      role,
      instrument,
      confidence_score: confidence,
      reasons,
      fairness_score: fairnessScore,
      skill_match: instrument ? !!member.skills?.some((s) => s.instrument_id === instrument.id) : true,
      below_limit: monthCount < maxAllowed,
      no_cooldown: !hasConflict,
    };
  }

  private getMonthAssignmentCount(memberId: string): number {
    return this.context.existing_assignments.filter(
      (a) => a.member_id === memberId
    ).length;
  }
}
