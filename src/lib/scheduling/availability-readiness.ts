import { getAdminClient } from '@/lib/auth/server';
import { AvailabilitySubmission, Member } from '@/lib/types/database';

export type AvailabilityReadinessMember = Pick<Member, 'id' | 'full_name'> & {
  status: 'missing' | 'submitted' | 'approved' | 'revision_required';
  submission_id?: string;
  revision_note?: string | null;
};

export interface AvailabilityReadiness {
  month: number;
  year: number;
  ministry_id: string;
  ministry_name: string;
  ministries: Array<{ id: string; name: string }>;
  required_members: number;
  submitted_count: number;
  approved_count: number;
  outstanding_count: number;
  ready: boolean;
  members: AvailabilityReadinessMember[];
}

export function summarizeAvailabilityReadiness(
  month: number,
  year: number,
  ministryId: string,
  ministryName: string,
  participants: Array<Pick<Member, 'id' | 'full_name'>>,
  submissions: Pick<AvailabilitySubmission, 'id' | 'member_id' | 'status' | 'revision_note'>[],
  ministries: Array<{ id: string; name: string }> = [],
): AvailabilityReadiness {
  const byMember = new Map(submissions.map((submission) => [submission.member_id, submission]));
  const members = participants.map((member): AvailabilityReadinessMember => {
    const submission = byMember.get(member.id);
    return {
      ...member,
      status: submission?.status ?? 'missing',
      submission_id: submission?.id,
      revision_note: submission?.revision_note,
    };
  });
  const submittedCount = members.filter((member) => member.status !== 'missing').length;
  const approvedCount = members.filter((member) => member.status === 'approved').length;
  return {
    month,
    year,
    ministry_id: ministryId,
    ministry_name: ministryName,
    ministries,
    required_members: participants.length,
    submitted_count: submittedCount,
    approved_count: approvedCount,
    outstanding_count: participants.length - approvedCount,
    ready: approvedCount === participants.length,
    members,
  };
}

export async function loadAvailabilityReadiness(
  churchId: string,
  month: number,
  year: number,
  requestedMinistryId?: string,
): Promise<AvailabilityReadiness> {
  const admin = getAdminClient();
  const { data: ministries, error: ministriesError } = await admin.from('ministries')
    .select('id, name')
    .eq('church_id', churchId)
    .eq('is_active', true)
    .order('priority', { ascending: true });
  if (ministriesError) throw new Error('Could not load active ministries.');
  const ministry = requestedMinistryId
    ? (ministries ?? []).find((item) => item.id === requestedMinistryId)
    : ministries?.[0];
  if (!ministry) throw new Error('No active ministry was found for this church.');

  const { data: roles, error: rolesError } = await admin.from('roles')
    .select('id')
    .eq('ministry_id', ministry.id)
    .eq('is_active', true);
  if (rolesError) throw new Error('Could not load ministry roles.');
  const roleIds = (roles ?? []).map((role) => role.id);
  let participants: Array<Pick<Member, 'id' | 'full_name'>> = [];
  if (roleIds.length) {
    const { data: memberRoles, error: memberRolesError } = await admin.from('member_roles')
      .select('member_id')
      .in('role_id', roleIds);
    if (memberRolesError) throw new Error('Could not load ministry participants.');
    const participantIds = [...new Set((memberRoles ?? []).map((item) => item.member_id))];
    if (participantIds.length) {
      const { data: memberRows, error: membersError } = await admin.from('members')
        .select('id, full_name')
        .eq('church_id', churchId)
        .eq('status', 'active')
        .in('id', participantIds);
      if (membersError) throw new Error('Could not load active ministry members.');
      participants = (memberRows ?? []) as Array<Pick<Member, 'id' | 'full_name'>>;
    }
  }

  const participantIds = participants.map((member) => member.id);
  let submissions: AvailabilitySubmission[] = [];
  if (participantIds.length) {
    const { data: submissionRows, error: submissionsError } = await admin.from('availability_submissions')
      .select('id, member_id, status, revision_note')
      .eq('church_id', churchId)
      .eq('month', month)
      .eq('year', year)
      .eq('is_current', true)
      .in('member_id', participantIds);
    if (submissionsError) throw new Error('Could not load availability submissions.');
    submissions = (submissionRows ?? []) as AvailabilitySubmission[];
  }

  return summarizeAvailabilityReadiness(month, year, ministry.id, ministry.name, participants, submissions, ministries ?? []);
}
