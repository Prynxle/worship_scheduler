'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

export interface WorkloadChartDatum {
  name: string;
  fullName: string;
  assignments: number;
  max_allowed: number;
  percentage: number;
}

/** Lazy chunk: this is the only analytics module that imports Recharts. */
export function WorkloadChartCanvas({ data }: { data: WorkloadChartDatum[] }) {
  return (
    <div className="h-[300px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="oklch(1 0 0 / 8%)" />
          <XAxis dataKey="name" tick={{ fill: 'oklch(0.55 0 0)', fontSize: 12 }} />
          <YAxis allowDecimals={false} tick={{ fill: 'oklch(0.55 0 0)', fontSize: 12 }} />
          <Tooltip
            contentStyle={{
              backgroundColor: 'oklch(0.17 0.015 260)',
              border: '1px solid oklch(1 0 0 / 10%)',
              borderRadius: '8px',
              color: 'oklch(0.93 0 0)',
            }}
            formatter={(value, name) => [
              String(value),
              name === 'assignments' ? 'Assignments' : 'Monthly limit',
            ]}
            labelFormatter={(_, payload) => payload?.[0]?.payload?.fullName ?? ''}
          />
          <Legend
            formatter={(value) => (value === 'assignments' ? 'Assignments' : 'Monthly limit')}
            wrapperStyle={{ fontSize: 12 }}
          />
          <Bar dataKey="assignments" fill="oklch(0.78 0.14 85)" radius={[4, 4, 0, 0]} />
          <Bar
            dataKey="max_allowed"
            fill="oklch(1 0 0 / 18%)"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
