'use client';

import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  formatAmount,
  formatDate,
  formatDateTime,
  tierLabel,
  ordinalLabel,
  type PendingFollowUp,
} from './types';

/**
 * A read-only card displaying a previously sent follow-up.
 * Shows email metadata (client, invoice, tone, sent time) and the body.
 */
export function SentHistoryCard({ followUp }: { followUp: PendingFollowUp }) {
  const invoice = followUp.invoice;
  const clientName = invoice?.client?.name ?? 'Unknown client';
  const clientEmail = invoice?.client?.email ?? '';
  const subject = invoice
    ? `Reminder: Invoice #${invoice.invoice_number}`
    : 'Payment reminder';

  return (
    <Card className="opacity-90">
      <CardHeader className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="font-semibold">
            {clientName}
            {invoice ? (
              <span className="text-muted-foreground"> · Invoice #{invoice.invoice_number}</span>
            ) : null}
          </p>
          {invoice ? (
            <p className="text-sm text-muted-foreground">
              {formatAmount(invoice.amount)} · due {formatDate(invoice.due_date)}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {followUp.follow_up_number ? (
            <span className="inline-flex w-fit items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              {ordinalLabel(followUp.follow_up_number)} follow-up
            </span>
          ) : null}
          <span className="inline-flex w-fit items-center rounded-full border px-2.5 py-0.5 text-xs font-medium">
            {tierLabel(followUp.tier)}
          </span>
          <span className="inline-flex w-fit items-center rounded-full bg-green-500/10 px-2.5 py-0.5 text-xs font-medium text-green-600 dark:text-green-400">
            Sent
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Email header preview */}
        <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
          <div className="flex items-start gap-2 text-sm">
            <span className="w-16 shrink-0 font-medium text-muted-foreground">To:</span>
            <span className="text-foreground">{clientEmail || clientName}</span>
          </div>
          <div className="flex items-start gap-2 text-sm">
            <span className="w-16 shrink-0 font-medium text-muted-foreground">Subject:</span>
            <span className="text-foreground">{subject}</span>
          </div>
          <div className="flex items-start gap-2 text-sm">
            <span className="w-16 shrink-0 font-medium text-muted-foreground">Sent:</span>
            <span className="text-foreground">{formatDateTime(followUp.sent_at)}</span>
          </div>
        </div>

        {/* Email body */}
        <div className="rounded-lg border bg-card p-4">
          <p className="whitespace-pre-wrap text-sm text-foreground">{followUp.content}</p>
        </div>
      </CardContent>
    </Card>
  );
}
