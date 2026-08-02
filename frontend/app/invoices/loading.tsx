import { Nav } from '@/components/nav';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonTable } from '@/components/ui/skeleton-card';

/**
 * Invoices list loading skeleton.
 *
 * Mirrors {@link InvoicesPage}: header title + "New invoice" button, the
 * status filter pills + search box row, then the invoices table (Number,
 * Description, Amount, Due date, Status — 5 columns) as a
 * {@link SkeletonTable}.
 */
export default function InvoicesLoading() {
  return (
    <>
      <Nav />
      <main className="container py-8">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-7 w-28" />
            <Skeleton className="h-4 w-64" />
          </div>
          <Skeleton className="h-9 w-32" />
        </div>

        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-1.5">
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-8 w-16 rounded-full" />
              ))}
            </div>
            <Skeleton className="h-9 w-full sm:w-64" />
          </div>

          <SkeletonTable
            columns={5}
            rows={6}
            columnWidths={['w-16', 'w-48', 'w-20', 'w-24', 'w-20']}
          />
        </div>
      </main>
    </>
  );
}
