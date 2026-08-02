import { Nav } from '@/components/nav';
import { EditClient } from './edit-client';

/**
 * Edit-client view (Req 2.9).
 *
 * Reads the client id from the route params and delegates to {@link EditClient},
 * which loads the client and renders the prefilled shared form. Route access is
 * guarded by the Next.js middleware (Req 1.7).
 */
export default function EditClientPage({ params }: { params: { id: string } }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Nav />
      <main className="container flex-1 py-8">
        <EditClient clientId={params.id} />
      </main>
    </div>
  );
}
