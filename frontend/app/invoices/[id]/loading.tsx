import { Nav } from '@/components/nav';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Invoice detail loading skeleton.
 *
 * Mirrors {@link InvoiceDetailView}: a centered max-w-2xl column with the
 * invoice-header card (title + status badge, the 2-col `dl` of fields, and
 * the action button row) followed by the activity-timeline card.
 */
export default function InvoiceDetailLoading() {
  return (
    <>
      <Nav />
      <main className="container flex justify-center py-8">
        <div className="w-full max-w-2xl space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <Skeleton className="h-6 w-40" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {Array.from({ length: 4 }).map((_, index) => (
                  <div key={index} className="space-y-1.5">
                    <Skeleton className="h-3.5 w-20" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                ))}
                <div className="space-y-1.5 sm:col-span-2">
                  <Skeleton className="h-3.5 w-32" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              </dl>

              <div className="flex flex-wrap items-center gap-3">
                <Skeleton className="h-9 w-28" />
                <Skeleton className="h-9 w-32" />
                <Skeleton className="h-9 w-16" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-40" />
            </CardHeader>
            <CardContent>
              <div className="space-y-6 border-l pl-6">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div key={index} className="space-y-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3.5 w-24" />
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </>
  );
}
