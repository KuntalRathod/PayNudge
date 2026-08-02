/**
 * Pure presentation helpers for the dashboard view (Task 15.4).
 *
 * These functions contain the only non-trivial logic in the dashboard UI:
 * formatting the Outstanding_Total as currency (Req 5.1) and turning raw
 * activity-event records into human-readable labels and timestamps for the
 * Activity_Feed (Req 5.5). They are intentionally free of React and I/O so they
 * can be unit- and property-tested directly in a Node environment.
 */
import type { ActivityEvent, ActivityEventType } from './types';

/** Formatter for USD amounts with exactly two fraction digits. */
const CURRENCY_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Formats a monetary amount as a currency string (Req 5.1).
 *
 * Non-finite or missing inputs (e.g. a malformed API payload) are treated as 0
 * so the dashboard always renders a stable, readable total rather than
 * "$NaN".
 */
export function formatCurrency(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return CURRENCY_FORMATTER.format(safe);
}

/**
 * Formats the Average Days to Pay metric. `null` (not enough paid invoices
 * yet to average) renders as an explicit placeholder rather than "0 days",
 * which would misleadingly imply instant payment.
 */
export function formatAverageDays(days: number | null): string {
  if (days === null) {
    return '—';
  }
  const rounded = Math.round(days * 10) / 10;
  return `${rounded} ${rounded === 1 ? 'day' : 'days'}`;
}

/**
 * Human-readable labels for each known activity-event type (Req 5.5). Widened
 * (Invoice Activity Timeline feature) to cover an invoice's full lifecycle,
 * matching the backend's `activity_events.type` set.
 */
const EVENT_LABELS: Record<ActivityEventType, string> = {
  invoice_created: 'Invoice created',
  invoice_sent: 'Invoice sent',
  invoice_became_overdue: 'Invoice became overdue',
  follow_up_drafted: 'Follow-up drafted',
  follow_up_sent: 'Follow-up sent',
  follow_up_discarded: 'Follow-up discarded',
  payment_received: 'Payment received',
};

/**
 * Maps an activity-event type to a display label. Unknown types (forward
 * compatibility with future event kinds) fall back to a normalized version of
 * the raw type string rather than throwing.
 */
export function activityEventLabel(type: ActivityEventType | string): string {
  if (type in EVENT_LABELS) {
    return EVENT_LABELS[type as ActivityEventType];
  }
  const normalized = type.replace(/_/g, ' ').trim();
  if (normalized.length === 0) {
    return 'Activity';
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

/** Optional short supporting detail for an activity-feed row, if any. */
export function activityEventDetail(event: ActivityEvent): string | null {
  const meta = event.metadata as Record<string, unknown> | undefined;
  if (!meta) return null;
  if (event.type === 'payment_received' && typeof meta.note === 'string' && meta.note.trim()) {
    return meta.note.trim();
  }
  if (
    (event.type === 'follow_up_drafted' || event.type === 'follow_up_sent') &&
    typeof meta.tier === 'string'
  ) {
    return meta.tier.replace(/_/g, ' ');
  }
  return null;
}

/**
 * Builds the informative subtitle for an activity-feed row: client name,
 * invoice number, and amount, joined with middot separators — whichever of
 * these the event carries (Dashboard upgrade: Improve Recent Activity). Falls
 * back to `null` when the event has no associated invoice/client context
 * (e.g. an event kind added in the future with no embedded invoice).
 */
export function activityEventSubtitle(event: ActivityEvent): string | null {
  const parts: string[] = [];
  if (event.client_name) {
    parts.push(event.client_name);
  }
  if (typeof event.invoice_number === 'number') {
    parts.push(`Invoice #${event.invoice_number}`);
  }
  if (event.amount !== undefined) {
    const numeric = typeof event.amount === 'number' ? event.amount : Number(event.amount);
    if (Number.isFinite(numeric)) {
      parts.push(formatCurrency(numeric));
    }
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * Formats an ISO timestamp for display in the activity feed. Invalid or missing
 * timestamps degrade to an em dash so a single bad row never breaks the feed.
 */
export function formatEventTimestamp(createdAt: string): string {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return '—';
  }
  return date.toLocaleString('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
