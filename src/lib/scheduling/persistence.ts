import type { GeneratedService, UnfilledPosition } from '@/lib/types/scheduling';
import type { Instrument, Member, Role, Service, ServiceUnfilledPosition } from '@/lib/types/database';
import {
  isBackupRoleName,
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
  is_devotion: boolean;
}

export interface PersistService {
  week_number: number;
  date: string;
  assignments: PersistAssignment[];
  /**
   * Positions this week could not fill, persisted to
   * `services.unfilled_positions`.
   *
   * Always an array, including for a complete week, and never `null`: the RPC
   * writes it with COALESCE so an explicit `[]` CLEARS the column on
   * regeneration. Omitting the key, or sending `null`, would leave a stale gap
   * list on a service that a later regeneration has since filled completely.
   */
  unfilled_positions: ServiceUnfilledPosition[];
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
  isDevotion: boolean;
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
    const isDevotion = !isLeader && member === generated.devotion;
    resolved.push({ memberId: member.id, roleId: role.id, instrumentId, isLeader, isDevotion });
  };
  add(generated.leader, roleFor(generated.leader, (role) => isWorshipLeaderRoleName(role.name)), null, true);
  for (const member of generated.backup_singers) add(member, roleFor(member, (role) => isBackupRoleName(role.name)), null);
  for (const item of generated.instrumentalists) add(item.member, instrumentRoleFor(item.member, item.instrument), item.instrument.id);
  add(generated.devotion, generated.devotion_role ?? (generated.devotion ?
    roleFor(generated.devotion, (role) => role.is_active) : undefined), null);
  return resolved;
}

function toPersistAssignments(resolved: ResolvedAssignment[]): PersistAssignment[] {
  return resolved.map((row) => ({
    member_id: row.memberId,
    role_id: row.roleId,
    instrument_id: row.instrumentId,
    is_leader: row.isLeader,
    is_devotion: row.isDevotion,
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
      // `?? []` rather than a conditional: a complete week MUST send an empty
      // array so the RPC clears any gap list left by an earlier generation.
      unfilled_positions: normalizeGaps(generatedService.unfilled_positions),
    })),
  };
}

/**
 * The engine's `UnfilledPosition[]` and the RPC's `ServiceUnfilledPosition[]`
 * are structurally identical by design, so this is only making two guarantees
 * explicit: the array is always present, and `service_id` is omitted rather than
 * sent as `null` when the generator does not yet know the service row id (the
 * RPC stamps the real id onto each entry it persists).
 */
function normalizeGaps(gaps: UnfilledPosition[] | undefined): ServiceUnfilledPosition[] {
  return (gaps ?? []).map(({ service_id, week_number, date, role_name, required_slots, eligible_candidates, rejected_candidates, message }) => ({
    ...(service_id ? { service_id } : {}),
    week_number,
    date,
    role_name,
    required_slots,
    eligible_candidates: eligible_candidates ?? [],
    rejected_candidates: (rejected_candidates ?? []).map(({ member_id, member_name, reason }) => ({ member_id, member_name, reason })),
    message,
  }));
}

function assignmentRowsFor(service: Service, resolved: ResolvedAssignment[], userId: string, now: string): Array<Record<string, unknown>> {
  return resolved.map((row) => ({ service_id: service.id, member_id: row.memberId, role_id: row.roleId, instrument_id: row.instrumentId, is_leader: row.isLeader, is_devotion: row.isDevotion, status: 'pending', assigned_by: userId, created_at: now, updated_at: now }));
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
