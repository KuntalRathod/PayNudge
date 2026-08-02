import { Nav } from '@/components/nav';
import { InvoiceForm } from './invoice-form';

/**
 * Create-invoice view (Req 3.1). Renders the shared nav shell and the
 * client-side create form. The route is protected by the Next.js middleware
 * guard (Req 1.7).
 */
export default function NewInvoicePage() {
  return (
    <>
      <Nav />
      <main className="container flex justify-center py-8">
        <InvoiceForm />
      </main>
    </>
  );
}
