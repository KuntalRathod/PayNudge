import { describe, expect, it } from 'vitest';

import {
  isOutstandingStatus,
  outstandingTotal,
  OUTSTANDING_STATUSES,
  type InvoiceAmountStatus,
} from './outstandingTotal.js';

/**
 * Unit tests for the pure Outstanding_Total aggregation
 * (Requirements 5.1, 5.2, 5.7; supports 6.2).
 *
 * These cover concrete examples and edge cases. The universal "total equals the
 * exact monetary sum of sent+overdue amounts" property is validated separately
 * by the property test in Task 8.2 (Property 8).
 */

describe('OUTSTANDING_STATUSES', () => {
  it('counts exactly "sent" and "overdue"', () => {
    expect([...OUTSTANDING_STATUSES]).toEqual(['sent', 'overdue']);
  });
});

describe('isOutstandingStatus', () => {
  it('returns true for sent and overdue', () => {
    expect(isOutstandingStatus('sent')).toBe(true);
    expect(isOutstandingStatus('overdue')).toBe(true);
  });

  it('returns false for draft, paid, and unknown statuses', () => {
    expect(isOutstandingStatus('draft')).toBe(false);
    expect(isOutstandingStatus('paid')).toBe(false);
    expect(isOutstandingStatus('')).toBe(false);
    expect(isOutstandingStatus('SENT')).toBe(false);
  });
});

describe('outstandingTotal', () => {
  it('returns 0 for an empty list (Req 5.2)', () => {
    expect(outstandingTotal([])).toBe(0);
  });

  it('returns 0 when no invoice is sent or overdue (Req 5.2)', () => {
    const invoices: InvoiceAmountStatus[] = [
      { status: 'draft', amount: 100 },
      { status: 'paid', amount: 250.5 },
    ];
    expect(outstandingTotal(invoices)).toBe(0);
  });

  it('sums amounts of sent and overdue invoices (Req 5.1)', () => {
    const invoices: InvoiceAmountStatus[] = [
      { status: 'sent', amount: 100.25 },
      { status: 'overdue', amount: 50.75 },
    ];
    expect(outstandingTotal(invoices)).toBe(151);
  });

  it('excludes draft and paid invoices from the total (Req 5.7)', () => {
    const invoices: InvoiceAmountStatus[] = [
      { status: 'sent', amount: 200 },
      { status: 'draft', amount: 999 },
      { status: 'overdue', amount: 100 },
      { status: 'paid', amount: 999 },
    ];
    expect(outstandingTotal(invoices)).toBe(300);
  });

  it('avoids floating-point drift by summing in integer cents', () => {
    const invoices: InvoiceAmountStatus[] = [
      { status: 'sent', amount: 0.1 },
      { status: 'overdue', amount: 0.2 },
    ];
    // 0.1 + 0.2 === 0.30000000000000004 as raw floats; cents summation yields 0.3.
    expect(outstandingTotal(invoices)).toBe(0.3);
  });

  it('stays exact across many small amounts', () => {
    const invoices: InvoiceAmountStatus[] = Array.from({ length: 10 }, () => ({
      status: 'sent',
      amount: 0.1,
    }));
    expect(outstandingTotal(invoices)).toBe(1);
  });

  it('handles the maximum valid amount', () => {
    const invoices: InvoiceAmountStatus[] = [{ status: 'overdue', amount: 999_999_999.99 }];
    expect(outstandingTotal(invoices)).toBe(999_999_999.99);
  });

  it('treats non-finite amounts on matching invoices as 0 contribution', () => {
    const invoices: InvoiceAmountStatus[] = [
      { status: 'sent', amount: Number.NaN },
      { status: 'overdue', amount: Number.POSITIVE_INFINITY },
      { status: 'sent', amount: 42 },
    ];
    expect(outstandingTotal(invoices)).toBe(42);
  });
});
