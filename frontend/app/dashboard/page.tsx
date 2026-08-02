import Link from 'next/link';
import { Nav } from '@/components/nav';
import { buttonVariants } from '@/components/ui/button';
import { DashboardView } from './dashboard-view';

/**
 * Dashboard page (Task 15.4, Req 5; upgraded with Quick Actions).
 *
 * The home view for authenticated users. Access is gated by the Next.js
 * middleware route guard (Req 1.7); this page renders the shared nav shell,
 * two quick-action shortcuts next to the title, and delegates data loading/
 * rendering to {@link DashboardView}, which fetches the per-user summary and
 * activity feed from the backend.
 */
export default function DashboardPage() {
  return (
    <div className="min-h-screen">
      <Nav />
      <main className="container py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <div className="flex flex-wrap gap-2">
            <Link href="/invoices/new" className={buttonVariants({ size: 'sm' })}>
              + New Invoice
            </Link>
            <Link
              href="/follow-ups"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              Review Follow-ups
            </Link>
          </div>
        </div>
        <DashboardView />
      </main>
    </div>
  );
}
