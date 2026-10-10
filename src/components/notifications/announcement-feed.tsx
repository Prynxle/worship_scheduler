'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Megaphone, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getSupabaseClient } from '@/lib/supabase/client';
import { ANNOUNCEMENT_PAGE_SIZE, formatRelativeTime, parseAnnouncementPage } from '@/lib/notifications/feed';
import type { Notification } from '@/lib/types/database';
import { AnnouncementDetailDialog } from './announcement-detail-dialog';

async function authHeaders(): Promise<HeadersInit | null> {
  const { data } = await getSupabaseClient().auth.getSession();
  return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : null;
}

/**
 * The member workspace announcements feed: the same broadcast stream the header
 * bell shows, rendered inline below the workspace so members see updates
 * without opening a popover. Opening a row marks it read (optimistically).
 */
export function AnnouncementFeed() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<Notification | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);

  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const headers = await authHeaders();
      if (!headers) return;
      const response = await fetch(`/api/announcements?limit=${ANNOUNCEMENT_PAGE_SIZE}`, { headers });
      const payload = await response.json().catch(() => null);
      if (requestId !== requestIdRef.current) return;
      if (!response.ok) {
        throw new Error((payload as { error?: string } | null)?.error ?? 'Could not load announcements.');
      }
      const page = parseAnnouncementPage(payload);
      setNotifications(page.notifications);
      setNextCursor(page.nextCursor);
      setError(null);
    } catch (cause) {
      if (requestId !== requestIdRef.current) return;
      setError(cause instanceof Error ? cause.message : 'Could not load announcements.');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const headers = await authHeaders();
      if (!headers) return;
      const response = await fetch(
        `/api/announcements?limit=${ANNOUNCEMENT_PAGE_SIZE}&before=${encodeURIComponent(nextCursor)}`,
        { headers },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error((payload as { error?: string } | null)?.error ?? 'Could not load announcements.');
      }
      const page = parseAnnouncementPage(payload);
      setNotifications((current) => [...current, ...page.notifications]);
      setNextCursor(page.nextCursor);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load announcements.');
    } finally {
      setLoadingMore(false);
    }
  };

  const markRead = async (id: string) => {
    // Optimistic: the row updates immediately, and a failed write re-syncs
    // from the server rather than trusting the local guess.
    setNotifications((current) => current.map((item) => (item.id === id ? { ...item, is_read: true } : item)));
    try {
      const headers = await authHeaders();
      if (!headers) throw new Error('no session');
      const response = await fetch('/api/announcements', {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [id] }),
      });
      if (!response.ok) throw new Error('write failed');
    } catch {
      void load();
    }
  };

  const openDetail = (item: Notification) => {
    setDetail(item);
    setDetailOpen(true);
    if (!item.is_read) void markRead(item.id);
  };

  const empty = !loading && !error && notifications.length === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Megaphone className="size-4 text-primary" /> Announcements
        </CardTitle>
        <CardDescription>Updates from your church and ministry.</CardDescription>
      </CardHeader>

      <CardContent className="p-0" aria-busy={loading}>
        <div className="max-h-[450px] overflow-y-auto">
          {loading && notifications.length === 0 && (
            <div className="flex items-center justify-center gap-2 px-6 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading announcements…
            </div>
          )}

          {!loading && error && notifications.length === 0 && (
            <div className="px-6 py-8 text-center">
              <p className="text-sm text-muted-foreground" role="alert">{error}</p>
              <Button variant="ghost" size="sm" className="mt-2" onClick={() => void load()}>
                <RotateCw className="size-3.5" /> Try again
              </Button>
            </div>
          )}

          {empty && (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              You&apos;re all caught up.
            </p>
          )}

          {notifications.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => openDetail(item)}
              className={`flex w-full gap-3 border-b border-border/40 px-6 py-3 text-left last:border-b-0 hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none ${item.is_read ? '' : 'bg-primary/[0.04]'}`}
            >
              <span
                aria-hidden
                className={`mt-1.5 size-2 shrink-0 rounded-full ${item.is_read ? 'bg-transparent' : 'bg-primary'}`}
              />
              <span className="min-w-0 flex-1">
                <span className={`block text-sm text-foreground ${item.is_read ? 'font-normal' : 'font-semibold'}`}>
                  {item.title}
                </span>
                <span className="mt-0.5 line-clamp-3 whitespace-pre-wrap break-words text-xs text-muted-foreground">
                  {item.message}
                </span>
                <span className="mt-1 block text-[11px] text-muted-foreground/70">
                  {formatRelativeTime(item.created_at)}
                  {item.is_read && <span className="sr-only"> (read)</span>}
                </span>
              </span>
            </button>
          ))}

          {(error && notifications.length > 0) && (
            <p className="border-t border-border/70 px-6 py-2 text-xs text-destructive" role="alert">{error}</p>
          )}
        </div>

        {nextCursor && (
          <div className="flex justify-center border-t border-border/70 px-6 py-2">
            <Button variant="ghost" size="sm" onClick={() => void loadMore()} disabled={loadingMore}>
              {loadingMore ? <Loader2 className="size-3.5 animate-spin" /> : 'Load older'}
            </Button>
          </div>
        )}
      </CardContent>

      <AnnouncementDetailDialog
        announcement={detail}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </Card>
  );
}
