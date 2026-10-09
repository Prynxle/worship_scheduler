import { cn } from '@/lib/utils';

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn('animate-pulse motion-reduce:animate-none rounded-md bg-muted', className)} />;
}

export function MemberGridSkeleton() {
  return (
    <div aria-label="Loading members" aria-busy="true" role="status" className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="rounded-xl border border-border/70 p-5">
          <div className="flex items-center gap-3"><Skeleton className="size-11 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-4 w-2/3" /><Skeleton className="h-3 w-1/3" /></div></div>
          <div className="mt-5 space-y-2"><Skeleton className="h-3 w-full" /><Skeleton className="h-3 w-4/5" /></div>
          <div className="mt-5 flex gap-2"><Skeleton className="h-6 w-16 rounded-full" /><Skeleton className="h-6 w-20 rounded-full" /></div>
        </div>
      ))}
      <span className="sr-only">Loading members</span>
    </div>
  );
}

export function ScheduleGridSkeleton() {
  return (
    <div aria-label="Loading schedules" aria-busy="true" role="status" className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="min-h-64 rounded-xl border border-border/70 p-5">
          <div className="flex justify-between"><Skeleton className="h-5 w-32" /><Skeleton className="h-6 w-20 rounded-full" /></div>
          <Skeleton className="mt-6 h-4 w-2/3" />
          <div className="mt-4 space-y-3">{Array.from({ length: 4 }, (_, row) => <Skeleton key={row} className="h-4 w-full" />)}</div>
        </div>
      ))}
      <span className="sr-only">Loading schedules</span>
    </div>
  );
}

export function DashboardLoadingSkeleton() {
  return (
    <div aria-label="Loading page" aria-busy="true" role="status" className="space-y-6">
      <div className="space-y-2"><Skeleton className="h-7 w-48" /><Skeleton className="h-4 w-72 max-w-full" /></div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)}</div>
      <div className="grid gap-4 lg:grid-cols-2">{Array.from({ length: 2 }, (_, i) => <Skeleton key={i} className="h-80 rounded-xl" />)}</div>
      <span className="sr-only">Loading page</span>
    </div>
  );
}
