/**
 * Dashboard API router — Requirement 5 (Dashboard Overview).
 *
 * Endpoint (requires a valid Supabase JWT via {@link requireAuth}):
 *
 *   GET /dashboard   Returns `outstanding_total`, `overdue_count`,
 *                    `pending_follow_up_count`, and up to 20 recent activity
 *                    events for the authenticated user (Req 5.1–5.8).
 *
 * ## Ownership
 *
 * Ownership is enforced by Row Level Security: every query runs on the
 * request-scoped `req.supabase` client whose JWT resolves `auth.uid()` to the
 * caller. Each read therefore returns only the caller's rows, so the aggregates
 * below are naturally scoped to the requesting user without any explicit
 * `user_id` filter.
 *
 * ## Aggregation
 *
 * The endpoint is a thin I/O shell over the pure logic layer. It fetches the
 * user's invoices, follow-ups, and activity events and delegates every
 * computation to side-effect-free functions:
 *
 *   - {@link outstandingTotal} — monetary sum of "sent"/"overdue" amounts
 *     (Req 5.1, 5.2, 5.7).
 *   - {@link overdueCount} — number of "overdue" invoices (Req 5.3, 5.8).
 *   - {@link pendingFollowUpCount} — number of "pending_approval" follow-ups
 *     (Req 5.4).
 *   - {@link activityFeed} — at most {@link ACTIVITY_FEED_LIMIT} events ordered
 *     by `created_at` desc then `id` desc (Req 5.5, 5.6).
 *
 * Empty ownership yields `0` for every count/total and `[]` for the feed,
 * which the pure functions already guarantee for empty inputs.
 *
 * The router accepts an injectable auth middleware so it can be integration
 * tested with an in-memory fake Supabase client and without a live auth service.
 */

import { Router, type Request, type RequestHandler, type Response } from 'express';

import {
  activityFeed,
  overdueCount,
  pendingFollowUpCount,
  type ActivityEvent,
  type FollowUpStatusRecord,
  type InvoiceStatusRecord,
} from '../lib/dashboard.js';
import {
  averageDaysToPay,
  collectedThisMonth,
  overdueAmount,
  type InvoiceCollectedRecord,
  type InvoiceDurationRecord,
  type InvoiceOverdueAmountRecord,
} from '../lib/dashboardMetrics.js';
import { outstandingTotal, type InvoiceAmountStatus } from '../lib/outstandingTotal.js';
import { requireAuth } from '../middleware/auth.js';

/** Tables backing the dashboard aggregates. */
const INVOICES_TABLE = 'invoices';
const FOLLOW_UPS_TABLE = 'follow_ups';
const ACTIVITY_EVENTS_TABLE = 'activity_events';

/**
 * Fields the aggregations depend on. Widened (Dashboard upgrade) to include
 * `sent_at`/`paid_at` for the Collected This Month and Average Days to Pay
 * metrics, plus invoice-identifying fields (and the embedded client name) so
 * the Activity_Feed can be enriched with client name/invoice number/amount for
 * clickable rows, all in this single query.
 */
const INVOICE_DASHBOARD_COLUMNS =
  'id, invoice_number, status, amount, sent_at, paid_at, client:clients(name)';
const FOLLOW_UP_DASHBOARD_COLUMNS = 'status';
const ACTIVITY_EVENT_COLUMNS = 'id, type, created_at, invoice_id, metadata';

/** Invoice row shape needed for every dashboard aggregate. */
type DashboardInvoiceRow = InvoiceAmountStatus &
  InvoiceStatusRecord &
  InvoiceOverdueAmountRecord &
  InvoiceCollectedRecord &
  InvoiceDurationRecord & {
    id: string;
    invoice_number: number;
    client?: { name: string } | { name: string }[] | null;
  };

/** Extracts the embedded client's name from Supabase's relation shape. */
function clientNameFrom(client: DashboardInvoiceRow['client']): string | undefined {
  if (!client) return undefined;
  const first = Array.isArray(client) ? client[0] : client;
  return first?.name || undefined;
}

/** Sends a generic 500 when the database layer reports an unexpected error. */
function sendServerError(res: Response): void {
  res.status(500).json({ error: 'An unexpected error occurred.' });
}

/**
 * GET /dashboard — compute the dashboard summary for the authenticated user
 * (Req 5.1–5.8).
 *
 * Fetches the user's invoices (status + amount), follow-ups (status), and
 * activity events (id, type, created_at) under RLS, then delegates every
 * computation to the pure logic layer. Any database error surfaces as a 500
 * without leaking internals.
 */
const handleGet: RequestHandler = async (req: Request, res: Response): Promise<void> => {
  const [invoiceResult, followUpResult, eventResult] = await Promise.all([
    req.supabase.from(INVOICES_TABLE).select(INVOICE_DASHBOARD_COLUMNS),
    req.supabase.from(FOLLOW_UPS_TABLE).select(FOLLOW_UP_DASHBOARD_COLUMNS),
    req.supabase.from(ACTIVITY_EVENTS_TABLE).select(ACTIVITY_EVENT_COLUMNS),
  ]);

  if (invoiceResult.error || followUpResult.error || eventResult.error) {
    sendServerError(res);
    return;
  }

  const invoices = (invoiceResult.data ?? []) as DashboardInvoiceRow[];
  const followUps = (followUpResult.data ?? []) as FollowUpStatusRecord[];
  const events = (eventResult.data ?? []) as ActivityEvent[];

  const feed = activityFeed(events);

  // Enrich each feed event with its invoice's number/amount/client name (when
  // it has an associated invoice) so the frontend can render "Action + Client
  // name + Invoice number + Amount" and link each row to the invoice, with no
  // extra round trip (Dashboard upgrade: Improve Recent Activity).
  const invoiceById = new Map(invoices.map((inv) => [inv.id, inv]));
  const enrichedFeed = feed.map((event) => {
    const invoice = event.invoice_id ? invoiceById.get(event.invoice_id) : undefined;
    if (!invoice) {
      return event;
    }
    return {
      ...event,
      invoice_number: invoice.invoice_number,
      amount: invoice.amount,
      client_name: clientNameFrom(invoice.client),
    };
  });

  res.status(200).json({
    outstanding_total: outstandingTotal(invoices),
    overdue_count: overdueCount(invoices),
    pending_follow_up_count: pendingFollowUpCount(followUps),
    overdue_amount: overdueAmount(invoices),
    collected_this_month: collectedThisMonth(invoices),
    average_days_to_pay: averageDaysToPay(invoices),
    // Bounded to the 20 most recent, ordered by created_at desc then id desc,
    // enriched with invoice number/amount/client name for clickable rows.
    activity_events: enrichedFeed,
  });
};

/** Options for {@link createDashboardRouter}. */
export interface DashboardRouterOptions {
  /**
   * Auth middleware applied to every route. Defaults to the process-wide
   * {@link requireAuth}. Tests inject a stub that attaches `req.userId` and a
   * fake `req.supabase`.
   */
  authMiddleware?: RequestHandler;
}

/**
 * Builds the Dashboard API router. Every route is guarded by the provided auth
 * middleware (defaults to {@link requireAuth}), which attaches `req.userId`
 * and the RLS-scoped `req.supabase` client the handler relies on.
 */
export function createDashboardRouter(options: DashboardRouterOptions = {}): Router {
  const auth = options.authMiddleware ?? requireAuth;
  const router = Router();

  router.get('/dashboard', auth, handleGet);

  return router;
}
