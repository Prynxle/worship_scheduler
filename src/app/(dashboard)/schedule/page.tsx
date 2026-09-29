'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ScheduleCard } from '@/components/schedule/schedule-card';
import { ScheduleLineupEditor, EditableAssignment } from '@/components/schedule/schedule-lineup-editor';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AvailabilityReadiness } from '@/lib/scheduling/availability-readiness';
import { getSupabaseClient } from '@/lib/supabase/client';
import { formatLocalDate, getWeeksInMonth, getWeekDate } from '@/lib/utils/date-utils';
import { AlertTriangle, CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, Plus, ShieldCheck, Users } from 'lucide-react';

type ScheduleStatus = 'draft' | 'validated' | 'published' | 'archived';
type ScheduleItem = {
  id: string;
  date: string;
  week_number: number;
  leader_name: string;
  leader_avatar?: string;
  backup_singers: { name: string; avatar?: string }[];
  instrumentalists: { instrument: string; name: string }[];
  devotion_name?: string;
  status: ScheduleStatus;
  conflict_count: number;
  legacy_unscoped?: boolean;
  schedule_version: number;
  revision_of?: string | null;
  validated_version?: number | null;
  published_at?: string | null;
  assignments: EditableAssignment[];
};
type RosterMember = { id: string; full_name: string };
type RoleOption = { id: string; name: string };
type InstrumentOption = { id: string; name: string };
type ConfirmAction = { kind: 'regenerate' | 'mock-unavailability' } | { kind: 'publish'; service: ScheduleItem } | { kind: 'revision'; service: ScheduleItem };

function monthString(year: number, month: number) { return `${year}-${String(month + 1).padStart(2, '0')}`; }
function parseMonth(value: string) {
  return { year: Number(value.slice(0, 4)), month: Number(value.slice(5, 7)) - 1 };
}

/**
 * First month, starting at the current one, that still has a Sunday ahead.
 *
 * The route refuses to generate a month whose service dates have passed, so a
 * picker that opens on the current month is dead on arrival once that month's
 * last Sunday is behind us -- the primary "Generate schedule" button can never
 * do anything. Sunday-anchored exactly like the route's own `futureWeeks`: week
 * 1 is `getFirstSunday(month, year)` and week n is that plus n-1 weeks, so the
 * LAST Sunday is the only date that decides whether anything is left. Derived
 * from the same helpers the gate uses, so the default view and the gate can
 * never disagree.
 */
function firstGeneratableMonth(today: Date): string {
  const todayString = formatLocalDate(today);
  // Every calendar month contains at least one Sunday, so this always resolves
  // on the first iteration. The bound exists only to give the loop a total.
  for (let offset = 0; offset < 24; offset += 1) {
    const month = (today.getMonth() + offset) % 12;
    const year = today.getFullYear() + Math.floor((today.getMonth() + offset) / 12);
    const lastSunday = formatLocalDate(getWeekDate(getWeeksInMonth(month, year), month, year));
    if (lastSunday >= todayString) return monthString(year, month);
  }
  return monthString(today.getFullYear(), today.getMonth());
}

export default function SchedulePage() {
  const today = new Date();
  const [selectedMonth, setSelectedMonth] = useState(() => firstGeneratableMonth(today));
  const { year, month } = parseMonth(selectedMonth);
  const [readiness, setReadiness] = useState<AvailabilityReadiness | null>(null);
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [members, setMembers] = useState<RosterMember[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [instruments, setInstruments] = useState<InstrumentOption[]>([]);
  const [selectedDate, setSelectedDate] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [editingId, setEditingId] = useState('');

  const loadSchedules = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const session = (await getSupabaseClient().auth.getSession()).data.session;
      if (!session) throw new Error('Your session has expired. Please sign in again.');
      const headers = { Authorization: `Bearer ${session.access_token}` };
      const query = `month=${month}&year=${year}`;
      const [readinessResponse, scheduleResponse] = await Promise.all([
        fetch(`/api/schedule/readiness?${query}`, { headers }),
        fetch(`/api/schedule?${query}`, { headers }),
      ]);
      const readinessPayload = await readinessResponse.json() as AvailabilityReadiness & { error?: string };
      const schedulePayload = await scheduleResponse.json() as {
        services?: ScheduleItem[];
        members?: RosterMember[];
        roles?: RoleOption[];
        instruments?: InstrumentOption[];
        error?: string;
      };
      if (!readinessResponse.ok) throw new Error(readinessPayload.error ?? 'Could not load availability readiness.');
      if (!scheduleResponse.ok) throw new Error(schedulePayload.error ?? 'Could not load monthly schedules.');
      setReadiness(readinessPayload);
      setSchedules(schedulePayload.services ?? []);
      setMembers(schedulePayload.members ?? []);
      setRoles(schedulePayload.roles ?? []);
      setInstruments(schedulePayload.instruments ?? []);
      setSelectedDate((current) => {
        const serviceDate = (schedulePayload.services ?? []).find((item) => item.date.startsWith(selectedMonth))?.date;
        return current.startsWith(selectedMonth) ? current : serviceDate ?? `${selectedMonth}-01`;
      });
      const url = new URL(window.location.href);
      url.searchParams.set('month', String(month));
      url.searchParams.set('year', String(year));
      url.searchParams.delete('ministry_id');
      window.history.replaceState({}, '', url);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load monthly schedules.');
    } finally {
      setLoading(false);
    }
  }, [month, year, selectedMonth]);

  // Load the selected month and ministry from the server.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadSchedules(); }, [loadSchedules]);

  const statusCounts = useMemo(() => ({
    all: schedules.length,
    draft: schedules.filter((item) => item.status === 'draft').length,
    validated: schedules.filter((item) => item.status === 'validated').length,
    published: schedules.filter((item) => item.status === 'published').length,
  }), [schedules]);

  const filteredSchedules = useMemo(() => schedules.filter((service) => {
    const matchesStatus = statusFilter === 'all' || service.status === statusFilter;
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || service.leader_name.toLowerCase().includes(query)
      || service.backup_singers.some((member) => member.name.toLowerCase().includes(query))
      || service.instrumentalists.some((player) => player.name.toLowerCase().includes(query));
    return matchesStatus && matchesSearch;
  }), [schedules, statusFilter, search]);

  const selectedService = schedules.find((item) => item.date === selectedDate);
  const editingService = schedules.find((item) => item.id === editingId);
  const monthIsPast = year < today.getFullYear() || (year === today.getFullYear() && month < today.getMonth());
  const lockedSchedules = schedules.some((item) => item.status !== 'draft');
  const hasLegacySchedules = schedules.some((item) => item.legacy_unscoped);
  const monthLabel = new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const calendarCells = Array.from({ length: Math.ceil((firstWeekday + daysInMonth) / 7) * 7 }, (_, index) => {
    const day = index - firstWeekday + 1;
    return day > 0 && day <= daysInMonth ? day : null;
  });
  const approvedPercent = readiness?.required_members ? Math.round((readiness.approved_count / readiness.required_members) * 100) : 100;

  function chooseMonth(value: string) {
    if (!/^\d{4}-\d{2}$/.test(value)) return;
    setSelectedMonth(value);
    setSelectedDate('');
    setMessage('');
  }

  async function withSession() {
    const session = (await getSupabaseClient().auth.getSession()).data.session;
    if (!session) throw new Error('Your session has expired. Please sign in again.');
    return session;
  }

  async function generate(regenerate: boolean) {
    setWorking(true); setError(''); setMessage(''); setConfirmAction(null);
    try {
      const session = await withSession();
      const response = await fetch('/api/schedule', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, year, regenerate }),
      });
      const payload = await response.json() as { services?: unknown[]; error?: string; readiness?: AvailabilityReadiness };
      if (!response.ok) throw new Error(payload.error ?? 'Could not generate the schedule.');
      setMessage(`Generated ${payload.services?.length ?? 0} service lineups for ${monthLabel}.`);
      await loadSchedules();
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : 'Could not generate the schedule.');
    } finally { setWorking(false); }
  }

  async function mockUnavailability() {
    setWorking(true); setError(''); setMessage(''); setConfirmAction(null);
    try {
      const session = await withSession();
      const response = await fetch('/api/schedule/mock-unavailability', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, year }),
      });
      const payload = await response.json() as { added?: number; skipped?: number; error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Could not create mock unavailability.');
      setMessage(`Mock unavailability updated for ${monthLabel}: ${payload.added ?? 0} added, ${payload.skipped ?? 0} skipped.`);
      await loadSchedules();
    } catch (mockError) { setError(mockError instanceof Error ? mockError.message : 'Could not create mock unavailability.'); }
    finally { setWorking(false); }
  }

  async function validate(service: ScheduleItem) {
    setWorking(true); setError(''); setMessage('');
    try {
      const session = await withSession();
      const response = await fetch('/api/validation', {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ service_id: service.id, expected_version: service.schedule_version }),
      });
      const payload = await response.json() as { error?: string; summary?: { warnings: number; suggestions: number } };
      if (!response.ok) throw new Error(payload.error ?? 'Could not validate this schedule.');
      const notes = (payload.summary?.warnings ?? 0) + (payload.summary?.suggestions ?? 0);
      setMessage(notes ? `Schedule validated with ${notes} advisory finding(s).` : 'Schedule validated with no outstanding findings.');
      await loadSchedules();
    } catch (validationError) { setError(validationError instanceof Error ? validationError.message : 'Could not validate this schedule.'); }
    finally { setWorking(false); }
  }

  async function publish(service: ScheduleItem) {
    setWorking(true); setError(''); setMessage(''); setConfirmAction(null);
    try {
      const session = await withSession();
      const response = await fetch(`/api/schedule/${encodeURIComponent(service.id)}/publish`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expected_version: service.schedule_version }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'Could not publish this schedule.');
      setMessage('Schedule published.');
      await loadSchedules();
    } catch (publishError) { setError(publishError instanceof Error ? publishError.message : 'Could not publish this schedule.'); }
    finally { setWorking(false); }
  }

  async function startRevision(service: ScheduleItem) {
    setWorking(true); setError(''); setConfirmAction(null);
    try {
      const session = await withSession();
      const response = await fetch(`/api/schedule/${encodeURIComponent(service.id)}/revision`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expected_version: service.schedule_version }),
      });
      const payload = await response.json() as { service_id?: string; error?: string };
      if (!response.ok || !payload.service_id) throw new Error(payload.error ?? 'Could not start the schedule amendment.');
      setMessage('A draft amendment is ready to edit. The published schedule remains in place until the amendment is published.');
      await loadSchedules();
      setEditingId(payload.service_id);
    } catch (revisionError) { setError(revisionError instanceof Error ? revisionError.message : 'Could not create the amendment.'); }
    finally { setWorking(false); }
  }

  const visibleCards = filteredSchedules.map((service, index) => (
    <ScheduleCard
      key={service.id}
      {...service}
      index={index}
      onEdit={(!monthIsPast || service.revision_of) && ['draft', 'validated'].includes(service.status) && !service.legacy_unscoped ? () => setEditingId(service.id) : undefined}
      onValidate={service.status === 'draft' && !service.legacy_unscoped ? () => void validate(service) : undefined}
      onPublish={service.status === 'validated' && !service.legacy_unscoped ? () => setConfirmAction({ kind: 'publish', service }) : undefined}
      onAmend={service.status === 'published' && !service.legacy_unscoped ? () => setConfirmAction({ kind: 'revision', service }) : undefined}
    />
  ));

  return (
    <div className="mx-auto max-w-[1440px] space-y-7 pb-10">
      <header className="relative overflow-hidden rounded-[1.75rem] border border-border bg-card px-6 py-7 shadow-sm sm:px-9 sm:py-9">
        <div className="pointer-events-none absolute -right-12 -top-24 h-72 w-72 rounded-full border-[36px] border-primary/5" aria-hidden="true" />
        <div className="relative flex flex-col gap-7 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-2xl">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.22em] text-primary">Worship coordination / monthly plan</p>
            <h1 className="font-display text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">The month, in harmony.</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">Review availability, shape each service lineup, and publish only after the current schedule has been validated.</p>
          </div>
          <div className="grid w-full gap-3 sm:grid-cols-2 xl:max-w-xl">
            <label className="space-y-1.5 text-xs font-medium text-muted-foreground" htmlFor="schedule-month">Month and year
              <Input id="schedule-month" aria-label="Choose schedule month" type="month" value={selectedMonth} onChange={(event) => chooseMonth(event.target.value)} className="h-11 bg-background text-foreground" />
            </label>
            <div className="flex items-center gap-2 sm:col-span-2 xl:justify-end">
              <Button type="button" variant="outline" aria-label="Previous month" className="h-11 w-11" onClick={() => chooseMonth(monthString(month === 0 ? year - 1 : year, month === 0 ? 11 : month - 1))}><ChevronLeft className="h-4 w-4" /></Button>
              <Button type="button" variant="outline" aria-label="Next month" className="h-11 w-11" onClick={() => chooseMonth(monthString(month === 11 ? year + 1 : year, month === 11 ? 0 : month + 1))}><ChevronRight className="h-4 w-4" /></Button>
              <Button type="button" variant="outline" className="h-11" onClick={() => chooseMonth(monthString(today.getFullYear(), today.getMonth()))}>Today</Button>
              <Button type="button" variant="outline" className="h-11" disabled={working || loading} onClick={() => setConfirmAction({ kind: 'mock-unavailability' })}>Mock unavailability</Button>
              {schedules.length > 0 ? (
                  <Button type="button" className="h-11" disabled={working || !readiness?.ready || lockedSchedules || hasLegacySchedules} onClick={() => setConfirmAction({ kind: 'regenerate' })}>
                  <Plus className="mr-2 h-4 w-4" />Regenerate drafts
                </Button>
              ) : (
                <Button type="button" className="h-11" disabled={working || !readiness?.ready || monthIsPast} onClick={() => void generate(false)}>
                  <Plus className="mr-2 h-4 w-4" />{working ? 'Generating…' : 'Generate schedule'}
                </Button>
              )}
            </div>
          </div>
        </div>
      </header>

      {error ? <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{error}</p> : null}
      {message ? <p role="status" className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground">{message}</p> : null}

      <section aria-label="Monthly readiness" className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(280px,1fr)]">
        <Card className="overflow-hidden border-primary/15">
          <CardContent className="grid gap-6 p-5 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:p-6">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary"><ShieldCheck className="h-7 w-7" aria-hidden="true" /></div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.15em] text-muted-foreground">Availability checkpoint · {monthLabel}</p>
              <h2 className="mt-1 text-xl font-semibold">{readiness?.ready ? 'Ready to generate' : 'Waiting on the team'}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{readiness ? `${readiness.approved_count} of ${readiness.required_members} required members approved for ${readiness.ministry_name}.` : 'Loading monthly approvals…'}</p>
            </div>
            <div className="min-w-40 text-left sm:text-right">
              <p className="font-display text-3xl font-semibold tabular-nums">{readiness?.approved_count ?? 0}<span className="text-lg text-muted-foreground"> / {readiness?.required_members ?? 0}</span></p>
              <p className="text-xs text-muted-foreground">approved submissions</p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Approved availability submissions" aria-valuemin={0} aria-valuemax={100} aria-valuenow={approvedPercent}>
                <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${approvedPercent}%` }} />
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex h-full items-center gap-4 p-5 sm:p-6">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground"><Users className="h-5 w-5" aria-hidden="true" /></div>
            <div className="min-w-0 flex-1">
              <p className="font-medium">{readiness?.outstanding_count ?? 0} still to review</p>
              <p className="text-sm text-muted-foreground">{readiness?.members.filter((member) => member.status === 'missing').length ?? 0} missing · {readiness?.members.filter((member) => member.status === 'submitted').length ?? 0} awaiting review · {readiness?.members.filter((member) => member.status === 'revision_required').length ?? 0} need revision</p>
            </div>
            <Link href="/availability" className={buttonVariants({ variant: 'outline' })}>Review</Link>
          </CardContent>
        </Card>
      </section>

      {!readiness?.ready && readiness ? (
        <Card className="border-[oklch(0.70_0.08_80)]/35 bg-[oklch(0.70_0.08_80)]/5">
          <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><AlertTriangle className="h-4 w-4 text-[oklch(0.58_0.09_62)]" />Generation is locked until each required member is approved</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {readiness.members.filter((member) => member.status !== 'approved').map((member) => (
              <Badge key={member.id} variant="outline" className="h-auto whitespace-normal py-1.5">{member.full_name} · {member.status === 'missing' ? 'not submitted' : member.status === 'revision_required' ? 'revision needed' : 'awaiting review'}</Badge>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(340px,0.8fr)]">
        <Card className="overflow-hidden">
          <CardHeader className="flex flex-row items-end justify-between gap-4 border-b border-border pb-4">
            <div><p className="text-xs uppercase tracking-[0.16em] text-primary">Service dates</p><CardTitle className="mt-1 font-display text-2xl">{monthLabel}</CardTitle></div>
            <Badge variant="outline" className="gap-1.5"><CalendarDays className="h-3.5 w-3.5" />{schedules.length} {schedules.length === 1 ? 'service' : 'services'}</Badge>
          </CardHeader>
          <CardContent className="p-4 sm:p-6">
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:gap-2">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <div key={day} className="py-2">{day}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1 sm:gap-2">
              {calendarCells.map((day, index) => {
                if (day === null) return <div key={`empty-${index}`} className="min-h-14 rounded-xl bg-muted/20 sm:min-h-20" aria-hidden="true" />;
                const date = `${selectedMonth}-${String(day).padStart(2, '0')}`;
                const service = schedules.find((item) => item.date.startsWith(date));
                const selected = selectedDate === date;
                return (
                  <button key={date} type="button" aria-label={`${monthLabel} ${day}${service ? `, service schedule ${service.status}` : ''}`} aria-pressed={selected} onClick={() => setSelectedDate(date)} className={`relative flex min-h-14 flex-col items-center justify-start rounded-xl border p-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:min-h-20 sm:items-start ${selected ? 'border-primary bg-primary text-primary-foreground' : service ? 'border-primary/20 bg-primary/5 hover:bg-primary/10' : 'border-transparent hover:border-border hover:bg-muted/50'}`}>
                    <span className="font-medium tabular-nums">{day}</span>
                    {service ? <span className={`mt-1 hidden max-w-full truncate rounded-full px-2 py-0.5 text-[10px] capitalize sm:block ${selected ? 'bg-primary-foreground/15' : service.status === 'published' ? 'bg-primary/15 text-primary' : service.status === 'validated' ? 'bg-accent/20 text-foreground' : 'bg-muted text-muted-foreground'}`}>{service.legacy_unscoped ? 'legacy' : service.status}</span> : null}
                    {service ? <span className={`absolute bottom-1 h-1.5 w-1.5 rounded-full sm:hidden ${selected ? 'bg-primary-foreground' : 'bg-primary'}`} /> : null}
                  </button>
                );
              })}
            </div>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 border-t border-border pt-4 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-muted-foreground" />Draft</span>
              <span className="inline-flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-accent" />Validated</span>
              <span className="inline-flex items-center gap-2"><i className="h-2 w-2 rounded-full bg-primary" />Published</span>
              <span className="inline-flex items-center gap-2"><i className="h-2 w-2 rounded-full border border-border bg-background" />No service</span>
            </div>
          </CardContent>
        </Card>

        <Card className="min-h-[420px]">
          <CardHeader className="border-b border-border pb-4">
            <p className="text-xs uppercase tracking-[0.16em] text-primary">Selected Sunday</p>
            <CardTitle className="font-display text-2xl">{selectedService ? new Date(`${selectedService.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : new Date(`${selectedDate}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</CardTitle>
          </CardHeader>
          <CardContent className="p-5">
            {selectedService ? (
              <div className="space-y-5">
                <div className="flex items-center justify-between"><span className="text-sm text-muted-foreground">Service status</span><Badge variant={selectedService.status === 'published' ? 'default' : 'outline'} className="capitalize">{selectedService.legacy_unscoped ? 'Legacy · ministry unknown' : selectedService.status}</Badge></div>
                <div className="rounded-2xl bg-primary/5 p-4">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary">Worship leader</p><p className="mt-1 text-lg font-semibold">{selectedService.leader_name}</p>
                </div>
                <div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Vocal team</p><div className="flex flex-wrap gap-2">{selectedService.backup_singers.length ? selectedService.backup_singers.map((member, index) => <Badge key={`${member.name}-${index}`} variant="secondary" className="h-7 px-3 font-normal">{member.name}</Badge>) : <span className="text-sm text-muted-foreground">No backup singers assigned</span>}</div></div>
                <div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Instruments & service roles</p><div className="space-y-2">{selectedService.instrumentalists.map((player, index) => <div key={`${player.instrument}-${index}`} className="flex justify-between gap-4 border-b border-border/70 pb-2 text-sm"><span className="text-muted-foreground">{player.instrument}</span><span className="font-medium text-right">{player.name}</span></div>)}{selectedService.devotion_name ? <div className="flex justify-between gap-4 text-sm"><span className="text-muted-foreground">Devotion</span><span className="font-medium">{selectedService.devotion_name}</span></div> : null}</div></div>
                {selectedService.legacy_unscoped ? <p className="rounded-xl border border-border bg-muted/40 p-3 text-xs leading-5 text-muted-foreground">This historical schedule has no reliable ministry assignment. It can be reviewed, but editing and regeneration stay locked until its ownership is resolved.</p> : null}
                <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                  {['draft', 'validated'].includes(selectedService.status) && (!monthIsPast || selectedService.revision_of) && !selectedService.legacy_unscoped ? <Button onClick={() => setEditingId(selectedService.id)}>Edit lineup</Button> : null}
                  {selectedService.status === 'draft' && !selectedService.legacy_unscoped ? <Button variant="outline" onClick={() => void validate(selectedService)} disabled={working}><ShieldCheck className="mr-2 h-4 w-4" />Validate</Button> : null}
                  {selectedService.status === 'validated' && !selectedService.legacy_unscoped ? <Button onClick={() => setConfirmAction({ kind: 'publish', service: selectedService })}><Check className="mr-2 h-4 w-4" />Publish</Button> : null}
                  {selectedService.status === 'published' && !selectedService.legacy_unscoped ? <Button variant="outline" onClick={() => setConfirmAction({ kind: 'revision', service: selectedService })}><Clock3 className="mr-2 h-4 w-4" />Create amendment</Button> : null}
                </div>
              </div>
            ) : <div className="flex min-h-64 flex-col items-center justify-center text-center"><CalendarDays className="h-8 w-8 text-muted-foreground/50" aria-hidden="true" /><p className="mt-3 font-medium">No service on this date</p><p className="mt-1 max-w-xs text-sm text-muted-foreground">Choose a marked service date to review the full lineup and schedule status.</p></div>}
          </CardContent>
        </Card>
      </section>

      <section aria-label="Schedule status filters" className="space-y-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">Monthly lineups</p><h2 className="mt-1 font-display text-3xl font-semibold">Every service, at a glance</h2></div>
          <Input aria-label="Search monthly lineups" placeholder="Search assigned members" value={search} onChange={(event) => setSearch(event.target.value)} className="h-10 sm:max-w-xs" />
        </div>
        <Tabs value={statusFilter} onValueChange={setStatusFilter}>
          <TabsList className="grid h-auto w-full grid-cols-4 sm:w-[520px]">
            <TabsTrigger value="all">All <span className="ml-1 text-xs text-muted-foreground">{statusCounts.all}</span></TabsTrigger>
            <TabsTrigger value="draft">Draft <span className="ml-1 text-xs text-muted-foreground">{statusCounts.draft}</span></TabsTrigger>
            <TabsTrigger value="validated">Validated <span className="ml-1 text-xs text-muted-foreground">{statusCounts.validated}</span></TabsTrigger>
            <TabsTrigger value="published">Published <span className="ml-1 text-xs text-muted-foreground">{statusCounts.published}</span></TabsTrigger>
          </TabsList>
        </Tabs>
        {loading ? <p role="status" className="py-12 text-center text-sm text-muted-foreground">Loading {monthLabel} schedules…</p> : null}
        {!loading && filteredSchedules.length ? <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">{visibleCards}</div> : null}
        {!loading && !filteredSchedules.length ? <Card><CardContent className="flex min-h-52 flex-col items-center justify-center text-center"><CalendarDays className="h-8 w-8 text-muted-foreground/50" aria-hidden="true" /><p className="mt-3 font-medium">{schedules.length ? 'No lineups match this view' : `No schedule for ${monthLabel}`}</p><p className="mt-1 text-sm text-muted-foreground">{schedules.length ? 'Choose another status or search term.' : readiness?.ready ? 'Generate the month when you are ready to build the lineup.' : 'Review the missing availability submissions above to unlock generation.'}</p></CardContent></Card> : null}
      </section>

      <ScheduleLineupEditor
        open={Boolean(editingService)}
        onOpenChange={(open) => { if (!open) setEditingId(''); }}
        serviceId={editingService?.id ?? ''}
        scheduleVersion={editingService?.schedule_version ?? 1}
        assignments={editingService?.assignments ?? []}
        members={members}
        roles={roles}
        instruments={instruments}
        onSaved={() => { setEditingId(''); setMessage('Lineup saved as a draft. Any prior validation was cleared, so validate this version before publishing.'); void loadSchedules(); }}
      />

      <Dialog open={Boolean(confirmAction)} onOpenChange={(open) => { if (!open) setConfirmAction(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmAction?.kind === 'mock-unavailability' ? 'Replace mock unavailability for this month?' : confirmAction?.kind === 'regenerate' ? 'Replace this month’s draft lineups?' : confirmAction?.kind === 'revision' ? 'Create a schedule amendment?' : 'Publish this validated schedule?'}</DialogTitle>
            <DialogDescription>
              {confirmAction?.kind === 'mock-unavailability' ? `This replaces existing mock unavailability rows for ${monthLabel}. Real member availability records are not changed.` : confirmAction?.kind === 'regenerate' ? 'Existing draft services for this ministry and month will be replaced as one transaction. Validated and published services are protected.' : confirmAction?.kind === 'revision' ? 'A separate draft will be created from the published lineup. The published schedule stays visible until the amendment is validated and published.' : 'The lineup will become visible to members. Publication is recorded with your coordinator account and timestamp.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)}>Cancel</Button>
            {confirmAction?.kind === 'mock-unavailability' ? <Button onClick={() => void mockUnavailability()} disabled={working}>Replace mock rows</Button> : null}
            {confirmAction?.kind === 'regenerate' ? <Button onClick={() => void generate(true)} disabled={working}>Replace draft lineups</Button> : null}
            {confirmAction?.kind === 'revision' ? <Button onClick={() => void startRevision(confirmAction.service)} disabled={working}>Create amendment</Button> : null}
            {confirmAction?.kind === 'publish' ? <Button onClick={() => void publish(confirmAction.service)} disabled={working}>Publish schedule</Button> : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
