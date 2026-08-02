import { describe, expect, it } from 'vitest';

import { generateInvoicePdf, type InvoicePdfInput } from './invoicePdf.js';

/**
 * Unit tests for the pure-ish invoice PDF renderer.
 *
 * `generateInvoicePdf` is generated with `compress: false` specifically so
 * its content stream is plain (uncompressed) PDF text-showing operators,
 * which lets these tests verify the rendered document actually contains the
 * expected fields without depending on a full PDF-parsing library.
 *
 * PDF text operators show characters as parenthesized/hex-encoded glyph
 * runs inside `BT ... ET` blocks, and kerning can split what was one string
 * into several adjacent hex runs on the same text line. `extractPdfText`
 * reconstructs each line by concatenating every hex run within a `BT/ET`
 * block, which is sufficient for asserting on the fields this module
 * renders.
 */

function extractPdfText(pdfBuffer: Buffer): string {
  const content = pdfBuffer.toString('latin1');
  const blocks = content.match(/BT([\s\S]*?)ET/g) ?? [];
  const lines: string[] = [];
  for (const block of blocks) {
    const hexMatches = block.match(/<([0-9A-Fa-f]+)>/g) ?? [];
    let line = '';
    for (const match of hexMatches) {
      const hex = match.slice(1, -1);
      line += Buffer.from(hex, 'hex').toString('latin1');
    }
    lines.push(line);
  }
  return lines.join('\n');
}

const baseInput: InvoicePdfInput = {
  senderName: 'Acme Freelance',
  invoiceNumber: 42,
  amount: 1234.5,
  description: 'Website redesign and deployment',
  dueDate: '2025-03-01',
  issueDate: '2025-02-01',
  clientName: 'Client Corp',
  clientEmail: 'billing@clientcorp.com',
  status: 'sent',
};

describe('generateInvoicePdf', () => {
  it('resolves with a non-empty PDF buffer for valid invoice data', async () => {
    const buffer = await generateInvoicePdf(baseInput);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
    // A PDF always starts with the "%PDF-" magic header.
    expect(buffer.toString('latin1', 0, 5)).toBe('%PDF-');
  });

  it('does not throw for valid invoice data across every status', async () => {
    for (const status of ['draft', 'sent', 'overdue', 'paid']) {
      await expect(generateInvoicePdf({ ...baseInput, status })).resolves.toBeInstanceOf(Buffer);
    }
  });

  it('includes the sender name, invoice number, amount, description, client name, and client email', async () => {
    const buffer = await generateInvoicePdf(baseInput);
    const text = extractPdfText(buffer);

    expect(text).toContain('Acme Freelance');
    expect(text).toContain('42');
    expect(text).toContain('$1,234.50');
    expect(text).toContain('Website redesign and deployment');
    expect(text).toContain('Client Corp');
    expect(text).toContain('billing@clientcorp.com');
  });

  it('includes the issue date and due date in long human-readable form', async () => {
    const buffer = await generateInvoicePdf(baseInput);
    const text = extractPdfText(buffer);

    expect(text).toContain('February 1, 2025');
    expect(text).toContain('March 1, 2025');
  });

  it('renders an "UNPAID" badge for a non-paid invoice', async () => {
    const buffer = await generateInvoicePdf({ ...baseInput, status: 'sent' });
    const text = extractPdfText(buffer);
    expect(text).toContain('UNPAID');
  });

  it('renders a "PAID" badge (and no "UNPAID" badge) for a paid invoice', async () => {
    const buffer = await generateInvoicePdf({ ...baseInput, status: 'paid' });
    const text = extractPdfText(buffer);
    expect(text).not.toContain('UNPAID');
    expect(text).toContain('PAID');
  });

  it('includes the footer thank-you note', async () => {
    const buffer = await generateInvoicePdf(baseInput);
    const text = extractPdfText(buffer);
    expect(text).toContain('Thank you for your business.');
  });

  it('defaults the issue date to today when omitted', async () => {
    const { issueDate: _issueDate, ...withoutIssueDate } = baseInput;
    const buffer = await generateInvoicePdf(withoutIssueDate);
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.length).toBeGreaterThan(0);
  });

  it('falls back gracefully for a non-standard currency code', async () => {
    const buffer = await generateInvoicePdf({ ...baseInput, currency: 'NOT_A_CURRENCY' });
    const text = extractPdfText(buffer);
    expect(text).toContain('1234.50');
  });
});
