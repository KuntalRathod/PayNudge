import { describe, expect, it } from 'vitest';
import {
  MAX_CONTENT_LENGTH,
  formatAmount,
  formatDate,
  formatDateTime,
  tierLabel,
} from './types';

/**
 * Unit tests for the follow-up UI formatting helpers (task 15.5).
 *
 * These pure helpers back the pending list, edit view, and history views, so
 * they are covered directly (the React components require a DOM environment
 * that is out of scope for this unit suite). Edge cases include non-numeric
 * amounts, invalid/empty dates, and unknown tiers.
 */

describe('formatAmount', () => {
  it('formats numeric and stringified amounts as USD', () => {
    expect(formatAmount(1234.5)).toBe('$1,234.50');
    expect(formatAmount('1234.5')).toBe('$1,234.50');
    expect(formatAmount(0)).toBe('$0.00');
  });

  it('falls back to the raw value when not a finite number', () => {
    expect(formatAmount('not-a-number')).toBe('not-a-number');
  });
});

describe('formatDate', () => {
  it('formats an ISO date', () => {
    expect(formatDate('2024-01-15')).toBe('Jan 15, 2024');
  });

  it('renders an em dash for empty input and echoes invalid input', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate(undefined)).toBe('—');
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });
});

describe('formatDateTime', () => {
  it('renders an em dash for empty input', () => {
    expect(formatDateTime(null)).toBe('—');
  });

  it('includes a date for a valid timestamp', () => {
    const formatted = formatDateTime('2024-01-15T09:30:00.000Z');
    expect(formatted).toContain('2024');
  });
});

describe('tierLabel', () => {
  it('maps known tiers to readable labels', () => {
    expect(tierLabel('polite')).toBe('Polite');
    expect(tierLabel('firm')).toBe('Firm');
    expect(tierLabel('final_notice')).toBe('Final notice');
  });

  it('echoes an unknown tier unchanged', () => {
    expect(tierLabel('unknown')).toBe('unknown');
  });
});

describe('MAX_CONTENT_LENGTH', () => {
  it('mirrors the backend 10,000-character edit bound', () => {
    expect(MAX_CONTENT_LENGTH).toBe(10_000);
  });
});
