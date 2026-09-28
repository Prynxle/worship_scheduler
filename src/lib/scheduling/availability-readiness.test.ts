import { describe, expect, it } from 'vitest';
import { summarizeAvailabilityReadiness } from './availability-readiness';

const participants = [
  { id: 'member-1', full_name: 'Ari' },
  { id: 'member-2', full_name: 'Bea' },
  { id: 'member-3', full_name: 'Cal' },
];

describe('summarizeAvailabilityReadiness', () => {
  it('requires every ministry participant to have an approved monthly submission', () => {
    const summary = summarizeAvailabilityReadiness(8, 2026, 'ministry-1', 'Worship', participants, [
      { id: 'submission-1', member_id: 'member-1', status: 'approved', revision_note: null },
      { id: 'submission-2', member_id: 'member-2', status: 'submitted', revision_note: null },
    ]);

    expect(summary).toMatchObject({ required_members: 3, submitted_count: 2, approved_count: 1, outstanding_count: 2, ready: false });
    expect(summary.members.map((member) => member.status)).toEqual(['approved', 'submitted', 'missing']);
  });

  it('keeps revision requests outstanding and exposes the coordinator note', () => {
    const summary = summarizeAvailabilityReadiness(8, 2026, 'ministry-1', 'Worship', participants, [
      { id: 'submission-1', member_id: 'member-1', status: 'approved', revision_note: null },
      { id: 'submission-2', member_id: 'member-2', status: 'revision_required', revision_note: 'Please confirm week three.' },
      { id: 'submission-3', member_id: 'member-3', status: 'approved', revision_note: null },
    ]);

    expect(summary.ready).toBe(false);
    expect(summary.outstanding_count).toBe(1);
    expect(summary.members[1]).toMatchObject({ status: 'revision_required', revision_note: 'Please confirm week three.' });
  });

  it('supports an explicit no-unavailability submission', () => {
    const summary = summarizeAvailabilityReadiness(8, 2026, 'ministry-1', 'Worship', participants, participants.map((member, index) => ({
      id: `submission-${index}`,
      member_id: member.id,
      status: 'approved' as const,
      revision_note: null,
    })));

    expect(summary.ready).toBe(true);
    expect(summary.approved_count).toBe(3);
  });
});
