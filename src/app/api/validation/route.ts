import { NextRequest, NextResponse } from 'next/server';
import { ScheduleValidator } from '@/lib/scheduling/validator';
import { ScheduleContext, ValidationResult } from '@/lib/types/scheduling';
import { Member, ScheduleAssignment } from '@/lib/types/database';

const mockMembers: Member[] = [
  {
    id: '1',
    church_id: 'church-1',
    full_name: 'Heidi',
    status: 'active',
    max_monthly_assignments: 3,
    priority_score: 85,
    total_assignments: 2,
    created_at: '2026-01-01',
    updated_at: '2026-08-01',
    roles: [
      { id: '1', member_id: '1', role_id: 'r1', skill_level: 'expert', is_preferred: true, created_at: '2026-01-01', role: { id: 'r1', ministry_id: 'm1', name: 'Worship Leader', min_required: 1, max_allowed: 1, priority: 1, is_active: true, created_at: '2026-01-01' } },
    ],
    skills: [],
    availability: [],
  },
  {
    id: '2',
    church_id: 'church-1',
    full_name: 'Shael',
    status: 'active',
    max_monthly_assignments: 3,
    priority_score: 80,
    total_assignments: 1,
    created_at: '2026-01-01',
    updated_at: '2026-08-01',
    roles: [
      { id: '2', member_id: '2', role_id: 'r1', skill_level: 'advanced', is_preferred: true, created_at: '2026-01-01', role: { id: 'r1', ministry_id: 'm1', name: 'Worship Leader', min_required: 1, max_allowed: 1, priority: 1, is_active: true, created_at: '2026-01-01' } },
    ],
    skills: [],
    availability: [
      { id: '1', member_id: '2', church_id: 'church-1', type: 'weekly', week_number: 1, status: 'approved', created_at: '2026-08-01' },
    ],
  },
];

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { service_id, assignments } = body;

  const context: ScheduleContext = {
    service: {
      id: service_id || 'temp',
      church_id: 'church-1',
      date: new Date().toISOString(),
      week_number: 1,
      month: new Date().getMonth(),
      year: new Date().getFullYear(),
      service_type: 'sunday',
      status: 'draft',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    church_id: 'church-1',
    month: new Date().getMonth(),
    year: new Date().getFullYear(),
    week_number: 1,
    existing_assignments: assignments || [],
    available_members: mockMembers,
    all_members: mockMembers,
    rules: [
      { rule_type: 'backup_count', rule_config: { min_required: 3, max_allowed: 5 }, severity: 'critical' },
      { rule_type: 'leader_count', rule_config: {}, severity: 'critical' },
      { rule_type: 'availability_check', rule_config: {}, severity: 'critical' },
      { rule_type: 'assignment_limit', rule_config: { default_max: 3 }, severity: 'critical' },
      { rule_type: 'cooldown', rule_config: { weeks: 1 }, severity: 'warning' },
      { rule_type: 'fairness', rule_config: {}, severity: 'suggestion' },
    ],
  };

  const validator = new ScheduleValidator(context);
  const results = await validator.validate();

  const critical = results.filter((r) => r.severity === 'critical');
  const warnings = results.filter((r) => r.severity === 'warning');
  const suggestions = results.filter((r) => r.severity === 'suggestion');

  return NextResponse.json({
    valid: critical.length === 0,
    results,
    summary: {
      total: results.length,
      critical: critical.length,
      warnings: warnings.length,
      suggestions: suggestions.length,
    },
  });
}
