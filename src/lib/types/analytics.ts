import type { AvailabilityHeatmapEntry, FairnessReport, WorkloadEntry } from './scheduling';

/** A month (0-based) that has at least one non-archived service. */
export interface AnalyticsMonth {
  month: number;
  year: number;
}

export interface AnalyticsReport {
  /** 0-based month, matching `services.month`. */
  month: number;
  year: number;
  /** Every month with a non-archived service, newest first. */
  months: AnalyticsMonth[];
  workload: WorkloadEntry[];
  fairness: FairnessReport[];
  /** Mean of the per-member reporting scores, 0-100. */
  overall_fairness: number;
  availability: AvailabilityHeatmapEntry[];
  /** Assignments counted for the selected month, across the church. */
  assignment_count: number;
  /** Active members included in the fairness report. */
  member_count: number;
}
