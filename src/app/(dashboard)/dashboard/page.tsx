'use client';

import Link from 'next/link';
import { ArrowUpRight, CalendarDays, Plus, Sparkles, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { getSupabaseClient } from '@/lib/supabase/client';

export default function DashboardPage() {
  const [greeting, setGreeting] = useState('Welcome to your ministry overview');

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const session = (await getSupabaseClient().auth.getSession()).data.session;
        if (!session) return;

        const response = await fetch('/api/auth/me', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!response.ok) return;

        const result = await response.json() as { user?: { full_name?: string; role?: string } };
        if (cancelled || result.user?.role !== 'coordinator') return;

        const firstName = result.user.full_name?.trim().split(/\s+/)[0]?.toLowerCase();
        if (firstName === 'zedrick') setGreeting('Welcome back, Music Director Zedrick');
        if (firstName === 'marilyn') setGreeting('Welcome back, Worship Team Leader Marilyn');
      } catch {
        // Keep the generic overview greeting if authentication lookup fails.
      }
    })();

    return () => { cancelled = true; };
  }, []);

  return (
    <div className="flex flex-col gap-8">
      <section className="relative overflow-hidden rounded-2xl border border-border/70 bg-card p-6 shadow-layered sm:p-8">
        <div aria-hidden="true" className="pointer-events-none absolute -right-24 -top-32 size-72 rounded-full bg-primary/10 blur-2xl opacity-70" />
        <div className="relative flex flex-col justify-between gap-7 lg:flex-row lg:items-end">
          <div className="max-w-2xl">
            <div className="mb-4 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-primary">
              <Sparkles className="size-3.5" />
              Sunday service planning
            </div>
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">{greeting}</h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
              Review your ministry roster and prepare upcoming services from the schedule workspace.
            </p>
          </div>
          <Link href="/schedule" className={cn(buttonVariants({ size: 'sm' }))}>
            <Plus data-icon="inline-start" />
            New schedule
          </Link>
        </div>
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="border-border/70 shadow-layered">
          <CardContent className="flex h-full flex-col justify-between gap-8 p-6">
            <div>
              <div className="mb-5 flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <CalendarDays className="size-5" />
              </div>
              <h3 className="text-xl font-semibold tracking-tight">Schedule services</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">Generate, review, validate, and publish ministry schedules.</p>
            </div>
            <Link href="/schedule" className={cn(buttonVariants({ variant: 'outline', className: 'w-full justify-between' }))}>
              Open schedule
              <ArrowUpRight data-icon="inline-end" />
            </Link>
          </CardContent>
        </Card>

        <Card className="border-border/70 shadow-layered">
          <CardContent className="flex h-full flex-col justify-between gap-8 p-6">
            <div>
              <div className="mb-5 flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Users className="size-5" />
              </div>
              <h3 className="text-xl font-semibold tracking-tight">Manage your roster</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">View members, roles, and submitted availability.</p>
            </div>
            <Link href="/members" className={cn(buttonVariants({ variant: 'outline', className: 'w-full justify-between' }))}>
              Open members
              <ArrowUpRight data-icon="inline-end" />
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
