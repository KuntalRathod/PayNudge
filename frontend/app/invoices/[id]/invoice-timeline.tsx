'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiGet } from '@/lib/api/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  formatTimelineDateTime,
  timelineEventDescription,
  timelineEventTitle,
  type TimelineEvent,
  type TimelineResponse,
} from './timeline-types';

/** Dot color per event type so the timeline reads at a glance. */
const DOT_STYLES: Record<string, string> = {
  invoice_created: 'bg-muted-foreground',
  invoice_sent: 'bg-blue-500',
  invoice_became_overdue: 'bg-red-500',
  follow_up_drafted: 'bg-amber-500',
  follow_up_sent: 'bg-indigo-500',
  follow_up_discarded: 'bg-gray-400',
  payment_received: 'bg-green-600',
};

/**
 * Full chronological activity timeline for an invoice (Invoice Activity
 * Timeline feature): Created, Sent, Became Overdue, Follow-up drafted,
 * Follow-up approved & sent, Follow-up discarded, Marked as Paid — each with
 * a timestamp and short description, rendered as a left-border + dot list.
 *
 * `refreshKey` lets the parent force a reload after an action (send, mark
 * paid, approve a follow-up) that appends a new event.
 */
export function InvoiceTimeline({
  invoiceId,
  refreshKey,
  onFollowUpCount,
}: {
  invoiceId: string;
  refreshKey?: number;
  /** Reports the count of sent follow-ups once the timeline loads. */
  onFollowUpCount?: (count: number) => void;
}) {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [invoiceCreatedAt, setInvoiceCreatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await apiGet<TimelineResponse>(`/invoices/${invoiceId}/timeline`);
    if (!result.ok) {
      setError(result.error);
      setEvents(null);
      return;
    }
    setError(null);
    const timeline = result.data.timeline;

    // Report how many follow-ups have been sent for this invoice
    const sentCount = timeline.filter((e) => e.type === 'follow_up_sent').length;
    onFollowUpCount?.(sentCount);

    // If no events returned, synthesize an "Invoice created" entry from the
    // invoice's own created_at so the timeline is never empty.
    if (timeline.length === 0 && result.data.invoice) {
      const inv = result.data.invoice as Record<string, unknown>;
      if (typeof inv.created_at === 'string') {
        setInvoiceCreatedAt(inv.created_at);
      }
    }

    setEvents(timeline);
  }, [invoiceId, onFollowUpCount]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Activity timeline</CardTitle>
      </CardHeader>
      <CardContent>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : events === null ? (
          <div className="space-y-6 border-l pl-6">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3.5 w-24" />
              </div>
            ))}
          </div>
        ) : events.length === 0 && invoiceCreatedAt ? (
          <ol className="relative border-l pl-6">
            <li className="mb-6 last:mb-0">
              <span
                className={cn(
                  'absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full ring-2 ring-background',
                  DOT_STYLES['invoice_created'],
                )}
                aria-hidden="true"
              />
              <div className="rounded-md border bg-card p-3 shadow-sm">
                <p className="text-sm font-medium">Invoice created</p>
                <time
                  dateTime={invoiceCreatedAt}
                  className="mt-1 block text-xs text-muted-foreground"
                >
                  {formatTimelineDateTime(invoiceCreatedAt)}
                </time>
              </div>
            </li>
          </ol>
        ) : events.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activity recorded yet.</p>
        ) : (
          <ol className="relative border-l pl-6">
            {events.map((event) => {
              const description = timelineEventDescription(event);
              return (
                <li key={String(event.id)} className="mb-6 last:mb-0">
                  <span
                    className={cn(
                      'absolute -left-[7px] mt-1.5 h-3 w-3 rounded-full ring-2 ring-background',
                      DOT_STYLES[event.type] ?? 'bg-muted-foreground',
                    )}
                    aria-hidden="true"
                  />
                  <div className="rounded-md border bg-card p-3 shadow-sm">
                    <p className="text-sm font-medium">{timelineEventTitle(event)}</p>
                    {description ? (
                      <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
                    ) : null}
                    <time
                      dateTime={event.created_at}
                      className="mt-1 block text-xs text-muted-foreground"
                    >
                      {formatTimelineDateTime(event.created_at)}
                    </time>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
