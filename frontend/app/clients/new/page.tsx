import { Nav } from '@/components/nav';
import { ClientForm } from '../client-form';

/**
 * Create-client view (Req 2.1).
 *
 * Renders the shared {@link ClientForm} in create mode, which POSTs to
 * `/clients` and surfaces field-level validation errors returned by the
 * backend. Route access is guarded by the Next.js middleware (Req 1.7).
 */
export default function NewClientPage() {
  return (
    <div className="flex min-h-screen flex-col">
      <Nav />
      <main className="container flex-1 py-8">
        <ClientForm mode="create" />
      </main>
    </div>
  );
}
