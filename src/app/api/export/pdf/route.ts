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

    let logoDataUrl: string | undefined;
    if (church?.logo_url) {
      try {
        const res = await fetch(church.logo_url);
        if (res.ok) {
          const buf = await res.arrayBuffer();
          const b64 = Buffer.from(buf).toString('base64');
          logoDataUrl = 'data:image/png;base64,' + b64;
        }
      } catch {
        logoDataUrl = undefined;
      }
    }
    if (!logoDataUrl) {
      try {
        const fs = await import('fs');
        const path = await import('path');
        const p = path.join(process.cwd(), 'public', 'icon-removebg-preview.png');
        if (fs.existsSync(p)) {
          const buf = fs.readFileSync(p);
          logoDataUrl = 'data:image/png;base64,' + buf.toString('base64');
        }
      } catch {
        // ignore
      }
    }

    const doc = generateSchedulePDF({
      month,
      year,
      churchName: church?.name || 'Worship Schedule',
      churchLogoUrl: logoDataUrl,
      services: transformed,
    });

    const pdfBuffer = doc.output('arraybuffer');
    const fileBuffer = Buffer.from(pdfBuffer as ArrayBuffer);
    const filename = 'schedule-' + (month + 1) + '-' + year + '.pdf';

    // Persist the generated file so the Exports page can list and re-download
    // it. Non-fatal: if recording fails the direct download still works; the
    // error is logged so the gap stays observable. The file is stored as an
    // explicit base64 string (PostgREST does not decode JSON base64 into
    // bytea), mirroring the base64 logo handling above.
    //
    // Dedup: remove any previously recorded export for the same church/month/
    // year/week scope before inserting, so a repeated generation does not
    // create duplicate PDF records. The coordinator can delete an export and
    // regenerate it when needed. Recording stays non-fatal throughout.
    const weekNumbers = weekFilter ? Array.from(weekFilter).sort((a, b) => a - b) : null;
    try {
      let dedupQuery = admin
        .from('church_exports')
        .delete()
        .eq('church_id', auth.churchId)
        .eq('month', month)
        .eq('year', year)
        .eq('format', 'pdf');
      if (weekNumbers && weekNumbers.length > 0) {
        dedupQuery = dedupQuery.eq('week_numbers', '{' + weekNumbers.join(',') + '}');
      } else {
        dedupQuery = dedupQuery.is('week_numbers', null);
      }
      await dedupQuery;
    } catch (dedupError) {
      console.error('Failed to deduplicate schedule export:', dedupError);
    }
    try {
      await admin.from('church_exports').insert({
        church_id: auth.churchId,
        created_by: auth.userId,
        month,
        year,
        week_numbers: weekNumbers,
        format: 'pdf',
        filename,
        file_size: fileBuffer.byteLength,
        file_data_base64: fileBuffer.toString('base64'),
      });
    } catch (recordError) {
      console.error('Failed to record schedule export:', recordError);
    }

    return new NextResponse(fileBuffer, {
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
