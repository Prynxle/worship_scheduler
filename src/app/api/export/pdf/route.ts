import { NextRequest, NextResponse } from 'next/server';
import { requireStaff, getAdminClient } from '@/lib/auth/server';
import { generateSchedulePDF } from '@/lib/export/pdf';
import { Service, ScheduleAssignment } from '@/lib/types/database';

type ServiceWithAssignments = Service & { schedule_assignments?: ScheduleAssignment[]; assignments?: ScheduleAssignment[] };

export async function POST(request: NextRequest) {
  const auth = await requireStaff(request);
  if (auth instanceof Response) return auth;

  const body = await request.json().catch(() => null);
  const { month, year, week_numbers, schedule_id } = body || {};

  if (!month || !year) {
    return NextResponse.json({ error: 'month and year are required.' }, { status: 400 });
  }

  const admin = getAdminClient();
  const { data: church } = await admin
    .from('churches')
    .select('name, logo_url')
    .eq('id', auth.churchId)
    .maybeSingle();

  let servicesQuery = admin
    .from('services')
    .select('*, schedule_assignments(*, member:members(*), role:roles(*), instrument:instruments(*))')
    .eq('church_id', auth.churchId)
    .eq('month', month)
    .eq('year', year)
    .order('date', { ascending: true });

  if (Array.isArray(week_numbers) && week_numbers.length > 0) {
    servicesQuery = servicesQuery.in('week_number', week_numbers);
  }
  if (schedule_id) {
    servicesQuery = servicesQuery.eq('id', schedule_id);
  }

  const { data: services, error } = await servicesQuery;
  if (error) {
    console.error('PDF export query error:', error);
    return NextResponse.json({ error: 'Could not load schedule.' }, { status: 500 });
  }

  const mapped = (services as ServiceWithAssignments[] | null | undefined)?.map((s) => ({
    ...s,
    assignments: s.schedule_assignments || s.assignments || [],
  }));

  const doc = generateSchedulePDF({
    month: Number(month),
    year: Number(year),
    churchName: church?.name || 'Worship Schedule',
    churchLogoUrl: church?.logo_url,
    services: mapped as (Service & { assignments: ScheduleAssignment[] })[],
  });

  const pdfBuffer = doc.output('arraybuffer');
  const filename = 'schedule-' + month + '-' + year + '.pdf';

  return new NextResponse(Buffer.from(pdfBuffer as ArrayBuffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="' + filename + '"',
    },
  });
}
