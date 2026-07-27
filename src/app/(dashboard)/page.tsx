'use client';

import { StatsCards } from '@/components/dashboard/stats-cards';
import { UpcomingServices } from '@/components/dashboard/upcoming-services';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Plus, RefreshCw } from 'lucide-react';

const mockUpcomingServices = [
  {
    id: '1',
    date: '2026-08-03',
    week_number: 1,
    leader_name: 'Heidi',
    backup_count: 3,
    status: 'published' as const,
  },
  {
    id: '2',
    date: '2026-08-10',
    week_number: 2,
    leader_name: 'Feng',
    backup_count: 3,
    status: 'validated' as const,
  },
  {
    id: '3',
    date: '2026-08-17',
    week_number: 3,
    leader_name: 'Shael',
    backup_count: 2,
    status: 'draft' as const,
  },
  {
    id: '4',
    date: '2026-08-24',
    week_number: 4,
    leader_name: 'Marlyn',
    backup_count: 3,
    status: 'draft' as const,
  },
];

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Dashboard</h2>
          <p className="text-muted-foreground">Overview of your worship ministry</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
          <Button size="sm">
            <Plus className="h-4 w-4 mr-1" />
            New Schedule
          </Button>
        </div>
      </div>

      <StatsCards
        totalMembers={18}
        upcomingServices={4}
        pendingConflicts={2}
        completedSchedules={12}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <UpcomingServices services={mockUpcomingServices} />

        <Card className="card-glow">
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-0">
              {[
                { action: 'Schedule published', time: '2 hours ago', user: 'Admin' },
                { action: 'Member availability updated', time: '5 hours ago', user: 'Heidi' },
                { action: 'Conflict resolved', time: '1 day ago', user: 'Admin' },
                { action: 'New member added', time: '2 days ago', user: 'Admin' },
              ].map((activity, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between py-3 border-b border-border last:border-0"
                >
                  <div>
                    <div className="text-sm font-medium text-foreground">{activity.action}</div>
                    <div className="text-xs text-muted-foreground">{activity.user}</div>
                  </div>
                  <div className="text-xs text-muted-foreground">{activity.time}</div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
