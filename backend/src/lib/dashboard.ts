/**
 * Dashboard counts and activity-feed ordering (Requirements 5.3, 5.4, 5.5,
 * 5.6, 5.8).
 *
 * PURE, side-effect-free functions with no I/O (no database, no clock, no
 * network). They operate only on the records handed to them, which keeps the
 * logic directly property-testable (Tasks 8.4 / Property 9 and 8.5 /
 * Property 10) and reusable at the `GET /dashboard` boundary (Task 8.6).
 *
 * Ownership scoping (returning only the requesting user's records) is enforced
 * upstream by Supabase Row Level Security; these functions assume the input
 * collections already contain only the relevant user's records.
 *
 * ## Overdue / pending counts
 *
 * {@link overdueCount} counts invoices in `"overdue"` status and
 * {@link pendingFollowUpCount} counts follow-ups in `"pending_approval"`
 * status. Both return 0 for an empty (or all-non-matching) collection, which
 * also covers Requirement 5.8: once an overdue invoice is marked paid its
 * status is no longer `"overdue"`, so it naturally drops out of the count.
 *
 * ## Activity-feed ordering
 *
 * {@link activityFeed} returns at most {@link ACTIVITY_FEED_LIMIT} events,
 * ordered by `created_at` DESCENDING (most recent first) and, for events that
 * share an identical timestamp, by event `id` DESCENDING (Requirement 5.5).
 * It returns an empty array when there are no events (Requirement 5.6) and
 * never mutates its input.
 *
 * `created_at` may be an ISO date/datetime string or a `Date`; it is parsed to
 * a numeric epoch timestamp for a deterministic comparison. Event `id` values
 * originate from a Postgres `bigint` identity column and may arrive as a
 * `number`, a `bigint`, or a numeric string; ids are compared as `bigint` so
 * that values beyond `Number.MAX_SAFE_INTEGER` still order correctly.
 */

/** The maximum number of events the activity feed returns (Requirement 5.5). */
export const ACTIVITY_FEED_LIMIT = 20;

/** Invoice statuses relevant to the dashboard. */
export type InvoiceStatus = 'draft' | 'sent' | 'overdue' | 'paid';

/** Follow-up statuses relevant to the dashboard. */
export type FollowUpStatus = 'pending_approval' | 'approved' | 'sent' | 'discarded';

/**
 * The kinds of events that appear in the activity feed / invoice timeline.
 *
 * Widened (Invoice Activity Timeline feature) beyond the original three types
 * to cover an invoice's full lifecycle: creation, sending, becoming overdue,
 * each AI-drafted follow-up, each sent/discarded follow-up, and payment.
 */
export type ActivityEventType =
  | 'invoice_created'
  | 'invoice_sent'
  | 'invoice_became_overdue'
  | 'follow_up_drafted'
  | 'follow_up_sent'
  | 'follow_up_discarded'
  | 'payment_received';

/**
 * Minimal shape needed to count overdue invoices. Only the status is
 * inspected; other invoice fields are irrelevant here.
 */
export interface InvoiceStatusRecord {
  status: InvoiceStatus;
}

/**
 * Minimal shape needed to count pending follow-ups. Only the status is
 * inspected.
 */
export interface FollowUpStatusRecord {
  status: FollowUpStatus;
}

/**
 * An activity-feed event.
 *
 * @property id         Event identifier from a `bigint` identity column. May be
 *                      a `number`, a `bigint`, or a numeric string; compared as
 *                      `bigint` for correct ordering of very large values.
 * @property created_at When the event occurred, as an ISO string or a `Date`.
 * @property type       The event kind.
 */
export interface ActivityEvent {
  id: number | bigint | string;
  created_at: string | Date;
  type: ActivityEventType;
  /** Optional invoice this event relates to (present for invoice-scoped events). */
  invoice_id?: string | null;
  /** Optional structured detail (e.g. follow-up tier, payment note). */
  metadata?: Record<string, unknown>;
}

/**
 * Counts invoices in `"overdue"` status (Requirements 5.3, 5.8).
 *
 * Returns 0 when the collection is empty or contains no overdue invoices.
 * Pure: does not mutate the input.
 */
export function overdueCount(invoices: readonly InvoiceStatusRecord[]): number {
  let count = 0;
  for (const invoice of invoices) {
    if (invoice.status === 'overdue') {
      count += 1;
    }
  }
  return count;
}

/**
 * Counts follow-ups in `"pending_approval"` status (Requirement 5.4).
 *
 * Returns 0 when the collection is empty or contains no pending follow-ups.
 * Pure: does not mutate the input.
 */
export function pendingFollowUpCount(followUps: readonly FollowUpStatusRecord[]): number {
  let count = 0;
  for (const followUp of followUps) {
    if (followUp.status === 'pending_approval') {
      count += 1;
    }
  }
  return count;
}

/**
 * Parses an event `created_at` into a numeric epoch timestamp (milliseconds).
 *
 * Accepts a `Date` or an ISO date/datetime string. Unparseable values sort as
 * the oldest possible (`-Infinity`) so that malformed timestamps never jump to
 * the top of a "most recent first" feed.
 */
function toTimestamp(createdAt: string | Date): number {
  const date = createdAt instanceof Date ? createdAt : new Date(createdAt);
  const time = date.getTime();
  return Number.isNaN(time) ? Number.NEGATIVE_INFINITY : time;
}

/**
 * Converts an event id (number, bigint, or numeric string) to a `bigint` for a
 * correct comparison of large values. Non-integer or unparseable ids fall back
 * to `0n` so ordering stays total and deterministic.
 */
function toBigIntId(id: number | bigint | string): bigint {
  try {
    if (typeof id === 'bigint') {
      return id;
    }
    if (typeof id === 'number') {
      return Number.isFinite(id) ? BigInt(Math.trunc(id)) : 0n;
    }
    const trimmed = id.trim();
    return trimmed.length > 0 ? BigInt(trimmed) : 0n;
  } catch {
    return 0n;
  }
}

/**
 * Returns at most {@link ACTIVITY_FEED_LIMIT} events ordered from most recent
 * to least recent by `created_at`, breaking ties by descending event `id`
 * (Requirement 5.5). Returns an empty array when there are no events
 * (Requirement 5.6).
 *
 * Pure and deterministic: the input array is copied before sorting, so the
 * caller's array is never mutated.
 */
export function activityFeed(events: readonly ActivityEvent[]): ActivityEvent[] {
  return events
    .slice()
    .sort((a, b) => {
      const timeA = toTimestamp(a.created_at);
      const timeB = toTimestamp(b.created_at);
      if (timeA !== timeB) {
        // Descending by timestamp (most recent first).
        return timeB - timeA;
      }
      // Tie-break: descending by event id (compared as bigint).
      const idA = toBigIntId(a.id);
      const idB = toBigIntId(b.id);
      if (idA === idB) {
        return 0;
      }
      return idB > idA ? 1 : -1;
    })
    .slice(0, ACTIVITY_FEED_LIMIT);
}
