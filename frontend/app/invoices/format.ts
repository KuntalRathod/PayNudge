/**
 * Feature-local presentation helpers for the invoice UI (task 15.3).
 *
 * Pure formatting functions kept separate from components so they are trivial
 * to unit test and reuse across the list, detail, and create views.
 */

import type { InvoiceStatus } from './types';

/**
 * Formats an invoice amount (which the API may send as a numeric string) as a
 * USD currency string. Falls back to the raw input when it is not a finite
 * number so we never render `NaN` to the user.
 */
export function formatAmount(amount: string | number): string {
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
 * Formats an ISO `YYYY-MM-DD` due date for display. The date is interpreted in
 * UTC so the rendered calendar day matches the stored value regardless of the
 * viewer's timezone. Falls back to the raw string when unparseable.
 */
export function formatDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) {
    return isoDate;
  }
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime())) {
    return isoDate;
  }
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** Human-friendly label for a status value. */
export function formatStatus(status: InvoiceStatus): string {
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
