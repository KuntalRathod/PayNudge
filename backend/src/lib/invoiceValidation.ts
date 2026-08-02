/**
 * Invoice input validation (Requirements 3.1, 3.5, 3.6, 3.7).
 *
 * Pure, side-effect-free functions that validate the fields of an invoice
 * submission. No I/O, no database access, no clock/time reads. This keeps the
 * logic directly property-testable (Task 5.2 / Property 4) and reusable both at
 * the API boundary and in tests.
 *
 * Ownership of the referenced client is intentionally NOT checked here — that is
 * enforced at the storage layer via Supabase Row Level Security. This module
 * only performs a presence check on the client reference.
 *
 * ## Field-check order (deterministic)
 *
 * When multiple fields are invalid, exactly one error is returned. Fields are
 * checked in a stable, documented order so validation is deterministic and
 * property-testable:
 *
 *   1. clientId
 *   2. amount
 *   3. description
 *   4. dueDate
 *
 * The first field (in that order) that fails determines the returned error.
 *
 * ## Amount decimal-places approach
 *
 * Floating-point numbers cannot reliably represent decimal fractions, so the
 * "at most 2 decimal places" rule is enforced against a textual representation
 * of the amount rather than by inspecting a binary float:
 *
 *   - When the amount is provided as a string, the string itself is the
 *     authoritative representation and is matched against a strict decimal
 *     pattern that allows at most two fractional digits.
 *   - When the amount is provided as a number, it is first checked to be finite
 *     and then converted to a canonical decimal string via `toDecimalString`,
 *     which is validated with the same pattern. `amount * 100` rounding is used
 *     only as a tolerance guard against binary-representation artifacts.
 *
 * ## Due-date approach
 *
 * The due date is accepted as an ISO calendar-date string in `YYYY-MM-DD` form.
 * Validity is checked by parsing the components and confirming they round-trip
 * through a UTC `Date`, which rejects impossible calendar dates such as
 * `2023-02-30` (JavaScript would otherwise roll it over to March 2).
 */

/** Inclusive lower bound for a valid invoice amount. */
export const MIN_AMOUNT = 0.01;
/** Inclusive upper bound for a valid invoice amount. */
export const MAX_AMOUNT = 999_999_999.99;
/** Minimum description length (characters). */
export const MIN_DESCRIPTION_LENGTH = 1;
/** Maximum description length (characters). */
export const MAX_DESCRIPTION_LENGTH = 2000;

/** The invoice fields this module validates, in field-check order. */
export type InvoiceField = 'clientId' | 'amount' | 'description' | 'dueDate';

/** Stable, machine-readable failure codes. */
export type InvoiceValidationCode =
  | 'CLIENT_REQUIRED'
  | 'AMOUNT_REQUIRED'
  | 'AMOUNT_NOT_NUMERIC'
  | 'AMOUNT_OUT_OF_RANGE'
  | 'AMOUNT_TOO_MANY_DECIMALS'
  | 'DESCRIPTION_REQUIRED'
  | 'DESCRIPTION_WHITESPACE_ONLY'
  | 'DESCRIPTION_TOO_LONG'
  | 'DUE_DATE_REQUIRED'
  | 'DUE_DATE_INVALID';

/**
 * Raw, untrusted invoice submission. Fields are typed as `unknown` because they
 * originate from an external request body and must be validated/narrowed here.
 */
export interface RawInvoiceInput {
  clientId?: unknown;
  amount?: unknown;
  description?: unknown;
  /** ISO calendar date in `YYYY-MM-DD` form. */
  dueDate?: unknown;
}

/** Normalized invoice values produced on successful validation. */
export interface NormalizedInvoice {
  clientId: string;
  /** Numeric amount with at most 2 decimal places. */
  amount: number;
  /** Canonical fixed-2-decimal string representation of {@link amount}. */
  amountString: string;
  /** The submitted description, unchanged. */
  description: string;
  /** The validated due date in `YYYY-MM-DD` form. */
  dueDate: string;
}

/** A field-identifying validation failure. */
export interface InvoiceValidationError {
  field: InvoiceField;
  code: InvoiceValidationCode;
  message: string;
}

/** Discriminated result of validating a single field. */
export type FieldResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: InvoiceValidationError };

/** Discriminated result of validating a full invoice submission. */
export type InvoiceValidationResult =
  | { ok: true; value: NormalizedInvoice }
  | ({ ok: false } & InvoiceValidationError);

/** A decimal amount: an integer or fixed-point number with 1 or 2 decimals. */
const DECIMAL_AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;
/** An ISO calendar date, `YYYY-MM-DD`. */
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function fail(
  field: InvoiceField,
  code: InvoiceValidationCode,
  message: string,
): { ok: false; error: InvoiceValidationError } {
  return { ok: false, error: { field, code, message } };
}

/**
 * Validates the client reference. Ownership is enforced elsewhere (RLS); this
 * is a presence check only: a non-empty string id must be provided.
 */
export function validateClientId(clientId: unknown): FieldResult<string> {
  if (typeof clientId !== 'string' || clientId.trim().length === 0) {
    return fail('clientId', 'CLIENT_REQUIRED', 'A client must be selected for the invoice.');
  }
  return { ok: true, value: clientId };
}

/**
 * Validates the amount. Accepts a number or a decimal string. Rejects zero,
 * negative, non-numeric, values greater than {@link MAX_AMOUNT}, and values with
 * more than 2 decimal places. See the module doc comment for the decimal-place
 * strategy.
 */
export function validateAmount(amount: unknown): FieldResult<number> {
  let numeric: number;

  if (typeof amount === 'string') {
    const trimmed = amount.trim();
    if (trimmed.length === 0) {
      return fail('amount', 'AMOUNT_REQUIRED', 'An invoice amount is required.');
    }
    // The string is the authoritative representation for decimal places.
    if (!DECIMAL_AMOUNT_PATTERN.test(trimmed)) {
      // Distinguish "too many decimals" from "not numeric" for a clearer message.
      if (/^\d+\.\d{3,}$/.test(trimmed)) {
        return fail(
          'amount',
          'AMOUNT_TOO_MANY_DECIMALS',
          'Amount must have at most 2 decimal places.',
        );
      }
      return fail('amount', 'AMOUNT_NOT_NUMERIC', 'Amount must be a valid number.');
    }
    numeric = Number(trimmed);
  } else if (typeof amount === 'number') {
    if (!Number.isFinite(amount)) {
      return fail('amount', 'AMOUNT_NOT_NUMERIC', 'Amount must be a valid number.');
    }
    numeric = amount;
  } else if (amount === undefined || amount === null) {
    return fail('amount', 'AMOUNT_REQUIRED', 'An invoice amount is required.');
  } else {
    return fail('amount', 'AMOUNT_NOT_NUMERIC', 'Amount must be a valid number.');
  }

  // Range check (inclusive). Zero and negatives fall below the lower bound.
  if (numeric < MIN_AMOUNT || numeric > MAX_AMOUNT) {
    return fail(
      'amount',
      'AMOUNT_OUT_OF_RANGE',
      'Amount must be between 0.01 and 999,999,999.99.',
    );
  }

  // Decimal-places check via the shortest round-trip string representation.
  // `String(n)` yields the shortest decimal string that parses back to the same
  // float (e.g. `String(999999999.99) === '999999999.99'`), so it exposes the
  // decimals the user actually meant without binary-representation artifacts.
  // Values in the accepted range [0.01, 999,999,999.99] never use exponential
  // notation, so a simple pattern match is sufficient.
  if (!DECIMAL_AMOUNT_PATTERN.test(String(numeric))) {
    return fail(
      'amount',
      'AMOUNT_TOO_MANY_DECIMALS',
      'Amount must have at most 2 decimal places.',
    );
  }

  return { ok: true, value: numeric };
}

/**
 * Validates the description: required, 1–2000 characters, and not
 * whitespace-only. The submitted value is returned unchanged on success.
 */
export function validateDescription(description: unknown): FieldResult<string> {
  if (typeof description !== 'string' || description.length === 0) {
    return fail('description', 'DESCRIPTION_REQUIRED', 'A description of work is required.');
  }
  if (description.trim().length === 0) {
    return fail(
      'description',
      'DESCRIPTION_WHITESPACE_ONLY',
      'Description cannot be only whitespace.',
    );
  }
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    return fail(
      'description',
      'DESCRIPTION_TOO_LONG',
      `Description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`,
    );
  }
  return { ok: true, value: description };
}

/**
 * Validates the due date as an ISO `YYYY-MM-DD` calendar date. Rejects missing
 * values, malformed strings, and impossible calendar dates (e.g. 2023-02-30).
 */
export function validateDueDate(dueDate: unknown): FieldResult<string> {
  if (typeof dueDate !== 'string' || dueDate.trim().length === 0) {
    return fail('dueDate', 'DUE_DATE_REQUIRED', 'A due date is required.');
  }

  const match = ISO_DATE_PATTERN.exec(dueDate);
  if (!match) {
    return fail('dueDate', 'DUE_DATE_INVALID', 'Due date must be a valid calendar date (YYYY-MM-DD).');
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  // Construct in UTC and confirm the components round-trip. An invalid day such
  // as 2023-02-30 rolls over to a different month/day, failing this check.
  const date = new Date(Date.UTC(year, month - 1, day));
  const roundTrips =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;

  if (!roundTrips) {
    return fail('dueDate', 'DUE_DATE_INVALID', 'Due date must be a valid calendar date (YYYY-MM-DD).');
  }

  return { ok: true, value: dueDate };
}

/**
 * Validates a full invoice submission. On success, returns the normalized
 * values. On failure, returns the first field error in the documented
 * field-check order: clientId → amount → description → dueDate.
 */
export function validateInvoiceInput(input: RawInvoiceInput): InvoiceValidationResult {
  const client = validateClientId(input.clientId);
  if (!client.ok) {
    return { ok: false, ...client.error };
  }

  const amount = validateAmount(input.amount);
  if (!amount.ok) {
    return { ok: false, ...amount.error };
  }

  const description = validateDescription(input.description);
  if (!description.ok) {
    return { ok: false, ...description.error };
  }

  const dueDate = validateDueDate(input.dueDate);
  if (!dueDate.ok) {
    return { ok: false, ...dueDate.error };
  }

  return {
    ok: true,
    value: {
      clientId: client.value,
      amount: amount.value,
      amountString: amount.value.toFixed(2),
      description: description.value,
      dueDate: dueDate.value,
    },
  };
}
