/**
 * Presentation helpers for the Clients section upgrade (list cards + detail
 * page). Pure formatting functions kept separate from components for easy
 * testing and reuse, mirroring `app/invoices/format.ts`.
 */

/**
 * Formats an amount (which the API may send as a numeric string) as a USD
 * currency string. Falls back to the raw input when it is not a finite number
 * so we never render `NaN` to the user.
 */
export function formatClientAmount(amount: string | number): string {
  const numeric = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(numeric)) {
    return String(amount);
  }
  return numeric.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Formats an ISO date/timestamp for display. Falls back to an em dash for a
 * missing value and to the raw string for an unparseable one.
 */
export function formatClientDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

/** Human-friendly label for an invoice status value. */
export function formatInvoiceStatus(status: string): string {
  switch (status) {
    case 'draft':
      return 'Draft';
    case 'sent':
      return 'Sent';
    case 'overdue':
      return 'Overdue';
    case 'paid':
      return 'Paid';
    default:
      return status;
  }
}
