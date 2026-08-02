'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { apiDelete, apiDownload, apiGet, apiPost, type ApiResult } from '@/lib/api/client';
import { formatAmount, formatDate } from '../format';
import { StatusBadge } from '../status-badge';
import type { InvoiceDetail, InvoiceResponse } from '../types';
import { InvoiceTimeline } from './invoice-timeline';
import { MarkPaidDialog } from './mark-paid-dialog';

/** Which async action is currently running (disables the others). */
type PendingAction = 'send' | 'delete' | 'pdf' | null;

/**
 * Invoice detail view with lifecycle actions (Req 3.8, 4.1, 6.1, 11.7).
 *
 * Loads a single owned invoice via `GET /invoices/:id` and renders its amount,
 * description, due date, number, associated client, and status. It exposes the
 * status-appropriate actions:
 *
 *   - Send (`POST /invoices/:id/send`) for a draft invoice (Req 4.1).
 *   - Mark as paid (via {@link MarkPaidDialog}, `POST /invoices/:id/pay`) for a
 *     sent/overdue invoice (Req 6.1), capturing a payment date + note.
 *   - Delete (`DELETE /invoices/:id`), always available, behind a confirm step
 *     because it cascades to the invoice's follow-ups (Req 11.7).
 *
 * Below the action card, {@link InvoiceTimeline} renders the invoice's full
 * chronological activity history (Invoice Activity Timeline feature). Actions
 * that append a new timeline event bump `timelineRefreshKey` so the timeline
 * reloads without a full page refresh.
 */
export function InvoiceDetailView({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();

  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [pending, setPending] = useState<PendingAction>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [markPaidOpen, setMarkPaidOpen] = useState(false);
  const [timelineRefreshKey, setTimelineRefreshKey] = useState(0);
  const [followUpCount, setFollowUpCount] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const result = await apiGet<InvoiceResponse>(`/invoices/${invoiceId}`);
    if (!result.ok) {
      setLoadError(result.error);
      setInvoice(null);
      setLoading(false);
      return;
    }
    setInvoice(result.data.invoice);
    setLoading(false);
  }, [invoiceId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSend() {
    setPending('send');
    setActionError(null);
    setActionMessage(null);
    const result = await apiPost<InvoiceResponse>(`/invoices/${invoiceId}/send`);
    if (!result.ok) {
      setActionError(result.error);
      setPending(null);
      return;
    }
    setActionMessage('Invoice sent.');
    setInvoice(result.data.invoice);
    setTimelineRefreshKey((key) => key + 1);
    setPending(null);
  }

  function handlePaid(result: ApiResult<InvoiceResponse>) {
    setActionError(null);
    if (!result.ok) {
      setActionError(result.error);
      return;
    }
    setActionMessage(result.data.message ?? 'Invoice has been marked paid.');
    setInvoice(result.data.invoice);
    setTimelineRefreshKey((key) => key + 1);
  }

  async function handleDownloadPdf() {
    setPending('pdf');
    setActionError(null);
    setActionMessage(null);
    const result = await apiDownload(`/invoices/${invoiceId}/pdf`);
    if (!result.ok) {
      setActionError(result.error);
      setPending(null);
      return;
    }

    const url = URL.createObjectURL(result.blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = result.filename ?? `invoice-${invoice?.invoice_number ?? invoiceId}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setPending(null);
  }

  async function handleDelete() {
    setPending('delete');
    setActionError(null);
    setActionMessage(null);
    const result = await apiDelete(`/invoices/${invoiceId}`);
    if (!result.ok) {
      setActionError(result.error);
      setPending(null);
      setConfirmingDelete(false);
      return;
    }
    router.push('/invoices');
    router.refresh();
  }

  if (loading) {
    return (
      <div className="w-full max-w-2xl space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="space-y-1.5">
                  <Skeleton className="h-3.5 w-20" />
                  <Skeleton className="h-4 w-32" />
                </div>
              ))}
            </dl>
            <div className="flex flex-wrap items-center gap-3">
              <Skeleton className="h-9 w-28" />
              <Skeleton className="h-9 w-32" />
              <Skeleton className="h-9 w-16" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
          </CardHeader>
          <CardContent>
            <div className="space-y-6 border-l pl-6">
              {Array.from({ length: 3 }).map((_, index) => (
                <div key={index} className="space-y-2">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3.5 w-24" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loadError || !invoice) {
    return (
      <div className="space-y-4">
        <p role="alert" className="text-sm text-destructive">
          {loadError ?? 'Invoice not available.'}
        </p>
        <Link href="/invoices" className={buttonVariants({ variant: 'outline' })}>
          Back to invoices
        </Link>
      </div>
    );
  }

  const canSend = invoice.status === 'draft';
  const canPay = invoice.status === 'sent' || invoice.status === 'overdue';
  const busy = pending !== null;

  return (
    <div className="w-full max-w-2xl space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <CardTitle>Invoice #{invoice.invoice_number}</CardTitle>
            <div className="flex items-center gap-2">
              {followUpCount !== null && followUpCount > 0 ? (
                <span className="inline-flex items-center rounded-full bg-indigo-500/10 px-2.5 py-0.5 text-xs font-medium text-indigo-600 dark:text-indigo-400">
                  {followUpCount} follow-up{followUpCount !== 1 ? 's' : ''} sent
                </span>
              ) : null}
              <StatusBadge status={invoice.status} />
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-sm text-muted-foreground">Client</dt>
              <dd className="text-sm font-medium">
                {invoice.client ? (
                  <>
                    {invoice.client.name}
                    {invoice.client.company ? ` (${invoice.client.company})` : ''}
                    <span className="block font-normal text-muted-foreground">
                      {invoice.client.email}
                    </span>
                  </>
                ) : (
                  '—'
                )}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Amount</dt>
              <dd className="text-sm font-medium">{formatAmount(invoice.amount)}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Due date</dt>
              <dd className="text-sm font-medium">{formatDate(invoice.due_date)}</dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">Invoice number</dt>
              <dd className="text-sm font-medium">#{invoice.invoice_number}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-sm text-muted-foreground">Description of work</dt>
              <dd className="whitespace-pre-wrap text-sm font-medium">{invoice.description}</dd>
            </div>
          </dl>

          {actionMessage ? (
            <p role="status" className="text-sm text-green-700">
              {actionMessage}
            </p>
          ) : null}
          {actionError ? (
            <p role="alert" className="text-sm text-destructive">
              {actionError}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            {canSend ? (
              <Button onClick={handleSend} disabled={busy}>
                {pending === 'send' ? 'Sending…' : 'Send invoice'}
              </Button>
            ) : null}
            {canPay ? (
              <Button variant="secondary" onClick={() => setMarkPaidOpen(true)} disabled={busy}>
                Mark as paid
              </Button>
            ) : null}

            <Button variant="outline" onClick={handleDownloadPdf} disabled={busy}>
              {pending === 'pdf' ? 'Preparing PDF…' : 'Download PDF'}
            </Button>

            {confirmingDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">Delete this invoice?</span>
                <Button variant="destructive" onClick={handleDelete} disabled={busy}>
                  {pending === 'delete' ? 'Deleting…' : 'Confirm delete'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={busy}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                variant="destructive"
                onClick={() => {
                  setActionError(null);
                  setActionMessage(null);
                  setConfirmingDelete(true);
                }}
                disabled={busy}
              >
                Delete
              </Button>
            )}

            <Link href="/invoices" className={buttonVariants({ variant: 'ghost' })}>
              Back
            </Link>
          </div>
        </CardContent>
      </Card>

      <MarkPaidDialog
        invoiceId={invoiceId}
        open={markPaidOpen}
        onOpenChange={setMarkPaidOpen}
        onPaid={handlePaid}
      />

      <InvoiceTimeline invoiceId={invoiceId} refreshKey={timelineRefreshKey} onFollowUpCount={setFollowUpCount} />
    </div>
  );
}
