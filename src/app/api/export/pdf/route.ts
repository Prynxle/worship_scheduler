import { NextRequest, NextResponse } from 'next/server';
import { requireStaff, getAdminClient } from '@/lib/auth/server';
import { generateSchedulePDF } from '@/lib/export/pdf';
import { loadScheduleData } from '@/lib/scheduling/schedule-data';
import { transformServiceAssignments } from '@/lib/scheduling/service-transform';

export async function POST(request: NextRequest) {
  const auth = await requireStaff(request);
  if (auth instanceof Response) return auth;

  const body = await request.json().catch(() => null);
  const { month, year, week_numbers, schedule_id } = body || {};

  if (
    typeof month !== 'number' || !Number.isInteger(month) || month < 0 || month > 11 ||
    typeof year !== 'number' || !Number.isInteger(year)
  ) {
    return NextResponse.json({ error: 'month (0-11) and year are required.' }, { status: 400 });
  }

  try {
    const admin = getAdminClient();
    const { data: church } = await admin
      .from('churches')
      .select('name, logo_url')
      .eq('id', auth.churchId)
      .maybeSingle();

    const data = await loadScheduleData(auth.churchId, month, year);

    const weekFilter = Array.isArray(week_numbers) && week_numbers.length > 0 ? new Set<number>(week_numbers) : null;

    const transformed = data.services
      .map((service) => transformServiceAssignments(service, data.assignments))
      .filter((service) => service.status === 'published' || service.status === 'validated')
      .filter((service) => !weekFilter || weekFilter.has(service.week_number))
      .filter((service) => !schedule_id || service.id === schedule_id);

    if (transformed.length === 0) {
      return NextResponse.json({ error: 'No published or validated schedule found for the selected period.' }, { status: 400 });
    }

    const servicesForPdf: any[] = transformed.map((t) => ({
      ...t,
      assignments: data.assignments.filter((a) => a.service_id === t.id),
    }));

    const doc = generateSchedulePDF({
      month,
      year,
      churchName: church?.name || 'Worship Schedule',
      churchLogoUrl: church?.logo_url,
      services: servicesForPdf,
    });

    const pdfBuffer = doc.output('arraybuffer');
    const filename = 'schedule-' + (month + 1) + '-' + year + '.pdf';

    return new NextResponse(Buffer.from(pdfBuffer as ArrayBuffer), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="' + filename + '"',
      },
    });
  } catch (error) {
    console.error('PDF export failed:', error);
    return NextResponse.json({ error: 'Could not generate the schedule PDF.' }, { status: 500 });
  }
}
