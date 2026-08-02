import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  tierForDaysOverdue,
  FIRM_MIN_DAYS,
  FINAL_NOTICE_MIN_DAYS,
} from './escalation.js';

// Feature: paynudge, Property 14: Escalation tier is a total function of days overdue

/**
 * Property-based test for the pure escalation-tier mapping.
 *
 * **Validates: Requirements 8.2, 8.3, 8.4** — for any Days_Overdue value that
 * is at least 1, the assigned Escalation_Tier is "polite" when 1 <= days < 7,
 * "firm" when 7 <= days < 14, and "final_notice" when days >= 14.
 *
 * Only Property 14 is implemented here. Property 22 (escalation decision) is
 * covered separately by Task 11.3.
 */

/**
 * Whole Days_Overdue values >= 1. Property 14 is defined over whole calendar
 * days that are at least one, so we generate integers in [1, large]. The upper
 * bound is generous to exercise the unbounded `final_notice` region.
 */
const daysOverdueArb = fc.integer({ min: 1, max: 100_000 });

describe('Property 14: Escalation tier is a total function of days overdue', () => {
  it('maps any days >= 1 to the correct tier by its band', () => {
    fc.assert(
      fc.property(daysOverdueArb, (days) => {
        const tier = tierForDaysOverdue(days);

        if (days >= FINAL_NOTICE_MIN_DAYS) {
          expect(tier).toBe('final_notice');
        } else if (days >= FIRM_MIN_DAYS) {
          expect(tier).toBe('firm');
        } else {
          expect(tier).toBe('polite');
        }
      }),
      { numRuns: 100 },
    );
  });
});
