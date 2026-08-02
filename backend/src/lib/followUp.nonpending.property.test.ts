import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  applyFollowUpAction,
  approveFollowUp,
  discardFollowUp,
  editFollowUp,
  type FollowUpAction,
  type FollowUpStatus,
} from './followUp.js';

// Feature: paynudge, Property 21: Non-pending follow-up actions are rejected without side effects

/**
 * Property-based test for the pure follow-up reducer's non-pending guard.
 *
 * **Validates: Requirements 9.11** — for any Follow_Up that is not in
 * `pending_approval` status, an edit, approval, or discard action is rejected
 * with a `NOT_PENDING` failure, the status is left unchanged (the pure
 * reducer never returns a new status for a rejected action), and the returned
 * message indicates the follow-up is not pending approval.
 */

/**
 * Non-pending statuses: every {@link FollowUpStatus} except `pending_approval`.
 * These are precisely the states from which every action must be rejected.
 */
const nonPendingStatusArb: fc.Arbitrary<FollowUpStatus> = fc.constantFrom(
  'approved',
  'sent',
  'discarded',
);

/**
 * Arbitrary follow-up action. Edit content is unconstrained (`unknown`) on
 * purpose: when the status is non-pending the guard must reject before any
 * content validation runs, regardless of whether the content would otherwise
 * be valid.
 */
const actionArb: fc.Arbitrary<FollowUpAction> = fc.oneof(
  fc.record({
    type: fc.constant<'edit'>('edit'),
    content: fc.anything(),
  }),
  fc.record({ type: fc.constant<'approve'>('approve') }),
  fc.record({ type: fc.constant<'discard'>('discard') }),
);

describe('Property 21: Non-pending follow-up actions are rejected without side effects', () => {
  it('rejects any action on a non-pending follow-up with NOT_PENDING and no status change', () => {
    fc.assert(
      fc.property(nonPendingStatusArb, actionArb, (status, action) => {
        const result = applyFollowUpAction(status, action);

        // Rejected: NOT_PENDING failure with a "not pending approval" message.
        expect(result.ok).toBe(false);
        if (result.ok) return; // narrows the type; unreachable given the assert above
        expect(result.code).toBe('NOT_PENDING');
        expect(result.message.toLowerCase()).toContain('not pending approval');

        // No side effects: a failure result carries no new status or content,
        // so the caller leaves the stored status unchanged.
        expect('status' in result).toBe(false);
        expect('content' in result).toBe(false);
      }),
      { numRuns: 200 },
    );
  });

  it('rejects each individual transition function on a non-pending follow-up', () => {
    fc.assert(
      fc.property(nonPendingStatusArb, fc.anything(), (status, editContent) => {
        for (const result of [
          editFollowUp(status, editContent),
          approveFollowUp(status),
          discardFollowUp(status),
        ]) {
          expect(result.ok).toBe(false);
          if (result.ok) return;
          expect(result.code).toBe('NOT_PENDING');
          expect(result.message.toLowerCase()).toContain('not pending approval');
        }
      }),
      { numRuns: 200 },
    );
  });
});
