import { NextRequest, NextResponse } from 'next/server';
import { requireStaff, getAdminClient } from '@/lib/auth/server';
import { MemberFieldError, assertIdsBelongToChurch, parseMemberFields } from '@/lib/members/validation';

/**
 * Roles and instruments have no `church_id` of their own; they are tenant-owned
 * through `ministries.church_id`. Every caller-supplied id set is filtered
 * through that join so a coordinator cannot attach another church's role.
 *
 * The two embeds name their foreign key explicitly and must keep doing so.
 * `member_skills` holds TWO references to `members` -- the owner
 * (`member_id`) and the designated stand-in (`fallback_member_id`) -- so an
 * unqualified `member_skills(...)` embed makes PostgREST reject the whole
 * query with PGRST201 "more than one relationship was found", which surfaces
 * as an empty member list rather than an error the caller can act on.
 */
const MEMBER_SELECT =
  '*, roles:member_roles!member_roles_member_id_fkey(*, role:roles(*)), ' +
  'skills:member_skills!member_skills_member_id_fkey(*, instrument:instruments(*))';

export async function GET(request: NextRequest) {
  const auth = await requireStaff(request);
  if (auth instanceof Response) return auth;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  let query = getAdminClient()
    .from('members')
    .select(MEMBER_SELECT)
    .eq('church_id', auth.churchId)
    .order('full_name');

  if (status === 'active' || status === 'inactive') {
    query = query.eq('status', status);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: 'Could not load members.' }, { status: 500 });

  return NextResponse.json({ members: data ?? [] });
}

export async function POST(request: NextRequest) {
  const auth = await requireStaff(request);
  if (auth instanceof Response) return auth;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'The request body must be valid JSON.' }, { status: 400 });
  }

  // Field rules and tenant scoping live in one module so POST and PATCH cannot
  // drift apart on the parts that decide whether a write is safe.
  let fields;
  try {
    fields = parseMemberFields(body);
  } catch (error) {
    if (error instanceof MemberFieldError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: 'Could not read the member details.' }, { status: 400 });
  }
  const { full_name: fullName, login_name: loginName, nickname, phone, gender, role_ids: roleIds, instrument_ids: instrumentIds } = fields;

  const admin = getAdminClient();

  try {
    // Reject before any write when an id belongs to another church, rather than
    // silently dropping it. A coordinator must never be told a cross-tenant role
    // was saved. `roles` and `instruments` are tenant-owned through
    // `ministries.church_id`, so scope both through the ministry list.
    await assertIdsBelongToChurch(admin, auth.churchId, roleIds, instrumentIds);
  } catch (error) {
    if (error instanceof MemberFieldError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: 'Could not read the member details.' }, { status: 400 });
  }

  const { data: created, error: insertError } = await admin
    .from('members')
    .insert({
      church_id: auth.churchId,
      full_name: fullName,
      login_name: loginName,
      nickname,
      gender,
      phone,
      status: fields.status,
      max_monthly_assignments: 3,
      priority_score: 50,
      total_assignments: 0,
    })
    .select('*')
    .single();

  if (insertError || !created) {
    // 23505 is the unique violation on (church_id, login_name).
    if (insertError?.code === '23505') {
      return NextResponse.json(
        { error: `The login name "${loginName}" is already used by another member.` },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'Could not create member.' }, { status: 500 });
  }

  const memberId = created.id;

  // Supabase REST cannot batch these into one transaction, so a failure after
  // the member row exists would leave a half-created member that the coordinator
  // cannot see or fix from the UI. Delete the member on any child failure;
  // member_roles and member_skills cascade.
  const { error: rolesError } = roleIds.length
    ? await admin.from('member_roles').insert(roleIds.map((roleId) => ({ member_id: memberId, role_id: roleId })))
    : { error: null };
  if (rolesError) {
    await admin.from('members').delete().eq('id', memberId);
    return NextResponse.json({ error: 'Could not assign the selected roles.' }, { status: 500 });
  }

  const { error: skillsError } = instrumentIds.length
    ? await admin.from('member_skills').insert(instrumentIds.map((instrumentId) => ({ member_id: memberId, instrument_id: instrumentId })))
    : { error: null };
  if (skillsError) {
    await admin.from('members').delete().eq('id', memberId);
    return NextResponse.json({ error: 'Could not assign the selected instruments.' }, { status: 500 });
  }

  // Re-read through the same select the GET route uses so the created member is
  // shaped identically to every other card on the page.
  const { data: member, error: reloadError } = await admin
    .from('members')
    .select(MEMBER_SELECT)
    .eq('id', memberId)
    .single();
  if (reloadError || !member) {
    return NextResponse.json({ error: 'Could not load the new member.' }, { status: 500 });
  }

  return NextResponse.json({ member }, { status: 201 });
}
