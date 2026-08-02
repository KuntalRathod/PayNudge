'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiGet } from '@/lib/api/client';
import { Nav } from '@/components/nav';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Client history view (Req 11.3).
 *
 * Lists every invoice associated with an owned client together with each
 * invoice's current status (Req 11.3). A missing or unowned client yields a
 * "not available" message and no invoice records (Req 11.6), surfaced from the
 * backend's error result on `GET /clients/:id/history`.
 *
 * The history endpoint returns only invoices, so the client's name for the page
 * header is fetched best-effort from `GET /clients/:id` in parallel; the
 * history call remains the authoritative ownership check.
 *
 * This is a client component because it reads data through the authenticated
 * browser API client (which attaches the Supabase session JWT). Only this route
 * file is owned by task 15.5; the client list/detail pages are built by 15.2.
 */

interface HistoryInvoice {
  id: string;
  invoice_number: number;
  amount: string | number;
  description: string;
  due_date: string;
  status: string;
}

interface ClientHistoryResponse {
  invoices: HistoryInvoice[];
}

interface ClientDetail {
  id: string;
  name: string;
  email: string;
  company: string | null;
}

interface ClientDetailResponse {
  client: ClientDetail;
}

function formatAmount(amount: string | number): string {
  const value = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(value)) return String(amount);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

export default function ClientHistoryPage({ params }: { params: { id: string } }) {
  const clientId = params.id;
  const [invoices, setInvoices] = useState<HistoryInvoice[]>([]);
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    // The history call is authoritative for ownership (Req 11.6); the detail
    // call only enriches the header, so its failure is non-fatal.
    const [historyResult, detailResult] = await Promise.all([
      apiGet<ClientHistoryResponse>(`/clients/${clientId}/history`),
      apiGet<ClientDetailResponse>(`/clients/${clientId}`),
    ]);

    if (!historyResult.ok) {
      setError(historyResult.error);
      setInvoices([]);
      setClient(null);
      setLoading(false);
      return;
    }

    setInvoices(historyResult.data.invoices ?? []);
    setClient(detailResult.ok ? detailResult.data.client : null);
    setLoading(false);
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="min-h-screen">
      <Nav />
      <main className="container space-y-6 py-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">
            {client ? `${client.name} · history` : 'Client history'}
          </h1>
          <Link
            href="/clients"
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            Back to clients
          </Link>
        </div>

        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, index) => (
              <Card key={index}>
                <CardHeader>
                  <Skeleton className="h-5 w-40" />
                </CardHeader>
                <CardContent className="space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-2/3" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : null}

        {error ? (
          <div
            role="alert"
            className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive"
          >
            {error}
          </div>
        ) : null}

        {!loading && !error ? (
          invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This client has no invoices yet.
            </p>
          ) : (
            <div className="space-y-3">
              {invoices.map((invoice) => (
                <Card key={invoice.id}>
                  <CardHeader className="flex flex-row items-center justify-between">
                    <CardTitle className="text-base">
                      Invoice #{invoice.invoice_number}
                    </CardTitle>
                    <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium">
                      {invoice.status}
                    </span>
                  </CardHeader>
                  <CardContent className="text-sm">
                    <div className="flex flex-wrap gap-x-6 gap-y-1 text-muted-foreground">
                      <span>{formatAmount(invoice.amount)}</span>
                      <span>due {formatDate(invoice.due_date)}</span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap">{invoice.description}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )
        ) : null}
      </main>
    </div>
  );
}
