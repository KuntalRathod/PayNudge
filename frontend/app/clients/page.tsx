import Link from 'next/link';
import { Nav } from '@/components/nav';
import { buttonVariants } from '@/components/ui/button';
import { ClientsList } from './clients-list';

/**
 * Clients index (Req 2.6, 2.7).
 *
 * Authenticated shell (shared {@link Nav}) with a header action to create a new
 * client and the {@link ClientsList}, which loads and renders the user's owned
 * clients (or an empty state). Route access is guarded by the Next.js
 * middleware (Req 1.7).
 */
export default function ClientsPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Nav />
      <main className="container flex-1 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
          <Link href="/clients/new" className={buttonVariants()}>
            New client
          </Link>
        </div>
        <ClientsList />
      </main>
    </div>
  );
}
