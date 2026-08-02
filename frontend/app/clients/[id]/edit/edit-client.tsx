'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiGet } from '@/lib/api/client';
import { buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ClientForm } from '../../client-form';
import type { Client, ClientResponse } from '../../types';

/**
 * Edit-client loader (Req 2.9).
 *
 * Fetches the target client via `GET /clients/:id` and, once loaded, renders
 * the shared {@link ClientForm} in edit mode prefilled with the stored values.
 * A missing or unowned client resolves to a "not available" response under RLS,
 * which we surface as a friendly not-found message with a link back to the
 * list (existence is never disclosed).
 */
type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; client: Client };

export function EditClient({ clientId }: { clientId: string }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    void (async () => {
      const result = await apiGet<ClientResponse>(`/clients/${clientId}`);
      if (!active) return;
      if (!result.ok) {
        setState({ status: 'error', message: result.error });
        return;
      }
      setState({ status: 'ready', client: result.data.client });
    })();
    return () => {
      active = false;
    };
  }, [clientId]);

  if (state.status === 'loading') {
    return (
      <div className="space-y-4">
        <Skeleton className="h-5 w-32" />
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="space-y-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
        <Link href="/clients" className={buttonVariants({ variant: 'outline' })}>
          Back to clients
        </Link>
      </div>
    );
  }

  return <ClientForm mode="edit" initialClient={state.client} />;
}
