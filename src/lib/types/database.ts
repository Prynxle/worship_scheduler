export interface Church {
  id: string;
  name: string;
  address?: string;
  city?: string;
  country?: string;
  phone?: string;
  email?: string;
  logo_url?: string;
  settings: ChurchSettings;
  created_at: string;
  updated_at: string;
}

export interface ChurchSettings {
  default_max_monthly_assignments: number;
  default_min_backup_singers: number;
  default_max_backup_singers: number;
  cooldown_weeks: number;
  enable_fairness: boolean;
  enable_cooldown: boolean;
  enable_leader_rotation: boolean;
}

export interface Department {
  id: string;
  church_id: string;
  name: string;
  description?: string;
  created_at: string;
}

export interface Ministry {
  id: string;
  church_id: string;
  name: string;
  description?: string;
  config: MinistryConfig;
  priority: number;
  is_active: boolean;
  created_at: string;
}

export interface MinistryConfig {
  min_members: number;
  max_members: number;
  requires_leader: boolean;
  allows_dual_role: boolean;
  auto_generate: boolean;
}

export interface Role {
  id: string;
  ministry_id: string;
  name: string;
  description?: string;
  min_required: number;
  max_allowed: number;
  priority: number;
  is_active: boolean;
  created_at: string;
}

export interface User {
  id: string;
  auth_id?: string;
  email: string;
  username?: string | null;
  full_name: string;
  role: 'admin' | 'coordinator' | 'member';
  is_active: boolean;
  church_id: string;
  created_at: string;
  updated_at: string;
}

export interface Member {
  id: string;
  user_id?: string;
  church_id: string;
  department_id?: string;
  full_name: string;
  /**
   * Lowercase canonical login identifier. The name-login flow in
   * `/api/auth/name` lowercases its input and then matches with `.eq()`, so a
   * stored value that is not already lowercase can never sign in.
   */
  login_name?: string | null;
  nickname?: string;
  gender?: 'male' | 'female' | 'other';
  phone?: string;
  avatar_url?: string;
  status: 'active' | 'inactive';
  max_monthly_assignments: number;
  priority_score: number;
  last_scheduled_date?: string;
  total_assignments: number;
  notes?: string;
  created_at: string;
  updated_at: string;
  roles?: MemberRole[];
  skills?: MemberSkill[];
  availability?: Availability[];
}

export interface MemberRole {
  id: string;
  member_id: string;
  role_id: string;
  skill_level: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  is_preferred: boolean;
  created_at: string;
  role?: Role;
}

export interface MemberSkill {
  id: string;
  member_id: string;
  instrument_id: string;
  skill_level: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  is_primary: boolean;
  fallback_member_id?: string;
  created_at: string;
  instrument?: Instrument;
}

export interface Instrument {
  id: string;
  ministry_id: string;
  name: string;
  description?: string;
  is_required: boolean;
  min_count: number;
  max_count: number;
  /**
   * Opt-in: sweep `min_count`/`max_count` into a slot count.
   *
   * `false` (the column default, and every pre-existing row) means this
   * instrument contributes exactly ONE slot however it is configured, which is
   * the behaviour that shipped before counts existed. `true` means
   * `min_count` hard slots plus `max_count - min_count` optional slots.
   *
   * It is read as `=== true` everywhere, so a row that predates the column, or
   * any untyped/DB-sourced object that omits it, is inert rather than
   * accidentally count-driven.
   */
  slot_counts: boolean;
  created_at: string;
}

export interface Availability {
  id: string;
  member_id: string;
  church_id: string;
  type: 'weekly' | 'date' | 'vacation' | 'temporary_leave' | 'emergency_leave' | 'recurring';
  week_number?: number;
  month?: number;
  year?: number;
  date?: string;
  end_date?: string;
  reason?: string;
  status: 'pending' | 'approved' | 'rejected';
  submission_id?: string | null;
  created_at: string;
}

export type AvailabilitySubmissionStatus = 'submitted' | 'approved' | 'revision_required';

export interface AvailabilitySubmission {
  id: string;
  church_id: string;
  member_id: string;
  month: number;
  year: number;
  status: AvailabilitySubmissionStatus;
  /**
   * Origin of the submission. 'member' rows come from the member-driven
   * monthly workflow; 'mock' rows are fixtures created by the
   * mock_month_availability RPC. A current 'member' submission is never
   * touched by the mock tool.
   */
  source: 'member' | 'mock';
  version: number;
  is_current: boolean;
  submitted_at: string;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  revision_note?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScheduleChangeLog {
  id: string;
  church_id: string;
  service_id?: string | null;
  actor_id?: string | null;
  action: string;
  from_version?: number | null;
  to_version?: number | null;
  reason?: string | null;
  before_state?: Record<string, unknown> | null;
  after_state?: Record<string, unknown> | null;
  created_at: string;
}

/**
 * Structural mirror of `UnfilledPosition` in `src/lib/types/scheduling.ts`.
 *
 * Duplicated rather than imported because that module imports THIS one, so
 * importing back would create a cycle. TypeScript is structural, so the two are
 * mutually assignable and `gaps.ts` / the read boundary normalise with `?? []`.
 */
export interface ServiceUnfilledPosition {
  service_id?: string;
  week_number: number;
  date: string;
  role_name: string;
  required_slots: number;
  eligible_candidates: string[];
  rejected_candidates: Array<{ member_id: string; member_name: string; reason: string }>;
  message: string;
}

/** The two override axes a coordinator may ever license. Anything else is a bug. */
export interface ServiceActiveOverrides {
  availability?: boolean;
  instrument_qualification?: boolean;
}

export interface Service {
  id: string;
  church_id: string;
  ministry_id?: string | null;
  date: string;
  week_number: number;
  month: number;
  year: number;
  service_type: string;
  status: 'draft' | 'validated' | 'published' | 'archived';
  notes?: string;
  published_at?: string;
  generated_by?: string;
  generated_at?: string | null;
  generation_metadata?: Record<string, unknown>;
  schedule_version?: number;
  validated_version?: number | null;
  validated_by?: string | null;
  validated_at?: string | null;
  published_by?: string | null;
  revision_of?: string | null;
  /**
   * Positions the generator could not fill, with the reason each was rejected.
   * The single READ authority for gaps: `GET /api/schedule` serves this column
   * and never recomputes it. Written by the engine's draft pass and by
   * `gaps.ts` on manual edit.
   */
  unfilled_positions?: ServiceUnfilledPosition[];
  /**
   * Service-level override licences, always present (default `{}`).
   *
   * ASSIGN, never merge: a PUT that does not pass an override flag writes `{}`,
   * because merging would turn a one-off coordinator decision into a permanent
   * skip that later edits never surface. Cleared by regeneration.
   */
  active_overrides?: ServiceActiveOverrides;
  created_at: string;
  updated_at: string;
  assignments?: ScheduleAssignment[];
}

export interface ScheduleAssignment {
  id: string;
  service_id: string;
  member_id: string;
  role_id: string;
  instrument_id?: string;
  is_leader: boolean;
  is_devotion?: boolean;
  status: 'pending' | 'confirmed' | 'declined' | 'swapped';
  assigned_by?: string;
  created_at: string;
  updated_at: string;
  member?: Member;
  role?: Role;
  instrument?: Instrument;
}

export interface MinistryRule {
  id: string;
  ministry_id: string;
  rule_type: RuleType;
  rule_config: Record<string, unknown>;
  severity: 'critical' | 'warning' | 'suggestion';
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type RuleType =
  | 'availability_check'
  | 'assignment_limit'
  | 'role_validation'
  | 'backup_count'
  | 'leader_count'
  | 'instrument_constraint'
  | 'cooldown'
  | 'fairness'
  | 'leader_rotation'
  | 'devotion_sequence'
  | 'dual_role_check';

export interface DevotionRotation {
  id: string;
  church_id: string;
  member_id: string;
  position: number;
  last_used_at?: string;
  is_active: boolean;
  created_at: string;
}

export interface AuditLog {
  id: string;
  church_id: string;
  user_id: string;
  action: string;
  entity_type: string;
  entity_id: string;
  old_value?: Record<string, unknown>;
  new_value?: Record<string, unknown>;
  ip_address?: string;
  created_at: string;
  user?: User;
}

/**
 * Which audience selector produced an announcement's recipient set.
 * Stored per notification row; NULL for every non-announcement type.
 */
export type AnnouncementAudience = 'church' | 'ministry' | 'role' | 'members';

export interface Notification {
  id: string;
  user_id: string;
  church_id: string;
  type: 'assignment' | 'conflict' | 'reminder' | 'schedule_published' | 'availability_reminder' | 'announcement';
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
  created_by?: string | null;
  audience_type?: AnnouncementAudience | null;
  /** Shared across every recipient row of one broadcast; used for staff hard delete. */
  announcement_id?: string;
  /** Set when the recipient removed the item from their own feed (row stays). */
  dismissed_at?: string | null;
}

export interface ChurchEvent {
  id: string;
  church_id: string;
  title: string;
  date: string;
  time?: string | null;
  location?: string | null;
  /** Free-text context for the event. Replaces the former Service/Rehearsal/Gathering kind. */
  description?: string | null;
  attendees: number;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}
