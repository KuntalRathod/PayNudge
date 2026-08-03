'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { apiGet } from '@/lib/api/client';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonStatCard, SkeletonTableRow } from '@/components/ui/skeleton-card';
import { StatCard } from '@/app/dashboard/stat-card';
import { StatusBadge } from '@/app/invoices/status-badge';
import type { InvoiceStatus } from '@/app/invoices/types';
import { formatClientAmount, formatClientDate } from '../format';
import type { ClientDetailResponse } from '../types';

/**
 * Client Detail page content (Clients section upgrade).
 *
 * Loads a single owned client's full detail bundle via `GET /clients/:id/detail`
 * (client fields + aggregated stats + full invoice list) in one request, and
 * renders:
 *   - the client's name/email/company with an Edit action,
 *   - headline stats (total billed, total paid, outstanding, invoice count)
 *     using the same {@link StatCard} component as the upgraded Dashboard for
 *     visual consistency,
 *   - the full list of the client's invoices (status, amount, due date), each
 *     row linking to that invoice's detail page.
 *
 * A missing or unowned client resolves to a "not available" response under
 * RLS, surfaced as a friendly not-found message with a link back to the list
 * (existence is never disclosed).
 */
export function ClientDetail({ clientId }: { clientId: string }) {
  const [data, setData] = useState<ClientDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await apiGet<ClientDetailResponse>(`/clients/${clientId}/detail`);
    if (!result.ok) {
      setError(result.error);
      setData(null);
    } else {
      setData(result.data);
    }
    setLoading(false);
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-4 w-48" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-16" />
            <Skeleton className="h-9 w-28" />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <SkeletonStatCard key={index} hint={index === 2} />
          ))}
        </div>
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-24" />
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  {Array.from({ length: 5 }).map((_, index) => (
                    <th key={index} className="px-4 py-3 text-left">
                      <Skeleton className="h-3.5 w-16" />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 4 }).map((_, index) => (
                  <SkeletonTableRow
                    key={index}
                    columns={5}
                    columnWidths={['w-16', 'w-48', 'w-20', 'w-24', 'w-20']}
                  />
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p role="alert" className="text-sm text-destructive">
          {error ?? 'Client not available.'}
        </p>
        <Link href="/clients" className={buttonVariants({ variant: 'outline' })}>
          Back to clients
        </Link>
      </div>
    );
  }

  const { client, stats, invoices } = data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{client.name}</h1>
          <p className="text-sm text-muted-foreground">{client.email}</p>
          {client.company ? (
            <p className="text-sm text-muted-foreground">{client.company}</p>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Link href={`/clients/${client.id}/edit`} className={buttonVariants({ variant: 'outline' })}>
            Edit
          </Link>
          <Link href="/clients" className={buttonVariants({ variant: 'ghost' })}>
            Back to clients
          </Link>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total billed" value={formatClientAmount(stats.totalBilled)} />
        <StatCard
          label="Total paid"
          value={formatClientAmount(stats.totalPaid)}
          tone="success"
        />
        <StatCard
          label="Outstanding"
          value={formatClientAmount(stats.outstandingAmount)}
          tone={stats.outstandingAmount > 0 ? 'danger' : 'default'}
          hint={
            stats.overdueCount > 0
              ? `${formatClientAmount(stats.overdueAmount)} overdue (${stats.overdueCount})`
              : undefined
          }
        />
        <StatCard label="Invoices" value={String(stats.invoiceCount)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Invoices</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          {invoices.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              This client has no invoices yet.
            </p>
          ) : (
            <table className="w-full text-sm">
              <caption className="sr-only">Invoices for {client.name}</caption>
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th scope="col" className="px-4 py-3 font-medium">
                    Number
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Description
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Amount
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Due date
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr key={invoice.id} className="border-b last:border-0 hover:bg-muted/50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/invoices/${invoice.id}`}
                        className="font-medium text-primary underline-offset-4 hover:underline"
                      >
                        #{invoice.invoice_number}
                      </Link>
                    </td>
                    <td className="max-w-xs truncate px-4 py-3">{invoice.description}</td>
                    <td className="px-4 py-3">{formatClientAmount(invoice.amount)}</td>
                    <td className="px-4 py-3">{formatClientDate(invoice.due_date)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={invoice.status as InvoiceStatus} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
