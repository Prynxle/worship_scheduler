import type { Notification } from '@/lib/types/database';

/** Feed page size shared by the header bell and the member workspace feed. */
export const ANNOUNCEMENT_PAGE_SIZE = 20;

export interface AnnouncementPage {
  notifications: Notification[];
  nextCursor: string | null;
  unreadCount: number;
}

/** Validate the `GET /api/announcements` payload before it reaches the UI. */
export function parseAnnouncementPage(payload: unknown): AnnouncementPage {
  if (!payload || typeof payload !== 'object') throw new Error('The notification response was invalid.');
  const { notifications, nextCursor, unreadCount } = payload as {
    notifications?: unknown;
    nextCursor?: unknown;
    unreadCount?: unknown;
  };
  if (!Array.isArray(notifications)) throw new Error('The notification response was invalid.');
  return {
    notifications: notifications as Notification[],
    nextCursor: typeof nextCursor === 'string' ? nextCursor : null,
    unreadCount: typeof unreadCount === 'number' ? unreadCount : 0,
  };
}

/** Compact "5m ago" style timestamp used in both feeds. */
export function formatRelativeTime(iso: string): string {
  const timestamp = new Date(iso).getTime();
  if (Number.isNaN(timestamp)) return '';
  const minutes = Math.round((Date.now() - timestamp) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
