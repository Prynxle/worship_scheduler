'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { BarChart3 } from 'lucide-react';
import { WorkloadEntry } from '@/lib/types/scheduling';

interface WorkloadChartProps {
  data: WorkloadEntry[];
}

export function WorkloadChart({ data }: WorkloadChartProps) {
  const chartData = data.map((entry) => ({
    name: entry.member_name.split(' ')[0],
    assignments: entry.assignments,
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
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 8%)" />
              <XAxis dataKey="name" tick={{ fill: 'oklch(0.55 0 0)', fontSize: 12 }} />
              <YAxis tick={{ fill: 'oklch(0.55 0 0)', fontSize: 12 }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'oklch(0.17 0.015 260)',
                  border: '1px solid oklch(1 0 0 / 10%)',
                  borderRadius: '8px',
                  color: 'oklch(0.93 0 0)',
                }}
                formatter={(value, name) => [String(value), name === 'assignments' ? 'Assignments' : 'Percentage']}
              />
              <Bar dataKey="assignments" fill="oklch(0.78 0.14 85)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  );
}
