/**
 * Invoice PDF generation (additive PDF-invoice feature).
 *
 * `generateInvoicePdf` renders a clean, one-page, professional invoice PDF
 * IN MEMORY using `pdfkit` — no headless browser, no filesystem writes. The
 * PDF is built entirely in a `Buffer`, which callers stream directly as an
 * HTTP response (`GET /invoices/:id/pdf`) or attach to the outbound Resend
 * email. Railway's filesystem is ephemeral, so this module never persists a
 * PDF to disk; every call regenerates the document on demand from the
 * invoice's current data (including its live "Paid"/"Unpaid" status).
 *
 * The layout is a simple, single-page structure:
 *   - Header: business/sender name + "INVOICE" title.
 *   - Status badge: "PAID" or "UNPAID" (colored accordingly).
 *   - Metadata block: invoice number, issue date, due date.
 *   - Client block: name + email.
 *   - Description/line-item section.
 *   - Total amount section.
 *   - Footer: "Thank you for your business."
 */

import PDFDocument from 'pdfkit';

/** Input needed to render an invoice PDF. */
export interface InvoicePdfInput {
  /** Business/sender name shown in the header (Req: sender name). */
  senderName: string;
  /** Per-user sequential invoice number. */
  invoiceNumber: number;
  /** Invoice amount in whole currency units (e.g. `1234.5` -> "$1,234.50"). */
  amount: number;
  /** ISO 4217 currency code. Defaults to `"USD"`. */
  currency?: string;
  /** Description of the work billed on the invoice. */
  description: string;
  /** Payment due date — ISO date/datetime string or a `Date`. */
  dueDate: string | Date;
  /**
   * Invoice issue date — ISO date/datetime string or a `Date`. Defaults to
   * "now" when omitted (e.g. for invoices with no stored issue date).
   */
  issueDate?: string | Date;
  /** Billed client's display name. */
  clientName: string;
  /** Billed client's email address. */
  clientEmail: string;
  /**
   * Current invoice status. Anything other than `"paid"` renders an
   * "UNPAID" badge; `"paid"` renders a "PAID" badge.
   */
  status: string;
  /** BCP 47 locale for amount/date formatting. Defaults to `"en-US"`. */
  locale?: string;
  /**
   * Business address, shown under the sender name in the header (Settings:
   * Business Address). Omitted from the layout when not provided.
   */
  businessAddress?: string | null;
  /**
   * Payment instructions / bank details / UPI / Stripe link, rendered above
   * the footer (Settings: Payment Instructions). Omitted when not provided.
   */
  paymentInstructions?: string | null;
  /**
   * Default payment terms label (e.g. "Net 15", "Due on receipt"), shown
   * alongside the due date (Settings: Default Payment Terms). Omitted when
   * not provided.
   */
  paymentTerms?: string | null;
}

const DEFAULT_CURRENCY = 'USD';
const DEFAULT_LOCALE = 'en-US';

const INK = '#1a1a1a';
const MUTED = '#6b7280';
const RULE = '#e5e7eb';
const PAID_COLOR = '#15803d';
const UNPAID_COLOR = '#b91c1c';

/** Formats an amount as readable currency, falling back gracefully. */
function formatAmount(
  amount: number,
  currency: string = DEFAULT_CURRENCY,
  locale: string = DEFAULT_LOCALE,
): string {
  if (!Number.isFinite(amount)) {
    return amount.toString();
  }
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return amount.toFixed(2);
  }
}

/** Formats a date in a human-readable, long form, computed in UTC. */
function formatDate(value: string | Date, locale: string = DEFAULT_LOCALE): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return typeof value === 'string' ? value : String(value);
  }
  try {
    return new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/**
 * Renders a one-page invoice PDF and resolves with its bytes as a `Buffer`.
 *
 * Pure with respect to the outside world: no file I/O, no network calls — the
 * document is assembled entirely in memory and the promise resolves once
 * `pdfkit` has flushed every chunk of the finished document.
 */
export function generateInvoicePdf(input: InvoicePdfInput): Promise<Buffer> {
  const currency = input.currency ?? DEFAULT_CURRENCY;
  const locale = input.locale ?? DEFAULT_LOCALE;
  const isPaid = input.status === 'paid';

  return new Promise<Buffer>((resolve, reject) => {
    try {
      // `compress: false` keeps the content stream uncompressed. The
      // document is tiny (a single page of text), so the size difference is
      // negligible, and it lets tests assert that expected text (client
      // name, invoice number, amount, etc.) appears directly in the raw
      // output buffer without needing a full PDF-parsing dependency.
      const doc = new PDFDocument({ size: 'A4', margin: 50, compress: false });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', (error: Error) => reject(error));

      // --- Header -------------------------------------------------------
      doc
        .fillColor(INK)
        .fontSize(20)
        .font('Helvetica-Bold')
        .text(input.senderName, { continued: false });

      if (input.businessAddress && input.businessAddress.trim().length > 0) {
        doc
          .font('Helvetica')
          .fontSize(10)
          .fillColor(MUTED)
          .text(input.businessAddress.trim(), { width: 300 });
      }

      doc
        .fontSize(26)
        .fillColor(INK)
        .font('Helvetica-Bold')
        .text('INVOICE', 50, doc.y + 6);

      // --- Status badge (top-right) -------------------------------------
      const badgeText = isPaid ? 'PAID' : 'UNPAID';
      const badgeColor = isPaid ? PAID_COLOR : UNPAID_COLOR;
      const badgeWidth = 100;
      const badgeHeight = 28;
      const badgeX = doc.page.width - doc.page.margins.right - badgeWidth;
      const badgeY = 50;
      doc
        .save()
        .lineWidth(1.5)
        .strokeColor(badgeColor)
        .roundedRect(badgeX, badgeY, badgeWidth, badgeHeight, 4)
        .stroke()
        .fillColor(badgeColor)
        .font('Helvetica-Bold')
        .fontSize(13)
        .text(badgeText, badgeX, badgeY + 8, { width: badgeWidth, align: 'center' })
        .restore();

      doc.moveDown(1.5);
      doc
        .strokeColor(RULE)
        .lineWidth(1)
        .moveTo(50, doc.y)
        .lineTo(doc.page.width - doc.page.margins.right, doc.y)
        .stroke();
      doc.moveDown(1);

      // --- Metadata block -------------------------------------------------
      const issueDate = input.issueDate ?? new Date();
      const metaTop = doc.y;
      const metaLabelColor = MUTED;
      const colWidth = (doc.page.width - doc.page.margins.left - doc.page.margins.right) / 2;

      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor(metaLabelColor)
        .text('Invoice number', 50, metaTop)
        .fillColor(INK)
        .font('Helvetica-Bold')
        .fontSize(12)
        .text(`#${input.invoiceNumber}`, 50, metaTop + 14);

      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor(metaLabelColor)
        .text('Issue date', 50 + colWidth, metaTop)
        .fillColor(INK)
        .font('Helvetica-Bold')
        .fontSize(12)
        .text(formatDate(issueDate, locale), 50 + colWidth, metaTop + 14);

      const metaRow2Top = metaTop + 40;
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor(metaLabelColor)
        .text('Due date', 50, metaRow2Top)
        .fillColor(INK)
        .font('Helvetica-Bold')
        .fontSize(12)
        .text(formatDate(input.dueDate, locale), 50, metaRow2Top + 14);

      if (input.paymentTerms && input.paymentTerms.trim().length > 0) {
        doc
          .font('Helvetica')
          .fontSize(10)
          .fillColor(metaLabelColor)
          .text('Payment terms', 50 + colWidth, metaRow2Top)
          .fillColor(INK)
          .font('Helvetica-Bold')
          .fontSize(12)
          .text(input.paymentTerms.trim(), 50 + colWidth, metaRow2Top + 14);
      }

      doc.y = metaRow2Top + 40;
      doc.moveDown(0.5);

      doc
        .strokeColor(RULE)
        .lineWidth(1)
        .moveTo(50, doc.y)
        .lineTo(doc.page.width - doc.page.margins.right, doc.y)
        .stroke();
      doc.moveDown(1);

      // --- Client block ----------------------------------------------------
      doc
        .font('Helvetica')
        .fontSize(10)
        .fillColor(metaLabelColor)
        .text('Billed to');
      doc
        .font('Helvetica-Bold')
        .fontSize(12)
        .fillColor(INK)
        .text(input.clientName);
      doc
        .font('Helvetica')
        .fontSize(11)
        .fillColor(MUTED)
        .text(input.clientEmail);

      doc.moveDown(1.5);

      // --- Description / line-item section ---------------------------------
      const tableTop = doc.y;
      const descX = 50;
      const amountX = doc.page.width - doc.page.margins.right - 150;

      doc
        .font('Helvetica-Bold')
        .fontSize(10)
        .fillColor(MUTED)
        .text('DESCRIPTION', descX, tableTop)
        .text('AMOUNT', amountX, tableTop, { width: 150, align: 'right' });

      doc.moveDown(0.5);
      doc
        .strokeColor(RULE)
        .lineWidth(1)
        .moveTo(50, doc.y)
        .lineTo(doc.page.width - doc.page.margins.right, doc.y)
        .stroke();
      doc.moveDown(0.75);

      const rowTop = doc.y;
      doc
        .font('Helvetica')
        .fontSize(11)
        .fillColor(INK)
        .text(input.description, descX, rowTop, { width: amountX - descX - 10 });

      const formattedAmount = formatAmount(input.amount, currency, locale);
      doc
        .font('Helvetica')
        .fontSize(11)
        .fillColor(INK)
        .text(formattedAmount, amountX, rowTop, { width: 150, align: 'right' });

      doc.moveDown(2);
      doc
        .strokeColor(RULE)
        .lineWidth(1)
        .moveTo(50, doc.y)
        .lineTo(doc.page.width - doc.page.margins.right, doc.y)
        .stroke();
      doc.moveDown(0.75);

      // --- Total section -----------------------------------------------------
      const totalTop = doc.y;
      doc
        .font('Helvetica-Bold')
        .fontSize(13)
        .fillColor(INK)
        .text('Total due', amountX - 100, totalTop, { width: 100, align: 'right' })
        .text(formattedAmount, amountX, totalTop, { width: 150, align: 'right' });

      // --- Payment instructions (Settings: Payment Instructions) --------------
      if (input.paymentInstructions && input.paymentInstructions.trim().length > 0) {
        doc.moveDown(1.5);
        doc
          .font('Helvetica-Bold')
          .fontSize(10)
          .fillColor(MUTED)
          .text('PAYMENT INSTRUCTIONS');
        doc.moveDown(0.25);
        doc
          .font('Helvetica')
          .fontSize(10)
          .fillColor(INK)
          .text(input.paymentInstructions.trim(), {
            width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
          });
      }

      // --- Footer --------------------------------------------------------------
      const footerY = doc.page.height - doc.page.margins.bottom - 40;
      doc
        .font('Helvetica-Oblique')
        .fontSize(10)
        .fillColor(MUTED)
        .text('Thank you for your business.', 50, footerY, {
          width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
          align: 'center',
        });

      doc.end();
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
