'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Nav } from '@/components/nav';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { SkeletonTable } from '@/components/ui/skeleton-card';
import { apiGet } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { formatAmount, formatDate } from './format';
import { StatusBadge } from './status-badge';
import type { InvoiceListItem, InvoiceListResponse, InvoiceStatus } from './types';

/** Filter tabs shown above the invoice list (Feature: small polish). */
const FILTERS: ReadonlyArray<{ value: InvoiceStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'paid', label: 'Paid' },
];

/**
 * Invoices list view (Req 3.8), with status filters and a search box (Feature:
 * small polish) and an improved empty state (Feature: empty states).
 *
 * Fetches the authenticated user's invoices via `GET /invoices` and renders each
 * with its number, client, amount, due date, and status. The list is a client
 * component because the shared API client attaches the browser Supabase
 * session's JWT; the route itself is already protected by the Next.js middleware
 * guard (Req 1.7). Each row links to the invoice detail view.
 */
const VALID_STATUSES: ReadonlyArray<InvoiceStatus> = ['draft', 'sent', 'overdue', 'paid'];

function InvoicesPageInner() {
  const searchParams = useSearchParams();
  const statusParam = searchParams.get('status');
  const initialFilter: InvoiceStatus | 'all' =
    statusParam && VALID_STATUSES.includes(statusParam as InvoiceStatus)
      ? (statusParam as InvoiceStatus)
      : 'all';

  const [invoices, setInvoices] = useState<InvoiceListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<InvoiceStatus | 'all'>(initialFilter);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setError(null);
    const result = await apiGet<InvoiceListResponse>('/invoices');
    if (!result.ok) {
      setError(result.error);
      setInvoices([]);
      return;
    }
    setInvoices(result.data.invoices ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    if (!invoices) return [];
    const query = search.trim().toLowerCase();
    return invoices.filter((invoice) => {
      if (filter !== 'all' && invoice.status !== filter) {
        return false;
      }
      if (query.length === 0) {
        return true;
      }
      const haystack = `${invoice.invoice_number} ${invoice.description}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [invoices, filter, search]);

  const isEmptyAccount = invoices !== null && invoices.length === 0;
  const noResultsForFilter =
    invoices !== null && invoices.length > 0 && filtered.length === 0;

  return (
    <>
      <Nav />
      <main className="container py-8">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Invoices</h1>
            <p className="text-sm text-muted-foreground">
              Create, send, and track the status of your invoices.
            </p>
          </div>
          <Link href="/invoices/new" className={buttonVariants()}>
            New invoice
          </Link>
        </div>

        {error ? (
          <p role="alert" className="mb-4 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        {invoices === null ? (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-1.5">
                {Array.from({ length: 5 }).map((_, index) => (
                  <Skeleton key={index} className="h-8 w-16 rounded-full" />
                ))}
              </div>
              <Skeleton className="h-9 w-full sm:w-64" />
            </div>
            <SkeletonTable columns={5} rows={6} columnWidths={['w-16', 'w-48', 'w-20', 'w-24', 'w-20']} />
          </div>
        ) : isEmptyAccount ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-2xl">
                🧾
              </div>
              <h2 className="text-lg font-semibold">No invoices yet</h2>
              <p className="max-w-sm text-sm text-muted-foreground">
                Create your first invoice to start billing clients and let the AI chase
                overdue ones automatically.
              </p>
              <Link href="/invoices/new" className={buttonVariants()}>
                Create your first invoice
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter by status">
                {FILTERS.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    role="tab"
                    aria-selected={filter === f.value}
                    onClick={() => setFilter(f.value)}
                    className={cn(
                      'rounded-full px-3 py-1.5 text-sm font-medium transition-colors',
                      filter === f.value
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                    )}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
              <Input
                type="search"
                placeholder="Search by invoice # or description…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="sm:w-64"
                aria-label="Search invoices"
              />
            </div>

            {noResultsForFilter ? (
              <Card>
                <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
                  <p className="text-sm text-muted-foreground">
                    No invoices match this filter or search.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <table className="w-full text-sm">
                    <caption className="sr-only">Your invoices</caption>
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
                      {filtered.map((invoice) => (
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
                          <td className="px-4 py-3">{formatAmount(invoice.amount)}</td>
                          <td className="px-4 py-3">{formatDate(invoice.due_date)}</td>
                          <td className="px-4 py-3">
                            <StatusBadge status={invoice.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </main>
    </>
  );
}

/**
 * Default export wrapped in Suspense because {@link InvoicesPageInner} reads
 * `useSearchParams()` (to support deep-linking from the dashboard's "Needs
 * your attention" section, e.g. `/invoices?status=overdue`), which requires a
 * Suspense boundary in the Next.js App Router.
 */
export default function InvoicesPage() {
  return (
    <Suspense fallback={null}>
      <InvoicesPageInner />
    </Suspense>
  );
}
