'use client';

import Link from 'next/link';
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Plus,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import { StatsCards } from '@/components/dashboard/stats-cards';
import { UpcomingServices } from '@/components/dashboard/upcoming-services';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const mockUpcomingServices = [
  { id: '1', date: '2026-08-03', week_number: 1, leader_name: 'Heidi', backup_count: 3, status: 'published' as const },
  { id: '2', date: '2026-08-10', week_number: 2, leader_name: 'Feng', backup_count: 3, status: 'validated' as const },
  { id: '3', date: '2026-08-17', week_number: 3, leader_name: 'Shael', backup_count: 2, status: 'draft' as const },
  { id: '4', date: '2026-08-24', week_number: 4, leader_name: 'Marlyn', backup_count: 3, status: 'draft' as const },
];

const activity = [
  { title: 'Schedule published', detail: 'August week 1 is ready to share', time: '2h ago', icon: CheckCircle2, tone: 'text-emerald-400' },
  { title: 'Availability updated', detail: 'Heidi marked week 3 unavailable', time: '5h ago', icon: Clock3, tone: 'text-primary' },
  { title: 'Conflict needs attention', detail: 'Shael is over the monthly limit', time: 'Yesterday', icon: AlertTriangle, tone: 'text-amber-400' },
];

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-8">
      <section className="relative overflow-hidden rounded-2xl border border-border/70 bg-card p-6 shadow-layered sm:p-8">
        <div className="pointer-events-none absolute -right-24 -top-32 size-72 rounded-full bg-primary/10 blur-3xl" />
        <div className="relative flex flex-col justify-between gap-7 lg:flex-row lg:items-end">
          <div className="max-w-2xl">
            <div className="mb-4 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-primary">
              <Sparkles className="size-3.5" />
              Sunday service planning
            </div>
            <h2 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">Good morning, John.</h2>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
              Your ministry is on track. Review this month&apos;s coverage, resolve two conflicts, and keep every service validated.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="outline" size="sm">
              <RefreshCw data-icon="inline-start" />
              Refresh
            </Button>
            <Link href="/schedule" className={cn(buttonVariants({ size: 'sm' }))}>
              <Plus data-icon="inline-start" />
              New schedule
            </Link>
          </div>
        </div>
      </section>

      <StatsCards totalMembers={18} upcomingServices={4} pendingConflicts={2} completedSchedules={12} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.6fr)]">
        <UpcomingServices services={mockUpcomingServices} />

        <Card className="overflow-hidden border-border/70 shadow-layered">
          <CardHeader className="flex flex-row items-start justify-between gap-4 border-b border-border/60">
            <div>
              <CardTitle className="text-base">Validation pulse</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">Schedule health this month</p>
            </div>
            <Badge variant="secondary" className="gap-1.5 rounded-full bg-emerald-500/10 text-emerald-400">
              <span className="size-1.5 rounded-full bg-emerald-400" />
              Healthy
            </Badge>
          </CardHeader>
          <CardContent className="flex flex-col gap-6 pt-6">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-5xl font-semibold tracking-tight text-foreground">86%</p>
                <p className="mt-1 text-sm text-muted-foreground">of assignments validated</p>
              </div>
              <ArrowUpRight className="mb-2 size-5 text-emerald-400" />
            </div>
            <div className="flex h-24 items-end gap-2">
              {[42, 56, 48, 68, 62, 78, 86, 92, 86, 100, 88, 96].map((height, index) => (
                <div key={index} className="group flex flex-1 flex-col justify-end gap-2">
                  <div className="relative h-20 overflow-hidden rounded-sm bg-secondary/70">
                    <div className="absolute inset-x-0 bottom-0 rounded-sm bg-primary/80 transition-all group-hover:bg-primary" style={{ height: `${height}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Week 1</span>
              <span>Week 4</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
        <Card className="border-border/70 shadow-layered">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-base">Recent activity</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">The latest changes across your workspace</p>
            </div>
            <Link href="/analytics" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}>View all</Link>
          </CardHeader>
          <CardContent className="grid gap-1">
            {activity.map((item) => {
              const Icon = item.icon;
              return (
                <div key={item.title} className="flex items-center gap-4 rounded-xl px-2 py-3 transition-colors hover:bg-secondary/50">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary/80">
                    <Icon className={`size-4 ${item.tone}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{item.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{item.detail}</p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{item.time}</span>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card className="border-border/70 bg-primary text-primary-foreground shadow-layered">
          <CardContent className="flex h-full flex-col justify-between gap-8 p-6">
            <div>
              <div className="mb-5 flex size-10 items-center justify-center rounded-xl bg-primary-foreground/15">
                <CalendarDays className="size-5" />
              </div>
              <h3 className="text-xl font-semibold tracking-tight">Prepare the next service</h3>
              <p className="mt-2 text-sm leading-6 text-primary-foreground/75">Assign a leader, confirm three backups, and validate before publishing.</p>
            </div>
            <Link href="/schedule" className={cn(buttonVariants({ variant: 'secondary', className: 'w-full justify-between' }))}>
              Open schedule
              <ArrowUpRight data-icon="inline-end" />
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
