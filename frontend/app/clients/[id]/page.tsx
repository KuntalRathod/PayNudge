import { Nav } from '@/components/nav';
import { ClientDetail } from './client-detail';

/**
 * Client Detail page (Clients section upgrade).
 *
 * Reads the client id from the route params and delegates to
 * {@link ClientDetail}, which loads the client's fields, aggregated stats, and
 * full invoice list in a single request and renders them. Route access is
 * guarded by the Next.js middleware (Req 1.7).
 */
export default function ClientDetailPage({ params }: { params: { id: string } }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Nav />
      <main className="container flex-1 py-8">
        <ClientDetail clientId={params.id} />
      </main>
    </div>
  );
}
