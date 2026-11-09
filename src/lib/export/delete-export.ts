import { NextRequest, NextResponse } from 'next/server';
import { requireStaff, getAdminClient } from '@/lib/auth/server';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Tenant-scoped deletion of a persisted schedule export. Returns a stable
 * NextResponse so every route alias shares identical behavior.
 */
export async function deleteExport(request: NextRequest, id: string | null): Promise<NextResponse> {
  const auth = await requireStaff(request);
  if (auth instanceof Response) return auth as unknown as NextResponse;

  if (!id || !UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: 'Export not found.' }, { status: 404 });
  }

  try {
    const admin = getAdminClient();
    const { data, error } = await admin
      .from('church_exports')
      .delete()
      .eq('id', id)
      .eq('church_id', auth.churchId)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('Failed to delete schedule export:', error);
      return NextResponse.json({ error: 'Could not delete the export.' }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: 'Export not found.' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Failed to delete schedule export:', error);
    return NextResponse.json({ error: 'Could not delete the export.' }, { status: 500 });
  }
}
