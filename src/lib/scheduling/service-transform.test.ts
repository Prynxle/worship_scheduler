import { describe, expect, it } from 'vitest';
import type { ScheduleAssignment, Service } from '../types/database';
import { transformServiceAssignments } from './service-transform';

const service: Service = {
  id: 'service',
  church_id: 'church',
  date: '2026-10-25',
  week_number: 4,
  month: 9,
  year: 2026,
  service_type: 'sunday',
  status: 'draft',
  created_at: '',
  updated_at: '',
};

const genericBackupRole = {
  id: 'backup',
  ministry_id: 'ministry',
  name: 'Back Up',
  min_required: 3,
  max_allowed: 3,
  priority: 2,
  is_active: true,
  created_at: '',
};

function assignment(id: string, memberId: string, isDevotion = false): ScheduleAssignment {
  return {
    id,
    service_id: service.id,
    member_id: memberId,
    role_id: genericBackupRole.id,
    is_leader: false,
    is_devotion: isDevotion,
    status: 'pending',
    created_at: '',
    updated_at: '',
    role: genericBackupRole,
    member: {
      id: memberId,
      church_id: service.church_id,
      full_name: memberId,
      status: 'active',
      max_monthly_assignments: 3,
      priority_score: 0,
      total_assignments: 0,
      created_at: '',
      updated_at: '',
    },
  };
}

describe('transformServiceAssignments', () => {
  it('preserves the assigned backup role while identifying the member selected for devotion', () => {
    const result = transformServiceAssignments(service, [
      assignment('devotion-assignment', 'Devotion member', true),
      assignment('backup-assignment', 'Backup member'),
    ]);

    expect(result.backup_singers.map((member) => member.name)).toEqual(['Devotion member', 'Backup member']);
    expect(result.devotion_name).toBe('Devotion member');
  });
});
