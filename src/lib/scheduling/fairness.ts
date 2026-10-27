import { FairnessReport } from '../types/scheduling';
import { Member, ScheduleAssignment } from '../types/database';

/** The assignment fields fairness scoring needs; reporting passes a scoped select. */
export type FairnessAssignment = Pick<ScheduleAssignment, 'member_id'>;

/** The member fields fairness scoring needs; reporting passes a scoped select. */
export type FairnessMember = Pick<
  Member,
  'id' | 'full_name' | 'status' | 'max_monthly_assignments'
>;

/**
 * The workload target used by the existing fairness calculation: 60% of a
 * member's limit. Kept here so the scheduling-time penalty and the reporting
 * score cannot drift apart.
 */
export const FAIRNESS_TARGET_UTILIZATION = 0.6;

/**
 * Deviation from the workload target, in percentage points of the member's
 * limit. `0` means exactly at the target; `100` means one full limit away.
 *
 * This is the scheduling-time penalty. It is intentionally NOT a
 * higher-is-better score: it is zero at the target.
 */
export function fairnessDeviation(count: number, maxAllowed: number): number {
  if (maxAllowed <= 0) return 0;
  const expectedCount = maxAllowed * FAIRNESS_TARGET_UTILIZATION;
  return (Math.abs(count - expectedCount) / maxAllowed) * 100;
}

/**
 * Reporting-only member score in the familiar 0-100, higher-is-better shape:
 * `100 - fairnessDeviation`, clamped. It uses the same target and deviation as
 * the scheduling-time calculation, so this is a presentation inversion rather
 * than a second formula.
 */
export function memberFairnessScore(count: number, maxAllowed: number): number {
  return Math.max(0, Math.min(100, 100 - fairnessDeviation(count, maxAllowed)));
}

/** Reporting-only church score: the mean member score, rounded and clamped. */
export function overallFairnessScore(scores: number[]): number {
  if (scores.length === 0) return 0;
  const average = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  return Math.max(0, Math.min(100, Math.round(average)));
}

/** The existing utilization bands, shared by the validator and reporting. */
export function fairnessStatus(utilization: number): FairnessReport['status'] {
  if (utilization < 30) return 'underutilized';
  if (utilization > 80) return 'overutilized';
  return 'balanced';
}

export class FairnessCalculator {
  calculateFairness(
    members: Member[],
    assignments: ScheduleAssignment[],
    month: number,
    year: number
  ): FairnessReport[] {
    const monthAssignments = this.getMonthAssignments(assignments, month, year);
    return this.buildReports(members, monthAssignments);
  }

  /**
   * Count every supplied assignment.
   *
   * Use this when the caller has already scoped the assignments to the
   * reporting month through their services. `calculateFairness` predates that
   * scoping and filters on `created_at`, which is the wrong month for a
   * schedule generated in advance.
   */
  calculateFairnessForAssignments(
    members: FairnessMember[],
    assignments: FairnessAssignment[]
  ): FairnessReport[] {
    const counts = new Map<string, number>();

    for (const assignment of assignments) {
      counts.set(assignment.member_id, (counts.get(assignment.member_id) || 0) + 1);
    }

    return this.buildReports(members, counts);
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

  private buildReports(
    members: FairnessMember[],
    monthAssignments: Map<string, number>
  ): FairnessReport[] {
    const reports: FairnessReport[] = [];

    for (const member of members) {
      if (member.status !== 'active') continue;

      const count = monthAssignments.get(member.id) || 0;
      const maxAllowed = member.max_monthly_assignments || 3;
      const utilization = (count / maxAllowed) * 100;

      reports.push({
        member_id: member.id,
        member_name: member.full_name,
        assignment_count: count,
        max_allowed: maxAllowed,
        utilization: utilization,
        fairness_score: fairnessDeviation(count, maxAllowed),
        status: fairnessStatus(utilization),
      });
    }

    return reports.sort((a, b) => a.fairness_score - b.fairness_score);
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
