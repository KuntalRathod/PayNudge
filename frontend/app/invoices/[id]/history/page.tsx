'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiGet } from '@/lib/api/client';
import { Nav } from '@/components/nav';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Invoice history view (Req 11.1, 11.2).
 *
 * Renders an owned invoice's details and current status together with its
 * follow-up history — the list of "sent" follow-ups with escalation tier and
 * delivery timestamp, ordered earliest→latest (the backend orders by `sent_at`
 * ascending — Req 11.2). A missing or unowned invoice yields a "not available"
 * message and no details (Req 11.5), which we surface from the backend's error
 * result.
 *
 * This is a client component because it reads data through the authenticated
 * browser API client (which attaches the Supabase session JWT). Only this route
 * file is owned by task 15.5; the invoice list/detail pages are built by 15.3.
 */

interface HistoryInvoice {
  id: string;
  invoice_number: number;
  amount: string | number;
  description: string;
  due_date: string;
  status: string;
  client: { id: string; name: string; email: string; company: string | null } | null;
}

interface FollowUpHistoryEntry {
  id: string;
  tier: string;
  sent_at: string | null;
}

interface InvoiceHistoryResponse {
  invoice: HistoryInvoice;
  follow_up_history: FollowUpHistoryEntry[];
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

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function tierLabel(tier: string): string {
  switch (tier) {
    case 'polite':
      return 'Polite';
    case 'firm':
      return 'Firm';
    case 'final_notice':
      return 'Final notice';
    default:
      return tier;
  }
}

export default function InvoiceHistoryPage({ params }: { params: { id: string } }) {
  const invoiceId = params.id;
  const [data, setData] = useState<InvoiceHistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await apiGet<InvoiceHistoryResponse>(`/invoices/${invoiceId}/history`);
    if (!result.ok) {
      setError(result.error);
      setData(null);
    } else {
      setData(result.data);
    }
    setLoading(false);
  }, [invoiceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const invoice = data?.invoice;
  const history = data?.follow_up_history ?? [];

  return (
    <div className="min-h-screen">
      <Nav />
      <main className="container space-y-6 py-8">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold tracking-tight">Invoice history</h1>
          <Link
            href="/invoices"
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            Back to invoices
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

        {invoice ? (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-xl">
                  Invoice #{invoice.invoice_number}
                  <span className="ml-2 inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium align-middle">
                    {invoice.status}
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                  <div>
                    <dt className="text-muted-foreground">Client</dt>
                    <dd className="font-medium">{invoice.client?.name ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Amount</dt>
                    <dd className="font-medium">{formatAmount(invoice.amount)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Due date</dt>
                    <dd className="font-medium">{formatDate(invoice.due_date)}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-muted-foreground">Description of work</dt>
                    <dd className="whitespace-pre-wrap font-medium">{invoice.description}</dd>
                  </div>
                </dl>
              </CardContent>
            </Card>

            <section className="space-y-3">
              <h2 className="text-lg font-semibold tracking-tight">Follow-up history</h2>
              {history.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No follow-ups have been sent for this invoice yet.
                </p>
              ) : (
                <ul className="space-y-2">
                  {history.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex items-center justify-between rounded-md border p-3 text-sm"
                    >
                      <span className="font-medium">{tierLabel(entry.tier)}</span>
                      <span className="text-muted-foreground">
                        Sent {formatDateTime(entry.sent_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
