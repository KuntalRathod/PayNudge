import { describe, expect, it } from 'vitest';

import { computeClientStats, EMPTY_CLIENT_STATS, type ClientInvoiceRecord } from './clientStats.js';

describe('computeClientStats', () => {
  it('returns all-zero/null stats for a client with no invoices', () => {
    expect(computeClientStats([])).toEqual(EMPTY_CLIENT_STATS);
  });

  it('counts every invoice regardless of status', () => {
    const invoices: ClientInvoiceRecord[] = [
      { status: 'draft', amount: 10, created_at: '2025-01-01T00:00:00.000Z' },
      { status: 'sent', amount: 20, created_at: '2025-01-02T00:00:00.000Z' },
      { status: 'overdue', amount: 30, created_at: '2025-01-03T00:00:00.000Z' },
      { status: 'paid', amount: 40, created_at: '2025-01-04T00:00:00.000Z' },
    ];
    expect(computeClientStats(invoices).invoiceCount).toBe(4);
  });

  it('excludes drafts from total billed but includes sent/overdue/paid', () => {
    const invoices: ClientInvoiceRecord[] = [
      { status: 'draft', amount: 999, created_at: '2025-01-01T00:00:00.000Z' },
      { status: 'sent', amount: 100, created_at: '2025-01-02T00:00:00.000Z' },
      { status: 'overdue', amount: 50, created_at: '2025-01-03T00:00:00.000Z' },
      { status: 'paid', amount: 25, created_at: '2025-01-04T00:00:00.000Z' },
    ];
    expect(computeClientStats(invoices).totalBilled).toBe(175);
  });

  it('sums only paid invoices into totalPaid', () => {
    const invoices: ClientInvoiceRecord[] = [
      { status: 'paid', amount: 100, created_at: '2025-01-01T00:00:00.000Z' },
      { status: 'paid', amount: 50, created_at: '2025-01-02T00:00:00.000Z' },
      { status: 'sent', amount: 999, created_at: '2025-01-03T00:00:00.000Z' },
    ];
    expect(computeClientStats(invoices).totalPaid).toBe(150);
  });

  it('computes outstanding and overdue amounts consistently with the shared helpers', () => {
    const invoices: ClientInvoiceRecord[] = [
      { status: 'sent', amount: 100, created_at: '2025-01-01T00:00:00.000Z' },
      { status: 'overdue', amount: 50, created_at: '2025-01-02T00:00:00.000Z' },
      { status: 'overdue', amount: 25, created_at: '2025-01-03T00:00:00.000Z' },
      { status: 'paid', amount: 999, created_at: '2025-01-04T00:00:00.000Z' },
    ];
    const stats = computeClientStats(invoices);
    expect(stats.outstandingAmount).toBe(175);
    expect(stats.overdueAmount).toBe(75);
    expect(stats.overdueCount).toBe(2);
  });

  it('reports the most recently created invoice as lastInvoiceDate', () => {
    const invoices: ClientInvoiceRecord[] = [
      { status: 'sent', amount: 10, created_at: '2025-01-01T00:00:00.000Z' },
      { status: 'paid', amount: 20, created_at: '2025-03-15T00:00:00.000Z' },
      { status: 'overdue', amount: 30, created_at: '2025-02-01T00:00:00.000Z' },
    ];
    expect(computeClientStats(invoices).lastInvoiceDate).toBe('2025-03-15T00:00:00.000Z');
  });

  it('avoids floating point drift when summing amounts', () => {
    const invoices: ClientInvoiceRecord[] = [
      { status: 'sent', amount: 0.1, created_at: '2025-01-01T00:00:00.000Z' },
      { status: 'sent', amount: 0.2, created_at: '2025-01-02T00:00:00.000Z' },
    ];
    expect(computeClientStats(invoices).totalBilled).toBe(0.3);
  });

  it('does not mutate its input', () => {
    const invoices: ClientInvoiceRecord[] = [
      { status: 'sent', amount: 10, created_at: '2025-01-01T00:00:00.000Z' },
    ];
    const snapshot = JSON.parse(JSON.stringify(invoices));
    computeClientStats(invoices);
    expect(invoices).toEqual(snapshot);
  });
});
