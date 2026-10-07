import { isBackupRoleName } from '@/lib/scheduling/role-classifier';
import { ScheduleAssignment, Service } from '@/lib/types/database';

export interface TransformedService {
  id: string;
  church_id: string;
  ministry_id?: string | null;
  legacy_unscoped?: boolean;
  date: string;
  week_number: number;
  leader_name: string;
  leader_avatar?: string;
  backup_singers: { name: string; avatar?: string }[];
  instrumentalists: { instrument: string; name: string }[];
  devotion_name?: string;
  assignments: {
    id: string;
    member_id: string;
    member_name: string;
    role_id: string;
    role_name: string;
    instrument_id: string | null;
    instrument_name: string | null;
    is_leader: boolean;
    is_devotion: boolean;
  }[];
  status: Service['status'];
  schedule_version: number;
  validated_version?: number | null;
  validated_by?: string | null;
  validated_at?: string | null;
  generated_at?: string | null;
  published_at?: string | null;
  published_by?: string | null;
  revision_of?: string | null;
  conflict_count: number;
  unfilled_positions?: Service['unfilled_positions'];
  is_complete?: boolean;
  active_overrides?: Service['active_overrides'];
}

export function transformServiceAssignments(service: Service, assignments: ScheduleAssignment[]): TransformedService {
  const own = assignments.filter((assignment) => assignment.service_id === service.id);
  const leader = own.find((assignment) => assignment.is_leader)?.member;
  const unfilledPositions = service.unfilled_positions ?? [];
  return {
    id: service.id,
    church_id: service.church_id,
    ministry_id: service.ministry_id ?? null,
    legacy_unscoped: !service.ministry_id,
    date: service.date,
    week_number: service.week_number,
    leader_name: leader?.full_name ?? 'Unassigned',
    leader_avatar: leader?.avatar_url,
    backup_singers: own
      .filter((assignment) => !assignment.is_leader && assignment.role && isBackupRoleName(assignment.role.name))
      .map((assignment) => ({ name: assignment.member?.full_name ?? 'Unassigned', avatar: assignment.member?.avatar_url })),
    instrumentalists: own
      .filter((assignment) => assignment.instrument)
      .map((assignment) => ({ instrument: assignment.instrument?.name ?? 'Instrument', name: assignment.member?.full_name ?? 'Unassigned' })),
    devotion_name: own.find((assignment) => assignment.is_devotion)?.member?.full_name,
    assignments: own.map((assignment) => ({
      id: assignment.id,
      member_id: assignment.member_id,
      member_name: assignment.member?.full_name ?? 'Unknown member',
      role_id: assignment.role_id,
      role_name: assignment.role?.name ?? 'Unknown role',
      instrument_id: assignment.instrument_id ?? null,
      instrument_name: assignment.instrument?.name ?? null,
      is_leader: assignment.is_leader,
      is_devotion: assignment.is_devotion === true,
    })),
    status: service.status === 'archived' ? 'draft' : service.status,
    schedule_version: service.schedule_version ?? 1,
    validated_version: service.validated_version ?? null,
    validated_by: service.validated_by ?? null,
    validated_at: service.validated_at ?? null,
    generated_at: service.generated_at ?? null,
    published_at: service.published_at ?? null,
    published_by: service.published_by ?? null,
    revision_of: service.revision_of ?? null,
    conflict_count: 0,
    unfilled_positions: unfilledPositions,
    is_complete: unfilledPositions.length === 0,
    active_overrides: service.active_overrides ?? {},
  };
}
