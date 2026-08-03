import { Nav } from '@/components/nav';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonStatCard, SkeletonTableRow } from '@/components/ui/skeleton-card';

/**
 * Client detail loading skeleton.
 *
 * Mirrors {@link ClientDetail}: the name/email header with Edit/Back actions,
 * the `sm:grid-cols-2 lg:grid-cols-4` stat grid (Total billed, Total paid,
 * Outstanding, Invoices — reusing the same {@link SkeletonStatCard} as the
 * dashboard for visual consistency), and the client's invoices table.
 */
export default function ClientDetailLoading() {
  return (
    <div className="flex min-h-screen flex-col">
      <Nav />
      <main className="container flex-1 py-8">
        <div className="space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <Skeleton className="h-7 w-40" />
              <Skeleton className="h-4 w-48" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-9 w-16" />
              <Skeleton className="h-9 w-28" />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <SkeletonStatCard key={index} hint={index === 2} />
            ))}
          </div>

          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-24" />
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    {Array.from({ length: 5 }).map((_, index) => (
                      <th key={index} className="px-4 py-3 text-left">
                        <Skeleton className="h-3.5 w-16" />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 4 }).map((_, index) => (
                    <SkeletonTableRow
                      key={index}
                      columns={5}
                      columnWidths={['w-16', 'w-48', 'w-20', 'w-24', 'w-20']}
                    />
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
