/**
 * Feature-local client-side validation for the create-invoice form (Req 3.1).
 *
 * These mirror the backend's authoritative rules (see backend
 * `lib/invoiceValidation.ts`) so the user gets immediate feedback before a round
 * trip. The backend remains the source of truth: any error it returns is still
 * surfaced. Kept as pure functions so they can be unit tested in isolation.
 */

/** Inclusive lower bound for a valid invoice amount. */
export const MIN_AMOUNT = 0.01;
/** Inclusive upper bound for a valid invoice amount. */
export const MAX_AMOUNT = 999_999_999.99;
/** Maximum description length (characters). */
export const MAX_DESCRIPTION_LENGTH = 2000;

/** A decimal amount with at most two fractional digits. */
const DECIMAL_AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;
/** An ISO calendar date, `YYYY-MM-DD`. */
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The fields a create submission can carry. */
export interface InvoiceFormValues {
  clientId: string;
  amount: string;
  description: string;
  dueDate: string;
}

/** Field-keyed validation errors (absent key = valid field). */
export type InvoiceFormErrors = Partial<Record<keyof InvoiceFormValues, string>>;

/** Validates the selected client reference (presence only; ownership is RLS). */
export function validateClientId(clientId: string): string | undefined {
  if (clientId.trim().length === 0) {
    return 'Select a client for this invoice.';
  }
  return undefined;
}

/**
 * Validates the amount string: required, numeric, at most two decimals, and
 * within [0.01, 999,999,999.99].
 */
export function validateAmount(amount: string): string | undefined {
  const trimmed = amount.trim();
  if (trimmed.length === 0) {
    return 'An invoice amount is required.';
  }
  if (/^\d+\.\d{3,}$/.test(trimmed)) {
    return 'Amount must have at most 2 decimal places.';
  }
  if (!DECIMAL_AMOUNT_PATTERN.test(trimmed)) {
    return 'Amount must be a valid number.';
  }
  const numeric = Number(trimmed);
  if (numeric < MIN_AMOUNT || numeric > MAX_AMOUNT) {
    return 'Amount must be between 0.01 and 999,999,999.99.';
  }
  return undefined;
}

/** Validates the description: required, non-whitespace, at most 2000 chars. */
export function validateDescription(description: string): string | undefined {
  if (description.length === 0 || description.trim().length === 0) {
    return 'A description of work is required.';
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return `Description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`;
  }
  return undefined;
}

/** Validates the due date as a real `YYYY-MM-DD` calendar date. */
export function validateDueDate(dueDate: string): string | undefined {
  if (dueDate.trim().length === 0) {
    return 'A due date is required.';
  }
  const match = ISO_DATE_PATTERN.exec(dueDate);
  if (!match) {
    return 'Due date must be a valid calendar date.';
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  const roundTrips =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  if (!roundTrips) {
    return 'Due date must be a valid calendar date.';
  }
  return undefined;
}

/** Validates every field, returning a map of the fields that failed. */
export function validateInvoiceForm(values: InvoiceFormValues): InvoiceFormErrors {
  const errors: InvoiceFormErrors = {};
  const clientId = validateClientId(values.clientId);
  if (clientId) errors.clientId = clientId;
  const amount = validateAmount(values.amount);
  if (amount) errors.amount = amount;
  const description = validateDescription(values.description);
  if (description) errors.description = description;
  const dueDate = validateDueDate(values.dueDate);
  if (dueDate) errors.dueDate = dueDate;
  return errors;
}
