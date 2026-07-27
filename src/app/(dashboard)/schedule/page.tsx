'use client';

import { useState } from 'react';
import { ScheduleCard } from '@/components/schedule/schedule-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Search, Filter, Calendar } from 'lucide-react';

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
      { instrument: 'Bass', name: 'Matt' },
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
      { instrument: 'Bass', name: 'Caleb O.' },
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
    devotion_name: 'Caleb M.',
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
      { instrument: 'Bass', name: 'Matt' },
    ],
    devotion_name: 'Marlyn',
    status: 'draft' as const,
    conflict_count: 2,
  },
];

export default function SchedulePage() {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('all');

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
        <Button>
          <Plus className="h-4 w-4 mr-1" />
          Generate Schedule
        </Button>
      </div>

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
            {filteredSchedules.map((schedule) => (
              <ScheduleCard
                key={schedule.id}
                {...schedule}
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
