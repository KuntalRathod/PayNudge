/**
 * Overdue detection and days-overdue arithmetic (Requirements 7.2–7.7).
 *
 * PURE, deterministic, side-effect-free functions. There is NO I/O and NO
 * reading of the system clock: the "current date" is ALWAYS supplied as a
 * parameter. This keeps the logic directly property-testable (Tasks 10.2 /
 * Property 12 and 10.3 / Property 13) and lets the daily cron (Task 10.4) pass
 * in a single evaluation date for all invoices.
 *
 * ## Calendar-day arithmetic approach
 *
 * All comparisons are by CALENDAR DATE in UTC, ignoring time-of-day. Every
 * input date — whether an ISO `YYYY-MM-DD` string, a full ISO datetime string,
 * or a `Date` instance — is reduced to a whole "UTC day number" (the count of
 * whole days since the Unix epoch at UTC midnight). Because UTC midnight is
 * always an exact multiple of {@link MS_PER_DAY}, the day number is computed by
 * exact integer division, so day differences are free of daylight-saving-time
 * and time-zone drift.
 *
 * Two dates are the "same calendar day" iff their day numbers are equal;
 * `currentDate` is "strictly later" than `dueDate` iff its day number is
 * greater. Days elapsed since the due date is simply the difference of the two
 * day numbers.
 */

/** Milliseconds in one calendar day. */
export const MS_PER_DAY = 86_400_000;

/** An ISO calendar date, `YYYY-MM-DD`. */
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A date accepted by the overdue helpers: an ISO string or a `Date`. */
export type DateInput = string | Date;

/**
 * The lifecycle state of an Invoice (Invoice_Status).
 * Mirrors the `status` CHECK constraint in the database schema.
 */
export type Status = 'draft' | 'sent' | 'overdue' | 'paid';

/**
 * Reduces any accepted date input to a whole "UTC day number" — the number of
 * whole days from the Unix epoch to that date's UTC calendar day, discarding
 * any time-of-day component.
 *
 * Accepts:
 *   - an ISO `YYYY-MM-DD` string (parsed by component, the common case), or
 *   - any other string parseable by `Date` (e.g. a full ISO datetime), or
 *   - a `Date` instance (its UTC calendar components are used).
 *
 * @throws {RangeError} when the input cannot be parsed into a valid date.
 */
export function toUtcDayNumber(date: DateInput): number {
  if (typeof date === 'string') {
    const match = ISO_DATE_PATTERN.exec(date.trim());
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      return Math.floor(Date.UTC(year, month - 1, day) / MS_PER_DAY);
    }
  }

  const parsed = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(parsed.getTime())) {
    throw new RangeError(`Invalid date input: ${String(date)}`);
  }

  // Collapse to the UTC calendar day, ignoring the time-of-day component.
  const utcMidnight = Date.UTC(
    parsed.getUTCFullYear(),
    parsed.getUTCMonth(),
    parsed.getUTCDate(),
  );
  return Math.floor(utcMidnight / MS_PER_DAY);
}

/**
 * Evaluates a single Overdue_Detector pass for one invoice and returns the
 * next status (Requirements 7.2–7.5).
 *
 *   - A `sent` invoice becomes `overdue` if and only if `currentDate` is
 *     STRICTLY later (by calendar date, UTC) than `dueDate` (Req 7.2).
 *   - A `sent` invoice whose `currentDate` is on or before `dueDate` stays
 *     `sent` (Req 7.3).
 *   - `paid` (Req 7.4) and `draft` (Req 7.5) are never changed.
 *   - An already-`overdue` invoice stays `overdue`; the detector never reverts
 *     an overdue invoice.
 *
 * Pure and deterministic: given the same inputs it always returns the same
 * status and has no side effects.
 */
export function evaluateOverdueTransition(
  status: Status,
  dueDate: DateInput,
  currentDate: DateInput,
): Status {
  if (status !== 'sent') {
    // paid, draft, and overdue are left unchanged.
    return status;
  }

  const isStrictlyLater = toUtcDayNumber(currentDate) > toUtcDayNumber(dueDate);
  return isStrictlyLater ? 'overdue' : 'sent';
}

/**
 * Computes Days_Overdue as the whole number of calendar days elapsed since the
 * due date, where the FIRST calendar day after the due date equals 1
 * (Requirements 7.6, 7.7).
 *
 * Overdue arithmetic is only meaningful once `currentDate` is later than
 * `dueDate`. When `currentDate` is on or before `dueDate` the invoice is not
 * overdue, so this returns 0.
 *
 * Because the result derives purely from the two UTC day numbers, it is stable
 * across repeated evaluations for the same pair of dates (Req 7.7).
 */
export function computeDaysOverdue(
  dueDate: DateInput,
  currentDate: DateInput,
): number {
  const elapsed = toUtcDayNumber(currentDate) - toUtcDayNumber(dueDate);
  return elapsed > 0 ? elapsed : 0;
}
