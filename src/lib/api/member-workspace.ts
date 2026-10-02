import { getAdminClient, type AuthContext } from '@/lib/auth/server';

/**
 * Read models for the member workspace (issue #38).
 *
 * These live here rather than in `@/lib/types/database` because they are the
 * response shapes of two API routes, not table row shapes. The table shapes stay
 * in `database.ts` and are reused where they fit.
 *
 * Only NAMES are exposed. The parent tables also carry coordination metadata that
 * this deliberately does not surface to a member looking at their own profile:
 *   - `member_skills.skill_level`  a proficiency rating, and unfilled rows would
 *     otherwise have to be shown as some invented default.
 *   - `member_skills.is_primary`   DEFAULT TRUE, so nearly every instrument would
 *     render the badge; per the schema it means "primary player" versus "fallback
 *     player" alongside `fallback_member_id`, not "my main instrument".
 *   - `member_roles.is_preferred`  a hint for who to assign, not a self-description.
 * Those belong to the scheduling engine's inputs, and the coordinator-facing member
 * management screens, which already show them.
 */

export type MemberProfile = {
  memberId: string;
  fullName: string;
  phone: string | null;
  accountRole: AuthContext['role'];
  /** Ministry role names, from `member_roles`. */
  ministryRoles: string[];
  /** Instrument names, from `member_skills`. */
  instruments: string[];
};

/**
 * `member_skills` holds TWO references to `members` -- the owner (`member_id`)
 * and the designated stand-in (`fallback_member_id`) -- so an unqualified
 * `member_skills(...)` embed makes PostgREST reject the whole query with
 * PGRST201 "more than one relationship was found", which surfaces as an empty
 * profile rather than an error. The explicit FK name is load-bearing.
 */
const PROFILE_SELECT =
  'id, full_name, phone, ' +
  'roles:member_roles!member_roles_member_id_fkey(*, role:roles(name)), ' +
  'skills:member_skills!member_skills_member_id_fkey(*, instrument:instruments(name))';

type ProfileRow = {
  id: string;
  full_name: string;
  phone: string | null;
  roles?: Array<{ role?: { name?: unknown } | null }> | null;
  skills?: Array<{ instrument?: { name?: unknown } | null }> | null;
};

/**
 * Ministry roles and instruments for the authenticated member.
 *
 * `memberId` is taken from the session by the caller and never from the request,
 * and the query is additionally scoped to `church_id`. The service-role client
 * bypasses RLS entirely, so that explicit scope is the tenant boundary -- it is
 * the same discipline as `src/app/api/members/route.ts:30`.
 */
export async function getMemberProfile(context: AuthContext, memberId: string): Promise<MemberProfile | null> {
  const { data, error } = await getAdminClient()
    .from('members')
    .select(PROFILE_SELECT)
    .eq('id', memberId)
    .eq('church_id', context.churchId)
    .maybeSingle<ProfileRow>();

  if (error || !data) return null;

  return {
    memberId: data.id,
    fullName: data.full_name,
    phone: data.phone ?? null,
    // The ACCOUNT role, deliberately kept separate from ministryRoles. Issue #38
    // asked for the member's real role to be shown instead of the hardcoded
    // "Worship team member" string; `context.role` is 'member' for every member
    // and would render the word "member" as a role.
    accountRole: context.role,
    ministryRoles: (data.roles ?? [])
      .map((entry) => (typeof entry.role?.name === 'string' ? entry.role.name : null))
      .filter((name): name is string => name !== null),
    instruments: (data.skills ?? [])
      .map((entry) => (typeof entry.instrument?.name === 'string' ? entry.instrument.name : null))
      .filter((name): name is string => name !== null),
  };
}
