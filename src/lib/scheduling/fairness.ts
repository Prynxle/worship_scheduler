import { FairnessReport, MemberAssignmentCount } from '../types/scheduling';
import { Member, ScheduleAssignment } from '../types/database';

export class FairnessCalculator {
  calculateFairness(
    members: Member[],
    assignments: ScheduleAssignment[],
    month: number,
    year: number
  ): FairnessReport[] {
    const monthAssignments = this.getMonthAssignments(assignments, month, year);
    const reports: FairnessReport[] = [];

    for (const member of members) {
      if (member.status !== 'active') continue;

      const count = monthAssignments.get(member.id) || 0;
      const maxAllowed = member.max_monthly_assignments || 3;
      const utilization = (count / maxAllowed) * 100;
      const fairnessScore = this.calculateMemberFairness(count, maxAllowed, members.length);

      let status: 'underutilized' | 'balanced' | 'overutilized';
      if (utilization < 30) {
        status = 'underutilized';
      } else if (utilization > 80) {
        status = 'overutilized';
      } else {
        status = 'balanced';
      }

      reports.push({
        member_id: member.id,
        member_name: member.full_name,
        assignment_count: count,
        max_allowed: maxAllowed,
        utilization: utilization,
        fairness_score: fairnessScore,
        status,
      });
    }

    return reports.sort((a, b) => a.fairness_score - b.fairness_score);
  }

  calculateOverallFairness(reports: FairnessReport[]): number {
    if (reports.length === 0) return 0;

    const scores = reports.map((r) => r.fairness_score);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((sum, score) => sum + Math.pow(score - avg, 2), 0) / scores.length;

    return Math.max(0, 100 - variance * 10);
  }

  getWorkloadDistribution(reports: FairnessReport[]): {
    mostAssigned: FairnessReport[];
    leastAssigned: FairnessReport[];
    balanced: FairnessReport[];
  } {
    const sorted = [...reports].sort((a, b) => b.assignment_count - a.assignment_count);

    return {
      mostAssigned: sorted.slice(0, Math.ceil(sorted.length * 0.2)),
      leastAssigned: sorted.slice(-Math.ceil(sorted.length * 0.2)),
      balanced: sorted.slice(
        Math.ceil(sorted.length * 0.2),
        sorted.length - Math.ceil(sorted.length * 0.2)
      ),
    };
  }

  private calculateMemberFairness(
    count: number,
    maxAllowed: number,
    totalMembers: number
  ): number {
    const expectedCount = maxAllowed * 0.6;
    const deviation = Math.abs(count - expectedCount);
    const maxDeviation = maxAllowed;

    return (deviation / maxDeviation) * 100;
  }

  private getMonthAssignments(
    assignments: ScheduleAssignment[],
    month: number,
    year: number
  ): Map<string, number> {
    const counts = new Map<string, number>();

    for (const assignment of assignments) {
      const date = new Date(assignment.created_at);
      if (date.getMonth() === month && date.getFullYear() === year) {
        const current = counts.get(assignment.member_id) || 0;
        counts.set(assignment.member_id, current + 1);
      }
    }

    return counts;
  }
}
