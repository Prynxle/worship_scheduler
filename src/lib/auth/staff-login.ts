/**
 * Staff login helpers for the JOHIA coordinator/admin sign-in flow.
 *
 * This module is intentionally pure: no Supabase clients, no Next.js imports,
 * no browser APIs. It only normalizes usernames and resolves the environment
 * configuration that the `/api/auth/name` route uses when provisioning and
 * authenticating staff identities.
 *
 * Credential policy:
 *   - Passwords are NEVER stored in the application schema. They are read from
 *     environment variables at request time (`ADMIN_LOGIN_PASSWORD`,
 *     `COORDINATOR_LOGIN_PASSWORD`) with documented local defaults, then handed
 *     to Supabase Auth (which hashes them). The values themselves are never
 *     logged or returned to the client.
 */

const ADMIN_LOGIN_USERNAME_DEFAULT = 'johiaapp';
const ADMIN_LOGIN_PASSWORD_DEFAULT = 'johia2026';
const COORDINATOR_LOGIN_PASSWORD_DEFAULT = 'coord2026';

const COORDINATOR_LOGIN_USERNAMES = ['coordzed', 'coordmarilyn'];

/** Trim and lowercase a staff username so matching is case-insensitive. */
export function normalizeStaffUsername(input: string): string {
  return input.trim().toLowerCase();
}

/**
 * Resolve the configured admin username from the environment.
 * Falls back to the documented default when unset or blank.
 */
function getAdminLoginUsername(): string {
  const configured = process.env.ADMIN_LOGIN_USERNAME?.trim().toLowerCase();
  return configured && configured.length > 0 ? configured : ADMIN_LOGIN_USERNAME_DEFAULT;
}

/**
 * Resolve the configured password for a known staff username, or null for
 * unknown usernames. Unknown usernames must never be provisioned, so a null
 * result is the route's signal to reject the login attempt.
 */
export function getStaffConfiguredPassword(username: string): string | null {
  const normalized = normalizeStaffUsername(username);

  if (normalized === getAdminLoginUsername()) {
    return process.env.ADMIN_LOGIN_PASSWORD || ADMIN_LOGIN_PASSWORD_DEFAULT;
  }

  if (COORDINATOR_LOGIN_USERNAMES.includes(normalized)) {
    return process.env.COORDINATOR_LOGIN_PASSWORD || COORDINATOR_LOGIN_PASSWORD_DEFAULT;
  }

  return null;
}

/**
 * The auth identity email for a staff username. Staff auth emails are derived
 * deterministically so lazy provisioning and sign-in always target the same
 * Supabase Auth identity.
 */
export function getStaffAuthEmail(username: string): string {
  return `${normalizeStaffUsername(username)}@johiabankers.com`;
}