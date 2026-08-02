/**
 * Per-client invoice statistics (Clients section upgrade).
 *
 * PURE, side-effect-free aggregation over a client's invoices, following the
 * same pattern (and monetary-summation approach) as `outstandingTotal.ts` and
 * `dashboardMetrics.ts`. Used by the Clients API to enrich the list view
 * (per-card stats) and the client detail view (headline stats + invoice list)
 * with no extra database round trips beyond a single invoices read.
 */

import { overdueAmount } from './dashboardMetrics.js';
import { outstandingTotal } from './outstandingTotal.js';

/** Number of minor units (cents) per major currency unit. */
const CENTS_PER_UNIT = 100;

/** Minimal invoice shape needed to compute a client's stats. */
export interface ClientInvoiceRecord {
  status: string;
  amount: number;
  created_at: string | Date;
}

/** Aggregated statistics for a single client's invoices. */
export interface ClientStats {
  /** Total number of invoices for this client, any status. */
  invoiceCount: number;
  /**
   * Total amount actually billed to the client: the sum of every invoice's
   * amount excluding drafts (drafts have not been sent, so nothing has been
   * billed yet).
   */
  totalBilled: number;
  /** Sum of amounts for invoices in "paid" status. */
  totalPaid: number;
  /** Sum of amounts for invoices in "sent" or "overdue" status. */
  outstandingAmount: number;
  /** Sum of amounts for invoices in "overdue" status. */
  overdueAmount: number;
  /** Count of invoices in "overdue" status. */
  overdueCount: number;
  /**
   * ISO timestamp of the most recently created invoice for this client, or
   * `null` when the client has no invoices — used as a "last activity" signal.
   */
  lastInvoiceDate: string | null;
}

/** Sums the amounts of invoices matching `predicate`, in integer cents. */
function sumAmountsCents(
  invoices: readonly ClientInvoiceRecord[],
  predicate: (invoice: ClientInvoiceRecord) => boolean,
): number {
  let totalCents = 0;
  for (const invoice of invoices) {
    if (!predicate(invoice) || !Number.isFinite(invoice.amount)) {
      continue;
    }
    totalCents += Math.round(invoice.amount * CENTS_PER_UNIT);
  }
  return totalCents;
}

/**
 * Computes {@link ClientStats} for one client's invoices.
 *
 * Pure and deterministic; never mutates its input. Returns all-zero/`null`
 * stats for an empty invoice list, so a brand-new client with no invoices yet
 * renders sensible zero states rather than `NaN`/`undefined`.
 */
export function computeClientStats(invoices: readonly ClientInvoiceRecord[]): ClientStats {
  const totalBilledCents = sumAmountsCents(invoices, (inv) => inv.status !== 'draft');
  const totalPaidCents = sumAmountsCents(invoices, (inv) => inv.status === 'paid');

  let lastInvoiceDate: string | null = null;
  let latestTime = Number.NEGATIVE_INFINITY;
  let overdueCount = 0;

  for (const invoice of invoices) {
    if (invoice.status === 'overdue') {
      overdueCount += 1;
    }
    const created =
      invoice.created_at instanceof Date ? invoice.created_at : new Date(invoice.created_at);
    const time = created.getTime();
    if (!Number.isNaN(time) && time > latestTime) {
      latestTime = time;
      lastInvoiceDate = created.toISOString();
    }
  }

  return {
    invoiceCount: invoices.length,
    totalBilled: totalBilledCents / CENTS_PER_UNIT,
    totalPaid: totalPaidCents / CENTS_PER_UNIT,
    outstandingAmount: outstandingTotal(invoices),
    overdueAmount: overdueAmount(invoices),
    overdueCount,
    lastInvoiceDate,
  };
}

/** The all-zero stats for a client with no invoices, exposed for reuse. */
export const EMPTY_CLIENT_STATS: ClientStats = {
  invoiceCount: 0,
  totalBilled: 0,
  totalPaid: 0,
  outstandingAmount: 0,
  overdueAmount: 0,
  overdueCount: 0,
  lastInvoiceDate: null,
};
