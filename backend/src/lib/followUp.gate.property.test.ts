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

// Feature: paynudge, Property 17: Follow-up delivery is reachable only through approval

/**
 * Property-based test for the approval-only delivery gate.
 *
 * **Validates: Requirements 9.1, 9.5, 9.10** — a Follow_Up email is delivered
 * to a Client only after the associated Follow_Up reaches "approved" status
 * through a User action (9.1); approving a pending Follow_Up sets its status to
 * "approved" (9.5); discarding a pending Follow_Up sets its status to
 * "discarded" and never delivers (9.10).
 *
 * Modelled at the pure-logic level: the sole gate to delivery is a resulting
 * status of "approved", and the only way to reach it is the `approve` action
 * applied while the Follow_Up is "pending_approval". Any other action, or any
 * action from any other status, must never yield "approved" — so it can never
 * trigger a dispatch. A discarded or still-pending Follow_Up therefore is never
 * delivered.
 */

/** All possible follow-up lifecycle statuses. */
const statusArb: fc.Arbitrary<FollowUpStatus> = fc.constantFrom(
  'pending_approval',
  'approved',
  'sent',
  'discarded',
);

/**
 * Any user action. Edit content is drawn from a mix of valid strings and
 * degenerate values (empty string, non-string) so the generator explores both
 * accepted and rejected edits — none of which may ever reach "approved".
 */
const actionArb: fc.Arbitrary<FollowUpAction> = fc.oneof(
  fc.record({
    type: fc.constant<'edit'>('edit'),
    content: fc.oneof(
      fc.string({ minLength: 1, maxLength: 200 }),
      fc.constant(''),
      fc.constant(null),
      fc.integer(),
    ),
  }),
  fc.record({ type: fc.constant<'approve'>('approve') }),
  fc.record({ type: fc.constant<'discard'>('discard') }),
);

/**
 * Delivery model: a follow-up email would be dispatched exactly when the result
 * of applying an action is a successful transition to "approved". This is the
 * single delivery gate — nothing else can trigger an email.
 */
function wouldDispatch(
  currentStatus: FollowUpStatus,
  action: FollowUpAction,
): boolean {
  const result = applyFollowUpAction(currentStatus, action);
  return result.ok && result.status === 'approved';
}

describe('Property 17: Follow-up delivery is reachable only through approval', () => {
  it('dispatches only when an approve action is applied to a pending follow-up', () => {
    fc.assert(
      fc.property(statusArb, actionArb, (currentStatus, action) => {
        const dispatched = wouldDispatch(currentStatus, action);

        // The delivery gate opens iff the follow-up was pending and the user
        // approved it. Any other (status, action) pair must never dispatch.
        const isApprovalOfPending =
          currentStatus === 'pending_approval' && action.type === 'approve';

        expect(dispatched).toBe(isApprovalOfPending);
      }),
      { numRuns: 200 },
    );
  });

  it('reaches "approved" only via the approve action from pending_approval', () => {
    fc.assert(
      fc.property(statusArb, actionArb, (currentStatus, action) => {
        const result = applyFollowUpAction(currentStatus, action);

        // If any action yields "approved", it must have been approve-of-pending.
        if (result.ok && result.status === 'approved') {
          expect(currentStatus).toBe('pending_approval');
          expect(action.type).toBe('approve');
        }
      }),
      { numRuns: 200 },
    );
  });

  it('approves a pending follow-up: pending_approval -> approved (Req 9.5)', () => {
    const result = approveFollowUp('pending_approval');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe('approved');
    }
  });

  it('discards a pending follow-up without ever reaching approved (Req 9.10)', () => {
    fc.assert(
      fc.property(fc.constant('pending_approval' as FollowUpStatus), (status) => {
        const result = discardFollowUp(status);
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.status).toBe('discarded');
          // A discarded follow-up is never in "approved" status, so it is
          // never delivered.
          expect(result.status).not.toBe('approved');
        }
      }),
      { numRuns: 100 },
    );
  });

  it('keeps edited follow-ups pending, never approved (no delivery via edit)', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 200 }),
        (content) => {
          const result = editFollowUp('pending_approval', content);
          expect(result.ok).toBe(true);
          if (result.ok) {
            // A valid edit keeps the follow-up pending — it is not a delivery
            // gate and can never on its own reach "approved".
            expect(result.status).toBe('pending_approval');
            expect(result.status).not.toBe('approved');
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
