import type { GeneratedService } from '@/lib/types/scheduling';
import type { Instrument, Member, Role, Service } from '@/lib/types/database';
import {
  isBackupRoleName,
  isDevotionRoleName,
  isInstrumentalistRoleName,
  isWorshipLeaderRoleName,
  matchesInstrumentName,
} from './role-classifier';

/**
 * Shape of the `p_services` payload sent to the transactional
 * `replace_month_schedule` RPC, plus the pure builder that produces it.
 *
 * This module is deliberately PURE -- no Supabase import, no I/O. It owns the
 * shape of the RPC payload so the writer surface leaves the HTTP route and the
 * route stays thin.
 *
 * Ordering guarantee: the route calls `buildMonthSchedulePayload` ONCE, before
 * any database write. The previous writer had no transaction, so an
 * unresolvable role had to throw before the first mutation or it would delete
 * the existing draft month and leave a partial month behind. That invariant is
 * now structural -- the RPC wraps the delete and the inserts in ONE transaction
 * -- and this builder keeps it as a fail-fast check before the call.
 */

export interface PersistAssignment {
  member_id: string;
  role_id: string;
  /** `null`, never `undefined`: matches the SQL `NULLIF(...,'')::UUID`. */
  instrument_id: string | null;
  is_leader: boolean;
}

export interface PersistService {
  week_number: number;
  date: string;
  assignments: PersistAssignment[];
}

export interface MonthSchedulePayload {
  service_type: string;
  services: PersistService[];
}

/**
 * Thrown when a generated assignment cannot be attributed to a role that
 * actually exists. Never partially applied: the builder resolves EVERY role
 * before returning anything, so a throw leaves the database untouched.
 */
export class UnresolvableRoleError extends Error {
  constructor(memberName: string) {
    super(`Could not resolve a persisted role for ${memberName}.`);
    this.name = 'UnresolvableRoleError';
  }
}

interface ResolvedAssignment {
  memberId: string;
  roleId: string;
  instrumentId: string | null;
  isLeader: boolean;
}

function roleFor(member: Member | null, predicate: (role: Role) => boolean): Role | undefined {
  return member?.roles?.map((item) => item.role).find((role) => role ? predicate(role) : false);
}

// Union of both pre-classifier instrument clauses, most specific first: the
// instrument-name match the writer always had, then the shared instrument-role
// classifier that additionally accepts 'Instrumentalist'.
function instrumentRoleFor(member: Member | null, instrument: Instrument): Role | undefined {
  return (
    roleFor(member, (role) => matchesInstrumentName(role.name, instrument.name)) ??
    roleFor(member, (role) => isInstrumentalistRoleName(role.name))
  );
}

function resolveAssignments(generated: GeneratedService): ResolvedAssignment[] {
  const resolved: ResolvedAssignment[] = [];
  const add = (member: Member | null, role: Role | undefined, instrumentId: string | null, isLeader = false) => {
    if (!member) return;
    if (!role) throw new UnresolvableRoleError(member.full_name);
    resolved.push({ memberId: member.id, roleId: role.id, instrumentId, isLeader });
  };
  add(generated.leader, roleFor(generated.leader, (role) => isWorshipLeaderRoleName(role.name)), null, true);
  for (const member of generated.backup_singers) add(member, roleFor(member, (role) => isBackupRoleName(role.name)), null);
  for (const item of generated.instrumentalists) add(item.member, instrumentRoleFor(item.member, item.instrument), item.instrument.id);
  add(generated.devotion, roleFor(generated.devotion, (role) => isDevotionRoleName(role.name)), null);
  return resolved;
}

function toPersistAssignments(resolved: ResolvedAssignment[]): PersistAssignment[] {
  return resolved.map((row) => ({
    member_id: row.memberId,
    role_id: row.roleId,
    instrument_id: row.instrumentId,
    is_leader: row.isLeader,
  }));
}

/**
 * Build the `p_services` payload for one month. Throws
 * `UnresolvableRoleError` before returning anything if any role is
 * unresolvable, so the caller can never send a half-attributable month.
 */
export function buildMonthSchedulePayload(generated: GeneratedService[]): MonthSchedulePayload {
  return {
    service_type: 'sunday',
    // `map` resolves every role before the payload exists: if one throws, the
    // whole payload is discarded and no caller ever sees a partial month.
    services: generated.map((generatedService) => ({
      week_number: generatedService.week_number,
      date: generatedService.date,
      assignments: toPersistAssignments(resolveAssignments(generatedService)),
    })),
  };
}

function assignmentRowsFor(service: Service, resolved: ResolvedAssignment[], userId: string, now: string): Array<Record<string, unknown>> {
  return resolved.map((row) => ({ service_id: service.id, member_id: row.memberId, role_id: row.roleId, instrument_id: row.instrumentId, is_leader: row.isLeader, status: 'pending', assigned_by: userId, created_at: now, updated_at: now }));
}

/**
 * Row shape the schedule writer produces for one service.
 *
 * Retained as a genuine READER/WRITER/VALIDATOR anti-asymmetry probe: it is the
 * only place a `GeneratedService` becomes rows, and
 * `role-classifier.test.ts` asserts that every role name accepted by the
 * reader predicate is also persistable, and vice versa. The signature is
 * unchanged. It lives here, not in the route, because the writer surface does
 * not belong in an HTTP route module.
 */
export function assignmentRows(service: Service, generated: GeneratedService, userId: string) {
  return assignmentRowsFor(service, resolveAssignments(generated), userId, new Date().toISOString());
}
