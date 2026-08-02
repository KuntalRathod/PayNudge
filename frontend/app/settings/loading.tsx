import { Nav } from '@/components/nav';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Settings loading skeleton.
 *
 * Mirrors {@link SettingsForm}: the company-logo card, the business-profile
 * fields card (label + input pairs), the follow-up cadence's 3-column input
 * row, and the save-button footer — all inside the same `max-w-2xl` column.
 */
export default function SettingsLoading() {
  return (
    <>
      <Nav />
      <main className="container py-8">
        <Skeleton className="mb-6 h-8 w-32" />

        <div className="max-w-2xl space-y-6">
          <Card>
            <CardHeader className="space-y-2">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-64" />
            </CardHeader>
            <CardContent className="flex items-center gap-4">
              <Skeleton className="h-16 w-16 rounded-md" />
              <Skeleton className="h-8 w-48" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-72" />
            </CardHeader>
            <CardContent className="space-y-4">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-9 w-full" />
                </div>
              ))}
            </CardContent>

            <CardHeader className="space-y-2 pt-0">
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-4 w-80" />
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-9 w-full" />
                </div>
              ))}
            </CardContent>

            <CardFooter>
              <Skeleton className="h-9 w-32" />
            </CardFooter>
          </Card>
        </div>
      </main>
    </>
  );
}
