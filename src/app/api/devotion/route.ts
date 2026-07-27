import { NextRequest, NextResponse } from 'next/server';
import { DevotionRotation } from '@/lib/scheduling/devotion-rotation';
import { Member, DevotionRotation as DevotionRotationType } from '@/lib/types/database';

const mockMembers: Member[] = [
  {
    id: '1',
    church_id: 'church-1',
    full_name: 'Beng',
    status: 'active',
    max_monthly_assignments: 3,
    priority_score: 70,
    total_assignments: 2,
    created_at: '2026-01-01',
    updated_at: '2026-08-01',
    roles: [
      { id: '1', member_id: '1', role_id: 'r4', skill_level: 'advanced', is_preferred: true, created_at: '2026-01-01', role: { id: 'r4', ministry_id: 'm1', name: 'Devotion', min_required: 1, max_allowed: 1, priority: 4, is_active: true, created_at: '2026-01-01' } },
    ],
    skills: [],
    availability: [],
  },
  {
    id: '2',
    church_id: 'church-1',
    full_name: 'Kass',
    status: 'active',
    max_monthly_assignments: 3,
    priority_score: 75,
    total_assignments: 2,
    created_at: '2026-01-01',
    updated_at: '2026-08-01',
    roles: [
      { id: '2', member_id: '2', role_id: 'r4', skill_level: 'advanced', is_preferred: false, created_at: '2026-01-01', role: { id: 'r4', ministry_id: 'm1', name: 'Devotion', min_required: 1, max_allowed: 1, priority: 4, is_active: true, created_at: '2026-01-01' } },
    ],
    skills: [],
    availability: [],
  },
  {
    id: '3',
    church_id: 'church-1',
    full_name: 'Caleb M.',
    status: 'active',
    max_monthly_assignments: 3,
    priority_score: 60,
    total_assignments: 1,
    created_at: '2026-01-01',
    updated_at: '2026-08-01',
    roles: [
      { id: '3', member_id: '3', role_id: 'r4', skill_level: 'intermediate', is_preferred: false, created_at: '2026-01-01', role: { id: 'r4', ministry_id: 'm1', name: 'Devotion', min_required: 1, max_allowed: 1, priority: 4, is_active: true, created_at: '2026-01-01' } },
    ],
    skills: [],
    availability: [],
  },
  {
    id: '4',
    church_id: 'church-1',
    full_name: 'Marlyn',
    status: 'active',
    max_monthly_assignments: 3,
    priority_score: 80,
    total_assignments: 1,
    created_at: '2026-01-01',
    updated_at: '2026-08-01',
    roles: [
      { id: '4', member_id: '4', role_id: 'r4', skill_level: 'advanced', is_preferred: true, created_at: '2026-01-01', role: { id: 'r4', ministry_id: 'm1', name: 'Devotion', min_required: 1, max_allowed: 1, priority: 4, is_active: true, created_at: '2026-01-01' } },
    ],
    skills: [],
    availability: [],
  },
];

const mockRotation: DevotionRotationType[] = [
  { id: '1', church_id: 'church-1', member_id: '1', position: 1, last_used_at: '2026-07-06', is_active: true, created_at: '2026-01-01' },
  { id: '2', church_id: 'church-1', member_id: '2', position: 2, last_used_at: '2026-07-13', is_active: true, created_at: '2026-01-01' },
  { id: '3', church_id: 'church-1', member_id: '3', position: 3, last_used_at: '2026-07-20', is_active: true, created_at: '2026-01-01' },
  { id: '4', church_id: 'church-1', member_id: '4', position: 4, last_used_at: '2026-07-27', is_active: true, created_at: '2026-01-01' },
];

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const churchId = searchParams.get('church_id') || 'church-1';
  const weekNumber = parseInt(searchParams.get('week_number') || '1');

  const rotation = new DevotionRotation(churchId, mockRotation);
  const nextMembers = rotation.getNextDevotionMembers(mockMembers, weekNumber, 4);

  return NextResponse.json({ rotation: nextMembers });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { church_id, assigned_member_ids } = body;

  const rotation = new DevotionRotation(church_id || 'church-1', mockRotation);
  const updatedRotation = await rotation.updateRotation(assigned_member_ids);

  return NextResponse.json({ rotation: updatedRotation });
}
