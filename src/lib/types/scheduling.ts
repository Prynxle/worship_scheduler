import { Member, Role, Instrument, Service, ScheduleAssignment } from './database';

export interface ScheduleContext {
  service: Service;
  church_id: string;
  month: number;
  year: number;
  week_number: number;
  existing_assignments: ScheduleAssignment[];
  available_members: Member[];
  all_members: Member[];
  rules: SchedulingRuleConfig[];
}

export interface SchedulingRuleConfig {
  rule_type: string;
  rule_config: Record<string, unknown>;
  severity: 'critical' | 'warning' | 'suggestion';
}

export interface ValidationResult {
  rule_type: string;
  severity: 'critical' | 'warning' | 'suggestion';
  member_id?: string;
  member_name?: string;
  role_name?: string;
  message: string;
  recommendation?: string;
}

export interface ReplacementSuggestion {
  member: Member;
  role: Role;
  instrument?: Instrument;
  confidence_score: number;
  reasons: string[];
  fairness_score: number;
  skill_match: boolean;
  below_limit: boolean;
  no_cooldown: boolean;
}

export interface FairnessReport {
  member_id: string;
  member_name: string;
  assignment_count: number;
  max_allowed: number;
  utilization: number;
  fairness_score: number;
  status: 'underutilized' | 'balanced' | 'overutilized';
}

export interface DevotionSlot {
  member_id: string;
  member_name: string;
  position: number;
  week_available: boolean;
  already_scheduled: boolean;
  confidence_score: number;
}

export interface ScheduleGenerationRequest {
  church_id: string;
  month: number;
  year: number;
  service_type: string;
  ministry_id: string;
  week_numbers: number[];
}

export interface ScheduleGenerationResult {
  services: GeneratedService[];
  validation_results: ValidationResult[];
  warnings: ValidationResult[];
  suggestions: ValidationResult[];
}

export interface GeneratedService {
  week_number: number;
  date: string;
  leader: Member | null;
  backup_singers: Member[];
  instrumentalists: InstrumentAssignment[];
  devotion: Member | null;
  conflicts: ValidationResult[];
}

export interface InstrumentAssignment {
  instrument: Instrument;
  member: Member | null;
  is_fallback: boolean;
}

export interface AnalyticsData {
  assignment_counts: MemberAssignmentCount[];
  availability_heatmap: AvailabilityHeatmapEntry[];
  fairness_score: number;
  workload_distribution: WorkloadEntry[];
  leader_distribution: LeaderDistribution[];
  conflict_summary: ConflictSummary;
}

export interface MemberAssignmentCount {
  member_id: string;
  member_name: string;
  count: number;
  max_allowed: number;
  roles: string[];
}

export interface AvailabilityHeatmapEntry {
  week_number: number;
  unavailable_count: number;
  unavailable_members: string[];
}

export interface WorkloadEntry {
  member_id: string;
  member_name: string;
  assignments: number;
  percentage: number;
}

export interface LeaderDistribution {
  leader_id: string;
  leader_name: string;
  count: number;
}

export interface ConflictSummary {
  total: number;
  critical: number;
  warnings: number;
  suggestions: number;
}
