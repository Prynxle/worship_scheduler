import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { format, schedule_id, month, year, week_numbers } = body;

  const exportData = {
    id: 'export-1',
    format,
    schedule_id,
    month,
    year,
    week_numbers,
    created_at: new Date().toISOString(),
    status: 'completed',
    download_url: `/exports/schedule-${month}-${year}.${format}`,
  };

  return NextResponse.json({ export: exportData });
}
