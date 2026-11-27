import { Skeleton } from '@/components/ui/loading-skeleton';

const barHeights = [120, 96, 96, 68, 68, 68, 36, 36];

/** Fixed-size placeholder that keeps the analytics card from jumping. */
export function WorkloadChartSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading workload chart"
      role="status"
      className="flex h-[300px] items-end justify-around gap-3 px-6 pb-8"
    >
      {barHeights.map((height, index) => (
        <div key={index} className="flex w-8 items-end" style={{ height }}>
          <Skeleton className="h-full w-8 rounded-t-md" />
        </div>
      ))}
      <span className="sr-only">Loading workload chart</span>
    </div>
  );
}
