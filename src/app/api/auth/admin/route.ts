import { NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/api/rate-limit';
import { getAdminClient, isStaff } from '@/lib/auth/server';

export async function POST(request: Request) {
  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? request.headers.get('x-real-ip')
    ?? 'unknown';
  const rateCheck = checkRateLimit(`admin-login:${clientIp}`);
  if (!rateCheck.ok) {
    return NextResponse.json(
      { error: 'Too many attempts. Please wait a moment.' },
      { status: 429, headers: { 'Retry-After': String(rateCheck.retryAfterSeconds) } },
    );
  }

  const expectedUsername = process.env.ADMIN_LOGIN_USERNAME;
  const expectedPassword = process.env.ADMIN_LOGIN_PASSWORD;
  const email = process.env.ADMIN_LOGIN_EMAIL;
  if (!expectedUsername || !expectedPassword || !email) {
    return NextResponse.json({ error: 'We could not sign you in.' }, { status: 503 });
  }

  try {
    const body = await request.json() as { username?: unknown; password?: unknown };
    if (body.username !== expectedUsername || body.password !== expectedPassword) {
      return NextResponse.json({ error: 'We could not sign you in.' }, { status: 401 });
    }

    const { data, error } = await getAdminClient().auth.signInWithPassword({
      email,
      password: expectedPassword,
    });
    if (error || !data.session) {
      return NextResponse.json({ error: 'We could not sign you in.' }, { status: 401 });
    }
    const { data: appUser } = await getAdminClient()
      .from('users')
      .select('role, is_active')
      .eq('auth_id', data.user?.id)
      .maybeSingle<{ role: 'admin' | 'coordinator' | 'member'; is_active: boolean }>();
    if (!appUser || !appUser.is_active || !isStaff(appUser.role)) {
      return NextResponse.json({ error: 'We could not sign you in.' }, { status: 401 });
    }

    return NextResponse.json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      role: appUser.role,
    });
  } catch {
    return NextResponse.json({ error: 'We could not sign you in.' }, { status: 401 });
  }
}
