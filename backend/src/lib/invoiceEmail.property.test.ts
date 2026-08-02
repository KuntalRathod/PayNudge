import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  buildInvoiceEmail,
  formatAmount,
  formatDueDate,
  type InvoiceEmailInput,
} from './invoiceEmail.js';

// Feature: paynudge, Property 6: Invoice email content includes all required fields

/**
 * Property-based test for the pure invoice email content builder.
 *
 * **Validates: Requirements 4.2** — for any invoice, the generated invoice-email
 * content contains the client name, the invoice number, the amount, the
 * description of work, and the due date.
 */

/**
 * Mirrors the HTML escaping applied inside {@link buildInvoiceEmail}. The HTML
 * body escapes the five HTML-significant characters, so user-provided values
 * (client name, description) and rendered values must be checked against their
 * escaped form in the HTML body rather than their raw form.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * A reasonably-constrained non-empty text generator: guarantees at least one
 * non-whitespace character so a "contains" assertion is meaningful (an empty
 * or whitespace-only string would make containment trivially true).
 */
const meaningfulText = fc
  .string({ minLength: 1, maxLength: 200 })
  .filter((s) => s.trim().length > 0);

/**
 * Valid invoice amount: 0.01 .. 999,999,999.99 with at most 2 decimal places.
 * Generated as an integer number of cents to avoid unrepresentable values.
 */
const amountArb = fc
  .integer({ min: 1, max: 99_999_999_999 })
  .map((cents) => cents / 100);

/** A valid calendar date within a broad, deterministic range. */
const dueDateArb = fc.date({
  min: new Date('1970-01-01T00:00:00Z'),
  max: new Date('2100-12-31T00:00:00Z'),
});

const invoiceInputArb: fc.Arbitrary<InvoiceEmailInput> = fc.record({
  clientName: meaningfulText,
  invoiceNumber: fc.integer({ min: 1, max: 1_000_000 }),
  amount: amountArb,
  description: meaningfulText,
  dueDate: dueDateArb,
});

describe('Property 6: Invoice email content includes all required fields', () => {
  it('renders client name, invoice number, amount, description, and due date', () => {
    fc.assert(
      fc.property(invoiceInputArb, (input) => {
        const { text, html } = buildInvoiceEmail(input);

        // Render amount/date via the same exported helpers to avoid brittle
        // formatting assumptions — the content must contain exactly what these
        // produce.
        const renderedAmount = formatAmount(input.amount);
        const renderedDueDate = formatDueDate(input.dueDate);
        const invoiceNumberStr = String(input.invoiceNumber);

        // Plain-text body contains every field in raw form.
        expect(text).toContain(input.clientName);
        expect(text).toContain(invoiceNumberStr);
        expect(text).toContain(renderedAmount);
        expect(text).toContain(input.description);
        expect(text).toContain(renderedDueDate);

        // HTML body contains every field in HTML-escaped form.
        expect(html).toContain(escapeHtml(input.clientName));
        expect(html).toContain(escapeHtml(invoiceNumberStr));
        expect(html).toContain(escapeHtml(renderedAmount));
        expect(html).toContain(escapeHtml(input.description));
        expect(html).toContain(escapeHtml(renderedDueDate));
      }),
      { numRuns: 200 },
    );
  });
});
