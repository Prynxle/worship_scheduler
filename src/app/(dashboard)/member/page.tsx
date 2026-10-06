'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getSupabaseClient } from '@/lib/supabase/client';
import { Availability } from '@/lib/types/database';
import { getAvailableWeeks, getWeekDateRange } from '@/lib/utils/date-utils';
import { EventCalendar } from '@/components/events/event-calendar';
import { CalendarCheck, Clock3, X } from 'lucide-react';

type MemberInfo = { id: string; full_name: string; role: string; phone?: string | null };
type MemberProfileInfo = {
  fullName: string;
  accountRole: string;
  ministryRoles: string[];
  instruments: string[];
} | null;
type MonthlySubmission = { status: 'submitted' | 'approved' | 'revision_required'; revision_note?: string | null; reviewer_name?: string; reviewed_at?: string | null; version: number };

const monthName = (month: number) => new Date(2024, month, 1).toLocaleString('en-US', { month: 'long' });

function formatWeek(weekNumber: number, month: number, year: number) {
  return getWeekDateRange(weekNumber, month, year).start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function MemberPage() {
  const router = useRouter();
  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();
  const [member, setMember] = useState<MemberInfo | null>(null);
  const [profile, setProfile] = useState<MemberProfileInfo>(null);
  const [selectedMonth, setSelectedMonth] = useState(`${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`);
  const year = Number(selectedMonth.slice(0, 4));
  const month = Number(selectedMonth.slice(5, 7)) - 1;
  const monthOptions = useMemo(() => Array.from({ length: 18 }, (_, index) => {
    const value = new Date(currentYear, currentMonth + index, 1);
    return { value: `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}`, label: `${monthName(value.getMonth())} ${value.getFullYear()}` };
  }), [currentYear, currentMonth]);
  const availableWeeks = getAvailableWeeks(month, year);
  const [unavailableWeeks, setUnavailableWeeks] = useState<number[]>([]);
  const [requests, setRequests] = useState<Availability[]>([]);
  const [submission, setSubmission] = useState<MonthlySubmission | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    void getSupabaseClient().auth.getSession().then(async ({ data }) => {
      if (!data.session) { router.replace('/login'); return; }
      const response = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${data.session.access_token}` } });
      if (!response.ok) { router.replace('/dashboard'); return; }
      const result = await response.json() as {
        user: { member_id: string | null; role: string; member_name?: string | null; phone?: string | null };
        profile?: { memberId: string; fullName: string; accountRole: string; ministryRoles: string[]; instruments: string[] } | null;
      };
      if (!active) return;
      if (result.user.role !== 'member' || !result.user.member_id) { router.replace('/dashboard'); return; }
      setMember({ id: result.user.member_id, full_name: result.user.member_name ?? 'Your profile', role: result.user.role, phone: result.user.phone });
      setProfile(result.profile ?? null);
    });
    return () => { active = false; };
  }, [router]);

  const loadSubmission = useCallback(async () => {
    if (!member) return;
    const session = (await getSupabaseClient().auth.getSession()).data.session;
    if (!session) return;
    const response = await fetch(`/api/availability/submission?month=${month}&year=${year}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
    if (!response.ok) { setError('Could not load your monthly availability.'); return; }
    const result = await response.json() as { submission: MonthlySubmission | null; availabilities: Availability[] };
    setSubmission(result.submission);
    setRequests(result.availabilities);
    setUnavailableWeeks(result.availabilities.filter((item) => item.type === 'weekly' && item.status !== 'rejected').map((item) => item.week_number ?? 0).filter(Boolean));
  }, [member, month, year]);

  // Refresh server state when the member or selected month changes.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadSubmission(); }, [loadSubmission]);

  useEffect(() => {
    if (!member) return;
    const supabase = getSupabaseClient();
    const channel = supabase.channel(`monthly-availability-${member.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'availability', filter: `member_id=eq.${member.id}` }, () => { void loadSubmission(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'availability_submissions', filter: `member_id=eq.${member.id}` }, () => { void loadSubmission(); })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [member, loadSubmission]);

  async function submitMonth() {
    setError(''); setMessage(''); setSubmitting(true);
    try {
      const session = (await getSupabaseClient().auth.getSession()).data.session;
      if (!session) throw new Error('Your session has expired. Please sign in again.');
      const response = await fetch('/api/availability/submission', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ month, year, entries: unavailableWeeks.map((week_number) => ({ type: 'weekly', week_number })) }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Could not submit this month.');
      setMessage(unavailableWeeks.length ? 'Monthly availability sent for coordinator review.' : 'You are marked available for the full month. Your response is waiting for coordinator review.');
      await loadSubmission();
    } catch (submitError) { setError(submitError instanceof Error ? submitError.message : 'Could not submit this month.'); }
    finally { setSubmitting(false); }
  }

  async function cancelLegacyRequest(id: string) {
    setError('');
    const session = (await getSupabaseClient().auth.getSession()).data.session;
    if (!session) return;
    const response = await fetch(`/api/availability?id=${encodeURIComponent(id)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${session.access_token}` } });
    if (response.ok) await loadSubmission();
    else setError('Could not cancel that request.');
  }

  if (!member) return null;
  const canSubmit = !submission || submission.status === 'revision_required';
  const ministryRoles = profile?.ministryRoles ?? [];
  const instruments = profile?.instruments ?? [];
  return (
    <div className="mx-auto max-w-[1440px] space-y-7 pb-10">
      {/* The former page header ("Your month at a glance" plus its instructions)
          is gone. It described a page that was mostly one task, and it pushed the
          member's own details below the fold. The profile now leads the workspace
          and spans the full grid, laid out as a horizontal strip so the name,
          phone, ministry roles and instruments read across one band instead of
          stacking in a tall side column. */}
      <Card>
        <CardContent className="flex flex-wrap items-start gap-x-8 gap-y-4 p-5 sm:p-6">
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Member workspace</p>
            <h1 className="mt-1.5 font-display text-2xl font-semibold">{profile?.fullName ?? member.full_name}</h1>
            {member.phone ? <p className="mt-1.5 text-sm text-muted-foreground">{member.phone}</p> : null}
          </div>
          {ministryRoles.length ? (
            <div className="min-w-0">
              <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Ministry role</h2>
              <ul className="mt-2 flex flex-wrap gap-2">
                {ministryRoles.map((name) => (
                  <li key={name}>
                    <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">{name}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {instruments.length ? (
            <div className="min-w-0">
              <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Instrument</h2>
              <ul className="mt-2 flex flex-wrap gap-2">
                {instruments.map((name) => (
                  <li key={name}>
                    <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">{name}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {/* A member with no role or instrument row is a real state, so it is
              stated rather than rendered as an empty list. The previous build
              hardcoded "Worship team member" here, which read as a role on every
              profile regardless of the truth. */}
          {!ministryRoles.length && !instruments.length ? (
            <div className="min-w-0">
              <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Ministry role &amp; instrument</h2>
              <p className="mt-2 text-sm text-muted-foreground">Nothing recorded yet — ask the coordinator to update your profile.</p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* `lg:row-span-2` makes this card stretch across both rows the right column
            occupies (calendar + details) instead of stopping at the calendar's
            baseline and leaving a column of dead space. The inner flex column
            lets the submit block settle to the bottom via `mt-auto`, so the
            button does not float mid-card when the right column is taller. */}
        <Card className="flex flex-col overflow-hidden lg:col-span-5 lg:row-span-2">
          <div className="border-b border-border bg-primary/[0.035] px-5 py-5 sm:px-6">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Availability response</p>
            <h2 className="mt-1 font-display text-2xl font-semibold">{monthName(month)} {year}</h2>
            <p className="mt-1 text-sm text-muted-foreground">Choose unavailable weeks, then send one complete monthly response.</p>
          </div>
          <CardContent className="flex flex-1 flex-col gap-5 p-5 sm:p-6">
            <div className="max-w-xs space-y-2"><Label htmlFor="member-month">Month</Label><Select value={selectedMonth} onValueChange={(value) => { if (value) { setSelectedMonth(value); setUnavailableWeeks([]); setMessage(''); setError(''); } }}><SelectTrigger id="member-month" className="h-10 w-full"><SelectValue placeholder="Choose month">{monthName(month)} {year}</SelectValue></SelectTrigger><SelectContent>{monthOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent></Select></div>
            <fieldset disabled={!canSubmit || submitting} className="space-y-3 disabled:opacity-70">
              <legend className="text-sm font-medium">Which service weeks are you unavailable?</legend>
              {availableWeeks.length ? <div className="grid gap-2 sm:grid-cols-2">
                {availableWeeks.map((weekNumber) => (
                  <label key={weekNumber} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-border px-4 py-3 text-sm transition-colors hover:bg-muted/50 has-[:checked]:border-primary/40 has-[:checked]:bg-primary/5">
                    <input type="checkbox" className="h-4 w-4 accent-primary" checked={unavailableWeeks.includes(weekNumber)} onChange={(event) => setUnavailableWeeks((current) => event.target.checked ? [...current, weekNumber].sort((a, b) => a - b) : current.filter((week) => week !== weekNumber))} />
                    <span>Week {weekNumber}<span className="ml-2 text-muted-foreground">{formatWeek(weekNumber, month, year)}</span></span>
                  </label>
                ))}
              </div> : <p className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">All service weeks in this month have passed.</p>}
              <p className="text-xs text-muted-foreground">{unavailableWeeks.length ? `Unavailable: week${unavailableWeeks.length === 1 ? '' : 's'} ${unavailableWeeks.join(', ')}.` : 'No weeks selected · available all month.'}</p>
            </fieldset>

            {submission ? <div className={`rounded-xl border p-4 ${submission.status === 'approved' ? 'border-primary/20 bg-primary/5' : submission.status === 'revision_required' ? 'border-destructive/20 bg-destructive/5' : 'border-border bg-muted/35'}`}>
              <div className="flex items-center gap-2 text-sm font-semibold capitalize">{submission.status === 'approved' ? <CalendarCheck className="h-4 w-4 text-primary" /> : submission.status === 'submitted' ? <Clock3 className="h-4 w-4 text-muted-foreground" /> : <X className="h-4 w-4 text-destructive" />}{submission.status.replace('_', ' ')}</div>
              {submission.revision_note ? <p className="mt-2 text-sm">Coordinator request: {submission.revision_note}</p> : null}
              {submission.reviewed_at && submission.reviewer_name ? <p className="mt-2 text-xs text-muted-foreground">Reviewed by {submission.reviewer_name} on {new Date(submission.reviewed_at).toLocaleDateString()}.</p> : null}
              {submission.status === 'approved' || submission.status === 'submitted' ? <p className="mt-2 text-xs text-muted-foreground">This response is locked while it is submitted or approved. Contact the coordinator if it needs to change.</p> : null}
            </div> : null}
            {/* `mt-auto` pins the submit block to the bottom of the stretched card rather
                than leaving it directly under the week list. */}
            <div className="mt-auto space-y-3">
            <Button onClick={() => void submitMonth()} disabled={!canSubmit || submitting || availableWeeks.length === 0}>{submitting ? 'Submitting…' : submission?.status === 'revision_required' ? 'Resubmit month' : 'Submit month'}</Button>
            {message ? <p role="status" className="text-sm text-primary">{message}</p> : null}
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            </div>
          </CardContent>
        </Card>

        {/* The right column stacks the calendar above the details card. Both sit in
            the same `lg:col-span-7` column, so the details card reads as a
            continuation of the calendar rather than as an unrelated third panel
            wedged underneath the response card. `EventCalendar` renders its own
            Cards and its own internal two-column layout (month grid beside the
            selected-day panel), so it is placed in a plain grid cell rather than
            wrapped in another Card, which would double the chrome. It self-fetches
            /api/events and self-subscribes, and `canManage={false}` hides
            Add/Delete: a member reads the calendar here rather than navigating to a
            separate Events tab, which has been removed. */}
        <div className="space-y-6 lg:col-span-7">
          <EventCalendar canManage={false} />
          <Card>
            <CardHeader><h2 className="font-heading text-base leading-snug font-medium">Availability details</h2></CardHeader>
            <CardContent>
              {!requests.length ? <p className="text-sm text-muted-foreground">{submission ? 'No unavailability details were submitted for this month.' : 'Submit the month above, even if you are available every week.'}</p> : <div className="space-y-2">
                {requests.map((request) => <div key={request.id} className="flex items-center justify-between gap-3 rounded-xl border border-border p-4">
                  <div><p className="font-medium">{request.type === 'weekly' ? `Week ${request.week_number} · ${monthName(request.month ?? month)} ${request.year ?? year}` : request.type}</p><p className="text-xs text-muted-foreground">{request.reason || 'No reason provided'} · {new Date(request.created_at).toLocaleDateString()}</p></div>
                  <div className="flex items-center gap-2"><span className="rounded-full bg-muted px-2.5 py-1 text-xs capitalize text-muted-foreground">{request.status}</span>{request.status === 'pending' && !request.submission_id ? <Button variant="ghost" size="sm" onClick={() => void cancelLegacyRequest(request.id)}><X className="mr-1 h-4 w-4" />Cancel</Button> : null}</div>
                </div>)}
              </div>}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}