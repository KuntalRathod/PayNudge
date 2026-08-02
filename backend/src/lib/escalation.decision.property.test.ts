import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  shouldDraft,
  tierForDaysOverdue,
  tierRank,
  type Tier,
} from './escalation.js';

// Feature: paynudge, Property 22: Escalation drafts only when the tier strictly increases

/**
 * Property-based test for the pure escalation-decision logic.
 *
 * **Validates: Requirements 10.1** — for any overdue invoice, a new follow-up
 * is drafted at the tier mapped to the current Days_Overdue only when that
 * tier is strictly higher (order: polite < firm < final_notice) than the tier
 * of the most recent non-discarded follow-up for that invoice.
 */

/**
 * Days_Overdue generator spanning the full decision space, including values
 * below 1 (no tier applies), fractional values (floored to whole calendar
 * days), and values across every tier boundary well past final_notice.
 */
const daysOverdueArb = fc.oneof(
  // Sub-tier region: < 1 day -> no tier applies.
  fc.double({ min: -30, max: 0.999, noNaN: true }),
  // Whole and fractional days across all tiers and boundaries.
  fc.double({ min: 0, max: 400, noNaN: true }),
  // Exact boundary integers where tier transitions occur.
  fc.constantFrom(0, 1, 6, 7, 13, 14, 15, 100),
);

/** The most recent non-discarded follow-up tier, or null when none exists. */
const priorTierArb: fc.Arbitrary<Tier | null> = fc.constantFrom<Tier | null>(
  null,
  'polite',
  'firm',
  'final_notice',
);

describe('Property 22: Escalation drafts only when the tier strictly increases', () => {
  it('drafts iff the current tier exists and is strictly higher than the prior tier', () => {
    fc.assert(
      fc.property(daysOverdueArb, priorTierArb, (daysOverdue, priorTier) => {
        const currentTier = tierForDaysOverdue(daysOverdue);
        const drafted = shouldDraft(daysOverdue, priorTier);

        // Reference decision derived directly from the strict tier order.
        const expected =
          currentTier !== null &&
          (priorTier === null ||
            tierRank(currentTier) > tierRank(priorTier));

        expect(drafted).toBe(expected);

        // When a draft is warranted, it must be at a strictly higher tier than
        // the prior non-discarded follow-up (or there is no prior at all).
        if (drafted) {
          expect(currentTier).not.toBeNull();
          if (priorTier !== null) {
            expect(tierRank(currentTier as Tier)).toBeGreaterThan(
              tierRank(priorTier),
            );
          }
        }

        // When no draft is warranted, either no tier applies or the current
        // tier is not strictly higher than the prior one.
        if (!drafted && currentTier !== null && priorTier !== null) {
          expect(tierRank(currentTier)).toBeLessThanOrEqual(
            tierRank(priorTier),
          );
        }
      }),
      { numRuns: 200 },
    );
  });

  it('never drafts when the current Days_Overdue maps to no tier (< 1 day)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -50, max: 0.999, noNaN: true }),
        priorTierArb,
        (daysOverdue, priorTier) => {
          // Guard the generator to the "no tier" region only.
          fc.pre(tierForDaysOverdue(daysOverdue) === null);
          expect(shouldDraft(daysOverdue, priorTier)).toBe(false);
        },
      ),
      { numRuns: 200 },
    );
  });
});
