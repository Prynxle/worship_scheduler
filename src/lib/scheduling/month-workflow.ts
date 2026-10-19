import { Service } from '@/lib/types/database';
import { ScheduleData } from './schedule-data';
import { ScheduleValidator } from './validator';
import { applyOverrides, unfilledFrom } from './gaps';
import { UnfilledPosition, ValidationResult } from '@/lib/types/scheduling';

/**
 * Monthly pipeline helpers (migration `20261012100000_month_schedule_workflow`).
 *
 * `activeMonthServices` / `deriveMonthStatus` / `summarizeMonth` are the
 * CLIENT-SIDE mirror of `month_active_service_ids` / `month_derive_status` in
 * SQL. The two must agree on two rules:
 *
 * 1. THE ACTIVE SET — non-archived services, one per logical week, preferring a
 *    draft/validated amendment (`revision_of` set) over its original.
 * 2. THE DERIVED STATUS — 'published' when every active service is published;
 *    'validated' when every active service is published or validated for its
 *    CURRENT `schedule_version`; otherwise 'draft'. This is the auto-downshift:
 *    any edit bumps `schedule_version`, the version comparison goes stale, and
 *    the month reads 'draft' again with no trigger to maintain.
 *
 * `finalValidateService` runs the exact final-stage validation surface the
 * single-service validate/publish routes use, so the month route cannot drift
 * from the per-service semantics.
 */

export type MonthWorkflowStatus = 'draft' | 'validated' | 'published';

/**
 * Minimal structural view of a service — accepts both the database `Service`
 * rows and the page's `ScheduleItem` list, which are the two producers today.
 */
export interface MonthServiceLike {
  id: string;
  week_number: number;
  status: 'draft' | 'validated' | 'published' | 'archived';
  schedule_version?: number;
  validated_version?: number | null;
  revision_of?: string | null;
  unfilled_positions?: Array<{ role_name: string }>;
}

/** A service that would block month publish because it is not publishable yet. */
export interface MonthNotReadyService {
  id: string;
  week_number: number;
  status: string;
  reason: 'not_validated' | 'version_drifted';
}

/** A non-published service that still has unfilled positions. */
export interface MonthIncompleteService {
  id: string;
  week_number: number;
  role_names: string[];
}

export interface MonthPipelineState {
  status: MonthWorkflowStatus | null;
  counts: { draft: number; validated: number; published: number };
  total: number;
  /** Reason for the current non-published status per service. */
  notReady: MonthNotReadyService[];
  /** Non-published services with unfilled positions (blocks month publish). */
  incomplete: MonthIncompleteService[];
}

export interface ServiceValidationOutcome {
  results: ValidationResult[];
  overridden_checks: string[];
  criticals: ValidationResult[];
  warnings: ValidationResult[];
  suggestions: ValidationResult[];
  unfilled_positions: UnfilledPosition[];
}

/**
 * Result document returned by `validate_month_schedule` / `publish_month_schedule`:
 * the SQL functions encode business gates (not yet validated / has unfilled
 * positions) as `ok: false` payloads, so the HTTP routes can map them to the
 * right status codes instead of treating every gate as the same 500.
 */
export interface MonthTransitionService {
  service_id: string;
  week_number: number;
  status?: string;
  reason?: 'not_validated' | 'version_drifted' | 'unexpected_state';
  unfilled_count?: number;
}

export interface MonthTransitionResult {
  ok: boolean;
  month_status: MonthWorkflowStatus | null;
  code?: 'nothing_to_validate' | 'unvalidated' | 'incomplete';
  services?: MonthTransitionService[];
  validated?: string[];
  already_validated?: string[];
  skipped_published?: string[];
  published?: string[];
  already_published?: string[];
}

/**
 * True when a `validated` row is stamped for its CURRENT `schedule_version`,
 * i.e. it may be published. A `validated` row whose `validated_version` is
 * stale or NULL is not publishable: publishing would skip the re-assertion the
 * version comparison exists to force.
 *
 * Mirrors the first half of the `publish_service_schedule` guard.
 */
export function isServiceValidatedForVersion(service: MonthServiceLike): boolean {
  return service.status === 'validated' && service.validated_version === service.schedule_version;
}

/**
 * True when a service is (re)validatable: a draft, or a `validated` row whose
 * stamp no longer matches its current `schedule_version` (a `validated` row
 * with no stamp at all counts as drifted).
 *
 * This is the state the UI, the per-service `POST /api/validation` route, and
 * `validate_service_schedule` in SQL must all agree on. Without it, a row
 * carrying `status='validated'` but `validated_version IS NULL` — which the
 * version derivation above already reads as 'draft' — is neither publishable
 * nor re-validatable: a dead end.
 */
export function serviceNeedsValidation(service: MonthServiceLike): boolean {
  return service.status === 'draft' || (service.status === 'validated' && !isServiceValidatedForVersion(service));
}

/**
 * One active service per logical week: drop archived rows, and when an original
 * and its amendment coexist, keep the amendment (the current intent).
 */
export function activeMonthServices<T extends MonthServiceLike>(items: readonly T[]): T[] {
  const grouped = new Map<string, T>();
  for (const item of items) {
    if (item.status === 'archived') continue;
    const key = item.revision_of ?? item.id;
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, item);
    } else if (!current.revision_of && item.revision_of) {
      // Preference rule: an amendment wins over its original.
      grouped.set(key, item);
    }
  }
  return [...grouped.values()];
}

export function deriveMonthStatus(active: readonly MonthServiceLike[]): MonthWorkflowStatus | null {
  if (active.length === 0) return null;
  if (active.every((service) => service.status === 'published')) return 'published';
  if (active.every((service) => service.status === 'published'
    || isServiceValidatedForVersion(service))) {
    return 'validated';
  }
  return 'draft';
}

export function summarizeMonth(active: readonly MonthServiceLike[]): MonthPipelineState {
  const status = deriveMonthStatus(active);
  const counts = { draft: 0, validated: 0, published: 0 };
  const notReady: MonthNotReadyService[] = [];
  const incomplete: MonthIncompleteService[] = [];

  for (const service of active) {
    if (service.status === 'draft') {
      counts.draft += 1;
      notReady.push({ id: service.id, week_number: service.week_number, status: service.status, reason: 'not_validated' });
    } else if (service.status === 'validated' && !isServiceValidatedForVersion(service)) {
      counts.validated += 1;
      notReady.push({ id: service.id, week_number: service.week_number, status: service.status, reason: 'version_drifted' });
    } else if (service.status === 'validated') {
      counts.validated += 1;
    } else if (service.status === 'published') {
      counts.published += 1;
    }

    if (service.status !== 'published' && service.unfilled_positions && service.unfilled_positions.length > 0) {
      incomplete.push({
        id: service.id,
        week_number: service.week_number,
        role_names: service.unfilled_positions.map((gap) => gap.role_name),
      });
    }
  }

  return { status, counts, total: active.length, notReady, incomplete };
}

/**
 * The full final-stage validation for one service, identical to the surface the
 * single-service `validate` route runs: `ScheduleValidator` at `'final'` (no
 * deferral), coordinator overrides applied, unfilled positions recomputed.
 */
export async function finalValidateService(service: Service, data: ScheduleData, churchId: string): Promise<ServiceValidationOutcome> {
  const assignments = data.assignments.filter((assignment) => assignment.service_id === service.id);
  const proposed = await new ScheduleValidator({
    service,
    church_id: churchId,
    month: service.month,
    year: service.year,
    week_number: service.week_number,
    existing_assignments: assignments,
    monthly_assignments: data.monthlyAssignments.filter((item) => item.service_id !== service.revision_of),
    available_members: data.members,
    all_members: data.members,
    rules: data.rules,
    config: data.config,
    instruments: data.instruments,
    validation_stage: 'final',
  }).validate();
  const { results, overridden_checks } = applyOverrides(proposed, service.active_overrides);
  const unfilledPositions = unfilledFrom({
    service,
    church_id: churchId,
    month: service.month,
    year: service.year,
    week_number: service.week_number,
    existing_assignments: assignments,
    available_members: data.members,
    all_members: data.members,
    rules: data.rules,
    config: data.config,
    instruments: data.instruments,
  }, assignments);
  return {
    results,
    overridden_checks,
    criticals: results.filter((result) => result.severity === 'critical'),
    warnings: results.filter((result) => result.severity === 'warning'),
    suggestions: results.filter((result) => result.severity === 'suggestion'),
    unfilled_positions: unfilledPositions,
  };
}