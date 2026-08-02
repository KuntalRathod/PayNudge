import { Nav } from '@/components/nav';
import { InvoiceDetailView } from './invoice-detail';

/**
 * Invoice detail view (Req 3.8, 4.1, 6.1, 11.7). Renders the shared nav shell
 * and the client-side detail component for the invoice identified by the route
 * param. The route is protected by the Next.js middleware guard (Req 1.7).
 */
export default function InvoiceDetailPage({ params }: { params: { id: string } }) {
  return (
    <>
      <Nav />
      <main className="container flex justify-center py-8">
        <InvoiceDetailView invoiceId={params.id} />
      </main>
    </>
  );
}
