'use client';

import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { getSupabaseClient } from '@/lib/supabase/client';
import { EventCalendar } from '@/components/events/event-calendar';

async function getAuthHeaders(): Promise<Record<string, string> | null> {
  const session = (await getSupabaseClient().auth.getSession()).data.session;
  return session ? { Authorization: `Bearer ${session.access_token}` } : null;
}

export function EventManager() {
  const [canManage, setCanManage] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const headers = await getAuthHeaders();
      if (!headers) return;
      const response = await fetch('/api/auth/me', { headers });
      if (!response.ok) return;
      const result = (await response.json()) as { user?: { role?: string } };
      if (!cancelled) setCanManage(result.user?.role !== 'member');
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <section className="relative overflow-hidden rounded-2xl border border-border/70 bg-card p-6 shadow-layered sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-24 size-64 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative">
          <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-primary">
            <Sparkles className="size-3.5" /> Ministry calendar
          </div>
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Keep everyone in step.</h2>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
            One shared rhythm for services, rehearsals, and the moments that make ministry happen.
          </p>
        </div>
      </section>

      <EventCalendar canManage={canManage} />
    </div>
  );
}
