import { NextRequest, NextResponse } from 'next/server';
import { SchedulingEngine } from '@/lib/scheduling/engine';
import { ScheduleValidator } from '@/lib/scheduling/validator';
import { ScheduleContext } from '@/lib/types/scheduling';
import { Member } from '@/lib/types/database';

const mockMembers: Member[] = [
  {
    id: '1',
    church_id: 'church-1',
    full_name: 'Heidi',
    status: 'active',
    max_monthly_assignments: 3,
    priority_score: 85,
    total_assignments: 2,
    last_scheduled_date: '2026-08-03',
    created_at: '2026-01-01',
    updated_at: '2026-08-01',
    roles: [
      { id: '1', member_id: '1', role_id: 'r1', skill_level: 'expert', is_preferred: true, created_at: '2026-01-01', role: { id: 'r1', ministry_id: 'm1', name: 'Worship Leader', min_required: 1, max_allowed: 1, priority: 1, is_active: true, created_at: '2026-01-01' } },
      { id: '2', member_id: '1', role_id: 'r2', skill_level: 'advanced', is_preferred: true, created_at: '2026-01-01', role: { id: 'r2', ministry_id: 'm1', name: 'Singer', min_required: 3, max_allowed: 5, priority: 2, is_active: true, created_at: '2026-01-01' } },
    ],
    skills: [],
    availability: [],
  },
  {
    id: '2',
    church_id: 'church-1',
    full_name: 'Feng',
    status: 'active',
    max_monthly_assignments: 3,
    priority_score: 90,
    total_assignments: 1,
    last_scheduled_date: '2026-08-10',
    created_at: '2026-01-01',
    updated_at: '2026-08-01',
    roles: [
      { id: '3', member_id: '2', role_id: 'r1', skill_level: 'advanced', is_preferred: true, created_at: '2026-01-01', role: { id: 'r1', ministry_id: 'm1', name: 'Worship Leader', min_required: 1, max_allowed: 1, priority: 1, is_active: true, created_at: '2026-01-01' } },
    ],
    skills: [],
    availability: [],
  },
  {
    id: '3',
    church_id: 'church-1',
    full_name: 'Beng',
    status: 'active',
    max_monthly_assignments: 3,
    priority_score: 70,
    total_assignments: 2,
    created_at: '2026-01-01',
    updated_at: '2026-08-01',
    roles: [
      { id: '4', member_id: '3', role_id: 'r2', skill_level: 'advanced', is_preferred: true, created_at: '2026-01-01', role: { id: 'r2', ministry_id: 'm1', name: 'Singer', min_required: 3, max_allowed: 5, priority: 2, is_active: true, created_at: '2026-01-01' } },
    ],
    skills: [],
    availability: [],
  },
];

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const month = parseInt(searchParams.get('month') || String(new Date().getMonth()));
  const year = parseInt(searchParams.get('year') || String(new Date().getFullYear()));
  const churchId = searchParams.get('church_id') || 'church-1';

  const services = generateMockServices(month, year);

  return NextResponse.json({ services, month, year, church_id: churchId });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { month, year, week_numbers } = body;

  const context: ScheduleContext = {
    service: {
      id: 'temp',
      church_id: 'church-1',
      date: new Date(year, month, 1).toISOString(),
      week_number: week_numbers?.[0] || 1,
      month,
      year,
      service_type: 'sunday',
      status: 'draft',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    church_id: 'church-1',
    month,
    year,
    week_number: week_numbers?.[0] || 1,
    existing_assignments: [],
    available_members: mockMembers,
    all_members: mockMembers,
    rules: [
      { rule_type: 'backup_count', rule_config: { min_required: 3, max_allowed: 5 }, severity: 'critical' },
      { rule_type: 'leader_count', rule_config: {}, severity: 'critical' },
      { rule_type: 'cooldown', rule_config: { weeks: 1 }, severity: 'warning' },
      { rule_type: 'fairness', rule_config: {}, severity: 'suggestion' },
    ],
  };

  const engine = new SchedulingEngine(context);
  const generatedServices = await engine.generateSchedule();

  const validator = new ScheduleValidator(context);
  const validationResults = await validator.validate();

  return NextResponse.json({
    services: generatedServices,
    validation: validationResults,
  });
}

function generateMockServices(month: number, year: number) {
  return [
    {
      id: '1',
      date: new Date(year, month, 3).toISOString(),
      week_number: 1,
      month,
      year,
      service_type: 'sunday',
      status: 'published',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: '2',
      date: new Date(year, month, 10).toISOString(),
      week_number: 2,
      month,
      year,
      service_type: 'sunday',
      status: 'validated',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: '3',
      date: new Date(year, month, 17).toISOString(),
      week_number: 3,
      month,
      year,
      service_type: 'sunday',
      status: 'draft',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: '4',
      date: new Date(year, month, 24).toISOString(),
      week_number: 4,
      month,
      year,
      service_type: 'sunday',
      status: 'draft',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];
}
