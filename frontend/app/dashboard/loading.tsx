import { Nav } from '@/components/nav';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonListItem, SkeletonStatCard } from '@/components/ui/skeleton-card';

/**
 * Dashboard loading skeleton.
 *
 * Mirrors {@link DashboardPage}: the nav shell stays visible (Nav is rendered
 * here too, not swapped out) while the title/quick-actions row, the six
 * {@link SkeletonStatCard}s (same `sm:grid-cols-2 lg:grid-cols-3` grid as the
 * real stat grid), the "Needs your attention" panel, and the recent-activity
 * list render as placeholders.
 */
export default function DashboardLoading() {
  return (
    <div className="min-h-screen">
      <Nav />
      <main className="container py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <Skeleton className="h-8 w-40" />
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-9 w-32" />
            <Skeleton className="h-9 w-40" />
          </div>
        </div>

        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <SkeletonStatCard key={index} />
            ))}
          </div>

          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-44" />
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              {Array.from({ length: 2 }).map((_, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between gap-4 rounded-lg border bg-background p-4"
                >
                  <div className="space-y-2">
                    <Skeleton className="h-7 w-10" />
                    <Skeleton className="h-4 w-28" />
                  </div>
                  <Skeleton className="h-9 w-16" />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-36" />
            </CardHeader>
            <CardContent className="divide-y">
              {Array.from({ length: 5 }).map((_, index) => (
                <SkeletonListItem key={index} />
              ))}
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
