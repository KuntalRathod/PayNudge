import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  ACTIVITY_FEED_LIMIT,
  activityFeed,
  overdueCount,
  pendingFollowUpCount,
  type ActivityEvent,
  type ActivityEventType,
  type FollowUpStatus,
  type FollowUpStatusRecord,
  type InvoiceStatus,
  type InvoiceStatusRecord,
} from './dashboard.js';

/**
 * Property-based test for the pure dashboard count functions.
 *
 * Feature: paynudge, Property 9: Dashboard counts match their underlying sets
 *
 * Validates: Requirements 5.3, 5.4, 5.8 — for any set of invoices and
 * follow-ups owned by a user, the reported overdue count equals the number of
 * invoices in "overdue" status and the reported pending-follow-up count equals
 * the number of follow-ups in "pending_approval" status (each 0 when the
 * corresponding set is empty). Requirement 5.8 is covered because a paid
 * invoice is no longer in "overdue" status and therefore never contributes to
 * the count.
 */

/** All possible invoice statuses, so generated sets exercise every case. */
const invoiceStatusArb: fc.Arbitrary<InvoiceStatus> = fc.constantFrom(
  'draft',
  'sent',
  'overdue',
  'paid',
);

/** All possible follow-up statuses. */
const followUpStatusArb: fc.Arbitrary<FollowUpStatus> = fc.constantFrom(
  'pending_approval',
  'approved',
  'sent',
  'discarded',
);

/** Invoice sets range from empty (min 0) up to a modest size for speed. */
const invoicesArb: fc.Arbitrary<InvoiceStatusRecord[]> = fc.array(
  invoiceStatusArb.map((status) => ({ status })),
  { minLength: 0, maxLength: 100 },
);

const followUpsArb: fc.Arbitrary<FollowUpStatusRecord[]> = fc.array(
  followUpStatusArb.map((status) => ({ status })),
  { minLength: 0, maxLength: 100 },
);

describe('Property 9: Dashboard counts match their underlying sets', () => {
  it('overdueCount equals the number of invoices in "overdue" status', () => {
    fc.assert(
      fc.property(invoicesArb, (invoices) => {
        // Independent reference count of the underlying "overdue" set.
        const expected = invoices.filter((i) => i.status === 'overdue').length;
        expect(overdueCount(invoices)).toBe(expected);
        // Empty set (or a set with no overdue invoices) yields 0.
        if (expected === 0) {
          expect(overdueCount(invoices)).toBe(0);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('pendingFollowUpCount equals the number of follow-ups in "pending_approval" status', () => {
    fc.assert(
      fc.property(followUpsArb, (followUps) => {
        const expected = followUps.filter((f) => f.status === 'pending_approval').length;
        expect(pendingFollowUpCount(followUps)).toBe(expected);
        if (expected === 0) {
          expect(pendingFollowUpCount(followUps)).toBe(0);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('both counts are 0 for empty sets', () => {
    expect(overdueCount([])).toBe(0);
    expect(pendingFollowUpCount([])).toBe(0);
  });
});

// Feature: paynudge, Property 10: Activity feed is bounded and correctly ordered

/**
 * Property-based test for the pure activity-feed ordering function.
 *
 * Validates: Requirements 5.5, 5.6 — for any set of activity events owned by a
 * user, {@link activityFeed} returns at most the {@link ACTIVITY_FEED_LIMIT}
 * (20) most recent events ordered by descending `created_at`, breaking ties by
 * descending event id, and returns an empty feed when the user owns no events.
 */

/** All event kinds, so generated feeds exercise every case. */
const activityEventTypeArb: fc.Arbitrary<ActivityEventType> = fc.constantFrom(
  'invoice_sent',
  'follow_up_sent',
  'payment_received',
);

/**
 * Sets of activity events with UNIQUE ids and timestamps drawn from a small
 * range so that timestamp collisions are common — this deliberately exercises
 * the id-based tie-break. Sizes range from empty up to 60 (> 20) so the
 * 20-event cap is exercised on many runs. Unique ids make the ranking a strict
 * total order, giving the reference comparison an unambiguous expected result.
 */
const activityEventsArb: fc.Arbitrary<ActivityEvent[]> = fc
  .uniqueArray(
    fc.record({
      id: fc.integer({ min: 1, max: 1_000_000 }),
      // Day offset within a 31-day window forces frequent timestamp ties.
      dayOffset: fc.integer({ min: 0, max: 30 }),
      type: activityEventTypeArb,
    }),
    { selector: (e) => e.id, minLength: 0, maxLength: 60 },
  )
  .map((records) =>
    records.map((r) => ({
      id: r.id,
      created_at: new Date(Date.UTC(2025, 0, 1 + r.dayOffset)).toISOString(),
      type: r.type,
    })),
  );

/**
 * Independent reference ranking: an event ranks earlier (nearer the top of the
 * feed) when it is more recent, breaking ties by larger id. Returns a negative
 * number when `a` should precede `b`, positive when it should follow, and 0
 * only when the events are identical in rank (impossible here as ids are
 * unique). Ids are plain numbers in this test.
 */
function compareRank(a: ActivityEvent, b: ActivityEvent): number {
  const timeA = new Date(a.created_at as string).getTime();
  const timeB = new Date(b.created_at as string).getTime();
  if (timeA !== timeB) {
    return timeB - timeA;
  }
  return (b.id as number) - (a.id as number);
}

describe('Property 10: Activity feed is bounded and correctly ordered', () => {
  it('returns at most the 20 most recent events, correctly ordered', () => {
    fc.assert(
      fc.property(activityEventsArb, (events) => {
        const feed = activityFeed(events);

        // Bounded: exactly min(n, 20) events (Requirement 5.5).
        expect(feed.length).toBe(Math.min(events.length, ACTIVITY_FEED_LIMIT));

        // Ordered: each event ranks at or before the next (desc timestamp,
        // then desc id). Unique ids make this strict.
        for (let i = 1; i < feed.length; i += 1) {
          const prev = feed[i - 1];
          const curr = feed[i];
          if (prev !== undefined && curr !== undefined) {
            expect(compareRank(prev, curr)).toBeLessThanOrEqual(0);
          }
        }

        // No invented events: every feed entry comes from the input.
        const inputIds = new Set(events.map((e) => e.id));
        for (const event of feed) {
          expect(inputIds.has(event.id)).toBe(true);
        }

        // "Most recent": every excluded event ranks no earlier than the last
        // event kept in the feed.
        const feedIds = new Set(feed.map((e) => e.id));
        const excluded = events.filter((e) => !feedIds.has(e.id));
        const last = feed[feed.length - 1];
        if (last !== undefined) {
          for (const event of excluded) {
            expect(compareRank(last, event)).toBeLessThanOrEqual(0);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  it('returns an empty feed when the user owns no events', () => {
    // Requirement 5.6.
    expect(activityFeed([])).toEqual([]);
  });
});
