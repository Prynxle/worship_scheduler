import { NextRequest, NextResponse } from 'next/server';
import { requireStaff, getAdminClient } from '@/lib/auth/server';

/**
 * Roles and instruments for the authenticated church, used to populate the
 * Add Member pickers. Both tables are tenant-owned through
 * `ministries.church_id`, so the church scope is applied at the ministry join
 * rather than on the leaf table.
 */
export async function GET(request: NextRequest) {
  const auth = await requireStaff(request);
  if (auth instanceof Response) return auth;

  const admin = getAdminClient();

  const { data: ministries, error: ministriesError } = await admin
    .from('ministries')
    .select('id, name')
    .eq('church_id', auth.churchId)
    .order('name');
  if (ministriesError) {
    return NextResponse.json({ error: 'Could not load ministries.' }, { status: 500 });
  }

  const ministryIds = (ministries ?? []).map((ministry) => ministry.id);
  const ministryName = new Map((ministries ?? []).map((ministry) => [ministry.id, ministry.name]));

  if (ministryIds.length === 0) {
    return NextResponse.json({ roles: [], instruments: [] });
  }

  const [{ data: roles, error: rolesError }, { data: instruments, error: instrumentsError }] = await Promise.all([
    admin
      .from('roles')
      .select('id, ministry_id, name')
      .in('ministry_id', ministryIds)
      .eq('is_active', true)
      .order('name'),
    admin
      .from('instruments')
      .select('id, ministry_id, name')
      .in('ministry_id', ministryIds)
      .order('name'),
  ]);

  if (rolesError) return NextResponse.json({ error: 'Could not load roles.' }, { status: 500 });
  if (instrumentsError) return NextResponse.json({ error: 'Could not load instruments.' }, { status: 500 });

  return NextResponse.json({
    roles: (roles ?? []).map((role) => ({ ...role, ministry_name: ministryName.get(role.ministry_id) ?? null })),
    instruments: (instruments ?? []).map((instrument) => ({
      ...instrument,
      ministry_name: ministryName.get(instrument.ministry_id) ?? null,
    })),
  });
}
