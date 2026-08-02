import { describe, expect, it } from 'vitest';

import {
  averageDaysToPay,
  collectedThisMonth,
  overdueAmount,
  type InvoiceCollectedRecord,
  type InvoiceDurationRecord,
  type InvoiceOverdueAmountRecord,
} from './dashboardMetrics.js';

describe('overdueAmount', () => {
  it('returns 0 for an empty list', () => {
    expect(overdueAmount([])).toBe(0);
  });

  it('returns 0 when no invoice is overdue', () => {
    const invoices: InvoiceOverdueAmountRecord[] = [
      { status: 'draft', amount: 100 },
      { status: 'sent', amount: 50 },
      { status: 'paid', amount: 999 },
    ];
    expect(overdueAmount(invoices)).toBe(0);
  });

  it('sums only overdue amounts', () => {
    const invoices: InvoiceOverdueAmountRecord[] = [
      { status: 'overdue', amount: 100.25 },
      { status: 'overdue', amount: 50.75 },
      { status: 'sent', amount: 999 },
    ];
    expect(overdueAmount(invoices)).toBe(151);
  });

  it('avoids floating-point drift', () => {
    const invoices: InvoiceOverdueAmountRecord[] = [
      { status: 'overdue', amount: 0.1 },
      { status: 'overdue', amount: 0.2 },
    ];
    expect(overdueAmount(invoices)).toBe(0.3);
  });

  it('treats non-finite amounts as 0 contribution', () => {
    const invoices: InvoiceOverdueAmountRecord[] = [
      { status: 'overdue', amount: Number.NaN },
      { status: 'overdue', amount: 42 },
    ];
    expect(overdueAmount(invoices)).toBe(42);
  });
});

describe('collectedThisMonth', () => {
  const reference = new Date('2025-06-15T00:00:00.000Z');

  it('returns 0 for an empty list', () => {
    expect(collectedThisMonth([], reference)).toBe(0);
  });

  it('sums paid invoices whose paid_at falls in the reference month', () => {
    const invoices: InvoiceCollectedRecord[] = [
      { status: 'paid', amount: 100, paid_at: '2025-06-01T00:00:00.000Z' },
      { status: 'paid', amount: 50, paid_at: '2025-06-30T23:59:59.000Z' },
    ];
    expect(collectedThisMonth(invoices, reference)).toBe(150);
  });

  it('excludes invoices paid in a different month or year', () => {
    const invoices: InvoiceCollectedRecord[] = [
      { status: 'paid', amount: 100, paid_at: '2025-05-31T23:59:59.000Z' },
      { status: 'paid', amount: 200, paid_at: '2025-07-01T00:00:00.000Z' },
      { status: 'paid', amount: 300, paid_at: '2024-06-15T00:00:00.000Z' },
    ];
    expect(collectedThisMonth(invoices, reference)).toBe(0);
  });

  it('excludes non-paid invoices and invoices with no paid_at', () => {
    const invoices: InvoiceCollectedRecord[] = [
      { status: 'sent', amount: 100, paid_at: '2025-06-01T00:00:00.000Z' },
      { status: 'paid', amount: 100, paid_at: null },
    ];
    expect(collectedThisMonth(invoices, reference)).toBe(0);
  });

  it('ignores an unparseable paid_at', () => {
    const invoices: InvoiceCollectedRecord[] = [
      { status: 'paid', amount: 100, paid_at: 'not-a-date' },
    ];
    expect(collectedThisMonth(invoices, reference)).toBe(0);
  });
});

describe('averageDaysToPay', () => {
  it('returns null when there is nothing to average', () => {
    expect(averageDaysToPay([])).toBeNull();
  });

  it('returns null when no paid invoice has both timestamps', () => {
    const invoices: InvoiceDurationRecord[] = [
      { status: 'paid', sent_at: '2025-01-01T00:00:00.000Z', paid_at: null },
      { status: 'sent', sent_at: '2025-01-01T00:00:00.000Z', paid_at: '2025-01-05T00:00:00.000Z' },
    ];
    expect(averageDaysToPay(invoices)).toBeNull();
  });

  it('averages the day-differences for paid invoices', () => {
    const invoices: InvoiceDurationRecord[] = [
      { status: 'paid', sent_at: '2025-01-01T00:00:00.000Z', paid_at: '2025-01-06T00:00:00.000Z' }, // 5 days
      { status: 'paid', sent_at: '2025-01-01T00:00:00.000Z', paid_at: '2025-01-11T00:00:00.000Z' }, // 10 days
    ];
    expect(averageDaysToPay(invoices)).toBe(7.5);
  });

  it('skips invoices paid before they were sent (malformed data)', () => {
    const invoices: InvoiceDurationRecord[] = [
      { status: 'paid', sent_at: '2025-01-10T00:00:00.000Z', paid_at: '2025-01-01T00:00:00.000Z' },
      { status: 'paid', sent_at: '2025-01-01T00:00:00.000Z', paid_at: '2025-01-05T00:00:00.000Z' }, // 4 days
    ];
    expect(averageDaysToPay(invoices)).toBe(4);
  });

  it('rounds to one decimal place', () => {
    const invoices: InvoiceDurationRecord[] = [
      { status: 'paid', sent_at: '2025-01-01T00:00:00.000Z', paid_at: '2025-01-02T00:00:00.000Z' }, // 1
      { status: 'paid', sent_at: '2025-01-01T00:00:00.000Z', paid_at: '2025-01-02T00:00:00.000Z' }, // 1
      { status: 'paid', sent_at: '2025-01-01T00:00:00.000Z', paid_at: '2025-01-03T00:00:00.000Z' }, // 2
    ];
    // (1 + 1 + 2) / 3 = 1.333... -> 1.3
    expect(averageDaysToPay(invoices)).toBe(1.3);
  });
});
