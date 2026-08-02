import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  isOutstandingStatus,
  outstandingTotal,
  type InvoiceAmountStatus,
} from './outstandingTotal.js';

/**
 * Property-based test for the pure Outstanding_Total aggregation.
 *
 * Feature: paynudge, Property 8: Outstanding total equals the sum of sent and overdue invoice amounts
 *
 * Validates: Requirements 5.1, 5.2, 5.7, 6.2 — for any set of invoices owned by
 * a user with arbitrary statuses and amounts, the Outstanding_Total equals the
 * exact monetary sum of the amounts of invoices in "sent" or "overdue" status,
 * and equals 0 when no such invoices exist.
 */

/**
 * A valid invoice amount: 0.01 .. 999,999,999.99 with at most 2 decimal places.
 * Generated as an integer number of cents so every value is exactly
 * representable and the reference sum can be computed in integer cents,
 * sidestepping IEEE-754 drift.
 */
const amountCentsArb = fc.integer({ min: 1, max: 99_999_999_999 });

/**
 * A status drawn from the full space the aggregation must tolerate: the two
 * contributing statuses plus common non-contributing ones and arbitrary junk.
 * Weighting toward "sent"/"overdue" keeps most generated invoices relevant so
 * the summation logic is exercised, while the other values confirm exclusion.
 */
const statusArb = fc.oneof(
  fc.constant('sent'),
  fc.constant('overdue'),
  fc.constant('draft'),
  fc.constant('paid'),
  fc.string(),
);

/** An invoice carrying its amount in integer cents alongside its major-unit value. */
interface InvoiceWithCents extends InvoiceAmountStatus {
  amountCents: number;
}

const invoiceArb: fc.Arbitrary<InvoiceWithCents> = fc.record({
  status: statusArb,
  amountCents: amountCentsArb,
}).map(({ status, amountCents }) => ({
  status,
  amountCents,
  amount: amountCents / 100,
}));

/** Reference total computed independently in integer cents (decimal-safe). */
function expectedTotal(invoices: readonly InvoiceWithCents[]): number {
  const totalCents = invoices.reduce(
    (sum, invoice) => (isOutstandingStatus(invoice.status) ? sum + invoice.amountCents : sum),
    0,
  );
  return totalCents / 100;
}

describe('Property 8: Outstanding total equals the sum of sent and overdue invoice amounts', () => {
  it('equals the exact monetary sum of sent/overdue amounts across arbitrary invoice sets', () => {
    fc.assert(
      fc.property(fc.array(invoiceArb, { maxLength: 200 }), (invoices) => {
        expect(outstandingTotal(invoices)).toBe(expectedTotal(invoices));
      }),
      { numRuns: 300 },
    );
  });

  it('returns 0 when no invoice is in sent or overdue status', () => {
    const nonOutstandingStatusArb = fc
      .oneof(fc.constant('draft'), fc.constant('paid'), fc.string())
      .filter((status) => !isOutstandingStatus(status));

    fc.assert(
      fc.property(
        fc.array(
          fc.record({ status: nonOutstandingStatusArb, amountCents: amountCentsArb }).map(
            ({ status, amountCents }) => ({ status, amount: amountCents / 100 }),
          ),
          { maxLength: 200 },
        ),
        (invoices) => {
          expect(outstandingTotal(invoices)).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
