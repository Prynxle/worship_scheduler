'use client';

import { useState } from 'react';
import { ScheduleCard } from '@/components/schedule/schedule-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Search, Filter, Calendar, CalendarOff } from 'lucide-react';
import { getSupabaseClient } from '@/lib/supabase/client';

const mockSchedules = [
  {
    id: '1',
    date: '2026-08-03',
    week_number: 1,
    leader_name: 'Heidi',
    backup_singers: [
      { name: 'Beng' },
      { name: 'Chelzy' },
      { name: 'Maricar' },
    ],
    instrumentalists: [
      { instrument: 'Piano', name: 'Kass' },
      { instrument: 'Guitar 1', name: 'Zedrick' },
      { instrument: 'Drums', name: 'Simone' },
      { instrument: 'Bass', name: 'Mat' },
    ],
    devotion_name: 'Simone',
    status: 'published' as const,
    conflict_count: 0,
  },
  {
    id: '2',
    date: '2026-08-10',
    week_number: 2,
    leader_name: 'Feng',
    backup_singers: [
      { name: 'Heidi' },
      { name: 'Beng' },
      { name: 'Shael' },
    ],
    instrumentalists: [
      { instrument: 'Piano', name: 'Chelzy' },
      { instrument: 'Guitar 1', name: 'Ivan' },
      { instrument: 'Guitar 2', name: 'Kai' },
      { instrument: 'Drums', name: 'Simone' },
      { instrument: 'Bass', name: 'Caleb' },
    ],
    devotion_name: 'Kass',
    status: 'validated' as const,
    conflict_count: 1,
  },
  {
    id: '3',
    date: '2026-08-17',
    week_number: 3,
    leader_name: 'Shael',
    backup_singers: [
      { name: 'Princess' },
      { name: 'Maricar' },
      { name: 'Feng' },
    ],
    instrumentalists: [
      { instrument: 'Piano', name: 'Kass' },
      { instrument: 'Guitar 1', name: 'Pia' },
      { instrument: 'Guitar 2', name: 'Kai' },
      { instrument: 'Drums', name: 'Simone' },
      { instrument: 'Bass', name: 'Dhon' },
    ],
    devotion_name: 'Caleb',
    status: 'draft' as const,
    conflict_count: 0,
  },
  {
    id: '4',
    date: '2026-08-24',
    week_number: 4,
    leader_name: 'Marlyn',
    backup_singers: [
      { name: 'Heidi' },
      { name: 'Beng' },
      { name: 'Chelzy' },
    ],
    instrumentalists: [
      { instrument: 'Piano', name: 'Kass' },
      { instrument: 'Guitar 1', name: 'Zedrick' },
      { instrument: 'Guitar 2', name: 'Pia' },
      { instrument: 'Drums', name: 'Simone' },
      { instrument: 'Bass', name: 'Mat' },
    ],
    devotion_name: 'Marlyn',
    status: 'draft' as const,
    conflict_count: 2,
  },
];

export default function SchedulePage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');

  const handleMockUnavailability = async () => {
    setLoading(true);
    setResult('');
    setError('');
    try {
      const session = (await getSupabaseClient().auth.getSession()).data.session;
      if (!session) {
        setError('Your session has expired. Please sign in again.');
        return;
      }
      const response = await fetch('/api/schedule/mock-unavailability', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ month: 9, year: 2026 }),
      });
      if (response.status === 401 || response.status === 403) {
        setError('You do not have permission to add mock unavailability.');
        return;
      }
      const payload = (await response.json()) as {
        success?: boolean;
        error?: string;
        added?: number;
        skipped?: number;
      };
      if (!response.ok || !payload.success) {
        setError(payload.error ?? 'Could not add mock unavailability.');
        return;
      }
      setResult(
        `Added ${payload.added ?? 0} mock unavailability records for October 2026 (skipped ${payload.skipped ?? 0}).`
      );
    } catch {
      setError('Could not add mock unavailability.');
    } finally {
      setLoading(false);
    }
  };

  const filteredSchedules = mockSchedules.filter((schedule) => {
    const matchesSearch =
      schedule.leader_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      schedule.backup_singers.some((s) =>
        s.name.toLowerCase().includes(searchQuery.toLowerCase())
      );

    if (activeTab === 'all') return matchesSearch;
    return matchesSearch && schedule.status === activeTab;
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Schedule</h2>
          <p className="text-muted-foreground">Manage worship service schedules</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleMockUnavailability} disabled={loading}>
            <CalendarOff className="h-4 w-4 mr-1" />
            Mock Unavailability
          </Button>
          <Button>
            <Plus className="h-4 w-4 mr-1" />
            Generate Schedule
          </Button>
        </div>
      </div>

      {result ? <p role="status" className="text-sm text-muted-foreground">{result}</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search schedules..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 bg-secondary/50"
          />
        </div>
        <Button variant="outline">
          <Filter className="h-4 w-4 mr-1" />
          Filter
        </Button>
        <Button variant="outline">
          <Calendar className="h-4 w-4 mr-1" />
          August 2026
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="draft">Draft</TabsTrigger>
          <TabsTrigger value="validated">Validated</TabsTrigger>
          <TabsTrigger value="published">Published</TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-6">
          <div className="grid gap-6 md:grid-cols-2">
            {filteredSchedules.map((schedule, i) => (
              <ScheduleCard
                key={schedule.id}
                {...schedule}
                index={i}
                onEdit={() => console.log('Edit', schedule.id)}
                onView={() => console.log('View', schedule.id)}
                onValidate={() => console.log('Validate', schedule.id)}
                onPublish={() => console.log('Publish', schedule.id)}
              />
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
