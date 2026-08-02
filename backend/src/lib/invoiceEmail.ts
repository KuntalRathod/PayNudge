/**
 * Invoice email content builder (Requirement 4.2).
 *
 * A PURE, deterministic, side-effect-free function that composes the content
 * of an invoice email. It performs no I/O (no network, no email delivery) so
 * it can be property-tested directly (see Task 6.3 / Property 6): for any
 * invoice, the rendered content must contain the client name, invoice number,
 * amount, description of work, and due date.
 *
 * Delivery itself is handled elsewhere by the Resend-backed Email_Service
 * (Task 6.1 / 6.4); this module only decides *what* the email says.
 */

/**
 * Structured input for composing an invoice email.
 *
 * @property clientName    Display name of the billed Client.
 * @property invoiceNumber Per-user sequential invoice number (>= 1).
 * @property amount        Invoice amount as a number, in whole currency units
 *                         (e.g. `1234.5` means 1,234.50). Rendered with 2
 *                         decimal places.
 * @property description   Description of the work being billed.
 * @property dueDate       Payment due date, either an ISO date string
 *                         (e.g. `"2025-03-01"` or a full ISO datetime) or a
 *                         `Date` instance.
 * @property currency      Optional ISO 4217 currency code for amount
 *                         formatting. Defaults to `"USD"`.
 * @property locale        Optional BCP 47 locale for amount/date formatting.
 *                         Defaults to `"en-US"`.
 */
export interface InvoiceEmailInput {
  clientName: string;
  invoiceNumber: number;
  amount: number;
  description: string;
  dueDate: string | Date;
  currency?: string;
  locale?: string;
}

/**
 * Structured, rendered invoice email content.
 *
 * @property subject A one-line subject naming the invoice number.
 * @property text    Plain-text body containing all five required fields.
 * @property html    HTML body containing all five required fields, with any
 *                   user-provided values HTML-escaped to keep the markup safe.
 */
export interface InvoiceEmailContent {
  subject: string;
  text: string;
  html: string;
}

const DEFAULT_CURRENCY = 'USD';
const DEFAULT_LOCALE = 'en-US';

/**
 * Formats an amount as readable currency.
 *
 * Uses `Intl.NumberFormat` with `style: 'currency'`, which renders a currency
 * symbol and exactly 2 fraction digits (e.g. `1234.5` -> `"$1,234.50"` for
 * USD/en-US). Non-finite inputs (NaN, Infinity) fall back to a fixed
 * 2-decimal string so the amount always appears in the content.
 */
export function formatAmount(
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
    // Unknown currency/locale: fall back to a plain 2-decimal representation
    // so the amount is still present in the rendered content.
    return amount.toFixed(2);
  }
}

/**
 * Formats a due date in a human-readable, long form.
 *
 * Accepts an ISO date string or a `Date`. Valid dates render in a long,
 * locale-aware form (e.g. `"March 1, 2025"` for en-US) computed in UTC so the
 * output is deterministic and independent of the host time zone. If the input
 * cannot be parsed into a valid date, the original string (or the Date's
 * string form) is returned unchanged so the due date still appears.
 */
export function formatDueDate(
  dueDate: string | Date,
  locale: string = DEFAULT_LOCALE,
): string {
  const date = dueDate instanceof Date ? dueDate : new Date(dueDate);

  if (Number.isNaN(date.getTime())) {
    return typeof dueDate === 'string' ? dueDate : String(dueDate);
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

/** Escapes the five characters that are significant in HTML text/attributes. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Composes invoice email content that includes ALL required fields
 * (Requirement 4.2): the client name, invoice number, amount, description of
 * work, and due date.
 *
 * Pure and deterministic: the same input always yields the same output, with
 * no side effects. The amount is rendered as readable currency (see
 * {@link formatAmount}) and the due date in a long human-readable form (see
 * {@link formatDueDate}).
 */
export function buildInvoiceEmail(input: InvoiceEmailInput): InvoiceEmailContent {
  const {
    clientName,
    invoiceNumber,
    amount,
    description,
    dueDate,
    currency = DEFAULT_CURRENCY,
    locale = DEFAULT_LOCALE,
  } = input;

  const formattedAmount = formatAmount(amount, currency, locale);
  const formattedDueDate = formatDueDate(dueDate, locale);
  const invoiceLabel = `Invoice #${invoiceNumber}`;

  const subject = `${invoiceLabel} from your service provider`;

  const text = [
    `Hi ${clientName},`,
    '',
    `Please find the details of ${invoiceLabel} below.`,
    '',
    `Invoice number: ${invoiceNumber}`,
    `Amount due: ${formattedAmount}`,
    `Description of work: ${description}`,
    `Due date: ${formattedDueDate}`,
    '',
    'Thank you for your business.',
  ].join('\n');

  const html = [
    `<p>Hi ${escapeHtml(clientName)},</p>`,
    `<p>Please find the details of ${escapeHtml(invoiceLabel)} below.</p>`,
    '<ul>',
    `<li><strong>Invoice number:</strong> ${escapeHtml(String(invoiceNumber))}</li>`,
    `<li><strong>Amount due:</strong> ${escapeHtml(formattedAmount)}</li>`,
    `<li><strong>Description of work:</strong> ${escapeHtml(description)}</li>`,
    `<li><strong>Due date:</strong> ${escapeHtml(formattedDueDate)}</li>`,
    '</ul>',
    '<p>Thank you for your business.</p>',
  ].join('\n');

  return { subject, text, html };
}
