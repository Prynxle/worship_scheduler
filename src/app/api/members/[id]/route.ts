import { NextRequest, NextResponse } from 'next/server';
import { requireStaff, getAdminClient } from '@/lib/auth/server';
import {
  MemberFieldError,
  assertIdsBelongToChurch,
  isUuid,
  parseMemberFields,
  type ParsedMemberFields,
} from '@/lib/members/validation';

/**
 * The two embeds name their foreign key explicitly and must keep doing so.
 * `member_skills` holds TWO references to `members` -- the owner
 * (`member_id`) and the designated stand-in (`fallback_member_id`) -- so an
 * unqualified `member_skills(...)` embed makes PostgREST reject the whole query
 * with PGRST201, which surfaces as an empty member list rather than an error the
 * caller can act on. Shared with GET /api/members; keep the two in step.
 */
const MEMBER_SELECT =
  '*, roles:member_roles!member_roles_member_id_fkey(*, role:roles(*)), ' +
  'skills:member_skills!member_skills_member_id_fkey(*, instrument:instruments(*))';

interface PriorRole {
  role_id: string;
  skill_level?: string;
  is_preferred?: boolean;
}

interface PriorSkill {
  instrument_id: string;
  skill_level?: string;
  is_primary?: boolean;
  fallback_member_id?: string | null;
}

/**
 * Replace this member's roles and instruments with exactly `roleIds` /
 * `instrumentIds`.
 *
 * Supabase REST cannot batch a delete and its inserts into one transaction, so
 * this is a delete-then-insert and there is a window where the member has
 * neither. The caller is expected to have snapshotted the previous sets first so
 * a failure can be undone; see `restoreChildren`. A member left with no roles
 * mid-request is strictly better than one left holding the WRONG roles, and the
 * window is a single round trip, but it is the reason the snapshot exists rather
 * than a tolerated edge case.
 *
 * `roleMeta` / `skillMeta` carry the per-row attributes of the ids that are
 * being kept. This is not an optimisation. The delete drops the old rows, and a
 * bare re-insert would fall back to the column defaults -- silently demoting an
 * `advanced` guitarist to `intermediate` and clearing `is_preferred` and the
 * `fallback_member_id` chain, all as a side effect of someone fixing a typo in a
 * name. Ids with no prior row simply take the defaults, which is what a newly
 * added role should get.
 */
async function replaceChildren(
  admin: ReturnType<typeof getAdminClient>,
  memberId: string,
  roleIds: string[],
  instrumentIds: string[],
  roleMeta: Map<string, PriorRole>,
  skillMeta: Map<string, PriorSkill>,
): Promise<{ rolesError: unknown; skillsError: unknown }> {
  const { error: deleteRolesError } = await admin.from('member_roles').delete().eq('member_id', memberId);
  if (deleteRolesError) return { rolesError: deleteRolesError, skillsError: null };

  const { error: deleteSkillsError } = await admin.from('member_skills').delete().eq('member_id', memberId);
  if (deleteSkillsError) return { rolesError: null, skillsError: deleteSkillsError };

  if (roleIds.length > 0) {
    const { error } = await admin
      .from('member_roles')
      .insert(
        roleIds.map((roleId) => ({ member_id: memberId, role_id: roleId, ...(roleMeta.get(roleId) ?? {}) })),
      );
    if (error) return { rolesError: error, skillsError: null };
  }

  if (instrumentIds.length > 0) {
    const { error } = await admin
      .from('member_skills')
      .insert(
        instrumentIds.map((instrumentId) => ({
          member_id: memberId,
          instrument_id: instrumentId,
          ...(skillMeta.get(instrumentId) ?? {}),
        })),
      );
    if (error) return { rolesError: null, skillsError: error };
  }

  return { rolesError: null, skillsError: null };
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await requireStaff(request);
  if (auth instanceof Response) return auth;

  const { id: memberId } = await context.params;
  if (!isUuid(memberId)) {
    return NextResponse.json({ error: 'That member could not be found.' }, { status: 404 });
  }

  let fields: ParsedMemberFields;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    fields = parseMemberFields(body);
  } catch (error) {
    if (error instanceof MemberFieldError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: 'The request body must be valid JSON.' }, { status: 400 });
  }

  const admin = getAdminClient();

  // Scoped by church_id, not just id. A 404 rather than a 403, so the response
  // cannot be used to confirm that some other church's member id exists.
  const { data: existing, error: existingError } = await admin
    .from('members')
    .select('*')
    .eq('id', memberId)
    .eq('church_id', auth.churchId)
    .maybeSingle();
  if (existingError) {
    return NextResponse.json({ error: 'Could not load the member.' }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: 'That member could not be found.' }, { status: 404 });
  }

  try {
    await assertIdsBelongToChurch(admin, auth.churchId, fields.role_ids, fields.instrument_ids);
  } catch (error) {
    if (error instanceof MemberFieldError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  // Snapshot the full prior rows before the first write. `replaceChildren` is a
  // delete-then-insert, so an undo needs the exact prior state -- and so does a
  // successful edit, which must not reset skill levels it is not touching.
  const [priorRoles, priorSkills] = await Promise.all([
    admin.from('member_roles').select('*').eq('member_id', memberId),
    admin.from('member_skills').select('*').eq('member_id', memberId),
  ]);
  const previousRoleRows = (priorRoles.data ?? []) as PriorRole[];
  const previousSkillRows = (priorSkills.data ?? []) as PriorSkill[];
  const previousRoleIds = previousRoleRows.map((row) => row.role_id);
  const previousInstrumentIds = previousSkillRows.map((row) => row.instrument_id);
  const roleMeta = new Map(previousRoleRows.map((row) => [row.role_id, row]));
  const skillMeta = new Map(previousSkillRows.map((row) => [row.instrument_id, row]));

  const { error: updateError } = await admin
    .from('members')
    .update({
      full_name: fields.full_name,
      login_name: fields.login_name,
      nickname: fields.nickname,
      phone: fields.phone,
      gender: fields.gender,
      status: fields.status,
    })
    .eq('id', memberId)
    .eq('church_id', auth.churchId);
  if (updateError) {
    // 23505 is the unique violation on (church_id, login_name).
    if (updateError.code === '23505') {
      return NextResponse.json(
        { error: `The login name "${fields.login_name}" is already used by another member.` },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: 'Could not save the member.' }, { status: 500 });
  }

  const { rolesError, skillsError } = await replaceChildren(
    admin,
    memberId,
    fields.role_ids,
    fields.instrument_ids,
    roleMeta,
    skillMeta,
  );
  if (rolesError || skillsError) {
    // Put the member back the way it was. Without this a failed role insert
    // would leave a coordinator looking at a renamed member who has silently
    // lost every role, and no way to tell that from an intentional edit.
    await admin
      .from('members')
      .update({
        full_name: existing.full_name,
        login_name: existing.login_name,
        nickname: existing.nickname,
        phone: existing.phone,
        gender: existing.gender,
        status: existing.status,
      })
      .eq('id', memberId)
      .eq('church_id', auth.churchId);
    await replaceChildren(admin, memberId, previousRoleIds, previousInstrumentIds, roleMeta, skillMeta);

    return NextResponse.json(
      {
        error: rolesError
          ? 'Could not assign the selected roles, so no changes were saved.'
          : 'Could not assign the selected instruments, so no changes were saved.',
      },
      { status: 500 },
    );
  }

  // Re-read through the same select the GET route uses so the updated member is
  // shaped identically to every other card on the page.
  const { data: member, error: reloadError } = await admin
    .from('members')
    .select(MEMBER_SELECT)
    .eq('id', memberId)
    .eq('church_id', auth.churchId)
    .single();
  if (reloadError || !member) {
    return NextResponse.json({ error: 'The member was saved but could not be reloaded. Refresh the list.' }, { status: 500 });
  }

  return NextResponse.json({ member });
}
