'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AvailabilityCalendar } from '@/components/members/availability-calendar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Check, Clock3, Users } from 'lucide-react';
import { Availability, AvailabilitySubmission } from '@/lib/types/database';
import { getSupabaseClient } from '@/lib/supabase/client';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/loading-skeleton';

type StaffMember = { id: string; full_name: string };
type ReadinessMember = StaffMember & { status: 'missing' | 'submitted' | 'approved' | 'revision_required'; submission_id?: string; revision_note?: string | null };
type ReadinessData = { required_members: number; submitted_count: number; approved_count: number; outstanding_count: number; ready: boolean; ministry_id: string; ministry_name: string; ministries: Array<{ id: string; name: string }>; members: ReadinessMember[] };

async function getAuthHeaders() {
  const session = (await getSupabaseClient().auth.getSession()).data.session;
  return session ? { Authorization: `Bearer ${session.access_token}` } : null;
}

export default function AvailabilityPage() {
  const [members, setMembers] = useState<StaffMember[]>([]);
  const [selectedMember, setSelectedMember] = useState('');
  const [availabilities, setAvailabilities] = useState<Availability[]>([]);
  const [submission, setSubmission] = useState<(AvailabilitySubmission & { reviewer_name?: string }) | null>(null);
  const [readiness, setReadiness] = useState<ReadinessData | null>(null);
  const [ministryId, setMinistryId] = useState('');
  const [revisionTarget, setRevisionTarget] = useState<ReadinessMember | null>(null);
  const [revisionNote, setRevisionNote] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [reviewingAvailabilityId, setReviewingAvailabilityId] = useState<string | null>(null);
  const [isStaff, setIsStaff] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [resetNote, setResetNote] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetMessage, setResetMessage] = useState('');
  // Separate from the page-level `error`: the reset dialog renders in a portal,
  // so a page-level banner sits behind the modal overlay and the coordinator
  // would see a dead button and no reason for it. Sharing one state would also
  // surface an unrelated review error inside the reset dialog.
  const [resetError, setResetError] = useState('');
  const [currentMonth, setCurrentMonth] = useState(new Date().getMonth());
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [error, setError] = useState('');
  const [membersLoading, setMembersLoading] = useState(true);
  const [availabilityLoading, setAvailabilityLoading] = useState(true);
  const [readinessLoading, setReadinessLoading] = useState(true);
  const [availabilityLoadError, setAvailabilityLoadError] = useState('');
  const [readinessLoadError, setReadinessLoadError] = useState('');
  const availabilityRequest = useRef(0);
  const readinessRequest = useRef(0);

  // Client-side gate only, so the destructive control is not offered to a
  // member. The authority is the route: POST /api/availability/reset is
  // requireStaff and the RPC re-verifies role IN ('admin','coordinator') AND
  // is_active AND church_id inside the transaction.
  useEffect(() => {
    void (async () => {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const response = await fetch('/api/auth/me', { headers });
      if (!response.ok) return;
      const result = await response.json() as { user?: { role?: string } };
      setIsStaff(result.user?.role === 'admin' || result.user?.role === 'coordinator');
    })();
  }, []);

  useEffect(() => {
    async function loadMembers() {
      try {
        const headers = await getAuthHeaders();
        if (!headers) throw new Error('Your session has expired. Please sign in again.');
        const response = await fetch('/api/members?status=active', { headers });
        if (!response.ok) throw new Error('Could not load members for this church.');
        const result = await response.json() as { members: StaffMember[] };
        setMembers(result.members);
        setSelectedMember((current) => current || result.members[0]?.id || '');
        setError('');
      } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Could not load members for this church.'); }
      finally { setMembersLoading(false); }
    }
    void loadMembers();
  }, []);

  const loadAvailability = useCallback(async () => {
    const requestId = ++availabilityRequest.current;
    if (!selectedMember) {
      setAvailabilityLoading(false);
      return;
    }
    setAvailabilityLoading(true);
    try {
      const headers = await getAuthHeaders();
      if (!headers) throw new Error('Your session has expired. Please sign in again.');
      const response = await fetch(`/api/availability/submission?member_id=${encodeURIComponent(selectedMember)}&month=${currentMonth}&year=${currentYear}`, { headers });
      if (!response.ok) throw new Error('Could not load availability for this member.');
      const result = await response.json() as { submission: (AvailabilitySubmission & { reviewer_name?: string }) | null; availabilities: Availability[] };
      if (requestId !== availabilityRequest.current) return;
      setAvailabilities(result.availabilities);
      setSubmission(result.submission);
      setAvailabilityLoadError('');
    } catch (loadError) { if (requestId === availabilityRequest.current) { const message = loadError instanceof Error ? loadError.message : 'Could not load availability for this member.'; setAvailabilityLoadError(message); setError(message); } }
    finally { if (requestId === availabilityRequest.current) setAvailabilityLoading(false); }
  }, [selectedMember, currentMonth, currentYear]);

  const loadReadiness = useCallback(async () => {
    const requestId = ++readinessRequest.current;
    setReadinessLoading(true);
    try {
      const headers = await getAuthHeaders();
      if (!headers) throw new Error('Your session has expired. Please sign in again.');
      const response = await fetch(`/api/schedule/readiness?month=${currentMonth}&year=${currentYear}${ministryId ? `&ministry_id=${encodeURIComponent(ministryId)}` : ''}`, { headers });
      if (!response.ok) throw new Error('Could not load monthly readiness.');
      const result = await response.json() as ReadinessData;
      if (requestId !== readinessRequest.current) return;
      setReadiness(result);
      setReadinessLoadError('');
      if (!ministryId) setMinistryId(result.ministry_id);
    } catch (loadError) { if (requestId === readinessRequest.current) { const message = loadError instanceof Error ? loadError.message : 'Could not load monthly readiness.'; setReadinessLoadError(message); setError(message); } }
    finally { if (requestId === readinessRequest.current) setReadinessLoading(false); }
  }, [currentMonth, currentYear, ministryId]);

  useEffect(() => {
    const refresh = async () => {
      await loadAvailability();
    };
    void refresh();
  }, [loadAvailability]);

  // The request synchronizes this view with the selected month/ministry.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadReadiness(); }, [loadReadiness]);

  useEffect(() => {
    if (!selectedMember) {
      return;
    }
    const supabase = getSupabaseClient();
    const channel = supabase
      .channel(`availability-changes-${selectedMember}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'availability',
          filter: `member_id=eq.${selectedMember}`,
        },
        () => {
          void loadAvailability();
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [selectedMember, loadAvailability]);

  const reviewRequest = useCallback(async (id: string, status: 'approved' | 'rejected') => {
    if (reviewingAvailabilityId) return;
    setReviewingAvailabilityId(id);
    setError('');
    try {
      const headers = await getAuthHeaders();
      if (!headers) throw new Error('Your session has expired. Please sign in again.');
      const response = await fetch('/api/availability', {
        method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }),
      });
      if (!response.ok) throw new Error('Could not update that request.');
      setAvailabilities((current) => current.map((item) => (item.id === id ? { ...item, status } : item)));
    } catch (reviewError) { setError(reviewError instanceof Error ? reviewError.message : 'Could not update that request.'); }
    finally { setReviewingAvailabilityId(null); }
  }, [reviewingAvailabilityId]);

  const reviewSubmission = useCallback(async (member: ReadinessMember, action: 'approved' | 'revision_required', note = '') => {
    if (!member.submission_id) return;
    setReviewing(true);
    setError('');
    try {
      const headers = await getAuthHeaders();
      if (!headers) throw new Error('Your session has expired. Please sign in again.');
      const response = await fetch('/api/availability/submission', {
        method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: member.submission_id, action, note }),
      });
      if (!response.ok) {
        const payload = await response.json() as { error?: string };
        throw new Error(payload.error ?? 'Could not review this monthly submission.');
      }
      if (selectedMember === member.id) await loadAvailability();
      await loadReadiness();
      setRevisionTarget(null);
      setRevisionNote('');
    } catch (reviewError) { setError(reviewError instanceof Error ? reviewError.message : 'Could not review this monthly submission.'); }
    finally { setReviewing(false); }
  }, [selectedMember, loadAvailability, loadReadiness]);

  const selectedMemberName = members.find((member) => member.id === selectedMember)?.full_name || '';

  const monthLabel = new Date(currentYear, currentMonth, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const resetMonthAvailability = useCallback(async () => {
    setResetting(true);
    setError('');
    setResetMessage('');
    setResetError('');
    // try/finally, not a trailing setResetting(false): the destructive button is
    // disabled while `resetting`, so a thrown fetch (dead network, aborted
    // request, non-JSON body) would otherwise leave the coordinator looking at
    // a permanently dead button with no feedback at all.
    try {
      const headers = await getAuthHeaders();
      if (!headers) {
        setResetError('Your session has expired. Please sign in again.');
        return;
      }
      // `month` and `year` are the ONLY month scoping sent. No ministry is sent
      // and the ministry Select in the readiness header is not consulted: the
      // action is church-wide, which the confirmation dialog states explicitly.
      const response = await fetch('/api/availability/reset', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: currentMonth, year: currentYear, note: resetNote.trim() }),
      });
      const payload = await response.json() as {
        error?: string;
        reset?: boolean;
        submissions_reset?: number;
        availability_reset?: number;
        unscoped_availability_reset?: number;
        remaining_blocking_dates?: number;
      };
      if (response.ok) {
        setResetConfirmOpen(false);
        setResetOpen(false);
        setResetNote('');
        const remaining = payload.remaining_blocking_dates ?? 0;
        // The counts are always reported. A repeat click returns `reset: false`
        // with zeros and must not read as "done".
        setResetMessage(
          payload.reset
            ? `${monthLabel}: ${payload.submissions_reset ?? 0} monthly submission(s) returned for revision, ${payload.availability_reset ?? 0} submitted unavailability entr(ies) cleared, ${payload.unscoped_availability_reset ?? 0} unscoped absence request(s) cleared. Every affected member must submit the month again and be re-approved before it can be scheduled.${remaining > 0 ? ` ${remaining} unavailability entr(ies) are not tied to this month and can still block it.` : ''}`
            : remaining > 0
              // Never the bare "nothing to reset" line while a blocker survives:
              // that would be false, and the coordinator has no other screen
              // that shows the offending rows.
              ? `Nothing was recorded for ${monthLabel}, so there was nothing to reset. ${remaining} unavailability entr(ies) are not tied to this month and can still block it.`
              : `Nothing was recorded for ${monthLabel}, so there was nothing to reset.`
        );
        await loadReadiness();
        await loadAvailability();
      } else {
        setResetError(payload.error ?? 'Could not reset this month\'s availability.');
      }
    } catch {
      setResetError('Could not reach the server to reset this month. Check your connection and try again.');
    } finally {
      setResetting(false);
    }
  }, [currentMonth, currentYear, resetNote, monthLabel, loadReadiness, loadAvailability]);

  const handlePreviousMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear(currentYear - 1);
    } else {
      setCurrentMonth(currentMonth - 1);
    }
  };

  const handleNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear(currentYear + 1);
    } else {
      setCurrentMonth(currentMonth + 1);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Availability</h2>
          <p className="text-muted-foreground">Manage member availability and unavailability</p>
        </div>
      </div>

      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

      <Card className="overflow-hidden border-primary/15">
        <CardHeader className="border-b border-border pb-4">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Coordinator review · {monthLabel}</p><CardTitle className="mt-1 font-display text-2xl">Monthly readiness</CardTitle>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {readinessLoading ? <Skeleton className="h-4 w-32" /> : readiness ? <p className="text-sm text-muted-foreground">{readiness.approved_count} approved · {readiness.outstanding_count} outstanding</p> : <p className="text-sm text-destructive">Readiness unavailable</p>}
              <Select value={ministryId} onValueChange={(value) => value && setMinistryId(value)}><SelectTrigger aria-label="Choose ministry for readiness" className="h-9 w-48"><SelectValue placeholder="Choose ministry" /></SelectTrigger><SelectContent>{(readiness?.ministries ?? []).map((ministry) => <SelectItem key={ministry.id} value={ministry.id}>{ministry.name}</SelectItem>)}</SelectContent></Select>
              {isStaff ? (
                <Button variant="destructive" size="lg" onClick={() => { setResetMessage(''); setResetError(''); setResetOpen(true); }} disabled={resetting}>
                  Reset {monthLabel} availability
                </Button>
              ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4 sm:p-6">
          {readinessLoading ? <div aria-busy="true" aria-label="Loading monthly readiness" role="status" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}</div> : !readiness ? <div className="flex items-center justify-between gap-3"><p className="text-sm text-muted-foreground">{readinessLoadError || 'Monthly readiness could not be loaded.'}</p><Button size="sm" variant="outline" onClick={() => void loadReadiness()}>Retry</Button></div> : !readiness.members.length ? <p className="text-sm text-muted-foreground">No active members with roles in this ministry are required for this month.</p> : (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {readiness.members.map((person) => (
                <div key={person.id} className="flex min-w-0 items-center gap-3 rounded-xl border border-border p-3">
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${person.status === 'approved' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                    {person.status === 'approved' ? <Check className="h-4 w-4" /> : person.status === 'submitted' ? <Clock3 className="h-4 w-4" /> : <Users className="h-4 w-4" />}
                  </div>
                  <button type="button" className="min-w-0 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setSelectedMember(person.id)}>
                    <span className="block truncate text-sm font-medium">{person.full_name}</span>
                    <span className={`text-xs ${person.status === 'approved' ? 'text-primary' : person.status === 'revision_required' ? 'text-destructive' : 'text-muted-foreground'}`}>
                      {person.status === 'missing' ? 'Not submitted' : person.status === 'revision_required' ? 'Revision requested' : person.status === 'submitted' ? 'Awaiting review' : 'Approved'}
                    </span>
                  </button>
                  {person.status === 'submitted' && person.submission_id ? <div className="flex shrink-0 gap-1"><Button size="sm" onClick={() => void reviewSubmission(person, 'approved')} disabled={reviewing}>Approve</Button><Button size="sm" variant="outline" onClick={() => { setRevisionTarget(person); setRevisionNote(''); }} disabled={reviewing}>Revise</Button></div> : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Select value={selectedMember} onValueChange={(value) => value && setSelectedMember(value)}>
          <SelectTrigger className="w-[200px]" disabled={membersLoading} aria-busy={membersLoading}>
            <SelectValue placeholder={membersLoading ? 'Loading members…' : 'Select member'}>
              {(value: string) => members.find((member) => member.id === value)?.full_name ?? 'Select member'}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {members.map((member) => (
              <SelectItem key={member.id} value={member.id}>
                {member.full_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {availabilityLoading ? <div aria-busy="true" aria-label="Loading member availability" role="status" className="space-y-3 rounded-xl border border-border p-5"><Skeleton className="h-6 w-48" /><div className="grid grid-cols-7 gap-2">{Array.from({ length: 35 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div></div> : availabilityLoadError ? <div role="alert" className="flex items-center justify-between rounded-xl border border-destructive/30 p-4 text-sm"><span>{availabilityLoadError}</span><Button size="sm" variant="outline" onClick={() => void loadAvailability()}>Retry</Button></div> : <AvailabilityCalendar
        memberName={selectedMemberName}
        availabilities={availabilities}
        currentMonth={currentMonth}
        currentYear={currentYear}
        onPreviousMonth={handlePreviousMonth}
        onNextMonth={handleNextMonth}
      />}

      <Card>
        <CardHeader><CardTitle>Monthly submission</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-start justify-between gap-4">
          <div>
            {availabilityLoading ? <><Skeleton className="h-5 w-32" /><Skeleton className="mt-2 h-4 w-56" /></> : availabilityLoadError ? <p className="text-sm text-destructive">Submission status unavailable.</p> : <><p className="font-medium">{submission ? submission.status.replace('_', ' ') : 'Not submitted'}</p>
            <p className="mt-1 text-sm text-muted-foreground">{submission?.reviewed_at ? `Reviewed ${new Date(submission.reviewed_at).toLocaleString()}${submission.reviewer_name ? ` by ${submission.reviewer_name}` : ''}` : submission ? 'Waiting for coordinator review.' : 'Legacy absence requests do not count as a complete monthly response.'}</p></>}
            {submission?.revision_note ? <p className="mt-2 rounded-lg bg-destructive/5 p-3 text-sm text-destructive">Revision requested: {submission.revision_note}</p> : null}
          </div>
          {submission ? <span className={`rounded-full px-3 py-1 text-xs font-semibold capitalize ${submission.status === 'approved' ? 'bg-primary/10 text-primary' : submission.status === 'revision_required' ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'}`}>{submission.status.replace('_', ' ')}</span> : null}
        </CardContent>
      </Card>

      <Card className="card-glow">
        <CardHeader>
          <CardTitle>Unavailability details</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {availabilityLoading ? <div aria-busy="true" aria-label="Loading unavailability details" role="status" className="space-y-3"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div> : availabilityLoadError ? <p className="text-sm text-destructive">Availability details unavailable.</p> : availabilities.length === 0 ? (
              <p className="text-sm text-muted-foreground">No unavailability was submitted. An approved monthly submission with no entries means the member is available throughout the month.</p>
            ) : (
              availabilities.map((availability) => {
                return (
                  <div
                    key={availability.id}
                    className="flex items-center justify-between rounded-lg border border-border p-4 hover-surface cursor-default"
                  >
                    <div>
                      <div className="font-medium text-foreground">{selectedMemberName}</div>
                      <div className="text-sm text-muted-foreground">
                        {availability.type === 'weekly'
                          ? `Week ${availability.week_number}${
                              availability.month !== undefined && availability.year !== undefined
                                ? ` · ${new Date(availability.year, availability.month).toLocaleString('en-US', { month: 'long' })} ${availability.year}`
                                : ''
                            }`
                          : availability.type}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                          availability.status === 'approved'
                            ? 'bg-primary/15 text-primary'
                            : availability.status === 'rejected'
                            ? 'bg-destructive/15 text-destructive'
                            : 'bg-[oklch(0.70_0.08_80)]/15 text-[oklch(0.70_0.08_80)]'
                        }`}
                      >
                        {availability.status}
                      </span>
                      {availability.status === 'pending' ? (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => reviewRequest(availability.id, 'approved')}
                            disabled={reviewingAvailabilityId !== null}
                            aria-busy={reviewingAvailabilityId === availability.id}
                          >
                            {reviewingAvailabilityId === availability.id ? 'Saving…' : 'Approve'}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-destructive hover:text-destructive"
                            onClick={() => reviewRequest(availability.id, 'rejected')}
                            disabled={reviewingAvailabilityId !== null}
                          >
                            Reject
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={Boolean(revisionTarget)} onOpenChange={(open) => { if (!open && !reviewing) setRevisionTarget(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Request a revision</DialogTitle><DialogDescription>Tell {revisionTarget?.full_name ?? 'the member'} what needs clarification. They must submit the month again before generation can proceed.</DialogDescription></DialogHeader>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <div className="space-y-2"><Label htmlFor="revision-note">Revision note</Label><Textarea id="revision-note" value={revisionNote} onChange={(event) => setRevisionNote(event.target.value)} placeholder="For example: Please confirm whether you are available in week three." /></div>
          <DialogFooter><Button variant="outline" onClick={() => setRevisionTarget(null)} disabled={reviewing}>Cancel</Button><Button disabled={!revisionNote.trim() || reviewing || !revisionTarget} aria-busy={reviewing} onClick={() => revisionTarget && void reviewSubmission(revisionTarget, 'revision_required', revisionNote.trim())}>{reviewing ? 'Sending…' : 'Send revision request'}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {resetMessage ? <p role="status" className="rounded-lg border border-border bg-muted/40 p-3 text-sm text-foreground">{resetMessage}</p> : null}

      {/* Step 1: disclosure + required note. Nothing is sent until step 2. */}
      <Dialog open={resetOpen} onOpenChange={(open) => { if (!open && !resetting) { setResetOpen(false); setResetConfirmOpen(false); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset unavailability for {monthLabel}</DialogTitle>
            <DialogDescription>
              This clears the unavailability recorded for {monthLabel} so the roster can declare it again. Read every point below before continuing.
            </DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
            <li><span className="font-medium text-foreground">Church-wide, not ministry-scoped.</span> The ministry selected above is ignored for this action. Every member in this church is affected, not only the members of one ministry.</li>
            <li>It applies to <span className="font-medium text-foreground">{monthLabel}</span> only, and it affects the whole month rather than the weeks shown for the selected member.</li>
            <li><span className="font-medium text-foreground">Recorded unavailability stops blocking scheduling</span> for the month. No record is deleted, and the reset itself is written to the review history.</li>
            <li><span className="font-medium text-foreground">Every affected member must submit the month again and be re-approved</span> by a coordinator. Until then the month is not ready to generate.</li>
            <li>A member who never submitted is <span className="font-medium text-foreground">not</span> unblocked by this action. They still owe a submission.</li>
            <li>Any existing draft schedule for the month may need to be regenerated, because it was built from the unavailability this action clears.</li>
            <li>A month that already has a <span className="font-medium text-foreground">validated or published</span> schedule is refused. Draft and archived services do not block the reset.</li>
            {/* A limitation, not a claim that this dialog handled them. The
                availability page reads a month-FILTERED endpoint, so no screen
                in the app lists these rows and none is named here. */}
            <li>Some unavailability entries are not tied to a month. This reset does not clear them and they are not listed on this screen; they can still block this month.</li>
          </ul>
          <div className="space-y-2">
            <Label htmlFor="reset-note">Why is this month being reset?</Label>
            <Textarea id="reset-note" value={resetNote} onChange={(event) => setResetNote(event.target.value)} placeholder="For example: The retreat moved to April; please declare unavailability for March again." />
            <p className="text-xs text-muted-foreground">This note is attached to every submission and shown to each member, so it must explain what changed.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setResetOpen(false); setResetConfirmOpen(false); }}>Cancel</Button>
            <Button disabled={!resetNote.trim()} onClick={() => { setResetOpen(false); setResetConfirmOpen(true); }}>Continue</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Step 2: the actual confirmation. */}
      <Dialog open={resetConfirmOpen} onOpenChange={(open) => { if (!open && !resetting) setResetConfirmOpen(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset unavailability for all members in {monthLabel}?</DialogTitle>
            <DialogDescription>
              This affects every member in this church, across every ministry. It cannot be undone from this screen; it is recorded in the availability review history.
            </DialogDescription>
          </DialogHeader>
          {/* Inside the dialog, next to the button that failed. The page-level
              banner is behind this modal overlay. */}
          {resetError ? <p role="alert" className="text-sm text-destructive">{resetError}</p> : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setResetConfirmOpen(false); setResetOpen(true); }} disabled={resetting}>Back</Button>
            <Button variant="destructive" disabled={resetting} onClick={() => void resetMonthAvailability()}>
              {resetting ? `Resetting…` : `Reset ${monthLabel}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
