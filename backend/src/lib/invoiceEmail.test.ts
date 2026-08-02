import { describe, expect, it } from 'vitest';

import {
  buildInvoiceEmail,
  formatAmount,
  formatDueDate,
  type InvoiceEmailInput,
} from './invoiceEmail.js';

/**
 * Unit tests for the pure invoice email content builder (Requirement 4.2).
 *
 * These cover concrete examples and edge cases. The universal "all required
 * fields are present" property is validated separately by the property test
 * in Task 6.3 (Property 6).
 */

const baseInput: InvoiceEmailInput = {
  clientName: 'Acme Corp',
  invoiceNumber: 42,
  amount: 1234.5,
  description: 'Website redesign and deployment',
  dueDate: '2025-03-01',
};

describe('formatAmount', () => {
  it('formats a number as USD currency with two decimals', () => {
    expect(formatAmount(1234.5)).toBe('$1,234.50');
  });

  it('always renders exactly two fraction digits', () => {
    expect(formatAmount(1000)).toBe('$1,000.00');
    expect(formatAmount(0.01)).toBe('$0.01');
  });

  it('falls back to a 2-decimal string for an unknown currency', () => {
    expect(formatAmount(50, 'NOT_A_CURRENCY')).toBe('50.00');
  });
});

describe('formatDueDate', () => {
  it('renders an ISO date string in long human-readable form (UTC)', () => {
    expect(formatDueDate('2025-03-01')).toBe('March 1, 2025');
  });

  it('accepts a Date instance', () => {
    expect(formatDueDate(new Date('2025-12-25T00:00:00Z'))).toBe('December 25, 2025');
  });

  it('returns the original string when the date is unparseable', () => {
    expect(formatDueDate('not-a-date')).toBe('not-a-date');
  });
});

describe('buildInvoiceEmail', () => {
  it('includes all five required fields in the text body', () => {
    const { text } = buildInvoiceEmail(baseInput);
    expect(text).toContain('Acme Corp');
    expect(text).toContain('42');
    expect(text).toContain('$1,234.50');
    expect(text).toContain('Website redesign and deployment');
    expect(text).toContain('March 1, 2025');
  });

  it('includes all five required fields in the html body', () => {
    const { html } = buildInvoiceEmail(baseInput);
    expect(html).toContain('Acme Corp');
    expect(html).toContain('42');
    expect(html).toContain('$1,234.50');
    expect(html).toContain('Website redesign and deployment');
    expect(html).toContain('March 1, 2025');
  });

  it('references the invoice number in the subject', () => {
    const { subject } = buildInvoiceEmail(baseInput);
    expect(subject).toContain('42');
  });

  it('escapes HTML-significant characters in user-provided values', () => {
    const { html } = buildInvoiceEmail({
      ...baseInput,
      clientName: 'Tom & Jerry <script>',
    });
    expect(html).toContain('Tom &amp; Jerry &lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('is deterministic for identical input', () => {
    expect(buildInvoiceEmail(baseInput)).toEqual(buildInvoiceEmail(baseInput));
  });
});
