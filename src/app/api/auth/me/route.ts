import { NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/auth/server';

export async function GET(request: Request) {
  const context = await getAuthContext(request);
  if (!context) return NextResponse.json({ error: 'Authentication required.' }, { status: 401 });
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
  });
}
