'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { ChevronRight, LogOut, Menu } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { NotificationBell } from '@/components/notifications/notification-bell';
import { useSessionUser } from '@/contexts/session-context';
import { getSupabaseClient } from '@/lib/supabase/client';
import { signOutLocal } from '@/lib/auth/sign-out';
import { formatLocalDate, formatLongDate } from '@/lib/utils/date-utils';
import { formatUpcomingEventCount, getUpcomingEventsQueryStart } from '@/lib/events/upcoming';

interface HeaderProps {
  title: string;
  subtitle?: string;
  onMenuClick?: () => void;
}

/**
 * Today's date, or `null` while rendering on the server.
 *
 * A date is not known during SSR: the server's clock and timezone can disagree
 * with the browser's, and the two straddle midnight differently. Computing it in
 * an effect or a lazy `useState` initializer still leaks the client value into
 * the hydration pass, so React reports a mismatch. `useSyncExternalStore` is the
 * supported primitive for exactly this case — it renders the server snapshot
 * during SSR and hydration, then swaps to the client snapshot afterwards.
 *
 * `getTodaySnapshot` must return a cached value; handing back a fresh `Date` on
 * every call would read as a change on every render and loop. The cache is keyed
 * by calendar day, so the value only changes when the displayed date actually
 * does.
 */
let cachedToday: Date | null = null;
let cachedDayKey = '';

function subscribeToClock() {
  return () => {};
}

function getTodaySnapshot(): Date | null {
  const now = new Date();
  const dayKey = formatLocalDate(now);
  if (dayKey !== cachedDayKey) {
    cachedDayKey = dayKey;
    cachedToday = now;
  }
  return cachedToday;
}

function getServerTodaySnapshot(): null {
  return null;
}

function useToday(): Date | null {
  return useSyncExternalStore(subscribeToClock, getTodaySnapshot, getServerTodaySnapshot);
}

/**
 * Count of upcoming church events, or `null` while unresolved.
 *
 * Reads `GET /api/events`, which already filters to the caller's `church_id`, so
 * a member sees their own church's events and no one else's. Only members make
 * this request; staff and admin keep the existing planning label.
 */
function useUpcomingEventCount(enabled: boolean): number | null {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let active = true;

    void (async () => {
      try {
        const { data } = await getSupabaseClient().auth.getSession();
        if (!active || !data.session) return;
        const start = getUpcomingEventsQueryStart(new Date());
        const response = await fetch(`/api/events?start=${start}`, {
          headers: { Authorization: `Bearer ${data.session.access_token}` },
        });
        if (!active || !response.ok) return;
        const result = await response.json() as { events?: unknown[] };
        if (!active) return;
        setCount(Array.isArray(result.events) ? result.events.length : 0);
      } catch {
        // Left unresolved on purpose: a failed request must not read as "no
        // events", so the summary line stays hidden instead of claiming the
        // month is empty when the truth is that we could not ask.
      }
    })();

    return () => {
      active = false;
    };
  }, [enabled]);

  return count;
}

export function Header({ title, subtitle, onMenuClick }: HeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const section = pathname.split('/').filter(Boolean).at(-1) ?? 'dashboard';
  const user = useSessionUser();
  const isMember = user?.role === 'member';
  const now = useToday();
  const upcomingEventCount = useUpcomingEventCount(isMember);
  const eventSummary = formatUpcomingEventCount(upcomingEventCount ?? 0);
  const [signingOut, setSigningOut] = useState(false);

  // Members have no sidebar, so the header carries their sign-out control.
  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOutLocal();
    } finally {
      router.push('/login');
      router.refresh();
      setSigningOut(false);
    }
  }

  return (
    <header className="flex min-h-20 items-center justify-between gap-4 border-b border-border/70 bg-background/80 px-5 backdrop-blur-xl sm:px-8">
      <div className="flex min-w-0 items-center gap-3">
        {onMenuClick && (
          <Button variant="ghost" size="icon" className="shrink-0 lg:hidden" onClick={onMenuClick} aria-label="Open navigation">
            <Menu className="size-5" />
          </Button>
        )}
        <div className="min-w-0">
          <div className="mb-1 hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex">
            <span>Workspace</span>
            <ChevronRight className="size-3" />
            <span className="capitalize text-foreground/70">{section}</span>
          </div>
          <h1 className="truncate text-xl font-semibold tracking-tight text-foreground">{title}</h1>
          {subtitle && <p className="hidden truncate text-sm text-muted-foreground sm:block">{subtitle}</p>}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <NotificationBell />
        <div className="hidden h-8 w-px bg-border sm:block" />
        <div className="hidden text-right sm:block">
          {/* Non-breaking space holds the line height before mount so the header
              does not reflow once the real date arrives. */}
          <p className="text-xs font-medium text-foreground">{now ? formatLongDate(now) : '\u00a0'}</p>
          {isMember
            ? eventSummary && <p className="text-[11px] text-muted-foreground">{eventSummary}</p>
            : <p className="text-[11px] text-muted-foreground">Planning season</p>}
        </div>
        {isMember && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleSignOut()}
            disabled={signingOut}
            aria-label="Sign out"
          >
            <LogOut className="size-4" />
            <span className="hidden sm:inline">{signingOut ? 'Signing out…' : 'Sign out'}</span>
          </Button>
        )}
      </div>
    </header>
  );
}
