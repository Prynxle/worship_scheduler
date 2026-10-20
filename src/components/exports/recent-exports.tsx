'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { getSupabaseClient } from '@/lib/supabase/client';
import { downloadBlob } from '@/lib/export/download-blob';
import type { ChurchExport } from '@/lib/types/database';
import { Download, FileText } from 'lucide-react';

function monthLabel(month: number, year: number) {
  return new Date(year, month, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function weekLabel(weeks: number[] | null) {
  if (!weeks || weeks.length === 0) return 'All weeks';
  if (weeks.length === 1) return `Week ${weeks[0]}`;
  return `Weeks ${weeks.join(', ')}`;
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

async function sessionHeaders(): Promise<Record<string, string>> {
  const { data } = await getSupabaseClient().auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * The church's saved PDF exports, newest first. Self-contained (fetches its own
 * data and handles downloads) so it can be dropped into any surface. Bump
 * `refreshKey` after generating an export to pull the new file into the list.
 */
export function RecentExports({ refreshKey = 0 }: { refreshKey?: number }) {
  const [exports, setExports] = useState<ChurchExport[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/export/list', { headers: await sessionHeaders() });
      if (!response.ok) throw new Error('Could not load recent exports.');
      const body = await response.json() as { exports?: ChurchExport[] };
      setExports(body.exports ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load recent exports.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Nothing stateful runs before the first await, so this stays lint-clean while
  // still refreshing whenever the page bumps `refreshKey` after an export.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load, refreshKey]);

  async function download(item: ChurchExport) {
    setDownloadingId(item.id);
    try {
      const response = await fetch(`/api/export/download/${item.id}`, { headers: await sessionHeaders() });
      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: 'Failed to download export' }));
        throw new Error(body.error || 'Failed to download export');
      }
      downloadBlob(await response.blob(), item.filename);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to download export');
    } finally {
      setDownloadingId('');
    }
  }

  return (
    <Card className="card-glow">
      <CardHeader className="flex flex-row items-end justify-between gap-4 border-b border-border pb-4">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-primary">Print &amp; share</p>
          <CardTitle className="mt-1 font-display text-2xl">Recent exports</CardTitle>
        </div>
        <span className="hidden text-xs text-muted-foreground sm:block">Latest {exports.length || ''} across all months</span>
      </CardHeader>
      <CardContent className="p-4 sm:p-6">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading exports…</p>
        ) : error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : exports.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No exports yet. Use <span className="font-medium text-foreground">Export PDF</span> above and the file will appear here.
          </p>
        ) : (
          <ul className="space-y-2">
            {exports.map((item) => (
              <li key={item.id} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="rounded-lg bg-primary/10 p-2">
                    <FileText className="h-4 w-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">{item.filename}</div>
                    <div className="text-xs text-muted-foreground">
                      {monthLabel(item.month, item.year)} · {weekLabel(item.week_numbers)} · {formatSize(item.file_size)} ·{' '}
                      {new Date(item.created_at).toLocaleString()}
                    </div>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  disabled={downloadingId === item.id}
                  onClick={() => void download(item)}
                >
                  <Download className="mr-1 h-4 w-4" />
                  {downloadingId === item.id ? 'Loading…' : 'Download'}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
