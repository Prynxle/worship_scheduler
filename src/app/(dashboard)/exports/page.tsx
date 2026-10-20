'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExportOptions } from '@/components/exports/export-options';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download, Calendar } from 'lucide-react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { downloadBlob } from '@/lib/export/download-blob';

/** A month with at least one validated or published service, and its weeks. */
interface ExportPeriod {
  month: number;
  year: number;
  weeks: number[];
}

/**
 * The picker's option value. The year is part of it, so two different years'
 * "September" can never collapse into the same selection, and the submitted
 * `{ month, year }` is read straight off the chosen period rather than from a
 * separate, independently-editable year state.
 */
function periodValue(month: number, year: number) {
  return `${year}-${month}`;
}

function periodLabel(month: number, year: number) {
  return new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

export default function ExportsPage() {
  const [isExporting, setIsExporting] = useState(false);
  const [periods, setPeriods] = useState<ExportPeriod[]>([]);
  const [loadingPeriods, setLoadingPeriods] = useState(true);
  const [periodsError, setPeriodsError] = useState('');
  const [selectedPeriod, setSelectedPeriod] = useState('');
  const [week, setWeek] = useState('all');
  const [error, setError] = useState('');

  async function authHeaders(): Promise<Record<string, string>> {
    const { data } = await getSupabaseClient().auth.getSession();
    const token = data.session?.access_token;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
  }

  const loadPeriods = useCallback(async () => {
    try {
      const response = await fetch('/api/export/periods', { headers: await authHeaders() });
      if (!response.ok) throw new Error('Could not load the months available for export.');
      const body = (await response.json()) as { periods?: ExportPeriod[] };
      setPeriods(body.periods ?? []);
      setPeriodsError('');
    } catch (e) {
      setPeriodsError(e instanceof Error ? e.message : 'Could not load the months available for export.');
    } finally {
      setLoadingPeriods(false);
    }
  }, []);

  // Nothing stateful runs before the first await, so this stays lint-clean.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void loadPeriods(); }, [loadPeriods]);

  // The newest exportable month is the default, DERIVED rather than stored, so
  // seeding it needs no set-state-in-effect.
  const activePeriodValue = useMemo(() => {
    if (selectedPeriod) return selectedPeriod;
    const newest = periods[periods.length - 1];
    return newest ? periodValue(newest.month, newest.year) : '';
  }, [periods, selectedPeriod]);

  const activePeriod = useMemo(
    () => periods.find((period) => periodValue(period.month, period.year) === activePeriodValue) ?? null,
    [periods, activePeriodValue],
  );

  async function handleExportPDF() {
    if (!activePeriod) return;
    setIsExporting(true);
    setError('');
    try {
      const payload: Record<string, unknown> = {
        // `period.month` is already 0-based, matching `services.month` and
        // `POST /api/export/pdf`.
        month: activePeriod.month,
        year: activePeriod.year,
      };
      if (week !== 'all') payload.week_numbers = [parseInt(week, 10)];
      const res = await fetch('/api/export/pdf', {
        method: 'POST',
        headers: await authHeaders(),
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Failed to generate PDF' }));
        throw new Error(body.error || 'Failed to generate PDF');
      }
      downloadBlob(await res.blob(), `schedule-${activePeriod.month + 1}-${activePeriod.year}.pdf`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to generate PDF');
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Exports</h2>
          <p className="text-muted-foreground">Export schedules for printing and sharing</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ExportOptions isExporting={isExporting} onExportPDF={handleExportPDF} />

        <Card className="card-glow">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-primary" />
              Select Schedule
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {loadingPeriods ? (
              <p className="text-sm text-muted-foreground">Loading available months…</p>
            ) : periodsError ? (
              <p className="text-sm text-destructive" role="alert">{periodsError}</p>
            ) : periods.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No validated or published schedules yet. Validate a month on the Schedule page and it will appear here.
              </p>
            ) : (
              <>
                <div>
                  <label className="text-sm font-medium text-foreground">Month</label>
                  <Select
                    value={activePeriodValue}
                    onValueChange={(value: string | null) => {
                      if (value) {
                        setSelectedPeriod(value);
                        // The weeks belong to the month, so a stale week choice
                        // must not survive a month change.
                        setWeek('all');
                      }
                    }}
                  >
                    <SelectTrigger className="mt-1.5 w-full">
                      <SelectValue placeholder="Select month" />
                    </SelectTrigger>
                    <SelectContent>
                      {periods.map((period) => (
                        <SelectItem key={periodValue(period.month, period.year)} value={periodValue(period.month, period.year)}>
                          {periodLabel(period.month, period.year)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-sm font-medium text-foreground">Week</label>
                  <Select value={week} onValueChange={(value: string | null) => setWeek(value || 'all')}>
                    <SelectTrigger className="mt-1.5 w-full">
                      <SelectValue placeholder="Select week" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Weeks</SelectItem>
                      {(activePeriod?.weeks ?? []).map((w) => (
                        <SelectItem key={w} value={w.toString()}>Week {w}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <span className="text-sm font-medium text-foreground">Format</span>
                  <div className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground">
                    A4 Portrait (PDF)
                  </div>
                </div>

                {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}

                <Button className="w-full" onClick={handleExportPDF} disabled={isExporting}>
                  <Download className="h-4 w-4 mr-1" />
                  {isExporting ? 'Generating…' : 'Generate Export'}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
