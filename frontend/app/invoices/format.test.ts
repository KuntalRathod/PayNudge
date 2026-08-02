import { describe, expect, it } from 'vitest';
import { formatAmount, formatDate, formatStatus } from './format';

/**
 * Unit tests for the invoice presentation helpers (Req 3.8 display).
 */

describe('formatAmount', () => {
  it('formats numeric strings and numbers as USD with two decimals', () => {
    expect(formatAmount('250')).toBe('$250.00');
    expect(formatAmount(1234.5)).toBe('$1,234.50');
    expect(formatAmount('999999999.99')).toBe('$999,999,999.99');
  });

  it('falls back to the raw value when not a finite number', () => {
    expect(formatAmount('abc')).toBe('abc');
  });
});

describe('formatDate', () => {
  it('formats an ISO date in UTC regardless of local timezone', () => {
    expect(formatDate('2025-01-15')).toBe('Jan 15, 2025');
  });

  it('falls back to the raw string when unparseable', () => {
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });
});

describe('formatStatus', () => {
  it('capitalizes each known status', () => {
    expect(formatStatus('draft')).toBe('Draft');
    expect(formatStatus('sent')).toBe('Sent');
    expect(formatStatus('overdue')).toBe('Overdue');
    expect(formatStatus('paid')).toBe('Paid');
  });
});
