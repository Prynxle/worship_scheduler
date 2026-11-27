import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient, requireStaff } from '@/lib/auth/server';
import { DevotionRotation } from '@/lib/scheduling/devotion-rotation';
import { loadScheduleData } from '@/lib/scheduling/schedule-data';
import type { DevotionRotation as DevotionRotationRecord, Member } from '@/lib/types/database';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function devotionMembers(members: Member[]) {
  return members.filter((member) => member.roles?.some((item) => item.role?.name.toLowerCase().includes('devotion')));
}

function parseWeek(value: string | null): number | null {
  if (value === null) return 1;
  if (!/^[1-5]$/.test(value)) return null;
  return Number(value);
}

async function loadDevotionContext(churchId: string, month: number, year: number) {
  const [scheduleData, rotationResult] = await Promise.all([
    loadScheduleData(churchId, month, year),
    getAdminClient().from('devotion_rotation').select('*').eq('church_id', churchId).order('position'),
  ]);
  if (rotationResult.error) throw new Error('Could not load the devotion rotation.');
  return {
    members: devotionMembers(scheduleData.members),
    rotation: (rotationResult.data ?? []) as DevotionRotationRecord[],
  };
}

export async function GET(request: NextRequest) {
  const auth = await requireStaff(request);
  if (auth instanceof Response) return auth;

  const params = new URL(request.url).searchParams;
  const weekNumber = parseWeek(params.get('week_number'));
  if (weekNumber === null) {
    return NextResponse.json({ error: 'week_number must be between 1 and 5.' }, { status: 400 });
  }

  try {
    const now = new Date();
    const month = now.getMonth();
    const year = now.getFullYear();
    const { members, rotation: records } = await loadDevotionContext(auth.churchId, month, year);
    const rotation = new DevotionRotation(auth.churchId, records);
    return NextResponse.json({ rotation: rotation.getNextDevotionMembers(members, weekNumber, 4, month, year) });
  } catch {
    return NextResponse.json({ error: 'Could not load the devotion rotation.' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireStaff(request);
  if (auth instanceof Response) return auth;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'The request body must be valid JSON.' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || !('assigned_member_ids' in body) || !Array.isArray(body.assigned_member_ids) ||
    !body.assigned_member_ids.every((id) => typeof id === 'string' && UUID_PATTERN.test(id))) {
    return NextResponse.json({ error: 'assigned_member_ids must be an array of member IDs.' }, { status: 400 });
  }

  try {
    const now = new Date().toISOString();
    const context = await loadDevotionContext(auth.churchId, new Date().getMonth(), new Date().getFullYear());
    const eligibleIds = new Set(context.members.filter((member) => member.status === 'active').map((member) => member.id));
    const assignedIds = [...new Set(body.assigned_member_ids as string[])].filter((id) => eligibleIds.has(id));
    const rotationIds = new Set(context.rotation.map((entry) => entry.member_id));
    const admin = getAdminClient();

    const existingIds = assignedIds.filter((id) => rotationIds.has(id));
    if (existingIds.length) {
      const { error } = await admin.from('devotion_rotation').update({ last_used_at: now })
        .eq('church_id', auth.churchId).in('member_id', existingIds);
      if (error) throw error;
    }

    const newIds = assignedIds.filter((id) => !rotationIds.has(id));
    if (newIds.length) {
      const nextPosition = Math.max(0, ...context.rotation.map((entry) => entry.position)) + 1;
      const { error } = await admin.from('devotion_rotation').insert(newIds.map((memberId, index) => ({
        church_id: auth.churchId,
        member_id: memberId,
        position: nextPosition + index,
        last_used_at: now,
      })));
      if (error) throw error;
    }

    const { data, error } = await admin.from('devotion_rotation').select('*').eq('church_id', auth.churchId).order('position');
    if (error) throw error;
    return NextResponse.json({ rotation: data ?? [] });
  } catch {
    return NextResponse.json({ error: 'Could not update the devotion rotation.' }, { status: 500 });
  }
}
