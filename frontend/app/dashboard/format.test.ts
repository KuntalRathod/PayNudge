import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  activityEventLabel,
  activityEventSubtitle,
  formatAverageDays,
  formatCurrency,
  formatEventTimestamp,
} from './format';
import type { ActivityEvent } from './types';

/**
 * Tests for the dashboard's pure presentation helpers (Task 15.4).
 *
 * Covers currency formatting for the Outstanding_Total (Req 5.1), the
 * activity-event labels and timestamps for the Activity_Feed (Req 5.5), and
 * their zero / empty / malformed edge cases.
 */

describe('formatCurrency', () => {
  it('formats a zero total for the empty-outstanding state (Req 5.2)', () => {
    expect(formatCurrency(0)).toBe('$0.00');
  });

  it('formats a whole-dollar amount with two decimals', () => {
    expect(formatCurrency(42)).toBe('$42.00');
  });

  it('formats a fractional amount and adds thousands separators', () => {
    expect(formatCurrency(1234.5)).toBe('$1,234.50');
  });

  it('falls back to $0.00 for non-finite input', () => {
    expect(formatCurrency(Number.NaN)).toBe('$0.00');
    expect(formatCurrency(Number.POSITIVE_INFINITY)).toBe('$0.00');
  });

  it('always returns a $-prefixed, 2-decimal string for finite amounts', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 999_999_999.99, noNaN: true, noDefaultInfinity: true }),
        (amount) => {
          const formatted = formatCurrency(amount);
          expect(formatted.startsWith('$')).toBe(true);
          // Exactly two fraction digits, e.g. "$1,234.50".
          expect(/^\$[\d,]+\.\d{2}$/.test(formatted)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
});

describe('activityEventLabel', () => {
  it('maps known event types to readable labels (Req 5.5)', () => {
    expect(activityEventLabel('invoice_sent')).toBe('Invoice sent');
    expect(activityEventLabel('follow_up_sent')).toBe('Follow-up sent');
    expect(activityEventLabel('payment_received')).toBe('Payment received');
  });

  it('normalizes an unknown event type instead of throwing', () => {
    expect(activityEventLabel('something_new')).toBe('Something new');
  });

  it('falls back to a generic label for an empty type', () => {
    expect(activityEventLabel('')).toBe('Activity');
  });
});

describe('formatAverageDays', () => {
  it('renders an em dash placeholder when there is nothing to average', () => {
    expect(formatAverageDays(null)).toBe('—');
  });

  it('pluralizes "days" for non-1 values', () => {
    expect(formatAverageDays(5)).toBe('5 days');
    expect(formatAverageDays(0)).toBe('0 days');
  });

  it('uses the singular "day" for exactly 1', () => {
    expect(formatAverageDays(1)).toBe('1 day');
  });

  it('rounds to one decimal place', () => {
    expect(formatAverageDays(4.567)).toBe('4.6 days');
  });
});

describe('activityEventSubtitle', () => {
  const base: ActivityEvent = {
    id: 1,
    type: 'invoice_sent',
    created_at: '2024-01-01T00:00:00.000Z',
  };

  it('returns null when the event has no invoice/client context', () => {
    expect(activityEventSubtitle(base)).toBeNull();
  });

  it('joins client name, invoice number, and amount with middots', () => {
    const event: ActivityEvent = {
      ...base,
      client_name: 'Acme Co',
      invoice_number: 42,
      amount: 1234.5,
    };
    expect(activityEventSubtitle(event)).toBe('Acme Co · Invoice #42 · $1,234.50');
  });

  it('renders only the fields present', () => {
    const event: ActivityEvent = { ...base, invoice_number: 7 };
    expect(activityEventSubtitle(event)).toBe('Invoice #7');
  });

  it('parses a stringified amount', () => {
    const event: ActivityEvent = { ...base, amount: '99.90' };
    expect(activityEventSubtitle(event)).toBe('$99.90');
  });
});

describe('formatEventTimestamp', () => {
  it('formats a valid ISO timestamp', () => {
    const formatted = formatEventTimestamp('2024-05-01T12:00:00.000Z');
    expect(formatted).not.toBe('—');
    expect(formatted.length).toBeGreaterThan(0);
  });

  it('degrades to an em dash for an invalid timestamp', () => {
    expect(formatEventTimestamp('not-a-date')).toBe('—');
  });
});
