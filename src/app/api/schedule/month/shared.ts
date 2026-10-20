import { NextRequest, NextResponse } from 'next/server';
import { ApiError } from '@/lib/api/errors';

/**
 * Shared parsing for the monthly pipeline routes
 * (`/api/schedule/month/validate`, `/api/schedule/month/publish`).
 *
 * Both routes accept `{ month, year }` (0-based month) exactly like
 * `GET /api/schedule`, and both resolve the ministry through
 * `loadAvailabilityReadiness` so a client-supplied tenant scope can never leak
 * across churches (see `src/app/api/schedule/route.ts` for the same rule).
 */

export function parseMonthYear(request: Request, body?: Record<string, unknown>) {
  const url = new URL(request.url);
  const monthValue = body?.month ?? (url.searchParams.get('month') === null ? new Date().getMonth() : Number(url.searchParams.get('month')));
  const yearValue = body?.year ?? (url.searchParams.get('year') === null ? new Date().getFullYear() : Number(url.searchParams.get('year')));
  if (typeof monthValue !== 'number' || !Number.isInteger(monthValue) || monthValue < 0 || monthValue > 11 || typeof yearValue !== 'number' || !Number.isInteger(yearValue) || yearValue < 2000 || yearValue > 2100) {
    throw new ApiError(400, 'Month must be 0-11 and year must be between 2000 and 2100.', 'invalid_month_year');
  }
  return { month: monthValue, year: yearValue };
}

/**
 * Parse the request body as a JSON object. Returns an `ApiError` for a
 * malformed body instead of throwing, so the caller can map it uniformly.
 */
export async function readJsonObject(request: NextRequest): Promise<Record<string, unknown> | ApiError | null> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) return new ApiError(400, 'Request body must be valid JSON.', 'invalid_json');
    throw error;
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return new ApiError(400, 'Request body must be an object.', 'invalid_body');
  }
  return raw as Record<string, unknown>;
}

/**
 * Map a Supabase RPC error to the same statuses the single-service lifecycle
 * routes use: authorization failures are 403, everything else is 409 (the RPC
 * raises for state violations; the business gates are returned as documents).
 */
export function rpcErrorResponse(error: { message: string; code?: string }): NextResponse {
  return NextResponse.json(
    { error: error.message },
    { status: error.code === '42501' ? 403 : 409 }
  );
}