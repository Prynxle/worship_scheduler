import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Shared field parsing and tenant scoping for the member write routes.
 *
 * Both `POST /api/members` and `PATCH /api/members/[id]` need exactly the same
 * rules, and the important ones are security-relevant: a role or instrument
 * belongs to a ministry, a ministry belongs to a church, and neither table
 * carries a `church_id` of its own. Duplicating that check across two routes is
 * how a cross-tenant attach slips in through the route nobody re-reviewed, so
 * the check lives here once and both routes call it.
 */

export const GENDERS = ['male', 'female', 'other'] as const;
export type Gender = (typeof GENDERS)[number];

export const STATUSES = ['active', 'inactive'] as const;
export type MemberStatus = (typeof STATUSES)[number];

export interface ParsedMemberFields {
  full_name: string;
  login_name: string;
  nickname: string | null;
  phone: string | null;
  gender: Gender | null;
  status: MemberStatus;
  role_ids: string[];
  instrument_ids: string[];
}

/** A rejected request, carrying the status the route should return. */
export class MemberFieldError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = 'MemberFieldError';
    this.status = status;
  }
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * A list of uuids, deduplicated. `undefined`/`null` means "not supplied" and
 * becomes an empty list; anything non-array, or any element that is not a uuid,
 * is rejected outright rather than silently dropped. A coordinator must never be
 * told a malformed id was saved.
 */
export function toIdSet(value: unknown, label: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every(isUuid)) {
    throw new MemberFieldError(`${label} must be a list of valid identifiers.`);
  }
  return Array.from(new Set(value));
}

function optionalText(value: unknown, maxLength: number, label: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new MemberFieldError(`${label} must be text.`);
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) throw new MemberFieldError(`${label} must be ${maxLength} characters or fewer.`);
  return trimmed;
}

/**
 * Parse and validate a member write body.
 *
 * `login_name` is lowercased here rather than at the call site: the name-login
 * flow lowercases its input and then matches with `.eq('login_name', ...)`, so
 * any stored value that is not already lowercase can never sign in. Doing it in
 * one place is what guarantees POST and PATCH agree.
 */
export function parseMemberFields(body: Record<string, unknown>): ParsedMemberFields {
  const fullName = typeof body.full_name === 'string' ? body.full_name.trim() : '';
  if (!fullName) throw new MemberFieldError('A member name is required.');
  if (fullName.length > 255) throw new MemberFieldError('The member name must be 255 characters or fewer.');

  const loginName = typeof body.login_name === 'string' ? body.login_name.trim().toLowerCase() : '';
  if (!loginName) throw new MemberFieldError('A login name is required.');
  if (loginName.length > 100) throw new MemberFieldError('The login name must be 100 characters or fewer.');

  const rawGender = body.gender;
  const gender = rawGender === undefined || rawGender === null || rawGender === ''
    ? null
    : (rawGender as Gender);
  if (gender !== null && !GENDERS.includes(gender)) throw new MemberFieldError('Choose a valid gender.');

  const status = body.status === undefined || body.status === null
    ? 'active'
    : (body.status as MemberStatus);
  if (!STATUSES.includes(status)) throw new MemberFieldError('Choose a valid status.');

  return {
    full_name: fullName,
    login_name: loginName,
    nickname: optionalText(body.nickname, 100, 'Nickname'),
    phone: optionalText(body.phone, 50, 'Phone'),
    gender,
    status,
    role_ids: toIdSet(body.role_ids, 'Roles'),
    instrument_ids: toIdSet(body.instrument_ids, 'Instruments'),
  };
}

/**
 * Fail closed unless every id belongs to this church.
 *
 * `roles` and `instruments` are tenant-owned through `ministries.church_id`.
 * An unverified id is rejected instead of dropped, so a coordinator is never
 * told another church's role was saved.
 */
export async function assertIdsBelongToChurch(
  admin: SupabaseClient,
  churchId: string,
  roleIds: string[],
  instrumentIds: string[],
): Promise<void> {
  if (roleIds.length === 0 && instrumentIds.length === 0) return;

  const { data: ministries, error: ministriesError } = await admin
    .from('ministries')
    .select('id')
    .eq('church_id', churchId);
  if (ministriesError) {
    throw new MemberFieldError('Could not verify the selected roles.', 500);
  }
  const ministryIds = (ministries ?? []).map((ministry) => ministry.id);
  if (ministryIds.length === 0) {
    throw new MemberFieldError('This church has no ministries configured yet.');
  }

  if (roleIds.length > 0) {
    const { data: allowedRoles } = await admin
      .from('roles')
      .select('id')
      .in('id', roleIds)
      .in('ministry_id', ministryIds)
      .eq('is_active', true);
    if ((allowedRoles ?? []).length !== roleIds.length) {
      throw new MemberFieldError('One or more selected roles are not available for this church.');
    }
  }

  if (instrumentIds.length > 0) {
    const { data: allowedInstruments } = await admin
      .from('instruments')
      .select('id')
      .in('id', instrumentIds)
      .in('ministry_id', ministryIds);
    if ((allowedInstruments ?? []).length !== instrumentIds.length) {
      throw new MemberFieldError('One or more selected instruments are not available for this church.');
    }
  }
}
