/**
 * Types and presentation helpers for the Invoice Activity Timeline.
 *
 * Mirrors the widened `activity_events.type` set from the backend
 * (`GET /invoices/:id/timeline`): a full chronological history of an
 * invoice's lifecycle, from creation through payment.
 */

export type TimelineEventType =
  | 'invoice_created'
  | 'invoice_sent'
  | 'invoice_became_overdue'
  | 'follow_up_drafted'
  | 'follow_up_sent'
  | 'follow_up_discarded'
  | 'payment_received';

export interface TimelineEvent {
  id: number | string;
  type: TimelineEventType | string;
  created_at: string;
  metadata?: Record<string, unknown> | null;
}

export interface TimelineResponse {
  invoice: { invoice_number: number; status: string };
  timeline: TimelineEvent[];
}

function tierLabel(tier: unknown): string {
  switch (tier) {
    case 'polite':
      return 'polite';
    case 'firm':
      return 'firm';
    case 'final_notice':
      return 'final notice';
    default:
      return typeof tier === 'string' ? tier : '';
  }
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** Short, human-readable title for a timeline event. */
export function timelineEventTitle(event: TimelineEvent): string {
  const meta = event.metadata ?? {};
  const followUpNumber =
    typeof meta.follow_up_number === 'number' ? meta.follow_up_number : null;

  switch (event.type) {
    case 'invoice_created':
      return 'Invoice created';
    case 'invoice_sent':
      return 'Invoice sent to client';
    case 'invoice_became_overdue':
      return 'Invoice became overdue';
    case 'follow_up_drafted':
      return followUpNumber
        ? `${ordinal(followUpNumber)} follow-up drafted by AI (${tierLabel(meta.tier)})`
        : `Follow-up drafted by AI (${tierLabel(meta.tier)})`;
    case 'follow_up_sent':
      return followUpNumber
        ? `${ordinal(followUpNumber)} follow-up approved & sent (${tierLabel(meta.tier)})`
        : `Follow-up approved & sent (${tierLabel(meta.tier)})`;
    case 'follow_up_discarded':
      return 'Follow-up discarded';
    case 'payment_received':
      return 'Marked as paid';
    default:
      return typeof event.type === 'string'
        ? event.type.replace(/_/g, ' ')
        : 'Activity';
  }
}

/** Short supporting description for a timeline event, if any. */
export function timelineEventDescription(event: TimelineEvent): string | null {
  const meta = event.metadata ?? {};
  if (event.type === 'payment_received' && typeof meta.note === 'string' && meta.note.trim()) {
    return `Note: ${meta.note.trim()}`;
  }
  return null;
}

/** Formats an ISO timestamp as a readable date and time; falls back to raw. */
export function formatTimelineDateTime(value: string | null | undefined): string {
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
