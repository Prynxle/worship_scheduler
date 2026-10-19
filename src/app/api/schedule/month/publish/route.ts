import { NextRequest, NextResponse } from 'next/server';
import { getAdminClient, requireStaff } from '@/lib/auth/server';
import { loadAvailabilityReadiness } from '@/lib/scheduling/availability-readiness';
import type { MonthTransitionResult } from '@/lib/scheduling/month-workflow';
import { ApiError, toErrorResponse, type ErrorContext } from '@/lib/api/errors';
import { parseMonthYear, readJsonObject, rpcErrorResponse } from '../shared';

/**
 * POST /api/schedule/month/publish
 *
 * Publishes EVERY active service in the month in one transaction, but only
 * from a validated month. The two month-level gates live in SQL
 * (`publish_month_schedule`) and are returned as result documents so this
 * route can map them to distinct statuses instead of one generic failure:
 *  - 'unvalidated' -> 409: a service is drafted or its version drifted since
 *    validation; the coordinator must validate the month again.
 *  - 'incomplete'  -> 422: a validated lineup still carries unfilled positions;
 *    deferred gaps are legal at validation, never at publication.
 *
 * The ministry comes from `loadAvailabilityReadiness`, never from the body,
 * and legacy ministry-unscoped services are excluded from the month set (they
 * are locked until their ownership is resolved).
 */
export async function POST(request: NextRequest) {
  const auth = await requireStaff(request);
  if (auth instanceof Response) return auth;

  const body = await readJsonObject(request);
  if (body instanceof ApiError) return toErrorResponse(body, { operation: 'schedule.month.publish', churchId: auth.churchId });

  const context: ErrorContext = { operation: 'schedule.month.publish', churchId: auth.churchId };

  try {
    const { month, year } = parseMonthYear(request, body ?? undefined);
    context.month = month;
    context.year = year;

    const readiness = await loadAvailabilityReadiness(auth.churchId, month, year);

    const admin = getAdminClient();
    const { data: rawTransition, error: transitionError } = await admin.rpc('publish_month_schedule', {
      p_church_id: auth.churchId,
      p_ministry_id: readiness.ministry_id,
      p_month: month,
      p_year: year,
      p_actor_id: auth.userId,
    });
    // RPC result documents are cast, not `.overrideTypes`-declared: the typed
    // client assumes RPC results are arrays, and a single-object JSONB result
    // triggers its "cannot cast array result to a single object" marker.
    const transition = rawTransition as MonthTransitionResult | null;
    if (transitionError) return rpcErrorResponse(transitionError);
    if (!transition || transition.ok === false) {
      if (transition?.code === 'incomplete') {
        const unfilled = (transition.services ?? []).reduce((sum, service) => sum + (service.unfilled_count ?? 0), 0);
        return NextResponse.json(
          {
            error: `Publish blocked: ${unfilled} position(s) are still unfilled across the month. Fill every gap before publishing.`,
            code: 'incomplete',
            services: transition.services ?? [],
          },
          { status: 422 }
        );
      }
      return NextResponse.json(
        {
          error: 'Publish blocked: validate the month first. Every service must be validated for its current version, or have a published amendment, before the month can be published.',
          code: transition?.code ?? 'unvalidated',
          services: transition?.services ?? [],
        },
        { status: 409 }
      );
    }

    return NextResponse.json({
      status: 'published',
      month_status: transition.month_status,
      published: transition.published ?? [],
      already_published: transition.already_published ?? [],
    });
  } catch (error) {
    return toErrorResponse(error, context);
  }
}