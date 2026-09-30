import { describe, expect, it } from 'vitest';
import { MemberFieldError, assertIdsBelongToChurch, isUuid, parseMemberFields, toIdSet } from './validation';

/**
 * Unit tests for the rules POST and PATCH share.
 *
 * These are the checks that decide whether a write is safe, so they are tested
 * directly rather than only through a route: a route test can only prove the
 * behaviour for the payloads it happens to send.
 */

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

describe('isUuid', () => {
  it('accepts a v4 uuid and rejects lookalikes', () => {
    expect(isUuid(UUID_A)).toBe(true);
    expect(isUuid(UUID_A.toUpperCase())).toBe(true);
    expect(isUuid(`${UUID_A} ' OR 1=1`)).toBe(false);
    expect(isUuid('1111')).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(42)).toBe(false);
  });
});

describe('toIdSet', () => {
  it('treats an omitted list as empty rather than as an error', () => {
    expect(toIdSet(undefined, 'Roles')).toEqual([]);
    expect(toIdSet(null, 'Roles')).toEqual([]);
  });

  it('deduplicates so a repeated id cannot violate a unique constraint later', () => {
    expect(toIdSet([UUID_A, UUID_B, UUID_A], 'Roles')).toEqual([UUID_A, UUID_B]);
  });

  it('rejects a non-list', () => {
    expect(() => toIdSet('nope', 'Roles')).toThrow(MemberFieldError);
    expect(() => toIdSet({ 0: UUID_A }, 'Roles')).toThrow(MemberFieldError);
  });

  it('rejects the whole list when one element is malformed', () => {
    // Dropping just the bad element would tell the coordinator the rest saved.
    expect(() => toIdSet([UUID_A, 'bogus'], 'Roles')).toThrow(/valid identifiers/);
  });
});

describe('parseMemberFields', () => {
  const base = { full_name: 'Zedrick Paul', login_name: 'zedrick' };

  it('trims and lowercases the login name, because sign-in matches case exactly', () => {
    expect(parseMemberFields({ ...base, login_name: '  Zedrick.PAUL  ' }).login_name).toBe('zedrick.paul');
  });

  it('defaults status to active so a member is never created or left unassignable', () => {
    expect(parseMemberFields(base).status).toBe('active');
    expect(parseMemberFields({ ...base, status: 'inactive' }).status).toBe('inactive');
  });

  it('normalises blank optional text to null instead of storing whitespace', () => {
    const parsed = parseMemberFields({ ...base, nickname: '   ', phone: '' });
    expect(parsed.nickname).toBeNull();
    expect(parsed.phone).toBeNull();
  });

  it('keeps a name that is only whitespace out of the database', () => {
    expect(() => parseMemberFields({ ...base, full_name: '   ' })).toThrow(/member name is required/i);
  });

  it('carries a 409-capable status on the error so the route can choose', () => {
    const error = new MemberFieldError('nope', 409);
    expect(error.status).toBe(409);
    expect(error).toBeInstanceOf(Error);
  });
});

describe('assertIdsBelongToChurch', () => {
  function client(overrides: Record<string, { data?: unknown; error?: unknown }> = {}) {
    const queries: { table: string; inFilter: unknown }[] = [];
    const tables: Record<string, { data?: unknown; error?: unknown }> = {
      ministries: { data: [{ id: UUID_B }], error: null },
      roles: { data: [{ id: UUID_A }], error: null },
      instruments: { data: [{ id: UUID_A }], error: null },
      ...overrides,
    };
    const admin = {
      from(table: string) {
        const self: Record<string, unknown> = {
          select: () => self,
          in: (column: string, value: unknown) => { queries.push({ table, inFilter: { column, value } }); return self; },
          eq: () => self,
          then: (resolve: (v: unknown) => unknown, reject: (r: unknown) => unknown) =>
            Promise.resolve(tables[table] ?? { data: [], error: null }).then(resolve, reject),
        };
        return self;
      },
    };
    return { admin: admin as never, queries };
  }

  it('short-circuits when nothing is selected', async () => {
    const { admin, queries } = client();
    await assertIdsBelongToChurch(admin, 'church-1', [], []);
    expect(queries).toHaveLength(0);
  });

  it('rejects every id when the church has no ministries', async () => {
    const { admin } = client({ ministries: { data: [], error: null } });
    await expect(assertIdsBelongToChurch(admin, 'church-1', [UUID_A], [])).rejects.toThrow(/no ministries/i);
  });

  it('fails closed when the ministry lookup itself errors', async () => {
    const { admin } = client({ ministries: { data: null, error: { message: 'down' } } });
    await expect(assertIdsBelongToChurch(admin, 'church-1', [UUID_A], [])).rejects.toThrow(MemberFieldError);
  });

  it('rejects a partially matching role list instead of saving the valid subset', async () => {
    const { admin } = client({ roles: { data: [{ id: UUID_A }], error: null } });
    await expect(assertIdsBelongToChurch(admin, 'church-1', [UUID_A, UUID_B], [])).rejects.toThrow(
      /not available for this church/i,
    );
  });

  it('scopes the lookup through the church ministry ids, not the church id directly', async () => {
    const { admin, queries } = client();
    await assertIdsBelongToChurch(admin, 'church-1', [UUID_A], [UUID_A]);

    // Both child tables must be constrained to this church's ministries, and to
    // nothing else. A `church_id` filter here would be a silent no-op, because
    // neither table has that column.
    expect(queries.map((q) => q.table).sort()).toEqual(['instruments', 'instruments', 'roles', 'roles']);
    for (const table of ['roles', 'instruments']) {
      const ministryFilters = queries
        .filter((q) => q.table === table)
        .map((q) => q.inFilter)
        .filter((filter) => (filter as { column: string }).column === 'ministry_id');
      expect(ministryFilters).toEqual([{ column: 'ministry_id', value: [UUID_B] }]);
    }
    const columns = queries.map((q) => (q.inFilter as { column: string }).column);
    expect(columns.every((column) => column === 'id' || column === 'ministry_id')).toBe(true);
  });
});
