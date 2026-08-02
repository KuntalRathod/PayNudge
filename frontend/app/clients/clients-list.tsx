'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { apiGet } from '@/lib/api/client';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { formatClientAmount, formatClientDate } from './format';
import type { ClientListResponse, ClientWithStats } from './types';

/**
 * Client list (Req 2.6, 2.7; upgraded with stats, search, and full-card
 * navigation to the Client Detail page).
 *
 * Fetches the authenticated user's clients (enriched with per-client invoice
 * stats) from `GET /clients` and renders one card per client showing invoice
 * count, outstanding amount, overdue amount, and last activity date. The
 * entire card links to `/clients/:id` (the new Client Detail page). A search
 * box filters by name or email client-side. When the user owns no clients the
 * backend returns an empty array and we show a dedicated empty state with a
 * call to action (Req 2.6). All owned clients are shown (Req 2.7); ownership is
 * enforced server-side by RLS.
 */
type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; clients: ClientWithStats[] };

export function ClientsList() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [search, setSearch] = useState('');

  useEffect(() => {
    let active = true;
    void (async () => {
      const result = await apiGet<ClientListResponse>('/clients');
      if (!active) return;
      if (!result.ok) {
        setState({ status: 'error', message: result.error });
        return;
      }
      setState({ status: 'ready', clients: result.data.clients ?? [] });
    })();
    return () => {
      active = false;
    };
  }, []);

  const filtered = useMemo(() => {
    if (state.status !== 'ready') return [];
    const query = search.trim().toLowerCase();
    if (query.length === 0) return state.clients;
    return state.clients.filter((client) => {
      const haystack = `${client.name} ${client.email}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [state, search]);

  if (state.status === 'loading') {
    return (
      <div className="space-y-4">
        <Skeleton className="h-9 w-full sm:max-w-xs" />
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <li key={index}>
              <Card className="h-full">
                <CardHeader className="pb-3">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="mt-2 h-3.5 w-36" />
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-3 pt-0">
                  {Array.from({ length: 4 }).map((_, statIndex) => (
                    <div key={statIndex} className="space-y-1">
                      <Skeleton className="h-3 w-16" />
                      <Skeleton className="h-4 w-14" />
                    </div>
                  ))}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <p role="alert" className="text-sm text-destructive">
        {state.message}
      </p>
    );
  }

  if (state.clients.length === 0) {
    // Empty state (Req 2.6).
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-2xl">
            👤
          </div>
          <h2 className="text-lg font-semibold">No clients yet</h2>
          <p className="max-w-sm text-sm text-muted-foreground">
            Add your first client to start billing. You&apos;ll be able to create invoices for
            them right after.
          </p>
          <Link href="/clients/new" className={buttonVariants()}>
            Add your first client
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Input
        type="search"
        placeholder="Search by name or email…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="sm:max-w-xs"
        aria-label="Search clients"
      />

      {filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
            <p className="text-sm text-muted-foreground">No clients match your search.</p>
          </CardContent>
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((client) => (
            <li key={client.id}>
              <Link
                href={`/clients/${client.id}`}
                className={cn(
                  'block h-full rounded-lg transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                )}
              >
                <Card className="h-full">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base font-medium">{client.name}</CardTitle>
                    <p className="truncate text-sm text-muted-foreground">{client.email}</p>
                    {client.company ? (
                      <p className="truncate text-sm text-muted-foreground">{client.company}</p>
                    ) : null}
                  </CardHeader>
                  <CardContent className="grid grid-cols-2 gap-3 pt-0 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Invoices</p>
                      <p className="font-medium tabular-nums">{client.stats.invoiceCount}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Outstanding</p>
                      <p className="font-medium tabular-nums">
                        {formatClientAmount(client.stats.outstandingAmount)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Overdue</p>
                      <p
                        className={cn(
                          'font-medium tabular-nums',
                          client.stats.overdueCount > 0 && 'text-red-600 dark:text-red-400',
                        )}
                      >
                        {client.stats.overdueCount > 0
                          ? `${formatClientAmount(client.stats.overdueAmount)} (${client.stats.overdueCount})`
                          : formatClientAmount(0)}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Last activity</p>
                      <p className="font-medium">
                        {formatClientDate(client.stats.lastInvoiceDate)}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
