'use client';

import { WorkloadChart } from '@/components/analytics/workload-chart';
import { FairnessScore } from '@/components/analytics/fairness-score';
import { AvailabilityHeatmap } from '@/components/analytics/availability-heatmap';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RefreshCw, Calendar } from 'lucide-react';

const mockWorkloadData = [
  { member_id: '1', member_name: 'Simone', assignments: 4, percentage: 100 },
  { member_id: '2', member_name: 'Zedrick', assignments: 3, percentage: 75 },
  { member_id: '3', member_name: 'Kass', assignments: 3, percentage: 75 },
  { member_id: '4', member_name: 'Heidi', assignments: 2, percentage: 50 },
  { member_id: '5', member_name: 'Feng', assignments: 2, percentage: 50 },
  { member_id: '6', member_name: 'Beng', assignments: 2, percentage: 50 },
  { member_id: '7', member_name: 'Chelzy', assignments: 1, percentage: 25 },
  { member_id: '8', member_name: 'Maricar', assignments: 1, percentage: 25 },
];

const mockFairnessReports = [
  { member_id: '1', member_name: 'Simone', assignment_count: 4, max_allowed: 4, utilization: 100, fairness_score: 85, status: 'overutilized' as const },
  { member_id: '2', member_name: 'Zedrick', assignment_count: 3, max_allowed: 3, utilization: 100, fairness_score: 75, status: 'balanced' as const },
  { member_id: '3', member_name: 'Kass', assignment_count: 3, max_allowed: 3, utilization: 100, fairness_score: 75, status: 'balanced' as const },
  { member_id: '4', member_name: 'Heidi', assignment_count: 2, max_allowed: 3, utilization: 67, fairness_score: 60, status: 'balanced' as const },
  { member_id: '5', member_name: 'Feng', assignment_count: 2, max_allowed: 3, utilization: 67, fairness_score: 60, status: 'balanced' as const },
  { member_id: '6', member_name: 'Beng', assignment_count: 2, max_allowed: 3, utilization: 67, fairness_score: 60, status: 'balanced' as const },
  { member_id: '7', member_name: 'Chelzy', assignment_count: 1, max_allowed: 3, utilization: 33, fairness_score: 40, status: 'underutilized' as const },
  { member_id: '8', member_name: 'Maricar', assignment_count: 1, max_allowed: 3, utilization: 33, fairness_score: 40, status: 'underutilized' as const },
];

const mockHeatmapData = [
  { week_number: 1, unavailable_count: 3, unavailable_members: ['Shael', 'Sam', 'Pia'] },
  { week_number: 2, unavailable_count: 2, unavailable_members: ['Heidi', 'Beng'] },
  { week_number: 3, unavailable_count: 1, unavailable_members: ['Feng'] },
  { week_number: 4, unavailable_count: 4, unavailable_members: ['Shael', 'Marlyn', 'Sam', 'Matt'] },
];

export default function AnalyticsPage() {
  const overallFairness = 72;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Analytics</h2>
          <p className="text-muted-foreground">Insights and metrics for your ministry</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm">
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
          <Button variant="outline" size="sm">
            <Calendar className="h-4 w-4 mr-1" />
            August 2026
          </Button>
        </div>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="workload">Workload</TabsTrigger>
          <TabsTrigger value="availability">Availability</TabsTrigger>
          <TabsTrigger value="fairness">Fairness</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6 space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            <WorkloadChart data={mockWorkloadData} />
            <FairnessScore overallScore={overallFairness} reports={mockFairnessReports} />
          </div>
          <AvailabilityHeatmap
            data={mockHeatmapData}
            month={new Date().getMonth()}
            year={new Date().getFullYear()}
          />
        </TabsContent>

        <TabsContent value="workload" className="mt-6">
          <WorkloadChart data={mockWorkloadData} />
        </TabsContent>

        <TabsContent value="availability" className="mt-6">
          <AvailabilityHeatmap
            data={mockHeatmapData}
            month={new Date().getMonth()}
            year={new Date().getFullYear()}
          />
        </TabsContent>

        <TabsContent value="fairness" className="mt-6">
          <FairnessScore overallScore={overallFairness} reports={mockFairnessReports} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
