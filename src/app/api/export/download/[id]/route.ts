import { NextRequest, NextResponse } from 'next/server';
import { requireStaff, getAdminClient } from '@/lib/auth/server';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/export/download/[id]
 * Streams a previously generated PDF back to the authenticated user. The row
 * is looked up by id AND church_id, so an export belonging to another church
 * is indistinguishable from one that does not exist (404) -- the tenant
 * boundary can never be crossed by guessing an id.
 */
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireStaff(request);
  if (auth instanceof Response) return auth;

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: 'Export not found.' }, { status: 404 });
  }

  try {
    const admin = getAdminClient();
    const { data: row, error } = await admin
      .from('church_exports')
      .select('filename, file_size, file_data_base64')
      .eq('id', id)
      .eq('church_id', auth.churchId)
      .maybeSingle<{ filename: string; file_size: number; file_data_base64: string }>();

    if (error) {
      console.error('Failed to load schedule export:', error);
      return NextResponse.json({ error: 'Could not load the export.' }, { status: 500 });
    }
    if (!row) return NextResponse.json({ error: 'Export not found.' }, { status: 404 });

    const buffer = Buffer.from(row.file_data_base64, 'base64');
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="' + row.filename + '"',
      },
    });
  } catch (error) {
    console.error('Failed to download schedule export:', error);
    return NextResponse.json({ error: 'Could not download the export.' }, { status: 500 });
  }
}