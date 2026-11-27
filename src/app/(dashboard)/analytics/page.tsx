'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Calendar, RefreshCw } from 'lucide-react';
import { WorkloadChart } from '@/components/analytics/workload-chart';
import { FairnessScore } from '@/components/analytics/fairness-score';
import { AvailabilityHeatmap } from '@/components/analytics/availability-heatmap';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/loading-skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getSupabaseClient } from '@/lib/supabase/client';
import type { AnalyticsReport } from '@/lib/types/analytics';

function monthLabel(month: number, year: number): string {
  return new Date(year, month, 1).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
  });
}

function monthValue(month: number, year: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

type FetchResult =
  | { report: AnalyticsReport; error?: undefined }
  | { report?: undefined; error: string };

export default function AnalyticsPage() {
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<{ month: number; year: number } | null>(null);

  const loadReport = useCallback(async (month?: number, year?: number): Promise<FetchResult> => {
    try {
      const session = (await getSupabaseClient().auth.getSession()).data.session;
      if (!session) {
        return { error: 'Your session has expired. Please sign in again.' };
      }

      const params =
        month !== undefined && year !== undefined ? `?month=${month}&year=${year}` : '';
      const response = await fetch(`/api/analytics${params}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (response.status === 403) {
        return { error: 'Analytics are available to coordinators and admins only.' };
      }
      if (!response.ok) {
        return { error: 'Could not load analytics for this church.' };
      }

      return { report: (await response.json()) as AnalyticsReport };
    } catch {
      return { error: 'Could not load analytics for this church.' };
    }
  }, []);

  const applyResult = useCallback((result: FetchResult) => {
    if (!result.report) {
      setError(result.error);
      return;
    }
    setError('');
    setReport(result.report);
    setSelected({ month: result.report.month, year: result.report.year });
  }, []);

  const fetchReport = useCallback(
    async (month?: number, year?: number) => {
      setLoading(true);
      setError('');
      applyResult(await loadReport(month, year));
      setLoading(false);
    },
    [applyResult, loadReport]
  );

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const result = await loadReport();
      if (cancelled) return;
      applyResult(result);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [applyResult, loadReport]);

  const monthOptions = useMemo(() => {
    if (!report) return [];
    const months = report.months.some(
      (item) => item.month === report.month && item.year === report.year
    )
      ? report.months
      : [{ month: report.month, year: report.year }, ...report.months];
    return months;
  }, [report]);

  const selectedValue = selected ? monthValue(selected.month, selected.year) : undefined;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Analytics</h2>
          <p className="text-muted-foreground">Fairness and workload for your church</p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchReport(selected?.month, selected?.year)}
            disabled={loading}
          >
            <RefreshCw className={`mr-1 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Select
            value={selectedValue}
            onValueChange={(value) => {
              if (!value) return;
              const [year, month] = value.split('-').map(Number);
              if (Number.isInteger(month) && Number.isInteger(year)) {
                void fetchReport(month, year);
              }
            }}
            disabled={loading || monthOptions.length === 0}
          >
            <SelectTrigger className="w-[190px]" aria-label="Choose analytics month">
              <Calendar className="h-4 w-4" />
              <SelectValue placeholder="Choose month">
                {selected ? monthLabel(selected.month, selected.year) : 'Choose month'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {monthOptions.map((item) => (
                <SelectItem key={monthValue(item.month, item.year)} value={monthValue(item.month, item.year)}>
                  {monthLabel(item.month, item.year)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {loading && !report ? (
        <AnalyticsLoading />
      ) : error ? (
        <Card className="card-glow">
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <AlertTriangle className="h-6 w-6 text-destructive" />
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" size="sm" onClick={() => void fetchReport(selected?.month, selected?.year)}>
              Try again
            </Button>
          </CardContent>
        </Card>
      ) : report ? (
        <>
          {report.assignment_count === 0 && (
            <Card className="card-glow">
              <CardContent className="py-5 text-sm text-muted-foreground">
                No assignments in {monthLabel(report.month, report.year)}. Generate or edit a
                schedule to see workload and fairness metrics.
              </CardContent>
            </Card>
          )}

          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="workload">Workload</TabsTrigger>
              <TabsTrigger value="availability">Availability</TabsTrigger>
              <TabsTrigger value="fairness">Fairness</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-6 space-y-6">
              <div className="grid gap-6 lg:grid-cols-2">
                <WorkloadChart data={report.workload} />
                <FairnessScore
                  overallScore={report.overall_fairness}
                  reports={report.fairness}
                  limit={10}
                />
              </div>
              <AvailabilityHeatmap
                data={report.availability}
                month={report.month}
                year={report.year}
              />
            </TabsContent>

            <TabsContent value="workload" className="mt-6">
              <WorkloadChart data={report.workload} />
            </TabsContent>

            <TabsContent value="availability" className="mt-6">
              <AvailabilityHeatmap
                data={report.availability}
                month={report.month}
                year={report.year}
              />
            </TabsContent>

            <TabsContent value="fairness" className="mt-6">
              <FairnessScore
                overallScore={report.overall_fairness}
                reports={report.fairness}
              />
            </TabsContent>
          </Tabs>
        </>
      ) : null}
    </div>
  );
}

function AnalyticsLoading() {
  return (
    <div aria-label="Loading analytics" aria-busy="true" role="status" className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-[380px] rounded-xl" />
        <Skeleton className="h-[380px] rounded-xl" />
      </div>
      <Skeleton className="h-48 rounded-xl" />
      <span className="sr-only">Loading analytics</span>
    </div>
  );
}
