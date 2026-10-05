import { NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth/server';
import { getMemberProfile } from '@/lib/api/member-workspace';

export async function GET(request: Request) {
  const context = await getAuthContext(request);
  if (!context) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });

  // Additive only: the sidebar and every existing consumer of this response keep
  // working. `profile` is null when the account has no active member record,
  // which is a real state (a staff login usually does not) and is reported
  // explicitly rather than as an empty roles list, so the member workspace can
  // say "role unavailable" instead of silently rendering nothing.
  const profile = context.memberId ? await getMemberProfile(context, context.memberId) : null;

  return NextResponse.json({
    user: {
      id: context.userId,
      member_id: context.memberId,
      church_id: context.churchId,
      full_name: context.fullName,
      member_name: context.memberName,
      phone: context.phone,
      role: context.role,
    },
    profile,
  });
}