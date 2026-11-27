'use client';

import dynamic from 'next/dynamic';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart3 } from 'lucide-react';
import type { WorkloadEntry } from '@/lib/types/scheduling';
import { WorkloadChartSkeleton } from '@/components/analytics/workload-chart-skeleton';

const WorkloadChartCanvas = dynamic(
  () => import('@/components/analytics/workload-chart-canvas').then((module) => module.WorkloadChartCanvas),
  { ssr: false, loading: () => <WorkloadChartSkeleton /> },
);

interface WorkloadChartProps {
  data: WorkloadEntry[];
}

export function WorkloadChart({ data }: WorkloadChartProps) {
  const chartData = data.map((entry) => ({
    name: entry.member_name.split(' ')[0],
    fullName: entry.member_name,
    assignments: entry.assignments,
    max_allowed: entry.max_allowed,
    percentage: entry.percentage,
  }));

  return (
    <Card className="card-glow">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          Workload Distribution
        </CardTitle>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No assignments to chart for this month.
          </p>
        ) : (
          <WorkloadChartCanvas data={chartData} />
        )}
      </CardContent>
    </Card>
  );
}
