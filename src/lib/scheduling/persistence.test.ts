import { describe, expect, it } from 'vitest';
import type { Instrument, Member, Role, Service } from '@/lib/types/database';
import type { GeneratedService } from '@/lib/types/scheduling';
import { assignmentRows, buildMonthSchedulePayload, UnresolvableRoleError } from './persistence';

/**
 * These are the writer tests that used to live in `route.test.ts`.
 *
 * They moved here because the writer surface left the HTTP route: persistence
 * is now a pure builder plus the transactional RPC, so the tests belong with
 * the builder rather than with the route that no longer owns persistence.
 */

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

const generatedWithGuitarist: GeneratedService = {
  week_number: 1, date: service.date, leader: null, backup_singers: [], devotion: null,
  conflicts: [], instrumentalists: [{ instrument: guitar, member: guitarist, is_fallback: false }],
};

describe('assignmentRows', () => {
  it('persists instrumentalists with the shared Instrumentalist role', () => {
    expect(assignmentRows(service, generatedWithGuitarist, 'user')).toEqual([
      expect.objectContaining({ member_id: guitarist.id, role_id: instrumentalistRole.id, instrument_id: guitar.id }),
    ]);
  });

  it('fails closed when a generated assignment has no persistable role', () => {
    const generated: GeneratedService = {
      ...generatedWithGuitarist,
      instrumentalists: [{ instrument: guitar, member: { ...guitarist, roles: [] }, is_fallback: false }],
    };

    expect(() => assignmentRows(service, generated, 'user')).toThrow('Could not resolve a persisted role');
    expect(() => assignmentRows(service, generated, 'user')).toThrow(UnresolvableRoleError);
  });
});

describe('buildMonthSchedulePayload', () => {
  it('builds the RPC payload for every generated service', () => {
    const payload = buildMonthSchedulePayload([
      generatedWithGuitarist,
      { ...generatedWithGuitarist, week_number: 2, date: '2026-09-13' },
    ]);

    expect(payload.service_type).toBe('sunday');
    expect(payload.services).toHaveLength(2);
    expect(payload.services.map((entry) => entry.week_number)).toEqual([1, 2]);
    expect(payload.services[0]).toEqual({
      week_number: 1,
      date: '2026-09-06',
      assignments: [
        { member_id: guitarist.id, role_id: instrumentalistRole.id, instrument_id: guitar.id, is_leader: false },
      ],
    });
  });

  it('carries the leader flag through to the payload', () => {
    const leaderRole: Role = {
      id: 'role-leader', ministry_id: 'ministry', name: 'Worship Leader',
      min_required: 0, max_allowed: 10, priority: 1, is_active: true, created_at: '',
    };
    const leader: Member = {
      ...guitarist,
      id: 'leader',
      full_name: 'Leader',
      roles: [{ id: 'lr', member_id: 'leader', role_id: leaderRole.id, skill_level: 'advanced', is_preferred: true, created_at: '', role: leaderRole }],
    };

    const payload = buildMonthSchedulePayload([
      { ...generatedWithGuitarist, leader, instrumentalists: [] },
    ]);

    expect(payload.services[0].assignments).toEqual([
      { member_id: 'leader', role_id: leaderRole.id, instrument_id: null, is_leader: true },
    ]);
  });

  it('is all-or-nothing: one unresolvable role discards the WHOLE month', () => {
    // The RPC is transactional, so a partial month is unrepresentable on the
    // database side. The builder must not hand the caller a partial payload
    // either, or a future non-transactional writer could reintroduce the
    // data-loss bug this module was extracted to prevent.
    const broken: GeneratedService = {
      ...generatedWithGuitarist,
      week_number: 3,
      date: '2026-09-20',
      instrumentalists: [{ instrument: guitar, member: { ...guitarist, roles: [] }, is_fallback: false }],
    };

    expect(() => buildMonthSchedulePayload([generatedWithGuitarist, broken])).toThrow(UnresolvableRoleError);
  });

  it('persists the assigned instrument id for an instrumentalist', () => {
    // What this actually proves: an instrumentalist's row carries the
    // instrument they were assigned, so a later audit can attribute the slot.
    const payload = buildMonthSchedulePayload([generatedWithGuitarist]);
    const row = payload.services[0].assignments[0];

    expect(row.instrument_id).toBe(guitar.id);
  });

  it('emits null, never undefined, for assignments with no instrument', () => {
    // Matches the SQL `NULLIF(...,'')::UUID` contract: a null column, not an
    // empty string, so the column's nullability is honoured on insert.
    // A leader carries no instrument, so this is the genuine null-instrument row.
    const leaderRole: Role = {
      id: 'role-leader', ministry_id: 'ministry', name: 'Worship Leader',
      min_required: 0, max_allowed: 10, priority: 1, is_active: true, created_at: '',
    };
    const leader: Member = {
      ...guitarist,
      id: 'leader',
      full_name: 'Leader',
      roles: [{ id: 'lr', member_id: 'leader', role_id: leaderRole.id, skill_level: 'advanced', is_preferred: true, created_at: '', role: leaderRole }],
    };

    const payload = buildMonthSchedulePayload([
      { ...generatedWithGuitarist, leader, instrumentalists: [] },
    ]);
    const row = payload.services[0].assignments[0];

    expect('instrument_id' in row).toBe(true);
    expect(row.instrument_id).toBeNull();
  });
});
