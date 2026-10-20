import { NextRequest, NextResponse } from 'next/server';
import { requireStaff, getAdminClient } from '@/lib/auth/server';

/**
 * GET /api/export/list
 * Returns the authenticated church's most recent generated exports, newest
 * first. Metadata only -- the stored file bytes (`file_data_base64`) are never
 * selected here, so the payload stays small and the bytes only ever leave the
 * server through the download route.
 */
export async function GET(request: NextRequest) {
  const auth = await requireStaff(request);
  if (auth instanceof Response) return auth;

  try {
    const admin = getAdminClient();
    const { data, error } = await admin
      .from('church_exports')
      .select('id, month, year, week_numbers, format, filename, file_size, created_by, created_at')
      .eq('church_id', auth.churchId)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      console.error('Failed to list schedule exports:', error);
      return NextResponse.json({ error: 'Could not load recent exports.' }, { status: 500 });
    }
    return NextResponse.json({ exports: data ?? [] });
  } catch (error) {
    console.error('Failed to list schedule exports:', error);
    return NextResponse.json({ error: 'Could not load recent exports.' }, { status: 500 });
  }
}