import { NextRequest, NextResponse } from 'next/server';
import { Member } from '@/lib/types/database';

const mockMembers: Member[] = [
  {
    id: '1',
    church_id: 'church-1',
    full_name: 'Heidi',
    nickname: '',
    gender: 'female',
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
    nickname: 'Tapeng',
    gender: 'male',
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
    full_name: 'Zedrick',
    nickname: 'Zed',
    gender: 'male',
    status: 'active',
    max_monthly_assignments: 3,
    priority_score: 80,
    total_assignments: 3,
    created_at: '2026-01-01',
    updated_at: '2026-08-01',
    roles: [
      { id: '4', member_id: '3', role_id: 'r3', skill_level: 'expert', is_preferred: true, created_at: '2026-01-01', role: { id: 'r3', ministry_id: 'm1', name: 'Instrumentalist', min_required: 4, max_allowed: 6, priority: 3, is_active: true, created_at: '2026-01-01' } },
    ],
    skills: [
      { id: '1', member_id: '3', instrument_id: 'i1', skill_level: 'expert', is_primary: true, created_at: '2026-01-01', instrument: { id: 'i1', ministry_id: 'm1', name: 'Guitar 1', is_required: true, min_count: 1, max_count: 1, created_at: '2026-01-01' } },
    ],
    availability: [],
  },
  {
    id: '4',
    church_id: 'church-1',
    full_name: 'Kass',
    nickname: '',
    gender: 'female',
    status: 'active',
    max_monthly_assignments: 3,
    priority_score: 75,
    total_assignments: 2,
    created_at: '2026-01-01',
    updated_at: '2026-08-01',
    roles: [
      { id: '5', member_id: '4', role_id: 'r3', skill_level: 'advanced', is_preferred: true, created_at: '2026-01-01', role: { id: 'r3', ministry_id: 'm1', name: 'Instrumentalist', min_required: 4, max_allowed: 6, priority: 3, is_active: true, created_at: '2026-01-01' } },
    ],
    skills: [
      { id: '2', member_id: '4', instrument_id: 'i2', skill_level: 'advanced', is_primary: true, created_at: '2026-01-01', instrument: { id: 'i2', ministry_id: 'm1', name: 'Piano', is_required: true, min_count: 1, max_count: 1, created_at: '2026-01-01' } },
    ],
    availability: [],
  },
  {
    id: '5',
    church_id: 'church-1',
    full_name: 'Simone',
    nickname: '',
    gender: 'female',
    status: 'active',
    max_monthly_assignments: 4,
    priority_score: 70,
    total_assignments: 4,
    created_at: '2026-01-01',
    updated_at: '2026-08-01',
    roles: [
      { id: '6', member_id: '5', role_id: 'r3', skill_level: 'expert', is_preferred: true, created_at: '2026-01-01', role: { id: 'r3', ministry_id: 'm1', name: 'Instrumentalist', min_required: 4, max_allowed: 6, priority: 3, is_active: true, created_at: '2026-01-01' } },
    ],
    skills: [
      { id: '3', member_id: '5', instrument_id: 'i3', skill_level: 'expert', is_primary: true, created_at: '2026-01-01', instrument: { id: 'i3', ministry_id: 'm1', name: 'Drums', is_required: true, min_count: 1, max_count: 1, created_at: '2026-01-01' } },
    ],
    availability: [],
  },
];

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const churchId = searchParams.get('church_id') || 'church-1';
  const status = searchParams.get('status');

  let filtered = mockMembers.filter((m) => m.church_id === churchId);
  if (status) {
    filtered = filtered.filter((m) => m.status === status);
  }

  return NextResponse.json({ members: filtered });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { full_name, nickname, gender, phone, email, roles, skills } = body;

  const newMember: Member = {
    id: String(mockMembers.length + 1),
    church_id: 'church-1',
    full_name,
    nickname,
    gender,
    phone,
    status: 'active',
    max_monthly_assignments: 3,
    priority_score: 50,
    total_assignments: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    roles: roles || [],
    skills: skills || [],
    availability: [],
  };

  mockMembers.push(newMember);

  return NextResponse.json({ member: newMember }, { status: 201 });
}
