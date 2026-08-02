/**
 * Shared types for the dashboard view (Task 15.4).
 *
 * Mirrors the `GET /dashboard` response contract implemented by the backend
 * (`backend/src/routes/dashboard.ts`): the outstanding total, the overdue and
 * pending-follow-up counts, and up to 20 recent activity events ordered
 * most-recent-first. The activity event shape matches the backend's selected
 * columns (`id, type, created_at`).
 */

/** The kinds of events that appear in the activity feed (Req 5.5). */
export type ActivityEventType =
  | 'invoice_created'
  | 'invoice_sent'
  | 'invoice_became_overdue'
  | 'follow_up_drafted'
  | 'follow_up_sent'
  | 'follow_up_discarded'
  | 'payment_received';

/**
 * A single activity-feed event as returned by `GET /dashboard`. Enriched
 * (Dashboard upgrade: Improve Recent Activity) with the associated invoice's
 * number/amount and client name, when the event has an associated invoice, so
 * each row can show "Action + Client + Invoice # + Amount" and link to it.
 */
export interface ActivityEvent {
  /** Event identifier from a `bigint` identity column; may arrive as string. */
  id: number | string;
  /** The event kind. */
  type: ActivityEventType | string;
  /** ISO timestamp of when the event occurred. */
  created_at: string;
  /** Optional structured detail (e.g. follow-up tier, payment note). */
  metadata?: Record<string, unknown> | null;
  /** The invoice this event relates to, when any. */
  invoice_id?: string | null;
  /** The related invoice's number, when available. */
  invoice_number?: number;
  /** The related invoice's amount, when available. */
  amount?: string | number;
  /** The related invoice's client name, when available. */
  client_name?: string;
}

/** The full `GET /dashboard` response body (Req 5.1, 5.3, 5.4, 5.5). */
export interface DashboardSummary {
  /** Monetary sum of "sent"/"overdue" invoice amounts (Req 5.1, 5.2). */
  outstanding_total: number;
  /** Count of invoices in "overdue" status (Req 5.3). */
  overdue_count: number;
  /** Count of follow-ups in "pending_approval" status (Req 5.4). */
  pending_follow_up_count: number;
  /** Monetary sum of "overdue" invoice amounts (Dashboard upgrade). */
  overdue_amount: number;
  /** Monetary sum collected (paid) during the current calendar month. */
  collected_this_month: number;
  /** Average days between an invoice being sent and paid, or null if none. */
  average_days_to_pay: number | null;
  /** Up to 20 recent events, most-recent-first (Req 5.5, 5.6). */
  activity_events: ActivityEvent[];
}
