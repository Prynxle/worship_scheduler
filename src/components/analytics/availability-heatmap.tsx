'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Grid } from 'lucide-react';
import { AvailabilityHeatmapEntry } from '@/lib/types/scheduling';

interface AvailabilityHeatmapProps {
  data: AvailabilityHeatmapEntry[];
  month: number;
  year: number;
}

export function AvailabilityHeatmap({ data, month, year }: AvailabilityHeatmapProps) {
  const monthName = new Date(year, month).toLocaleString('default', {
    month: 'long',
  });

  const getIntensity = (count: number, max: number) => {
    const ratio = count / max;
    if (ratio >= 0.7) return 'bg-destructive/15 text-destructive';
    if (ratio >= 0.4) return 'bg-[oklch(0.70_0.08_80)]/15 text-[oklch(0.70_0.08_80)]';
    if (ratio > 0) return 'bg-primary/10 text-primary';
    return 'bg-secondary text-muted-foreground';
  };

  const maxUnavailable = Math.max(...data.map((d) => d.unavailable_count), 1);

  return (
    <Card className="card-glow">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Grid className="h-5 w-5 text-primary" />
          Availability Heatmap - {monthName} {year}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="grid grid-cols-5 gap-2">
            {data.map((entry) => (
              <div
                key={entry.week_number}
                className={`rounded-lg p-4 text-center ${getIntensity(
                  entry.unavailable_count,
                  maxUnavailable
                )}`}
              >
                <div className="text-sm font-medium">Week {entry.week_number}</div>
                <div className="text-2xl font-bold mt-1">{entry.unavailable_count}</div>
                <div className="text-xs opacity-70">unavailable</div>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-center gap-4 text-sm">
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 rounded bg-secondary" />
              <span className="text-muted-foreground">None</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 rounded bg-primary/10" />
              <span className="text-muted-foreground">Low</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 rounded bg-[oklch(0.70_0.08_80)]/15" />
              <span className="text-muted-foreground">Medium</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 rounded bg-destructive/15" />
              <span className="text-muted-foreground">High</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
