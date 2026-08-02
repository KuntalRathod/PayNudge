import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { evaluateOverdueTransition, toUtcDayNumber, type Status } from './overdue.js';

// Feature: paynudge, Property 12: Overdue detector transitions preserve status rules

/**
 * Property-based test for the pure Overdue_Detector transition logic.
 *
 * **Validates: Requirements 7.2, 7.3, 7.4, 7.5** — for any invoice and any
 * current date, one evaluation sets status to "overdue" if and only if the
 * invoice was "sent" and the current date is strictly later (by UTC calendar
 * date) than the due date; a "sent" invoice on or before the due date stays
 * "sent"; and "paid" and "draft" invoices are never changed.
 */

/** All lifecycle statuses the detector may see. */
const statusArb = fc.constantFrom<Status>('draft', 'sent', 'overdue', 'paid');

/** A valid calendar date within a broad, deterministic range. */
const dateArb = fc.date({
  min: new Date('1970-01-01T00:00:00Z'),
  max: new Date('2100-12-31T00:00:00Z'),
  noInvalidDate: true,
});

describe('Property 12: Overdue detector transitions preserve status rules', () => {
  it('sets "overdue" iff invoice was "sent" and current date is strictly later than due date', () => {
    fc.assert(
      fc.property(statusArb, dateArb, dateArb, (status, dueDate, currentDate) => {
        const next = evaluateOverdueTransition(status, dueDate, currentDate);
        const isStrictlyLater = toUtcDayNumber(currentDate) > toUtcDayNumber(dueDate);

        if (status === 'sent') {
          // A "sent" invoice becomes "overdue" exactly when the current date is
          // strictly later than the due date (Req 7.2); otherwise it stays
          // "sent" (Req 7.3).
          expect(next).toBe(isStrictlyLater ? 'overdue' : 'sent');
        } else {
          // "paid" (Req 7.4), "draft" (Req 7.5), and already-"overdue"
          // invoices are never changed by an evaluation.
          expect(next).toBe(status);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('never sets "overdue" from anything other than a "sent" invoice', () => {
    const nonSentArb = fc.constantFrom<Status>('draft', 'overdue', 'paid');
    fc.assert(
      fc.property(nonSentArb, dateArb, dateArb, (status, dueDate, currentDate) => {
        expect(evaluateOverdueTransition(status, dueDate, currentDate)).toBe(status);
      }),
      { numRuns: 200 },
    );
  });
});
