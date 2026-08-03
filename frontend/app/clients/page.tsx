'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { Nav } from '@/components/nav';
import { buttonVariants } from '@/components/ui/button';
import { ClientsList } from './clients-list';
import { ImportCsvDialog } from './import-csv-dialog';

/**
 * Clients index (Req 2.6, 2.7).
 *
 * Authenticated shell (shared Nav) with header actions to create a new client
 * or import from CSV, plus the ClientsList which loads and renders the user's
 * owned clients (or an empty state).
 */
export default function ClientsPage() {
  const [refreshKey, setRefreshKey] = useState(0);

  const handleImported = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <Nav />
      <main className="container flex-1 py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
          <div className="flex items-center gap-2">
            <ImportCsvDialog onImported={handleImported} />
            <Link href="/clients/new" className={buttonVariants()}>
              New client
            </Link>
          </div>
        </div>
        <ClientsList key={refreshKey} />
      </main>
    </div>
  );
}
