import { NextRequest, NextResponse } from 'next/server';
import { Availability } from '@/lib/types/database';

const mockAvailabilities: Availability[] = [
  {
    id: '1',
    member_id: '2',
    church_id: 'church-1',
    type: 'weekly',
    week_number: 1,
    status: 'approved',
    created_at: '2026-08-01',
  },
  {
    id: '2',
    member_id: '2',
    church_id: 'church-1',
    type: 'weekly',
    week_number: 2,
    status: 'approved',
    created_at: '2026-08-01',
  },
  {
    id: '3',
    member_id: '1',
    church_id: 'church-1',
    type: 'date',
    date: '2026-08-17',
    status: 'pending',
    created_at: '2026-08-01',
  },
];

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const memberId = searchParams.get('member_id');
  const churchId = searchParams.get('church_id') || 'church-1';

  let filtered = mockAvailabilities.filter((a) => a.church_id === churchId);
  if (memberId) {
    filtered = filtered.filter((a) => a.member_id === memberId);
  }

  return NextResponse.json({ availabilities: filtered });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { member_id, type, week_number, date, end_date, reason } = body;

  const newAvailability: Availability = {
    id: String(mockAvailabilities.length + 1),
    member_id,
    church_id: 'church-1',
    type,
    week_number,
    date,
    end_date,
    reason,
    status: 'pending',
    created_at: new Date().toISOString(),
  };

  mockAvailabilities.push(newAvailability);

  return NextResponse.json({ availability: newAvailability }, { status: 201 });
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const { id, status } = body;

  const availability = mockAvailabilities.find((a) => a.id === id);
  if (!availability) {
    return NextResponse.json({ error: 'Availability not found' }, { status: 404 });
  }

  availability.status = status;

  return NextResponse.json({ availability });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  const index = mockAvailabilities.findIndex((a) => a.id === id);
  if (index === -1) {
    return NextResponse.json({ error: 'Availability not found' }, { status: 404 });
  }

  mockAvailabilities.splice(index, 1);

  return NextResponse.json({ success: true });
}
