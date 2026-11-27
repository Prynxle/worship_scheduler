import { Skeleton } from '@/components/ui/loading-skeleton';

/** Fixed-size, accessible placeholder matching the month grid's six week rows. */
export function EventCalendarGridSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading calendar"
      role="status"
      className="h-[39rem] rounded-lg border border-border/60 bg-secondary/10 p-3 sm:h-[44rem] sm:p-5"
    >
      <div className="grid h-full grid-cols-7 grid-rows-[auto_repeat(6,minmax(0,1fr))] gap-px overflow-hidden rounded-md border border-border/50">
        {Array.from({ length: 7 }, (_, index) => (
          <div key={`header-${index}`} className="flex items-center justify-center border-b border-border/60 bg-muted/30">
            <Skeleton className="h-2 w-8" />
          </div>
        ))}
        {Array.from({ length: 42 }, (_, index) => (
          <div key={`day-${index}`} className="border-b border-r border-border/40 p-2">
            <Skeleton className="size-5 rounded-full" />
          </div>
        ))}
      </div>
      <span className="sr-only">Loading calendar</span>
    </div>
  );
}
