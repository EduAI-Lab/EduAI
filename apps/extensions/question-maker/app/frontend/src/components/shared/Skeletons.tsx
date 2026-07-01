/**
 * Skeleton presets for QM loading states. Prefer these over spinners for any list,
 * grid, or stat row so layout stays stable while data loads (DS guidance).
 */
import { Skeleton, cn } from '@eduai/ui';

/** A single question/course-card placeholder matching card height. */
export function CardSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-[var(--radius-xl)] border border-border bg-card p-4 shadow-2xs',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-5 w-16 rounded-full" />
        <Skeleton className="ml-auto size-7 rounded-md" />
      </div>
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-5/6" />
      <div className="flex gap-2 pt-1">
        <Skeleton className="h-5 w-14 rounded-full" />
        <Skeleton className="h-5 w-14 rounded-full" />
      </div>
    </div>
  );
}

/** Responsive grid of card skeletons. */
export function CardGridSkeleton({ count = 6, columns = 2 }: { count?: number; columns?: 1 | 2 | 3 }) {
  const cols =
    columns === 1 ? 'grid-cols-1' : columns === 3 ? 'grid-cols-1 md:grid-cols-2 xl:grid-cols-3' : 'grid-cols-1 lg:grid-cols-2';
  return (
    <div className={cn('grid gap-4', cols)}>
      {Array.from({ length: count }).map((_, i) => (
        <CardSkeleton key={i} />
      ))}
    </div>
  );
}

/** Stacked single-line list placeholders. */
export function ListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-border bg-card px-4 py-3"
        >
          <Skeleton className="size-9 rounded-md" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** Row of stat-card placeholders. */
export function StatRowSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-[var(--radius-xl)] border border-border bg-card p-4 shadow-2xs">
          <Skeleton className="h-3.5 w-20" />
          <Skeleton className="h-7 w-12" />
        </div>
      ))}
    </div>
  );
}
