import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { computeDaysOverdue, MS_PER_DAY, toUtcDayNumber } from './overdue.js';

// Feature: paynudge, Property 13: Days_overdue is correct calendar-day arithmetic

/**
 * Property-based test for the pure days-overdue arithmetic
 * ({@link computeDaysOverdue}).
 *
 * **Validates: Requirements 7.6, 7.7** — for any overdue invoice and a current
 * date later than the due date, the computed Days_Overdue equals the whole
 * number of calendar days elapsed since the due date, where the first calendar
 * day after the due date equals 1, and this holds identically on every
 * recomputation.
 */

/** A due date within a broad, deterministic UTC range. */
const dueDateArb = fc.date({
  min: new Date('1970-01-01T00:00:00Z'),
  max: new Date('2100-12-31T00:00:00Z'),
});

/**
 * The whole number of calendar days the current date is past the due date.
 * Constrained to be at least 1 so the invoice is genuinely overdue — the
 * regime Property 13 describes ("current date later than the due date").
 */
const daysPastDueArb = fc.integer({ min: 1, max: 20_000 });

/**
 * A random time-of-day offset (in ms) within a single calendar day. Used to
 * confirm the arithmetic depends only on the calendar day and ignores the
 * time-of-day component.
 */
const timeOfDayMsArb = fc.integer({ min: 0, max: MS_PER_DAY - 1 });

describe('Property 13: Days_overdue is correct calendar-day arithmetic', () => {
  it('equals the whole calendar days elapsed, with the first day after due = 1', () => {
    fc.assert(
      fc.property(
        dueDateArb,
        daysPastDueArb,
        timeOfDayMsArb,
        (dueDate, daysPastDue, timeOfDayMs) => {
          // Build a current date exactly `daysPastDue` calendar days after the
          // due date's UTC calendar day, with an arbitrary time-of-day so the
          // computation must ignore sub-day precision.
          const currentDayNumber = toUtcDayNumber(dueDate) + daysPastDue;
          const currentDate = new Date(
            currentDayNumber * MS_PER_DAY + timeOfDayMs,
          );

          const result = computeDaysOverdue(dueDate, currentDate);

          // The whole number of calendar days elapsed; first day after = 1.
          expect(result).toBe(daysPastDue);

          // Recomputation yields the identical value (Req 7.7): stable across
          // repeated evaluations for the same pair of dates.
          expect(computeDaysOverdue(dueDate, currentDate)).toBe(result);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('returns exactly 1 on the first calendar day after the due date', () => {
    fc.assert(
      fc.property(dueDateArb, timeOfDayMsArb, (dueDate, timeOfDayMs) => {
        const nextDayNumber = toUtcDayNumber(dueDate) + 1;
        const currentDate = new Date(nextDayNumber * MS_PER_DAY + timeOfDayMs);

        expect(computeDaysOverdue(dueDate, currentDate)).toBe(1);
      }),
      { numRuns: 100 },
    );
  });
});
