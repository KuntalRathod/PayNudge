/**
 * Additional dashboard metrics: Overdue Amount, Collected This Month, and
 * Average Days to Pay (Dashboard upgrade feature).
 *
 * PURE, side-effect-free functions with no I/O, following the same pattern as
 * `outstandingTotal.ts` and `dashboard.ts`. Monetary sums are computed in
 * integer cents to avoid floating-point drift (see `outstandingTotal.ts` for
 * the rationale); date math reuses the UTC-day convention from `overdue.ts`.
 */

import { MS_PER_DAY } from './overdue.js';

/** Number of minor units (cents) per major currency unit. */
const CENTS_PER_UNIT = 100;

/** Minimal invoice shape needed to compute the Overdue Amount metric. */
export interface InvoiceOverdueAmountRecord {
  status: string;
  amount: number;
}

/**
 * Computes the total amount currently overdue: the exact monetary sum of the
 * amounts of all invoices in "overdue" status.
 *
 * Pure and deterministic. Returns `0` when the list is empty or contains no
 * overdue invoices. Non-finite amounts on a matching invoice contribute `0`
 * rather than corrupting the total.
 */
export function overdueAmount(invoices: readonly InvoiceOverdueAmountRecord[]): number {
  let totalCents = 0;
  for (const invoice of invoices) {
    if (invoice.status !== 'overdue') {
      continue;
    }
    if (!Number.isFinite(invoice.amount)) {
      continue;
    }
    totalCents += Math.round(invoice.amount * CENTS_PER_UNIT);
  }
  return totalCents / CENTS_PER_UNIT;
}

/** Minimal invoice shape needed to compute the Collected This Month metric. */
export interface InvoiceCollectedRecord {
  status: string;
  amount: number;
  paid_at?: string | Date | null;
}

/**
 * Computes the total amount collected during the calendar month (UTC) of
 * `referenceDate`: the exact monetary sum of the amounts of all invoices in
 * "paid" status whose `paid_at` falls in that same UTC year/month.
 *
 * Pure and deterministic (the "current" date is always supplied, never read
 * from the system clock internally). Returns `0` when no paid invoice falls in
 * the reference month, when `paid_at` is missing/unparseable, or when the
 * amount is non-finite.
 */
export function collectedThisMonth(
  invoices: readonly InvoiceCollectedRecord[],
  referenceDate: Date = new Date(),
): number {
  const refYear = referenceDate.getUTCFullYear();
  const refMonth = referenceDate.getUTCMonth();

  let totalCents = 0;
  for (const invoice of invoices) {
    if (invoice.status !== 'paid' || !invoice.paid_at) {
      continue;
    }
    const paidDate =
      invoice.paid_at instanceof Date ? invoice.paid_at : new Date(invoice.paid_at);
    if (Number.isNaN(paidDate.getTime())) {
      continue;
    }
    if (paidDate.getUTCFullYear() !== refYear || paidDate.getUTCMonth() !== refMonth) {
      continue;
    }
    if (!Number.isFinite(invoice.amount)) {
      continue;
    }
    totalCents += Math.round(invoice.amount * CENTS_PER_UNIT);
  }
  return totalCents / CENTS_PER_UNIT;
}

/** Minimal invoice shape needed to compute the Average Days to Pay metric. */
export interface InvoiceDurationRecord {
  status: string;
  sent_at?: string | Date | null;
  paid_at?: string | Date | null;
}

/**
 * Computes the average number of days between an invoice being sent and being
 * paid, across every invoice in "paid" status that carries both a `sent_at`
 * and a `paid_at` timestamp.
 *
 * Pure and deterministic. Returns `null` when no paid invoice has both
 * timestamps (there is nothing to average), rather than `0` or `NaN`, so
 * callers can render an explicit "not enough data yet" state. The result is
 * rounded to one decimal place. Invoices with an unparseable timestamp or a
 * negative duration (paid before sent — malformed data) are skipped rather
 * than corrupting the average.
 */
export function averageDaysToPay(invoices: readonly InvoiceDurationRecord[]): number | null {
  const durations: number[] = [];

  for (const invoice of invoices) {
    if (invoice.status !== 'paid' || !invoice.sent_at || !invoice.paid_at) {
      continue;
    }
    const sent = invoice.sent_at instanceof Date ? invoice.sent_at : new Date(invoice.sent_at);
    const paid = invoice.paid_at instanceof Date ? invoice.paid_at : new Date(invoice.paid_at);
    if (Number.isNaN(sent.getTime()) || Number.isNaN(paid.getTime())) {
      continue;
    }
    const diffMs = paid.getTime() - sent.getTime();
    if (diffMs < 0) {
      continue;
    }
    durations.push(diffMs / MS_PER_DAY);
  }

  if (durations.length === 0) {
    return null;
  }

  const average = durations.reduce((sum, d) => sum + d, 0) / durations.length;
  return Math.round(average * 10) / 10;
}
