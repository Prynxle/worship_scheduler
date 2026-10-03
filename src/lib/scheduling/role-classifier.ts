// Single source of truth for the role-name predicates shared by the schedule
// reader (GET /api/schedule), the schedule writer (POST /api/schedule), the
// scheduling engine, the validator, and the mock-unavailability planner.
//
// Guard rail: this module may only ever WIDEN a predicate. The pre-classifier
// predicates were:
//   display      (route.ts)      name.includes('vocal') || name.includes('singer')
//   persistence  (route.ts)      /vocal|singer|backup/.test(name)
//   validation   (validator.ts)  ['singer','backup','backup singer','backup singers']
//   instruments  (route.ts)      name.includes(instrument.name) || /guitar|drum|pian|keyboard/.test(name)
// Narrowing any of them silently hides or drops assignments, so a count
// disagreement must always be resolved by widening the consumer instead.

// Union of the display and persistence backup clauses above. The validator's
// narrower exact set is fully subsumed by this pattern.
// No `g` flag: `test` must stay stateless for deterministic scheduling.
const BACKUP_ROLE_NAME_PATTERN = /vocal|singer|backup|back up/;

// Second clause of the pre-classifier instrument predicate. The first clause
// (specific instrument-name match) is instrument-dependent and lives in
// `matchesInstrumentName`; the writer tries it first, then this.
const INSTRUMENT_ROLE_NAME_PATTERN = /guitar|drum|pian|keyboard/;

export function normalizeRoleName(name: string): string {
  return name.trim().toLowerCase();
}

export function isBackupRoleName(name: string): boolean {
  return BACKUP_ROLE_NAME_PATTERN.test(normalizeRoleName(name));
}

export function isDevotionRoleName(name: string): boolean {
  return normalizeRoleName(name).includes('devotion');
}

export function isWorshipLeaderRoleName(name: string): boolean {
  return normalizeRoleName(name) === 'worship leader';
}

// Union of the pre-classifier /guitar|drum|pian|keyboard/ clause and the
// 'Instrumentalist' role that clause missed (which dropped every instrumentalist
// assignment). Callers must try `matchesInstrumentName` first.
export function isInstrumentalistRoleName(name: string): boolean {
  const role = normalizeRoleName(name);
  return role.includes('instrument') || INSTRUMENT_ROLE_NAME_PATTERN.test(role);
}

// Specific instrument-name match, e.g. role 'Acoustic Guitar' for instrument
// 'Acoustic Guitar'. Widened by normalizeRoleName's trim only.
export function matchesInstrumentName(roleName: string, instrumentName: string): boolean {
  return normalizeRoleName(roleName).includes(normalizeRoleName(instrumentName));
}
