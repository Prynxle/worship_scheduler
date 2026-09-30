import type { Member } from '@/lib/types/database';

/**
 * Client-side narrowing of the already-loaded roster.
 *
 * This runs on the member list the page has in memory, not on a server query,
 * so a coordinator toggling filters gets an instant answer and the count shown
 * on the filter button always agrees with the cards on screen. The lists are
 * small enough that a round trip per filter change would only add latency.
 *
 * Two deliberate decisions:
 *
 *   - Selections inside one facet are a UNION. Picking "Guitarist" and "Drummer"
 *     should widen the result, not demand someone who is both.
 *   - Facets are INTERSECTED with each other and with the search box and the
 *     status tab, which is the reading a coordinator expects from "guitar AND
 *     active".
 *
 * Roles and instruments are matched on the join-row ids, not the joined display
 * names, so a role deleted since the member list was fetched cannot leave a
 * card permanently unmatchable by name.
 */
export interface MemberFilterState {
  searchQuery: string;
  status: string;
  roleIds: string[];
  instrumentIds: string[];
}

export function filterMembers(members: Member[], filters: MemberFilterState): Member[] {
  const query = filters.searchQuery.trim().toLowerCase();
  const { status, roleIds, instrumentIds } = filters;

  return members.filter((member) => {
    if (query) {
      const matchesSearch =
        member.full_name.toLowerCase().includes(query) ||
        Boolean(member.nickname?.toLowerCase().includes(query)) ||
        Boolean(member.roles?.some((row) => row.role?.name.toLowerCase().includes(query)));
      if (!matchesSearch) return false;
    }

    if (status !== 'all' && member.status !== status) return false;

    if (roleIds.length > 0) {
      const memberRoleIds = (member.roles ?? []).map((row) => row.role_id);
      if (!roleIds.some((id) => memberRoleIds.includes(id))) return false;
    }

    if (instrumentIds.length > 0) {
      const memberInstrumentIds = (member.skills ?? []).map((row) => row.instrument_id);
      if (!instrumentIds.some((id) => memberInstrumentIds.includes(id))) return false;
    }

    return true;
  });
}

/** True when anything is narrowing the list, so the empty state can say which. */
export function isFiltering(filters: MemberFilterState): boolean {
  return (
    filters.searchQuery.trim().length > 0 ||
    filters.status !== 'all' ||
    filters.roleIds.length > 0 ||
    filters.instrumentIds.length > 0
  );
}
