# Ministries Live-Data Wiring (IMPLEMENTED)

> The Ministries page now reads configuration from Supabase through an
> authenticated, tenant-scoped API route. No database migration or scheduling
> engine/validator behavior change was required.

## Goal

The static mock ministry, role, rule, and instrument configuration on the
Ministries page has been replaced with live data from Supabase while preserving
all scheduling invariants.

## API route

- Added `GET src/app/api/ministries/route.ts` with the existing `requireStaff`
  gate so only authenticated staff can read configuration.

## Tenant scoping

- Ministry and church settings queries use `auth.churchId`. Child queries use
  ministry IDs returned by the authenticated church's ministry query.
- Client-provided `church_id` values are ignored.

## Response shape

- The typed response returns ministries with roles, instruments, normalized
  rules, and a derived `effective_backup_range` (min/max).
- Database values are validated and normalized at the route boundary.

## Rule normalization

- Added `src/lib/ministries/rules.ts` as the shared rule normalizer for the API
  route and schedule data loader. The page renders the normalized results.

## Client fetch states

- The Ministries page fetches via the new route and handles loading, empty, and
  error states with retry/sign-in actions and accessible status labels.
  `MinistryConfig` remains read-only.

## Tests

- Added route handler tests for auth gating, tenant scoping, and the response
  shape (including `effective_backup_range`), plus helper tests.
- Existing scheduler/validator test files were left untouched.

## Constraints

- No DB/migration changes without a separate approved plan.
- No scheduling engine or validator behavior was changed.
- Backup role row must continue to display Min 3 | Max 5; Instrumentalist
  Min 4 | Max 5 remains a documented UI-only divergence until live data
  resolves it.
- The full lint, test, and production build gate passed for this implementation.
