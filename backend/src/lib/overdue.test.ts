import { describe, expect, it } from 'vitest';

import {
  computeDaysOverdue,
  evaluateOverdueTransition,
  toUtcDayNumber,
  type Status,
} from './overdue.js';

/**
 * Unit tests for overdue detection and days-overdue arithmetic
 * (Requirements 7.2–7.7). Example-based cases and edge cases that complement
 * the property tests (Task 10.2 / Property 12 and Task 10.3 / Property 13).
 */

describe('toUtcDayNumber', () => {
  it('reduces an ISO date string to a whole UTC day number', () => {
    // 1970-01-01 is day 0; 1970-01-02 is day 1.
    expect(toUtcDayNumber('1970-01-01')).toBe(0);
    expect(toUtcDayNumber('1970-01-02')).toBe(1);
  });

  it('ignores the time-of-day component of a Date', () => {
    const morning = new Date('2024-03-15T00:30:00Z');
    const nightIso = '2024-03-15';
    expect(toUtcDayNumber(morning)).toBe(toUtcDayNumber(nightIso));
  });

  it('treats late-night and early-morning UTC as the same calendar day', () => {
    const almostMidnight = new Date('2024-03-15T23:59:59Z');
    const justAfterMidnight = new Date('2024-03-15T00:00:01Z');
    expect(toUtcDayNumber(almostMidnight)).toBe(toUtcDayNumber(justAfterMidnight));
  });

  it('throws on an unparseable date', () => {
    expect(() => toUtcDayNumber('not-a-date')).toThrow(RangeError);
  });
});

describe('evaluateOverdueTransition', () => {
  it('transitions sent to overdue when current date is strictly later than due date', () => {
    expect(evaluateOverdueTransition('sent', '2024-03-15', '2024-03-16')).toBe('overdue');
  });

  it('leaves sent as sent when current date equals the due date', () => {
    expect(evaluateOverdueTransition('sent', '2024-03-15', '2024-03-15')).toBe('sent');
  });

  it('leaves sent as sent when current date is earlier than the due date', () => {
    expect(evaluateOverdueTransition('sent', '2024-03-15', '2024-03-14')).toBe('sent');
  });

  it('ignores time-of-day: same calendar day stays sent', () => {
    const due = '2024-03-15';
    const current = new Date('2024-03-15T23:59:59Z');
    expect(evaluateOverdueTransition('sent', due, current)).toBe('sent');
  });

  it.each<Status>(['paid', 'draft', 'overdue'])(
    'never changes a %s invoice regardless of dates',
    (status) => {
      expect(evaluateOverdueTransition(status, '2024-03-15', '2025-01-01')).toBe(status);
      expect(evaluateOverdueTransition(status, '2024-03-15', '2020-01-01')).toBe(status);
    },
  );
});

describe('computeDaysOverdue', () => {
  it('returns 1 for the first calendar day after the due date', () => {
    expect(computeDaysOverdue('2024-03-15', '2024-03-16')).toBe(1);
  });

  it('returns the whole number of days elapsed since the due date', () => {
    expect(computeDaysOverdue('2024-03-15', '2024-03-29')).toBe(14);
  });

  it('returns 0 when current date equals the due date', () => {
    expect(computeDaysOverdue('2024-03-15', '2024-03-15')).toBe(0);
  });

  it('returns 0 when current date is before the due date', () => {
    expect(computeDaysOverdue('2024-03-15', '2024-03-10')).toBe(0);
  });

  it('counts across month boundaries correctly', () => {
    // Feb 28 -> Mar 1 in a leap year is 2 days (28->29->Mar1).
    expect(computeDaysOverdue('2024-02-28', '2024-03-01')).toBe(2);
  });

  it('counts across a year boundary correctly', () => {
    expect(computeDaysOverdue('2023-12-31', '2024-01-01')).toBe(1);
  });

  it('is stable across repeated evaluations (Req 7.7)', () => {
    const first = computeDaysOverdue('2024-03-15', '2024-04-15');
    const second = computeDaysOverdue('2024-03-15', '2024-04-15');
    expect(first).toBe(second);
    expect(first).toBe(31);
  });

  it('ignores time-of-day when computing elapsed days', () => {
    const due = new Date('2024-03-15T18:00:00Z');
    const current = new Date('2024-03-16T02:00:00Z');
    expect(computeDaysOverdue(due, current)).toBe(1);
  });
});
