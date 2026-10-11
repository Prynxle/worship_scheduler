import type { SupabaseClient } from '@supabase/supabase-js';
import type { AnnouncementAudience, User } from '@/lib/types/database';
import { isUuid } from '@/lib/members/validation';

/**
 * A resolved announcement audience, as expressed by the compose form.
 *
 * The four variants mirror the four audience options in the compose dialog.
 * `ministry_id`, `role` and `member_ids` are caller-supplied and therefore
 * untrusted: every one of them is re-validated against the author's
 * `church_id` inside `resolveAudience` before it can select anyone.
 */
export type AudienceSpec =
  | { type: 'church' }
  | { type: 'ministry'; ministry_id: string }
  | { type: 'role'; role: User['role'] }
  | { type: 'members'; member_ids: string[] };

/**
 * An audience that cannot be resolved. `status` is the HTTP status the route
 * should answer with: 400 for a caller mistake (unknown ministry, cross-tenant
 * member id, empty audience) and 500 for a failed lookup.
 */
export class AudienceError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'AudienceError';
    this.status = status;
  }
}

const APP_ROLES: readonly User['role'][] = ['admin', 'coordinator', 'member'];
const AUDIENCE_TYPES: readonly AnnouncementAudience[] = ['church', 'ministry', 'role', 'members'];

/**
 * Parses the `audience` field of a publish request into an AudienceSpec.
 * Returns null when the shape is unusable, so the route can answer with one
 * generic validation message instead of leaking which subfield failed.
 */
export function parseAudienceSpec(value: unknown): AudienceSpec | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.type !== 'string' || !AUDIENCE_TYPES.includes(raw.type as AnnouncementAudience)) return null;

  switch (raw.type) {
    case 'church':
      return { type: 'church' };
    case 'ministry':
      return typeof raw.ministry_id === 'string' && isUuid(raw.ministry_id)
        ? { type: 'ministry', ministry_id: raw.ministry_id }
        : null;
    case 'role':
      return typeof raw.role === 'string' && (APP_ROLES as readonly string[]).includes(raw.role)
        ? { type: 'role', role: raw.role as User['role'] }
        : null;
    case 'members':
      return Array.isArray(raw.member_ids)
        && raw.member_ids.length > 0
        && raw.member_ids.every((id) => typeof id === 'string' && id.length > 0)
        ? { type: 'members', member_ids: [...new Set(raw.member_ids as string[])] }
        : null;
    default:
      return null;
  }
}

async function churchMemberUserIds(admin: SupabaseClient, churchId: string): Promise<string[]> {
  const { data, error } = await admin
    .from('members')
    .select('user_id')
    .eq('church_id', churchId)
    .eq('status', 'active')
    .not('user_id', 'is', null);
  if (error) throw new AudienceError('Could not resolve the announcement audience.', 500);
  return (data ?? []).map((row) => row.user_id as string);
}

async function ministryUserIds(admin: SupabaseClient, churchId: string, ministryId: string): Promise<string[]> {
  // Confirm the ministry belongs to this church and is active before anything
  // else: a ministry id from another tenant must produce "not found", never a
  // recipient list derived from that tenant's roles.
  const { data: ministry, error: ministryError } = await admin
    .from('ministries')
    .select('id')
    .eq('id', ministryId)
    .eq('church_id', churchId)
    .eq('is_active', true)
    .maybeSingle();
  if (ministryError) throw new AudienceError('Could not resolve the announcement audience.', 500);
  if (!ministry) throw new AudienceError('That ministry was not found in your church.');

  const { data: roles, error: rolesError } = await admin
    .from('roles')
    .select('id')
    .eq('ministry_id', ministryId)
    .eq('is_active', true);
  if (rolesError) throw new AudienceError('Could not resolve the announcement audience.', 500);
  const roleIds = (roles ?? []).map((role) => role.id as string);
  if (roleIds.length === 0) throw new AudienceError('That ministry has no active roles, so no one would receive this.');

  const { data: memberRoles, error: memberRolesError } = await admin
    .from('member_roles')
    .select('member_id')
    .in('role_id', roleIds);
  if (memberRolesError) throw new AudienceError('Could not resolve the announcement audience.', 500);
  const memberIds = [...new Set((memberRoles ?? []).map((row) => row.member_id as string))];
  if (memberIds.length === 0) throw new AudienceError('No one is assigned to that ministry, so no one would receive this.');

  const { data: members, error: membersError } = await admin
    .from('members')
    .select('user_id')
    .in('id', memberIds)
    .eq('church_id', churchId)
    .eq('status', 'active')
    .not('user_id', 'is', null);
  if (membersError) throw new AudienceError('Could not resolve the announcement audience.', 500);
  return (members ?? []).map((row) => row.user_id as string);
}

async function roleUserIds(admin: SupabaseClient, churchId: string, role: User['role']): Promise<string[]> {
  // App role lives only on `users`, so this audience is account-based rather
  // than roster-based: a staff account with no members row is still reachable
  // through a role-targeted announcement.
  const { data, error } = await admin
    .from('users')
    .select('id')
    .eq('church_id', churchId)
    .eq('role', role)
    .eq('is_active', true);
  if (error) throw new AudienceError('Could not resolve the announcement audience.', 500);
  return (data ?? []).map((row) => row.id as string);
}

async function namedMemberUserIds(admin: SupabaseClient, churchId: string, memberIds: string[]): Promise<string[]> {
  if (!memberIds.every(isUuid)) {
    throw new AudienceError('One or more selected member ids are not valid.');
  }

  // Reject before any write when an id belongs to another church or is no
  // longer active, rather than silently dropping it -- the same stance
  // assertIdsBelongToChurch takes for role and instrument ids.
  const { data, error } = await admin
    .from('members')
    .select('id, user_id')
    .in('id', memberIds)
    .eq('church_id', churchId)
    .eq('status', 'active');
  if (error) throw new AudienceError('Could not resolve the announcement audience.', 500);
  if (!data || data.length !== memberIds.length) {
    throw new AudienceError('One or more selected members are not active in your church.');
  }
  return data.map((row) => row.user_id as string | null).filter((id): id is string => Boolean(id));
}

/**
 * Resolves an audience spec to the deduplicated user ids that should receive
 * the announcement.
 *
 * Recipient definition, per audience:
 * - church:  every active `members` row with a linked user account, plus every
 *            active `coordinator` account in the church
 * - ministry: the church subset that holds an active role in the ministry
 * - role:    every active `users` account with that app role in the church
 * - members: the named member rows, validated same-church and active
 *
 * Every result passes a final filter for an active user account in the
 * caller's church, so a stale or cross-tenant id can never survive resolution.
 * Throws AudienceError with status 400 when the audience resolves to nobody.
 */
export async function resolveAudience(
  admin: SupabaseClient,
  churchId: string,
  spec: AudienceSpec,
): Promise<string[]> {
  let userIds: string[];
  switch (spec.type) {
    case 'church': {
      // The roster lookup only sees coordinators who also hold a members row,
      // so the staff role is unioned in explicitly: every active coordinator
      // receives a whole-church announcement regardless of their roster state.
      const [memberIds, coordinatorIds] = await Promise.all([
        churchMemberUserIds(admin, churchId),
        roleUserIds(admin, churchId, 'coordinator'),
      ]);
      userIds = [...memberIds, ...coordinatorIds];
      break;
    }
    case 'ministry':
      userIds = await ministryUserIds(admin, churchId, spec.ministry_id);
      break;
    case 'role':
      userIds = await roleUserIds(admin, churchId, spec.role);
      break;
    case 'members':
      userIds = await namedMemberUserIds(admin, churchId, spec.member_ids);
      break;
  }

  const uniqueIds = [...new Set(userIds)];
  if (uniqueIds.length === 0) throw new AudienceError('The selected audience has no recipients.');

  // Every audience passes one final filter: the id must belong to an active
  // account in the caller's church, so a stale or cross-tenant id can never
  // survive resolution.
  const { data: activeUsers, error } = await admin
    .from('users')
    .select('id')
    .eq('church_id', churchId)
    .eq('is_active', true)
    .in('id', uniqueIds);
  if (error) throw new AudienceError('Could not resolve the announcement audience.', 500);

  const activeIds = new Set((activeUsers ?? []).map((row) => row.id as string));
  const recipients = uniqueIds.filter((id) => activeIds.has(id)).sort();
  if (recipients.length === 0) throw new AudienceError('The selected audience has no recipients.');
  return recipients;
}
