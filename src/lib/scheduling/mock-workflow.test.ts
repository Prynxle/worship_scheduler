import { describe, expect, it } from 'vitest';
import { summarizeAvailabilityReadiness } from './availability-readiness';
import { buildMockSubmissionEntries, soleQualifiedMemberIds } from './mock-unavailability';

/**
 * Composed flow test for the workflow-native mock-unavailability path.
 *
 * This pins the transition sequence the feature depends on, using the real
 * pure pieces wired together the way the route, the RPC, and the readiness
 * gate use them:
 *
 *   1. buildMockSubmissionEntries produces the p_entries payload the route
 *      sends to mock_month_availability (excluded members carry a null week).
 *   2. The RPC creates one source='mock' submission per non-skipped entry at
 *      status 'submitted'; a member with a current MEMBER submission is
 *      skipped and keeps their own response.
 *   3. summarizeAvailabilityReadiness is the gate: it must read the month as
 *      NOT ready while any participant is missing or merely submitted, and
 *      ready only once every participant is approved.
 *
 * The submission rows below are the summarize input shape
 * (Pick<AvailabilitySubmission, 'id' | 'member_id' | 'status' | 'revision_note'>);
 * `source` is deliberately not part of it: the gate decides on status alone,
 * so a mock submission blocks exactly like a member one until approved.
 */

const roster = [
  { id: 'm-1', full_name: 'Ari' },
  { id: 'm-2', full_name: 'Bea' },
  { id: 'm-3', full_name: 'Cal' },
];

type WorkflowStatus = 'submitted' | 'approved' | 'revision_required';
type SubmissionRow = { id: string; member_id: string; status: WorkflowStatus; revision_note: null };

/** The submission set a mock run leaves behind for the given entries. */
function mockRunResults(
  entries: ReturnType<typeof buildMockSubmissionEntries>,
  skippedMemberIds: ReadonlySet<string>,
  priorSubmissions: SubmissionRow[] = [],
): SubmissionRow[] {
  const kept = priorSubmissions.filter((row) => skippedMemberIds.has(row.member_id));
  const created = entries
    .filter((entry) => !skippedMemberIds.has(entry.member_id))
    .map((entry) => ({
      id: `mock-submission-${entry.member_id}`,
      member_id: entry.member_id,
      status: 'submitted' as const,
      revision_note: null,
    }));
  return [...kept, ...created];
}

function approveAll(submissions: SubmissionRow[]): SubmissionRow[] {
  return submissions.map((row) => ({ ...row, status: 'approved' as const }));
}

describe('mock unavailability workflow — readiness transitions', () => {
  it('moves the month missing -> submitted -> approved, and the gate blocks until approval', () => {
    const entries = buildMockSubmissionEntries(roster, 9, 2026);

    // Stage 0: nobody has responded. The gate is closed and every participant
    // is missing.
    const missing = summarizeAvailabilityReadiness(9, 2026, 'ministry-1', 'Worship', roster, []);
    expect(missing.ready).toBe(false);
    expect(missing.members.map((member) => member.status)).toEqual(['missing', 'missing', 'missing']);

    // Stage 1: the mock run creates a 'submitted' mock submission for every
    // member. The month is fully RESPONDED but the gate stays closed: only
    // approvals open it.
    const submitted = summarizeAvailabilityReadiness(9, 2026, 'ministry-1', 'Worship', roster, mockRunResults(entries, new Set()));
    expect(submitted.submitted_count).toBe(3);
    expect(submitted.approved_count).toBe(0);
    expect(submitted.ready).toBe(false);

    // Stage 2: the coordinator approves every submission. Only now does the
    // gate open.
    const approved = summarizeAvailabilityReadiness(9, 2026, 'ministry-1', 'Worship', roster, approveAll(mockRunResults(entries, new Set())));
    expect(approved.ready).toBe(true);
    expect(approved.outstanding_count).toBe(0);
  });

  it('keeps the gate closed while even one mock submission awaits approval', () => {
    const entries = buildMockSubmissionEntries(roster, 9, 2026);
    const submissions = mockRunResults(entries, new Set());
    // Approve all but one: the gate must still block.
    const almost = submissions.map((row, index) => (index === 0 ? row : { ...row, status: 'approved' as const }));

    const summary = summarizeAvailabilityReadiness(9, 2026, 'ministry-1', 'Worship', roster, almost);

    expect(summary.ready).toBe(false);
    expect(summary.approved_count).toBe(2);
    expect(summary.outstanding_count).toBe(1);
  });

  it('never mocks over a member-sourced response: the skipped member keeps their approved submission', () => {
    // Bea already submitted her own month and it was approved BEFORE the mock
    // run. The RPC skips her (reported in skipped_members); her response is
    // the one the month keeps.
    const memberSourced: SubmissionRow[] = [
      { id: 'member-submission-m-2', member_id: 'm-2', status: 'approved', revision_note: null },
    ];
    const entries = buildMockSubmissionEntries(roster, 9, 2026);
    const afterMock = mockRunResults(entries, new Set(['m-2']), memberSourced);

    // No mock submission exists for Bea; her own row survived untouched.
    expect(afterMock.find((row) => row.member_id === 'm-2')?.id).toBe('member-submission-m-2');
    expect(afterMock).toHaveLength(3);

    // The two mocked members still block the gate until they are approved.
    const midFlow = summarizeAvailabilityReadiness(9, 2026, 'ministry-1', 'Worship', roster, afterMock);
    expect(midFlow.ready).toBe(false);
    expect(midFlow.approved_count).toBe(1);

    const done = summarizeAvailabilityReadiness(9, 2026, 'ministry-1', 'Worship', roster, approveAll(afterMock));
    expect(done.ready).toBe(true);
  });

  it('still completes the gate when a sole-qualified member gets an empty (null-week) mock submission', () => {
    // Simone-shaped: m-3 is the only holder of a required slot, so the route
    // excludes them from the mock weeks. They still receive an EMPTY mock
    // submission, which is a full response for readiness purposes.
    const excluded = soleQualifiedMemberIds({
      memberIds: roster.map((member) => member.id),
      roles: [
        { member_id: 'm-1', role: { name: 'Worship Leader', is_active: true } },
        { member_id: 'm-2', role: { name: 'Worship Leader', is_active: true } },
        { member_id: 'm-3', role: { name: 'Singer', is_active: true } },
      ],
      skills: [{ member_id: 'm-3', instrument: { id: 'drums', is_required: true } }],
    });
    expect(excluded.has('m-3')).toBe(true);

    const entries = buildMockSubmissionEntries(roster, 9, 2026, excluded);
    // The entry-shape contract in action: the excluded member is present with
    // a null week, which is what lets the RPC record their empty submission.
    expect(entries.find((entry) => entry.member_id === 'm-3')).toEqual({ member_id: 'm-3', week_number: null });

    const submissions = mockRunResults(entries, new Set());
    expect(submissions).toHaveLength(3);

    const submitted = summarizeAvailabilityReadiness(9, 2026, 'ministry-1', 'Worship', roster, submissions);
    expect(submitted.submitted_count).toBe(3);
    expect(submitted.ready).toBe(false);

    const approved = summarizeAvailabilityReadiness(9, 2026, 'ministry-1', 'Worship', roster, approveAll(submissions));
    expect(approved.ready).toBe(true);
  });
});
