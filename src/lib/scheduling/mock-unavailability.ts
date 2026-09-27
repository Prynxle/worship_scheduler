import { getWeeksInMonth } from '../utils/date-utils';

export type PlannedUnavailability = {
  member_id: string;
  month: number;
  year: number;
  week_number: number;
};

// Mirrors the engine's BACKUP_NAMES (src/lib/scheduling/engine.ts): only these
// role names qualify a member for a backup slot.
const BACKUP_NAMES = new Set(['singer', 'singers', 'vocalist', 'vocal', 'backup', 'backup singer', 'backup singers']);

/**
 * Returns the member ids that are the ONLY active holder of a slot modeled by
 * the scheduling engine's `buildSlots` (src/lib/scheduling/engine.ts):
 *
 * - Worship Leader: slot always exists; holders of the active `Worship Leader`
 *   role.
 * - Backup: slots always exist; holders of any role name in BACKUP_NAMES.
 * - Devotion: slot exists only when at least one active holder of the active
 *   `Devotion` role exists; zero holders means no slot and no exclusion.
 * - Required instruments: unique instrument ids (by id) referenced by an
 *   active member skill where `instrument.is_required === true`; a required
 *   instrument with zero active holders creates no slot.
 *
 * A slot with EXACTLY ONE active holder adds that member id to the exclusion
 * set, so the mock-unavailability route never mocks the last qualified member
 * of a slot into unavailability.
 *
 * "Active" means the member id appears in `memberIds` AND the role's
 * `is_active` is not false (the engine's hasRole predicate). Skill level is
 * intentionally not modeled.
 *
 * Intentional simplifications vs. `buildSlots`: this helper does NOT model
 * monthly assignment limits or duplicate-in-service rules; it exists only to
 * protect sole-qualified members from mock unavailability.
 */
export function soleQualifiedMemberIds(input: {
  memberIds: Iterable<string>;
  roles: Array<{ member_id: string; role?: { name?: string; is_active?: boolean } }>;
  skills: Array<{ member_id: string; instrument?: { id?: string; is_required?: boolean } }>;
}): Set<string> {
  const activeMemberIds = new Set(input.memberIds);
  const excluded = new Set<string>();

  const holdersOf = (roleNames: Set<string>): Set<string> => {
    const holders = new Set<string>();
    for (const entry of input.roles) {
      if (!activeMemberIds.has(entry.member_id)) continue;
      if (entry.role?.is_active === false) continue;
      const name = entry.role?.name?.toLowerCase();
      if (name && roleNames.has(name)) holders.add(entry.member_id);
    }
    return holders;
  };

  const leaderHolders = holdersOf(new Set(['worship leader']));
  if (leaderHolders.size === 1) excluded.add([...leaderHolders][0]);

  const backupHolders = holdersOf(BACKUP_NAMES);
  if (backupHolders.size === 1) excluded.add([...backupHolders][0]);

  const devotionHolders = holdersOf(new Set(['devotion']));
  if (devotionHolders.size === 1) excluded.add([...devotionHolders][0]);

  const instrumentHolders = new Map<string, Set<string>>();
  for (const entry of input.skills) {
    if (!activeMemberIds.has(entry.member_id)) continue;
    const instrument = entry.instrument;
    const instrumentId = instrument?.id;
    if (!instrumentId || instrument.is_required !== true) continue;
    let holders = instrumentHolders.get(instrumentId);
    if (!holders) {
      holders = new Set();
      instrumentHolders.set(instrumentId, holders);
    }
    holders.add(entry.member_id);
  }
  for (const holders of instrumentHolders.values()) {
    if (holders.size === 1) excluded.add([...holders][0]);
  }

  return excluded;
}

/**
 * Plans one deterministic mock unavailability row per member for a month.
 * Pure and tenant-free: rows carry only member/month/year/week; the API route
 * composes the persisted shape (church_id, type, status, reason) at write time.
 *
 * Rotation is stable: members are sorted by id so the same roster always maps
 * to the same weeks regardless of input order. Excluded member ids (see
 * soleQualifiedMemberIds) are skipped AFTER week assignment, so non-excluded
 * members keep their exact weeks and the rotation is preserved.
 */
export function planMockUnavailability(
  members: { id: string; full_name: string }[],
  month: number,
  year: number,
  excludedMemberIds: ReadonlySet<string> = new Set()
): PlannedUnavailability[] {
  const weeks = getWeeksInMonth(month, year);
  const sorted = [...members].sort((a, b) => a.id.localeCompare(b.id));
  return sorted
    .map((member, index) => ({
      member_id: member.id,
      month,
      year,
      week_number: (index % weeks) + 1,
    }))
    .filter((row) => !excludedMemberIds.has(row.member_id));
}