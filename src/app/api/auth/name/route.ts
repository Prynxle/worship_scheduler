import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit } from '@/lib/api/rate-limit';

type MemberRecord = {
  id: string;
  user_id: string | null;
  church_id: string;
  full_name: string;
  login_name: string;
  status: 'active' | 'inactive';
};

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Keep the private name as the production contract. The public-prefixed
  // fallback supports this repository's current local .env.local only.
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    ?? process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) throw new Error('Supabase server credentials are not configured');

  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function POST(request: Request) {
  // Rate limit BEFORE reading the body and BEFORE the try/catch below: the
  // catch-all converts thrown errors to 500, and 429 must never become 500.
  const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? request.headers.get('x-real-ip')
    ?? 'unknown';
  const rateCheck = checkRateLimit(`name-login:${clientIp}`);
  if (!rateCheck.ok) {
    return NextResponse.json(
      { error: 'Too many attempts. Please wait a moment.' },
      {
        status: 429,
        headers: { 'Retry-After': String(rateCheck.retryAfterSeconds) },
      },
    );
  }

  try {
    const body = (await request.json()) as { name?: unknown };
    const loginName = typeof body.name === 'string'
      ? body.name.trim().toLocaleLowerCase()
      : '';

    if (!loginName || loginName.length > 100) {
      return NextResponse.json({ error: 'Enter your name to continue.' }, { status: 400 });
    }

    const admin = getAdminClient();
    const { data: member, error: memberError } = await admin
      .from('members')
      .select('id, user_id, church_id, full_name, login_name, status')
      .eq('login_name', loginName)
      .eq('status', 'active')
      .maybeSingle<MemberRecord>();

    if (memberError) {
      console.error('Name login member lookup failed:', memberError);
      return NextResponse.json({ error: 'We could not check your name right now.' }, { status: 500 });
    }
    if (!member) {
      return NextResponse.json({ error: 'That name is not on the active worship roster.' }, { status: 401 });
    }

    const password = randomBytes(32).toString('base64url');
    const syntheticEmail = `${member.login_name}.${member.church_id}@name-login.invalid`;
    let signInEmail = syntheticEmail;
    let authId: string | null = null;
    let createdAuthUser = false;

    if (member.user_id) {
      const { data: user } = await admin
        .from('users')
        .select('auth_id, email')
        .eq('id', member.user_id)
        .maybeSingle<{ auth_id: string | null; email: string }>();
      authId = user?.auth_id ?? null;
      signInEmail = user?.email || syntheticEmail;
    }

    if (!authId) {
      const { data: createdUser, error: createError } = await admin.auth.admin.createUser({
        email: syntheticEmail,
        password,
        email_confirm: true,
        user_metadata: { member_id: member.id, login_name: member.login_name },
      });

      let authUser = createdUser?.user ?? null;
      if (createError && !authUser) {
        // A previous interrupted attempt may have created the Auth user but
        // failed before linking it to public.users/members.
        const { data: listedUsers, error: listError } = await admin.auth.admin.listUsers({
          page: 1,
          perPage: 1000,
        });
        authUser = listedUsers.users.find((user) => user.email === syntheticEmail) ?? null;
        if (listError || !authUser) {
          console.error('Name login auth user recovery failed:', createError, listError);
          return NextResponse.json({ error: 'We could not start your session.' }, { status: 500 });
        }
      }

      if (!authUser) {
        console.error('Name login auth user creation failed:', createError);
        return NextResponse.json({ error: 'We could not start your session.' }, { status: 500 });
      }

      authId = authUser.id;
      createdAuthUser = !createError;
      const { error: passwordError } = await admin.auth.admin.updateUserById(authId, { password });
      if (passwordError) {
        console.error('Name login auth user password update failed:', passwordError);
        return NextResponse.json({ error: 'We could not start your session.' }, { status: 500 });
      }
      let appUserId = member.user_id;
      if (!appUserId) {
        const { data: existingAppUser } = await admin
          .from('users')
          .select('id, email')
          .eq('auth_id', authId)
          .maybeSingle<{ id: string; email: string }>();
        appUserId = existingAppUser?.id ?? null;
        signInEmail = existingAppUser?.email || syntheticEmail;
      }
      const appUserError = appUserId
        ? (await admin.from('users').update({ auth_id: authId, email: syntheticEmail }).eq('id', appUserId)).error
        : null;

      if (!appUserId) {
        const { data: appUser, error: insertError } = await admin
          .from('users')
          .insert({
            auth_id: authId,
            email: syntheticEmail,
            full_name: member.full_name,
            role: 'member',
            is_active: true,
            church_id: member.church_id,
          })
          .select('id')
          .single<{ id: string }>();
        appUserId = appUser?.id ?? null;
        if (insertError) console.error('Name login app user creation failed:', insertError);
      }

      if (appUserError || !appUserId) {
        console.error('Name login app user creation failed:', appUserError);
        if (createdAuthUser) await admin.auth.admin.deleteUser(authId);
        return NextResponse.json({ error: 'We could not finish your account setup.' }, { status: 500 });
      }
      const { error: memberLinkError } = await admin
        .from('members')
        .update({ user_id: appUserId })
        .eq('id', member.id);
      if (memberLinkError) {
        console.error('Name login member link failed:', memberLinkError);
        return NextResponse.json({ error: 'We could not finish your account setup.' }, { status: 500 });
      }
    } else {
      const { error: updateError } = await admin.auth.admin.updateUserById(authId, { password });
      if (updateError) {
        console.error('Name login auth user update failed:', updateError);
        return NextResponse.json({ error: 'We could not start your session.' }, { status: 500 });
      }
    }

    const { data: sessionData, error: sessionError } = await admin.auth.signInWithPassword({
      email: signInEmail,
      password,
    });
    if (sessionError || !sessionData.session) {
      console.error('Name login session creation failed:', sessionError);
      return NextResponse.json({ error: 'We could not sign you in.' }, { status: 500 });
    }

    return NextResponse.json({
      access_token: sessionData.session.access_token,
      refresh_token: sessionData.session.refresh_token,
      member: { id: member.id, name: member.full_name, login_name: member.login_name },
    });
  } catch (error) {
    console.error('Name login request failed:', error);
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 });
  }
}
