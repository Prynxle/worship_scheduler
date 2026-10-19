import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient, requireStaff } from '@/lib/auth/server';
import { loadAvailabilityReadiness } from '@/lib/scheduling/availability-readiness';
import { loadScheduleData } from '@/lib/scheduling/schedule-data';
import { activeMonthServices, finalValidateService, type MonthTransitionResult } from '@/lib/scheduling/month-workflow';
import { ValidationResult, UnfilledPosition } from '@/lib/types/scheduling';
import { ApiError, toErrorResponse, type ErrorContext } from '@/lib/api/errors';
import { parseMonthYear, readJsonObject, rpcErrorResponse } from '../shared';

/**
 * POST /api/schedule/month/validate
 *
 * Validates EVERY draft service in the month in one pass, then — only if no
 * critical remains anywhere — transitions the whole month through the
 * `validate_month_schedule` RPC in a single transaction.
 *
 * Division of labour, exactly like the single-service validate route:
 *  - TypeScript runs the full `ScheduleValidator` at `final` stage per draft
 *    (nothing deferred), applies recorded coordinator overrides, and refuses
 *    the month on ANY critical (422 with the offending services).
 *  - SQL is the second line of defence: `validate_month_schedule` re-asserts
 *    `assert_service_meets_publication_rules` for every draft inside its
 *    transaction and writes the audit rows.
 *
 * The ministry comes from `loadAvailabilityReadiness`, never from the body,
 * and legacy ministry-unscoped services are excluded from the month set (they
 * are locked until their ownership is resolved).
 */
export async function POST(request: NextRequest) {
  const auth = await requireStaff(request);
  if (auth instanceof Response) return auth;

  const body = await readJsonObject(request);
  if (body instanceof ApiError) return toErrorResponse(body, { operation: 'schedule.month.validate', churchId: auth.churchId });

  const context: ErrorContext = { operation: 'schedule.month.validate', churchId: auth.churchId };

  try {
    const { month, year } = parseMonthYear(request, body ?? undefined);
    context.month = month;
    context.year = year;

    const readiness = await loadAvailabilityReadiness(auth.churchId, month, year);
    const data = await loadScheduleData(auth.churchId, month, year, readiness.ministry_id);

    // Scope parity with the SQL candidate set: only services of the resolved
    // ministry may participate; ministry-unscoped legacy rows stay locked.
    const active = activeMonthServices(
      data.services.filter((service) => service.ministry_id === readiness.ministry_id)
    );
    const drafts = active.filter((service) => service.status === 'draft');
    if (drafts.length === 0) {
      return NextResponse.json(
        { error: 'Nothing to validate: every service in this month is already validated or published.' },
        { status: 409 }
      );
    }

    const perService: Array<{
      service_id: string;
      week_number: number;
      critical: number;
      warnings: number;
      suggestions: number;
      overridden_checks: string[];
      unfilled_positions: UnfilledPosition[];
    }> = [];
    const results: ValidationResult[] = [];
    let total = 0;
    let criticalCount = 0;
    let warningCount = 0;
    let suggestionCount = 0;

    for (const service of drafts) {
      const outcome = await finalValidateService(service, data, auth.churchId);
      total += outcome.results.length;
      criticalCount += outcome.criticals.length;
      warningCount += outcome.warnings.length;
      suggestionCount += outcome.suggestions.length;
      results.push(...outcome.results);
      perService.push({
        service_id: service.id,
        week_number: service.week_number,
        critical: outcome.criticals.length,
        warnings: outcome.warnings.length,
        suggestions: outcome.suggestions.length,
        overridden_checks: outcome.overridden_checks,
        unfilled_positions: outcome.unfilled_positions,
      });
    }

    if (criticalCount > 0) {
      return NextResponse.json(
        {
          valid: false,
          reason: 'critical',
          services: perService,
          results,
          summary: { total, critical: criticalCount, warnings: warningCount, suggestions: suggestionCount },
        },
        { status: 422 }
      );
    }

    const admin = getAdminClient();
    const { data: rawTransition, error: transitionError } = await admin.rpc('validate_month_schedule', {
      p_church_id: auth.churchId,
      p_ministry_id: readiness.ministry_id,
      p_month: month,
      p_year: year,
      p_actor_id: auth.userId,
      p_validation_summary: results,
    });
    // RPC result documents are cast, not `.overrideTypes`-declared: the typed
    // client assumes RPC results are arrays, and a single-object JSONB result
    // triggers its "cannot cast array result to a single object" marker.
    const transition = rawTransition as MonthTransitionResult | null;
    if (transitionError) return rpcErrorResponse(transitionError);
    if (!transition || transition.ok === false) {
      return NextResponse.json(
        { error: 'Nothing to validate: every service in this month is already validated or published.' },
        { status: 409 }
      );
    }

    return NextResponse.json({
      valid: true,
      status: 'validated',
      month_status: transition.month_status,
      validated: transition.validated ?? [],
      already_validated: transition.already_validated ?? [],
      skipped_published: transition.skipped_published ?? [],
      summary: { total, critical: 0, warnings: warningCount, suggestions: suggestionCount },
    });
  } catch (error) {
    return toErrorResponse(error, context);
  }
}