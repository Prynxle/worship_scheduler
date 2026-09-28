import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Instrument, Member, Role, Service } from '@/lib/types/database';
import type { GeneratedService } from '@/lib/types/scheduling';
import { assignmentRows } from './route';

const instrumentalistRole: Role = {
  id: 'role-instrumentalist', ministry_id: 'ministry', name: 'Instrumentalist',
  min_required: 0, max_allowed: 10, priority: 2, is_active: true, created_at: '',
};
const guitar: Instrument = {
  id: 'guitar-1', ministry_id: 'ministry', name: 'Guitar 1', is_required: true,
  min_count: 1, max_count: 1, created_at: '',
};
const guitarist: Member = {
  id: 'guitarist', church_id: 'church', full_name: 'Guitarist', status: 'active',
  max_monthly_assignments: 3, priority_score: 1, total_assignments: 0,
  created_at: '', updated_at: '', roles: [{
    id: 'member-role', member_id: 'guitarist', role_id: instrumentalistRole.id,
    skill_level: 'advanced', is_preferred: true, created_at: '', role: instrumentalistRole,
  }],
};
const service: Service = {
  id: 'service', church_id: 'church', date: '2026-09-06', week_number: 1,
  month: 8, year: 2026, service_type: 'sunday', status: 'draft', created_at: '', updated_at: '',
};

describe('schedule persistence', () => {
  it('persists instrumentalists with the shared Instrumentalist role', () => {
    const generated: GeneratedService = {
      week_number: 1, date: service.date, leader: null, backup_singers: [], devotion: null,
      conflicts: [], instrumentalists: [{ instrument: guitar, member: guitarist, is_fallback: false }],
    };

    expect(assignmentRows(service, generated, 'user')).toEqual([
      expect.objectContaining({ member_id: guitarist.id, role_id: instrumentalistRole.id, instrument_id: guitar.id }),
    ]);
  });

  it('fails closed when a generated assignment has no persistable role', () => {
    const generated: GeneratedService = {
      week_number: 1, date: service.date, leader: null, backup_singers: [], devotion: null,
      conflicts: [], instrumentalists: [{ instrument: guitar, member: { ...guitarist, roles: [] }, is_fallback: false }],
    };

    expect(() => assignmentRows(service, generated, 'user')).toThrow('Could not resolve a persisted role');
  });

  it('resolves every role before the first database mutation in persistGeneratedSchedule', async () => {
    // Data-loss guard: persistGeneratedSchedule has no transaction, so the
    // unresolvable-role throw must happen before the DELETE/INSERT. The only
    // exported writer surface is assignmentRows, so assert the ordering on the
    // source of the unexported function.
    const source = await readFile(fileURLToPath(new URL('./route.ts', import.meta.url)), 'utf8');
    const body = source.slice(source.indexOf('async function persistGeneratedSchedule'));
    expect(body.length).toBeGreaterThan(0);

    const resolve = body.indexOf('resolveAssignments(');
    expect(resolve).toBeGreaterThan(-1);
    expect(resolve).toBeLessThan(body.indexOf('getAdminClient()'));
    expect(resolve).toBeLessThan(body.indexOf(".from('services').delete()"));
    expect(resolve).toBeLessThan(body.indexOf(".from('services').insert("));
  });
});
