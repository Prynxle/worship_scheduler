'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck, EyeOff, Loader2, RotateCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useSessionUser } from '@/contexts/session-context';
import { getSupabaseClient } from '@/lib/supabase/client';
import { ANNOUNCEMENT_PAGE_SIZE, formatRelativeTime, parseAnnouncementPage } from '@/lib/notifications/feed';
import type { Notification } from '@/lib/types/database';
import { AnnouncementDetailDialog } from './announcement-detail-dialog';

async function authHeaders(): Promise<HeadersInit | null> {
  const { data } = await getSupabaseClient().auth.getSession();
  return data.session ? { Authorization: `Bearer ${data.session.access_token}` } : null;
}

/** Shared row content for one notification, in both normal and select mode. */
function ItemBody({ item }: { item: Notification }) {
  return (
    <span className="min-w-0 flex-1">
      <span className={`block truncate text-sm text-foreground ${item.is_read ? 'font-normal' : 'font-semibold'}`}>
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
  );
}

/**
 * The header notification bell: unread badge and the announcement feed panel,
 * including per-row select mode, soft remove, and staff hard delete. Composing
 * a new announcement lives on the Announcements page (see the sidebar), not in
 * this panel.
 *
 * The feed loads silently on mount so the badge is accurate without opening
 * the panel, and refreshes every time the panel opens so it cannot go stale.
 * A monotonic request id drops out-of-order responses when the two overlap.
 */
export function NotificationBell() {
  const user = useSessionUser();
  const isStaff = user?.role === 'admin' || user?.role === 'coordinator';

  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Notification | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requestIdRef = useRef(0);

  const load = useCallback(async (silent: boolean) => {
    const requestId = ++requestIdRef.current;
    if (!silent) setLoading(true);
    try {
      const headers = await authHeaders();
      if (!headers) return;
      const response = await fetch(`/api/announcements?limit=${ANNOUNCEMENT_PAGE_SIZE}`, { headers });
      const payload = await response.json().catch(() => null);
      if (requestId !== requestIdRef.current) return;
      if (!response.ok) {
        throw new Error((payload as { error?: string } | null)?.error ?? 'Could not load notifications.');
      }
      const page = parseAnnouncementPage(payload);
      setNotifications(page.notifications);
      setNextCursor(page.nextCursor);
      setUnreadCount(page.unreadCount);
      setError(null);
    } catch (cause) {
      if (requestId !== requestIdRef.current) return;
      setError(cause instanceof Error ? cause.message : 'Could not load notifications.');
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Deferred like EventManager's mount fetch: load() writes state, and the
    // set-state-in-effect rule wants that write out of the effect body itself.
    const timer = setTimeout(() => { void load(true); }, 0);
    return () => clearTimeout(timer);
  }, [load]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      void load(false);
    } else {
      setSelectMode(false);
      setSelected(new Set());
    }
  };

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
        throw new Error((payload as { error?: string } | null)?.error ?? 'Could not load notifications.');
      }
      const page = parseAnnouncementPage(payload);
      setNotifications((current) => [...current, ...page.notifications]);
      setNextCursor(page.nextCursor);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load notifications.');
    } finally {
      setLoadingMore(false);
    }
  };

  const markRead = async (id: string) => {
    const target = notifications.find((item) => item.id === id);
    if (!target || target.is_read) return;

    // Optimistic: the badge and the row update immediately, and a failed
    // write re-syncs from the server rather than trusting the local guess.
    setNotifications((current) => current.map((item) => (item.id === id ? { ...item, is_read: true } : item)));
    setUnreadCount((count) => Math.max(0, count - 1));
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
      void load(true);
    }
  };

  const markAllRead = async () => {
    if (unreadCount === 0) return;
    setNotifications((current) => current.map((item) => ({ ...item, is_read: true })));
    setUnreadCount(0);
    try {
      const headers = await authHeaders();
      if (!headers) throw new Error('no session');
      const response = await fetch('/api/announcements', {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
      if (!response.ok) throw new Error('write failed');
    } catch {
      void load(true);
    }
  };

  const toggleSelected = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // "All" means every row currently loaded in the panel; older pages pulled
  // in by "Load older" join the selection only after they appear.
  const allSelected = notifications.length > 0 && notifications.every((item) => selected.has(item.id));

  const toggleSelectAll = () => {
    setSelected(allSelected ? new Set() : new Set(notifications.map((item) => item.id)));
  };

  /**
   * Optimistic removal from this feed: the rows leave the list and the badge
   * immediately. A failed write re-syncs, which brings the rows back if the
   * server did not apply the change.
   */
  const applyRemoval = (ids: string[]) => {
    const removedUnread = notifications.filter((item) => ids.includes(item.id) && !item.is_read).length;
    const remaining = notifications.filter((item) => !ids.includes(item.id));
    setNotifications(remaining);
    setUnreadCount((count) => Math.max(0, count - removedUnread));
    setSelected(new Set());
    if (remaining.length === 0) setSelectMode(false);
  };

  /** Soft remove: dismissed_at hides the rows from this user's feed only. */
  const removeSelected = async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    applyRemoval(ids);
    try {
      const headers = await authHeaders();
      if (!headers) throw new Error('no session');
      const response = await fetch('/api/announcements', {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'dismiss', ids }),
      });
      if (!response.ok) throw new Error('write failed');
    } catch {
      void load(true);
    }
  };

  /** Staff hard delete: removes every recipient's row of the announcement. */
  const deleteSelected = async () => {
    const announcementIds = [...new Set(
      notifications
        .filter((item) => selected.has(item.id))
        .map((item) => item.announcement_id)
        .filter((id): id is string => Boolean(id)),
    )];
    if (announcementIds.length === 0) return;
    const noun = announcementIds.length === 1
      ? 'this announcement'
      : `these ${announcementIds.length} announcements`;
    if (!window.confirm(`Delete ${noun} permanently? Everyone on the team will stop seeing it.`)) return;

    applyRemoval([...selected]);
    try {
      const headers = await authHeaders();
      if (!headers) throw new Error('no session');
      const response = await fetch('/api/announcements', {
        method: 'DELETE',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ announcement_ids: announcementIds }),
      });
      if (!response.ok) throw new Error('write failed');
    } catch {
      void load(true);
    }
  };

  const openDetail = (item: Notification) => {
    setDetail(item);
    setDetailOpen(true);
    setOpen(false);
    if (!item.is_read) void markRead(item.id);
  };

  const empty = !loading && !error && notifications.length === 0;

  return (
    <>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="relative text-muted-foreground hover:text-foreground"
              aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : 'Notifications'}
            />
          }
        >
          <Bell className="size-[18px]" />
          {unreadCount > 0 && (
            <span
              aria-hidden
              className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold leading-none text-primary-foreground"
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </PopoverTrigger>

        <PopoverContent align="end" className="w-96 gap-0 p-0" aria-label="Notifications">
          <div className="flex items-center justify-between gap-2 border-b border-border/70 px-4 py-3">
            <p className="text-sm font-semibold text-foreground">Notifications</p>
            <div className="flex items-center gap-1.5">
              <Button
                variant="ghost"
                size="sm"
                disabled={notifications.length === 0 && !selectMode}
                onClick={() => {
                  setSelectMode((current) => !current);
                  setSelected(new Set());
                }}
              >
                {selectMode ? 'Cancel' : 'Select'}
              </Button>
            </div>
          </div>

          <div className="max-h-96 overflow-y-auto" aria-busy={loading}>
            {loading && notifications.length === 0 && (
              <div className="flex items-center justify-center gap-2 px-4 py-10 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading notifications…
              </div>
            )}

            {!loading && error && notifications.length === 0 && (
              <div className="px-4 py-8 text-center">
                <p className="text-sm text-muted-foreground" role="alert">{error}</p>
                <Button variant="ghost" size="sm" className="mt-2" onClick={() => void load(false)}>
                  <RotateCw className="size-3.5" /> Try again
                </Button>
              </div>
            )}

            {empty && (
              <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                You&apos;re all caught up.
              </p>
            )}

            {notifications.map((item) => (selectMode ? (
              <label
                key={item.id}
                className={`flex w-full cursor-pointer gap-3 border-b border-border/40 px-4 py-3 last:border-b-0 hover:bg-accent/40 ${selected.has(item.id) ? 'bg-primary/[0.06]' : ''}`}
              >
                <Checkbox
                  checked={selected.has(item.id)}
                  onCheckedChange={() => toggleSelected(item.id)}
                  className="mt-1"
                />
                <ItemBody item={item} />
              </label>
            ) : (
              <button
                key={item.id}
                type="button"
                onClick={() => openDetail(item)}
                className={`flex w-full gap-3 border-b border-border/40 px-4 py-3 text-left last:border-b-0 hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none ${item.is_read ? '' : 'bg-primary/[0.04]'}`}
              >
                <span
                  aria-hidden
                  className={`mt-1.5 size-2 shrink-0 rounded-full ${item.is_read ? 'bg-transparent' : 'bg-primary'}`}
                />
                <ItemBody item={item} />
              </button>
            )))}
          </div>

          {(error && notifications.length > 0) && (
            <p className="border-t border-border/70 px-4 py-2 text-xs text-destructive" role="alert">{error}</p>
          )}

          {(selectMode || unreadCount > 0 || nextCursor) && (
            <div className="flex items-center justify-between gap-2 border-t border-border/70 px-4 py-2">
              {selectMode ? (
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={notifications.length === 0}
                    onClick={toggleSelectAll}
                  >
                    {allSelected ? 'Deselect' : 'Select all'}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={selected.size === 0}
                    onClick={() => void removeSelected()}
                  >
                    <EyeOff className="size-3.5" /> Remove{selected.size > 0 ? ` (${selected.size})` : ''}
                  </Button>
                  {isStaff && (
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={selected.size === 0}
                      onClick={() => void deleteSelected()}
                    >
                      <Trash2 className="size-3.5" /> Delete
                    </Button>
                  )}
                </div>
              ) : unreadCount > 0 ? (
                <Button variant="ghost" size="sm" onClick={() => void markAllRead()}>
                  <CheckCheck className="size-3.5" /> Mark all read
                </Button>
              ) : (
                <span />
              )}
              {nextCursor && (
                <Button variant="ghost" size="sm" onClick={() => void loadMore()} disabled={loadingMore}>
                  {loadingMore ? <Loader2 className="size-3.5 animate-spin" /> : 'Load older'}
                </Button>
              )}
            </div>
          )}
        </PopoverContent>
      </Popover>

      <AnnouncementDetailDialog
        announcement={detail}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </>
  );
}
