import { Nav } from '@/components/nav';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonText } from '@/components/ui/skeleton';

/**
 * Follow-ups loading skeleton.
 *
 * Mirrors {@link FollowUpsPage}/{@link FollowUpCard}: the page title/subtitle,
 * then a stack of follow-up cards each with a client/invoice header row (name
 * + tier badges), the drafted-content body as a few text lines, and the
 * action-button footer.
 */
export default function FollowUpsLoading() {
  return (
    <div className="min-h-screen">
      <Nav />
      <main className="container space-y-6 py-8">
        <div className="space-y-2">
          <Skeleton className="h-7 w-72" />
          <Skeleton className="h-4 w-96" />
        </div>

        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <Card key={index}>
              <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3.5 w-40" />
                </div>
                <div className="flex items-center gap-2">
                  <Skeleton className="h-5 w-24 rounded-full" />
                  <Skeleton className="h-5 w-16 rounded-full" />
                </div>
              </CardHeader>
              <CardContent>
                <SkeletonText lines={3} />
              </CardContent>
              <CardFooter className="flex flex-wrap items-center gap-2">
                <Skeleton className="h-8 w-28" />
                <Skeleton className="h-8 w-16" />
                <Skeleton className="h-8 w-40" />
                <Skeleton className="h-8 w-20" />
              </CardFooter>
            </Card>
          ))}
        </div>
      </main>
    </div>
  );
}
