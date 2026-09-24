'use client';
import { useCallback, useEffect, useState } from 'react';
import { ScheduleCard } from '@/components/schedule/schedule-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Search, Filter, Calendar, CalendarOff } from 'lucide-react';
import { getSupabaseClient } from '@/lib/supabase/client';

type ScheduleCardData = { id: string; date: string; week_number: number; leader_name: string; leader_avatar?: string; backup_singers: { name: string; avatar?: string }[]; instrumentalists: { instrument: string; name: string }[]; devotion_name?: string; status: 'draft' | 'validated' | 'published'; conflict_count: number };

export default function SchedulePage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const [schedules, setSchedules] = useState<ScheduleCardData[]>([]);
  const month = new Date().getMonth();
  const year = new Date().getFullYear();

  const loadSchedules = useCallback(async () => {
    const session = (await getSupabaseClient().auth.getSession()).data.session;
    if (!session) throw new Error('Your session has expired. Please sign in again.');
    const response = await fetch('/api/schedule?month=' + month + '&year=' + year, { headers: { Authorization: 'Bearer ' + session.access_token } });
    const payload = await response.json() as { services?: ScheduleCardData[]; error?: string };
    if (!response.ok) throw new Error(payload.error ?? 'Could not load schedules.');
    setSchedules(payload.services ?? []);
  }, [month, year]);
  useEffect(() => { const timer = window.setTimeout(() => { loadSchedules().catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : 'Could not load schedules.')); }, 0); return () => window.clearTimeout(timer); }, [loadSchedules]);

  const handleGenerate = async () => {
    setLoading(true); setResult(''); setError('');
    try {
      const session = (await getSupabaseClient().auth.getSession()).data.session;
      if (!session) throw new Error('Your session has expired. Please sign in again.');
      const response = await fetch('/api/schedule', { method: 'POST', headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify({ month, year }) });
      const payload = await response.json() as { services?: unknown[]; error?: string; failures?: { message: string }[] };
      if (!response.ok) throw new Error(payload.error ?? payload.failures?.map((failure) => failure.message).join(' ') ?? 'Could not generate schedule.');
      setResult('Generated ' + (payload.services?.length ?? 0) + ' service schedules.');
      await loadSchedules();
    } catch (generateError: unknown) { setError(generateError instanceof Error ? generateError.message : 'Could not generate schedule.'); }
    finally { setLoading(false); }
  };
  const handleMockUnavailability = async () => {
    setLoading(true); setResult(''); setError('');
    try {
      const session = (await getSupabaseClient().auth.getSession()).data.session;
      if (!session) throw new Error('Your session has expired. Please sign in again.');
      const response = await fetch('/api/schedule/mock-unavailability', { method: 'POST', headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify({ month: 9, year: 2026 }) });
      const payload = await response.json() as { success?: boolean; error?: string; added?: number; skipped?: number };
      if (!response.ok || !payload.success) throw new Error(payload.error ?? 'Could not add mock unavailability.');
      setResult('Added ' + (payload.added ?? 0) + ' mock unavailability records (skipped ' + (payload.skipped ?? 0) + ').');
    } catch (mockError: unknown) { setError(mockError instanceof Error ? mockError.message : 'Could not add mock unavailability.'); }
    finally { setLoading(false); }
  };
  const filteredSchedules = schedules.filter((schedule) => {
    const query = searchQuery.toLowerCase();
    return (activeTab === 'all' || schedule.status === activeTab) && (schedule.leader_name.toLowerCase().includes(query) || schedule.backup_singers.some((singer) => singer.name.toLowerCase().includes(query)));
  });
  return <div className="space-y-6">
    <div className="flex items-center justify-between"><div><h2 className="text-2xl font-bold text-foreground">Schedule</h2><p className="text-muted-foreground">Manage worship service schedules</p></div><div className="flex items-center gap-2"><Button variant="outline" onClick={handleMockUnavailability} disabled={loading}><CalendarOff className="h-4 w-4 mr-1" />Mock Unavailability</Button><Button onClick={handleGenerate} disabled={loading}><Plus className="h-4 w-4 mr-1" />{loading ? 'Working...' : 'Generate Schedule'}</Button></div></div>
    {result ? <p role="status" className="text-sm text-muted-foreground">{result}</p> : null}{error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <div className="flex items-center gap-3"><div className="relative flex-1 max-w-md"><Search className="absolute left-3 top-1/2 h-4 w-4 text-muted-foreground" /><Input placeholder="Search schedules..." value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} className="pl-10 bg-secondary/50" /></div><Button variant="outline"><Filter className="h-4 w-4 mr-1" />Filter</Button><Button variant="outline"><Calendar className="h-4 w-4 mr-1" />{new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</Button></div>
    <Tabs value={activeTab} onValueChange={setActiveTab}><TabsList><TabsTrigger value="all">All</TabsTrigger><TabsTrigger value="draft">Draft</TabsTrigger><TabsTrigger value="validated">Validated</TabsTrigger><TabsTrigger value="published">Published</TabsTrigger></TabsList><TabsContent value={activeTab} className="mt-6"><div className="grid gap-6 md:grid-cols-2">{filteredSchedules.map((schedule, index) => <ScheduleCard key={schedule.id} {...schedule} index={index} />)}</div>{filteredSchedules.length === 0 ? <p className="py-12 text-center text-muted-foreground">No schedules for this month.</p> : null}</TabsContent></Tabs>
  </div>;
}
