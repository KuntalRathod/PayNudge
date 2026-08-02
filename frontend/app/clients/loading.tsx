import { Nav } from '@/components/nav';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Clients list loading skeleton.
 *
 * Mirrors {@link ClientsPage}/{@link ClientsList}: header + "New client"
 * button, the search box, then a `sm:grid-cols-2 lg:grid-cols-3` grid of
 * client cards, each with a name/email header and a 2x2 stat grid (Invoices,
 * Outstanding, Overdue, Last activity) matching the real card body.
 */
export default function ClientsLoading() {
  return (
    <div className="flex min-h-screen flex-col">
      <Nav />
      <main className="container flex-1 py-8">
        <div className="mb-6 flex items-center justify-between">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-9 w-28" />
        </div>

        <div className="space-y-4">
          <Skeleton className="h-9 w-full sm:max-w-xs" />

          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <li key={index}>
                <Card className="h-full">
                  <CardHeader className="pb-3">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="mt-2 h-3.5 w-36" />
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-3 pt-0">
                    {Array.from({ length: 4 }).map((_, statIndex) => (
                      <div key={statIndex} className="space-y-1">
                        <Skeleton className="h-3 w-16" />
                        <Skeleton className="h-4 w-14" />
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        </div>
      </main>
    </div>
  );
}
