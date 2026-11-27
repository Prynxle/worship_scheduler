import { isUnavailableForService, type AvailabilityRecord } from '@/lib/scheduling/availability';
import {
  FairnessCalculator,
  memberFairnessScore,
  overallFairnessScore,
} from '@/lib/scheduling/fairness';
import type { AnalyticsMonth, AnalyticsReport } from '@/lib/types/analytics';
import type { Member, ScheduleAssignment } from '@/lib/types/database';
import { formatLocalDate, getWeekDate, getWeeksInMonth } from '@/lib/utils/date-utils';

export type AnalyticsMember = Pick<
  Member,
  'id' | 'full_name' | 'status' | 'max_monthly_assignments'
>;
export type AnalyticsAssignment = Pick<ScheduleAssignment, 'member_id' | 'service_id'>;
export type AnalyticsAvailability = AvailabilityRecord;

export interface BuildAnalyticsReportInput {
  /** Members for the authenticated church. Inactive members are ignored. */
  members: AnalyticsMember[];
  /** Assignments already scoped to the selected month's non-archived services. */
  assignments: AnalyticsAssignment[];
  /** Availability records for the authenticated church. */
  availability: AnalyticsAvailability[];
  /** 0-based month, matching `services.month`. */
  month: number;
  year: number;
  months?: AnalyticsMonth[];
}

/**
 * Build the church-scoped analytics view for one month.
 *
 * Per-member reporting score = `100 - |count - 0.6 * limit| / limit * 100`,
 * clamped to 0-100. The 60% target and deviation come from
 * `src/lib/scheduling/fairness.ts`, so this is the scheduling-time fairness
 * target expressed as a higher-is-better display score. The church score is the
 * mean of the member scores.
 */
export function buildAnalyticsReport({
  members,
  assignments,
  availability,
  month,
  year,
  months = [],
}: BuildAnalyticsReportInput): AnalyticsReport {
  const activeMembers = members.filter((member) => member.status === 'active');
  const calculator = new FairnessCalculator();

  const fairness = calculator
    .calculateFairnessForAssignments(activeMembers, assignments)
    .map((report) => ({
      ...report,
      fairness_score: roundScore(memberFairnessScore(report.assignment_count, report.max_allowed)),
    }))
    .sort(
      (left, right) =>
        right.assignment_count - left.assignment_count ||
        left.member_name.localeCompare(right.member_name)
    );

  const workload = fairness.map((report) => ({
    member_id: report.member_id,
    member_name: report.member_name,
    assignments: report.assignment_count,
    max_allowed: report.max_allowed,
    percentage: Math.round(report.utilization),
  }));

  return {
    month,
    year,
    months,
    workload,
    fairness,
    overall_fairness: overallFairnessScore(fairness.map((report) => report.fairness_score)),
    availability: buildAvailabilityHeatmap(activeMembers, availability, month, year),
    assignment_count: assignments.length,
    member_count: activeMembers.length,
  };
}

/** One row per Sunday-anchored week in the month, using the shared predicate. */
function buildAvailabilityHeatmap(
  members: AnalyticsMember[],
  records: AvailabilityRecord[],
  month: number,
  year: number
): AnalyticsReport['availability'] {
  const memberIds = new Set(members.map((member) => member.id));
  const scopedRecords = records.filter(
    (record) => memberIds.has(record.member_id) && ['pending', 'approved'].includes(record.status)
  );

  return Array.from({ length: getWeeksInMonth(month, year) }, (_, index) => {
    const weekNumber = index + 1;
    const date = formatLocalDate(getWeekDate(weekNumber, month, year));
    const unavailableMembers = members
      .filter((member) =>
        scopedRecords.some(
          (record) =>
            record.member_id === member.id &&
            isUnavailableForService(record, {
              week_number: weekNumber,
              month,
              year,
              date,
            })
        )
      )
      .map((member) => member.full_name);

    return {
      week_number: weekNumber,
      unavailable_count: unavailableMembers.length,
      unavailable_members: unavailableMembers,
    };
  });
}

function roundScore(value: number): number {
  return Math.round(value * 10) / 10;
}
