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
  created_at: string;
}

export interface Availability {
  id: string;
  member_id: string;
  church_id: string;
  type: 'weekly' | 'date' | 'vacation' | 'temporary_leave' | 'emergency_leave' | 'recurring';
  week_number?: number;
  date?: string;
  end_date?: string;
  reason?: string;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
}

export interface Service {
  id: string;
  church_id: string;
  date: string;
  week_number: number;
  month: number;
  year: number;
  service_type: string;
  status: 'draft' | 'validated' | 'published' | 'archived';
  notes?: string;
  published_at?: string;
  generated_by?: string;
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

export interface Notification {
  id: string;
  user_id: string;
  church_id: string;
  type: 'assignment' | 'conflict' | 'reminder' | 'schedule_published' | 'availability_reminder';
  title: string;
  message: string;
  is_read: boolean;
  created_at: string;
}
