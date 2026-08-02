import { describe, expect, it } from 'vitest';

import {
  ACTIVITY_FEED_LIMIT,
  activityFeed,
  overdueCount,
  pendingFollowUpCount,
  type ActivityEvent,
  type FollowUpStatusRecord,
  type InvoiceStatusRecord,
} from './dashboard.js';

describe('overdueCount', () => {
  it('returns 0 for an empty list', () => {
    expect(overdueCount([])).toBe(0);
  });

  it('returns 0 when no invoice is overdue', () => {
    const invoices: InvoiceStatusRecord[] = [
      { status: 'draft' },
      { status: 'sent' },
      { status: 'paid' },
    ];
    expect(overdueCount(invoices)).toBe(0);
  });

  it('counts only invoices in overdue status', () => {
    const invoices: InvoiceStatusRecord[] = [
      { status: 'overdue' },
      { status: 'sent' },
      { status: 'overdue' },
      { status: 'paid' },
      { status: 'overdue' },
    ];
    expect(overdueCount(invoices)).toBe(3);
  });

  it('does not mutate the input', () => {
    const invoices: InvoiceStatusRecord[] = [{ status: 'overdue' }, { status: 'sent' }];
    const snapshot = JSON.parse(JSON.stringify(invoices));
    overdueCount(invoices);
    expect(invoices).toEqual(snapshot);
  });
});

describe('pendingFollowUpCount', () => {
  it('returns 0 for an empty list', () => {
    expect(pendingFollowUpCount([])).toBe(0);
  });

  it('returns 0 when no follow-up is pending approval', () => {
    const followUps: FollowUpStatusRecord[] = [
      { status: 'approved' },
      { status: 'sent' },
      { status: 'discarded' },
    ];
    expect(pendingFollowUpCount(followUps)).toBe(0);
  });

  it('counts only follow-ups in pending_approval status', () => {
    const followUps: FollowUpStatusRecord[] = [
      { status: 'pending_approval' },
      { status: 'approved' },
      { status: 'pending_approval' },
      { status: 'discarded' },
    ];
    expect(pendingFollowUpCount(followUps)).toBe(2);
  });
});

describe('activityFeed', () => {
  it('returns an empty array when there are no events', () => {
    expect(activityFeed([])).toEqual([]);
  });

  it('orders events by created_at descending', () => {
    const events: ActivityEvent[] = [
      { id: 1, created_at: '2025-01-01T00:00:00Z', type: 'invoice_sent' },
      { id: 2, created_at: '2025-03-01T00:00:00Z', type: 'payment_received' },
      { id: 3, created_at: '2025-02-01T00:00:00Z', type: 'follow_up_sent' },
    ];
    expect(activityFeed(events).map((e) => e.id)).toEqual([2, 3, 1]);
  });

  it('breaks ties on identical timestamps by descending id', () => {
    const ts = '2025-01-01T00:00:00Z';
    const events: ActivityEvent[] = [
      { id: 10, created_at: ts, type: 'invoice_sent' },
      { id: 30, created_at: ts, type: 'payment_received' },
      { id: 20, created_at: ts, type: 'follow_up_sent' },
    ];
    expect(activityFeed(events).map((e) => e.id)).toEqual([30, 20, 10]);
  });

  it('compares bigint-range ids correctly beyond MAX_SAFE_INTEGER', () => {
    const ts = '2025-01-01T00:00:00Z';
    const events: ActivityEvent[] = [
      { id: '9007199254740993', created_at: ts, type: 'invoice_sent' },
      { id: '9007199254740994', created_at: ts, type: 'payment_received' },
    ];
    expect(activityFeed(events).map((e) => e.id)).toEqual([
      '9007199254740994',
      '9007199254740993',
    ]);
  });

  it('accepts Date and string timestamps together', () => {
    const events: ActivityEvent[] = [
      { id: 1, created_at: new Date('2025-01-01T00:00:00Z'), type: 'invoice_sent' },
      { id: 2, created_at: '2025-06-01T00:00:00Z', type: 'payment_received' },
    ];
    expect(activityFeed(events).map((e) => e.id)).toEqual([2, 1]);
  });

  it('caps the result at ACTIVITY_FEED_LIMIT, keeping the most recent', () => {
    const events: ActivityEvent[] = Array.from({ length: 25 }, (_, i) => ({
      id: i + 1,
      created_at: new Date(Date.UTC(2025, 0, i + 1)).toISOString(),
      type: 'invoice_sent' as const,
    }));
    const feed = activityFeed(events);
    expect(feed).toHaveLength(ACTIVITY_FEED_LIMIT);
    // The 25 events (ids 1..25 by ascending date) keep the 20 most recent: 25..6.
    expect(feed.map((e) => e.id)).toEqual(
      Array.from({ length: ACTIVITY_FEED_LIMIT }, (_, i) => 25 - i),
    );
  });

  it('does not mutate the input array', () => {
    const events: ActivityEvent[] = [
      { id: 1, created_at: '2025-01-01T00:00:00Z', type: 'invoice_sent' },
      { id: 2, created_at: '2025-03-01T00:00:00Z', type: 'payment_received' },
    ];
    const originalOrder = events.map((e) => e.id);
    activityFeed(events);
    expect(events.map((e) => e.id)).toEqual(originalOrder);
  });
});
