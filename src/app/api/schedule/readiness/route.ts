import { NextRequest, NextResponse } from 'next/server';
import { requireStaff } from '@/lib/auth/server';
import { loadAvailabilityReadiness } from '@/lib/scheduling/availability-readiness';

function parseMonthYear(request: Request) {
  const params = new URL(request.url).searchParams;
  const month = Number(params.get('month'));
  const year = Number(params.get('year'));
  if (!Number.isInteger(month) || month < 0 || month > 11 || !Number.isInteger(year) || year < 2000 || year > 2100) return null;
  return { month, year, ministryId: params.get('ministry_id') ?? undefined };
}

export async function GET(request: NextRequest) {
  const auth = await requireStaff(request);
  if (auth instanceof Response) return auth;
  const selection = parseMonthYear(request);
  if (!selection) return NextResponse.json({ error: 'A valid month and year are required.' }, { status: 400 });
  try {
    const readiness = await loadAvailabilityReadiness(auth.churchId, selection.month, selection.year, selection.ministryId);
    return NextResponse.json(readiness);
  } catch (error) {
    console.error('GET /api/schedule/readiness failed', error);
    const message = error instanceof Error ? error.message : 'Could not load availability readiness.';
    const status = message === 'No active ministry was found for this church.' ? 409 : 500;
    return NextResponse.json({ error: status === 409 ? message : 'Could not load availability readiness.' }, { status });
  }
}
