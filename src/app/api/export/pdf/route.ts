import { NextRequest, NextResponse } from 'next/server';
import { requireStaff, getAdminClient } from '@/lib/auth/server';
import { generateSchedulePDF } from '@/lib/export/pdf';
import { loadScheduleData } from '@/lib/scheduling/schedule-data';
import { ScheduleAssignment, Service } from '@/lib/types/database';

/**
 * PDF export for one church month.
 *
 * The data is loaded through `loadScheduleData`, the SAME domain loader the
 * Schedule > Monthly lineups cards use. Both the tenant scope (`church_id`) and
 * the active-ministry scope are applied inside it, so the exported PDF can never
 * disagree with what the coordinator sees on screen.
 *
 * `month` is 0-BASED, exactly like `GET /api/schedule` and the
 * `services.month` column (`services_month_date_consistency_check` enforces
 * `month = EXTRACT(MONTH FROM date) - 1`). A 1-based value here matched no rows
 * at all, which is why every export came out empty.
 */
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
    const assignmentsByService = new Map<string, ScheduleAssignment[]>();
    for (const assignment of data.assignments) {
      const existing = assignmentsByService.get(assignment.service_id);
      if (existing) existing.push(assignment);
      else assignmentsByService.set(assignment.service_id, [assignment]);
    }

    const services = data.services
      .filter((service) => !weekFilter || weekFilter.has(service.week_number))
      .filter((service) => !schedule_id || service.id === schedule_id)
      .map((service) => ({ ...service, assignments: assignmentsByService.get(service.id) ?? [] }));

    const doc = generateSchedulePDF({
      month,
      year,
      churchName: church?.name || 'Worship Schedule',
      churchLogoUrl: church?.logo_url,
      services: services as (Service & { assignments: ScheduleAssignment[] })[],
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
