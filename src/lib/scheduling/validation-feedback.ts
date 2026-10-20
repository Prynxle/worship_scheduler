/**
 * User-facing reason a `POST /api/validation` request was refused with HTTP 422.
 *
 * A 422 body carries TWO independent things: the authoritative gap list
 * (`unfilled_positions`) and every validation `result`. Availability, monthly
 * limit and qualification criticals produce NO gap, so a message built from the
 * gap list alone collapses to a generic "Could not validate this schedule" for
 * exactly the conflicts a coordinator most needs to see. The critical `message`
 * fields are already written for a human (e.g. "Dhon Obniala is unavailable for
 * week 1"), so they are the primary source; the gap list is only the fallback.
 *
 * The input is structurally typed rather than importing `ValidationResult`, so
 * the page can pass its parsed JSON without a cast.
 */
export interface ValidationFailurePayload {
  error?: string;
  results?: Array<{ severity: 'critical' | 'warning' | 'suggestion'; message: string }>;
  unfilled_positions?: Array<{ role_name: string }>;
}

export function validationFailureMessage(payload: ValidationFailurePayload): string {
  const reasons = dedupe(
    (payload.results ?? [])
      .filter((result) => result.severity === 'critical')
      .map((result) => result.message?.trim())
      .filter((message): message is string => Boolean(message))
  );
  if (reasons.length) return `Cannot validate yet: ${reasons.join(' \u00b7 ')}.`;

  const gaps = payload.unfilled_positions ?? [];
  if (gaps.length) {
    return `Cannot validate yet: ${gaps.length} position(s) still unfilled (${gaps.map((gap) => gap.role_name).join(', ')}). Fill them in the lineup first.`;
  }

  return payload.error ?? 'Could not validate this schedule.';
}

function dedupe(values: string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}
