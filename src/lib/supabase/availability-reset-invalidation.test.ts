import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * GH #97 migration contract.
 *
 * The unit tests cannot execute plpgsql, so the load-bearing SQL properties are
 * pinned here: the non-destructive marker, the date scope every guard shares,
 * the same-statement audit rows, the W0005 refusal, and the ACL that the DROP
 * discards. Behavioural coverage of the routes that consume this state lives in
 * each route's own test file.
 */
const migration = readFileSync(
  fileURLToPath(new URL('../../../supabase/migrations/20261026120000_availability_reset_invalidates_month_drafts.sql', import.meta.url)),
  'utf8',
);

const resetBody = migration.slice(
  migration.indexOf('CREATE OR REPLACE FUNCTION public.reset_month_availability'),
  migration.indexOf('CREATE OR REPLACE FUNCTION public.validate_service_schedule'),
);

describe('availability reset invalidation migration', () => {
  it('adds a nullable marker column and deletes nothing', () => {
    expect(migration).toContain('ALTER TABLE public.services ADD COLUMN availability_reset_at TIMESTAMPTZ;');
    expect(resetBody).not.toMatch(/\bDELETE\s+FROM\b/i);
    expect(resetBody).not.toMatch(/\bTRUNCATE\b/i);
  });

  it('stamps only future drafts of the requested church and month', () => {
    const stamp = resetBody.match(/WITH stamped AS \(([\s\S]*?)\)\s+INSERT INTO public\.schedule_change_log/)?.[1] ?? '';
    expect(stamp).toMatch(/UPDATE public\.services s\s+SET availability_reset_at = pg_catalog\.now\(\)/);
    for (const clause of [
      's.church_id = p_church_id',
      's.month = p_month',
      's.year = p_year',
      "s.status = 'draft'",
      's.date >= CURRENT_DATE',
      's.availability_reset_at IS NULL',
    ]) {
      expect(stamp).toContain(clause);
    }
    // The SET list must stay exactly the marker: status, version and the
    // validation stamps are the lifecycle's, not this action's.
    const setClause = stamp.match(/SET\s+([\s\S]*?)\s+WHERE\b/)?.[1]?.replace(/\s+/g, ' ').trim();
    expect(setClause).toBe('availability_reset_at = pg_catalog.now()');
  });

  it('writes one schedule_change_log row per stamped service from the same CTE', () => {
    expect(resetBody).toContain("'availability_reset'");
    expect(resetBody).toMatch(/FROM stamped;/);
    expect(resetBody).toContain('GET DIAGNOSTICS v_draft_services_invalidated = ROW_COUNT;');
  });

  it('refuses the reset with W0005 rather than stranding a future draft that owns songs', () => {
    const guards = resetBody.match(/ERRCODE = 'W0005'/g) ?? [];
    expect(guards).toHaveLength(2);
    expect(resetBody).toContain('FROM public.song_lineups sl');
    // Before the submission loop and again after the stamp, closing the
    // concurrent-save window.
    expect(resetBody.indexOf("ERRCODE = 'W0005'")).toBeLessThan(resetBody.indexOf('FOR v_submission IN'));
    expect(resetBody.lastIndexOf("ERRCODE = 'W0005'")).toBeGreaterThan(resetBody.indexOf('WITH stamped AS ('));
  });

  it('redefines every lifecycle function with a date-scoped W0004 refusal', () => {
    for (const name of ['validate_service_schedule', 'publish_service_schedule', 'validate_month_schedule', 'save_song_lineup']) {
      const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
      expect(start).toBeGreaterThan(-1);
      const body = migration.slice(start, migration.indexOf('CREATE OR REPLACE FUNCTION public.', start + 1));
      expect(body).toContain('availability_reset_at IS NOT NULL');
      expect(body).toContain('date >= CURRENT_DATE');
      expect(body).toContain("ERRCODE = 'W0004'");
    }
  });

  it('drops the arity-changed function and re-issues its exact grants', () => {
    // CREATE OR REPLACE cannot add an OUT column, so the DROP is mandatory...
    expect(migration).toContain('DROP FUNCTION IF EXISTS public.reset_month_availability(UUID, INTEGER, INTEGER, UUID, TEXT);');
    // ...and a DROP discards the ACL, so both statements must come back.
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.reset_month_availability(UUID, INTEGER, INTEGER, UUID, TEXT) FROM PUBLIC, anon, authenticated;');
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.reset_month_availability(UUID, INTEGER, INTEGER, UUID, TEXT) TO service_role;');
    expect(migration).not.toMatch(/GRANT (?:ALL|EXECUTE) ON FUNCTION public\.reset_month_availability\([^;]*\)\s+TO\s+(?:PUBLIC|anon|authenticated)[,;\s]/);
  });

  it('reloads the PostgREST schema cache last', () => {
    const statements = migration.trimEnd().split('\n').filter((line) => line.trim() && !line.trim().startsWith('--'));
    expect(statements.at(-1)).toBe("NOTIFY pgrst, 'reload schema';");
  });
});
