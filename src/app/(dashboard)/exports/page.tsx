'use client';

import { useEffect, useMemo, useState } from 'react';
import { ExportOptions } from '@/components/exports/export-options';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download, Calendar, FileText, Image as ImageIcon } from 'lucide-react';
import { getSupabaseClient } from '@/lib/supabase/client';

export default function ExportsPage() {
  const [isExporting, setIsExporting] = useState(false);
  const [month, setMonth] = useState<string>('1');
  const [year, setYear] = useState<string>(new Date().getFullYear().toString());
  const [week, setWeek] = useState<string>('all');
  const months = useMemo(() => {
    const current = new Date();
    const items = [];
    for (let i = -6; i <= 6; i++) {
      const d = new Date(current.getFullYear(), current.getMonth() + i, 1);
      items.push({
        month: d.getMonth() + 1,
        year: d.getFullYear(),
        label: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      });
    }
    return items;
  }, []);

  useEffect(() => {
    const current = new Date();
    const cur = months.find((m) => m.month === current.getMonth() + 1 && m.year === current.getFullYear());
    if (cur && month === '1') {
      setTimeout(() => {
        setMonth(cur.month.toString());
        setYear(cur.year.toString());
      }, 0);
    }
  }, [months, month, year]);

  async function handleExportPDF() {
    setIsExporting(true);
    try {
      const payload: Record<string, unknown> = {
        month: parseInt(month),
        year: parseInt(year),
      };
      if (week !== 'all') payload.week_numbers = [parseInt(week)];
      const { data } = await getSupabaseClient().auth.getSession();
      const token = data.session?.access_token;
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      const res = await fetch('/api/export/pdf', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const error = await res.json().catch(() => ({ error: 'Failed to generate PDF' }));
        console.error('Export failed:', error);
        alert(error.error || 'Failed to generate PDF');
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'schedule-' + month + '-' + year + '.pdf';
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      console.error('Export error:', err);
      alert('Failed to generate PDF');
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
        <ExportOptions
          isExporting={isExporting}
          onExportPDF={handleExportPDF}
          onExportImage={() => {}}
          onExportPrint={() => {}}
        />

        <Card className="card-glow">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5 text-primary" />
              Select Schedule
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-sm font-medium text-foreground">Month</label>
              <Select value={month} onValueChange={(v: string | null) => setMonth(v || month)}>
                <SelectTrigger className="mt-1.5 w-full">
                  <SelectValue placeholder="Select month" />
                </SelectTrigger>
                <SelectContent>
                  {months.map((m) => (
                    <SelectItem key={m.year + '-' + m.month} value={m.month.toString()}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium text-foreground">Week</label>
              <Select value={week} onValueChange={(v: string | null) => setWeek(v || week)}>
                <SelectTrigger className="mt-1.5 w-full">
                  <SelectValue placeholder="Select week" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Weeks</SelectItem>
                  <SelectItem value="1">Week 1</SelectItem>
                  <SelectItem value="2">Week 2</SelectItem>
                  <SelectItem value="3">Week 3</SelectItem>
                  <SelectItem value="4">Week 4</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-sm font-medium text-foreground">Format</label>
              <Select defaultValue="a4">
                <SelectTrigger className="mt-1.5 w-full">
                  <SelectValue placeholder="Select format" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="a4">A4 Portrait</SelectItem>
                  <SelectItem value="a4-landscape">A4 Landscape</SelectItem>
                  <SelectItem value="social">Social Media (1080x1080)</SelectItem>
                  <SelectItem value="announcement">Church Announcement</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button className="w-full" onClick={handleExportPDF} disabled={isExporting}>
              <Download className="h-4 w-4 mr-1" />
              {isExporting ? 'Generating...' : 'Generate Export'}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="card-glow">
        <CardHeader>
          <CardTitle>Recent Exports</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2"></div>
        </CardContent>
      </Card>
    </div>
  );
}
