/**
 * Outstanding-total aggregation (Requirements 5.1, 5.2, 5.7; supports 6.2).
 *
 * A PURE, deterministic, side-effect-free function that computes the
 * Outstanding_Total for a User: the monetary sum of the amounts of all their
 * invoices whose status is "sent" or "overdue". It performs no I/O (no
 * database, no clock, no network) so it can be property-tested directly
 * (Task 8.2 / Property 8): for any set of invoices with arbitrary statuses and
 * amounts, the result must equal the exact monetary sum of the sent+overdue
 * amounts, and 0 when no such invoice exists.
 *
 * ## Monetary summation approach — sum in integer cents
 *
 * Invoice amounts are currency values with at most 2 decimal places (see
 * `invoiceValidation.ts`). Summing them directly as IEEE-754 doubles is prone
 * to representation drift (e.g. `0.1 + 0.2 === 0.30000000000000004`). To keep
 * the total exact, each amount is first converted to an integer number of
 * cents (`Math.round(amount * 100)`), the cents are summed as integers, and
 * the integer total is converted back to a 2-decimal number at the end
 * (`totalCents / 100`).
 *
 * Rounding each amount to the nearest cent before summing:
 *   - is a no-op for well-formed amounts (already ≤ 2 decimals), and
 *   - absorbs any tiny binary artifact in a single amount so it cannot
 *     accumulate across the sum.
 *
 * The returned number therefore has at most 2-decimal precision and matches
 * the value obtained by adding the amounts as exact decimals. Non-matching
 * invoices contribute nothing, so an empty list — or a list with no sent/
 * overdue invoices — yields exactly `0`.
 */

/** Invoice statuses that count toward the Outstanding_Total. */
export const OUTSTANDING_STATUSES = ['sent', 'overdue'] as const;

/** An invoice status that contributes to the Outstanding_Total. */
export type OutstandingStatus = (typeof OUTSTANDING_STATUSES)[number];

/**
 * Minimal shape needed to aggregate the Outstanding_Total.
 *
 * Only the two fields the aggregation depends on are required; callers may pass
 * richer invoice objects and they will be accepted structurally.
 *
 * @property status The invoice status. Only "sent" and "overdue" contribute to
 *                  the total; any other value ("draft", "paid", or anything
 *                  else) is ignored.
 * @property amount The invoice amount in whole currency units (e.g. `1234.5`
 *                  means 1,234.50), with at most 2 decimal places.
 */
export interface InvoiceAmountStatus {
  status: string;
  amount: number;
}

/** Number of minor units (cents) per major currency unit. */
const CENTS_PER_UNIT = 100;

/** Returns true when the given status contributes to the Outstanding_Total. */
export function isOutstandingStatus(status: string): status is OutstandingStatus {
  return (OUTSTANDING_STATUSES as readonly string[]).includes(status);
}

/**
 * Computes the Outstanding_Total: the exact monetary sum of the amounts of all
 * invoices in "sent" or "overdue" status.
 *
 * Pure and deterministic. Returns `0` when the list is empty or contains no
 * sent/overdue invoices (Requirement 5.2). Summation is performed in integer
 * cents to avoid floating-point drift (see the module doc comment), so the
 * result is a number with at most 2-decimal precision.
 *
 * Non-finite amounts (NaN, Infinity) on a matching invoice would corrupt the
 * total; such invoices are treated as contributing 0 so a single malformed
 * record cannot poison the aggregate. Amount validity is enforced upstream by
 * `invoiceValidation.ts`.
 *
 * @param invoices Invoices owned by a single User (any statuses, any amounts).
 * @returns The Outstanding_Total as a 2-decimal number, or `0` when none match.
 */
export function outstandingTotal(invoices: readonly InvoiceAmountStatus[]): number {
  let totalCents = 0;

  for (const invoice of invoices) {
    if (!isOutstandingStatus(invoice.status)) {
      continue;
    }
    if (!Number.isFinite(invoice.amount)) {
      continue;
    }
    totalCents += Math.round(invoice.amount * CENTS_PER_UNIT);
  }

  return totalCents / CENTS_PER_UNIT;
}
