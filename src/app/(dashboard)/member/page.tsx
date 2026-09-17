'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { X } from 'lucide-react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { Availability } from '@/lib/types/database';
import { getAvailableWeeks, getWeekDateRange } from '@/lib/utils/date-utils';

type MemberInfo = { id: string; full_name: string; role: string; phone?: string | null };

const getStatusClass = (status: string) => {
  switch (status) {
    case 'approved':
      return 'bg-primary/15 text-primary';
    case 'rejected':
      return 'bg-destructive/15 text-destructive';
    default:
      return 'bg-[oklch(0.70_0.08_80)]/15 text-[oklch(0.70_0.08_80)]';
  }
};

const getMonthName = (month: number) =>
  new Date(2024, month, 1).toLocaleString('en-US', { month: 'long' });

const formatWeekRange = (weekNumber: number, month: number, year: number) => {
  const range = getWeekDateRange(weekNumber, month, year);
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(range.start)} - ${fmt(range.end)}`;
};

const getRequestLabel = (request: Availability) => {
  if (request.type !== 'weekly') return request.type;
  if (request.month === undefined || request.year === undefined) return `Week ${request.week_number} - weekly`;
  return `Week ${request.week_number} · ${getMonthName(request.month)} ${request.year} - weekly`;
};

export default function MemberPage() {
  const router = useRouter();
  const [member, setMember] = useState<MemberInfo | null>(null);
  const [currentMonth] = useState(() => new Date().getMonth());
  const [year] = useState(() => new Date().getFullYear());
  const monthOptions = Array.from({ length: 12 - currentMonth }, (_, i) => currentMonth + i);
  const [month, setMonth] = useState(() => String(currentMonth));
  const availableWeeks = getAvailableWeeks(Number(month), year);
  const [week, setWeek] = useState(() => String(getAvailableWeeks(currentMonth, year)[0] ?? 1));
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [requests, setRequests] = useState<Availability[]>([]);

  useEffect(() => {
    const token = getSupabaseClient().auth.getSession().then(async ({ data }) => {
      if (!data.session) return router.replace('/login');
      const response = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${data.session.access_token}` } });
      if (!response.ok) return router.replace('/dashboard');
      const result = await response.json() as { user: { member_id: string | null; role: string; member_name?: string | null; phone?: string | null } };
      if (result.user.role !== 'member' || !result.user.member_id) return router.replace('/dashboard');
      setMember({ id: result.user.member_id, full_name: result.user.member_name ?? 'Your profile', role: result.user.role, phone: result.user.phone });
    });
    return () => { void token; };
  }, [router]);

  const loadRequests = useCallback(async () => {
    const session = (await getSupabaseClient().auth.getSession()).data.session;
    if (!session) return;
    const response = await fetch('/api/availability', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!response.ok) {
      setError('Could not load your availability requests.');
      return;
    }
    const result = await response.json() as { availabilities: Availability[] };
    setRequests(result.availabilities);
  }, []);

  useEffect(() => {
    if (!member) return;
    const refresh = async () => {
      await loadRequests();
    };
    void refresh();
  }, [member, loadRequests]);

  useEffect(() => {
    if (!member) return;
    const supabase = getSupabaseClient();
    const channel = supabase
      .channel(`member-availability-changes-${member.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'availability',
          filter: `member_id=eq.${member.id}`,
        },
        () => {
          void loadRequests();
        }
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [member, loadRequests]);

  function handleMonthChange(value: string | null) {
    if (!value) return;
    setMonth(value);
    setWeek(String(getAvailableWeeks(Number(value), year)[0] ?? 1));
    setMessage('');
    setError('');
  }

  async function submitAvailability() {
    setError('');
    setMessage('');
    const session = (await getSupabaseClient().auth.getSession()).data.session;
    if (!session || !member) return;
    const response = await fetch('/api/availability', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ type: 'weekly', week_number: Number(week), month: Number(month), year }),
    });
    if (response.ok) {
      setMessage('Availability request submitted.');
      void loadRequests();
    } else {
      const result = await response.json().catch(() => null) as { error?: string } | null;
      setError(result?.error ?? 'We could not save that request.');
    }
  }

  async function cancelRequest(id: string) {
    setError('');
    const session = (await getSupabaseClient().auth.getSession()).data.session;
    if (!session) return;
    const response = await fetch(`/api/availability?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (response.ok) {
      setRequests((current) => current.filter((request) => request.id !== id));
    } else {
      setError('Could not cancel that request.');
    }
  }

  if (!member) return null;
  return (
    <div className="max-w-3xl space-y-6">
      <div><h1 className="text-2xl font-semibold">My workspace</h1><p className="text-muted-foreground">Only your profile and availability are visible here.</p></div>
      <Card><CardHeader><CardTitle>My profile</CardTitle></CardHeader><CardContent><p className="font-medium">{member.full_name}</p><p className="text-sm text-muted-foreground">Worship team member</p></CardContent></Card>
      <Card className="relative">
        <span className="absolute right-6 top-6 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
          Year {year}
        </span>
        <CardHeader><CardTitle>New unavailability request</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="month">Month</Label>
              <Select value={month} onValueChange={handleMonthChange}>
                <SelectTrigger id="month" className="w-full">
                  <SelectValue placeholder="Select month">{getMonthName(Number(month))}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {monthOptions.map((monthNumber) => (
                    <SelectItem key={monthNumber} value={String(monthNumber)}>
                      {getMonthName(monthNumber)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="week">Unavailable week</Label>
              {availableWeeks.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  All weeks in this month have already passed.
                </p>
              ) : (
                <Select value={week} onValueChange={(value) => value && setWeek(value)}>
                  <SelectTrigger id="week" className="w-full">
                    <SelectValue placeholder="Select week">
                      {`WEEK ${week} ${formatWeekRange(Number(week), Number(month), year)}`}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {availableWeeks.map((weekNumber) => (
                      <SelectItem key={weekNumber} value={String(weekNumber)}>
                        {`WEEK ${weekNumber} ${formatWeekRange(weekNumber, Number(month), year)}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
          <Button onClick={submitAvailability} disabled={availableWeeks.length === 0}>Submit request</Button>
          {message ? <p role="status" className="text-sm text-muted-foreground">{message}</p> : null}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>My requests</CardTitle></CardHeader>
        <CardContent>
          {requests.length === 0 ? (
            <p className="text-sm text-muted-foreground">You have not submitted any unavailability requests.</p>
          ) : (
            <div className="space-y-2">
              {requests.map((request) => (
                <div key={request.id} className="flex items-center justify-between rounded-lg border border-border p-4">
                  <div>
                    <div className="font-medium text-foreground">{getRequestLabel(request)}</div>
                    <div className="text-sm text-muted-foreground">{new Date(request.created_at).toLocaleDateString()}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${getStatusClass(request.status)}`}>{request.status}</span>
                    {request.status === 'pending' ? (
                      <Button variant="ghost" size="sm" onClick={() => cancelRequest(request.id)}>
                        <X className="h-4 w-4 mr-1" />
                        Cancel
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}