import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';

import type { Tier } from '../lib/escalation.js';
import type { Status } from '../lib/overdue.js';
import type { GenerativeModelLike } from './geminiDraft.js';
import {
  MAX_CONSECUTIVE_DRAFT_FAILURES,
  draftFollowUp,
  type DraftFailureRecord,
  type DraftStore,
  type InvoiceContext,
  type PersistFollowUpInput,
} from './draftWorker.js';

// Feature: paynudge, Property 16: Draft failures are recorded, non-blocking, and capped at three consecutive attempts

/**
 * Property-based test for the LangGraph draft worker's failure handling and cap
 * (Req 8.8, 8.9).
 *
 * **Validates: Requirements 8.8, 8.9** — for any invoice, a failed draft attempt
 * creates no pending follow-up, records a draft-failure message, increments the
 * consecutive-failure count, and leaves the invoice eligible for a later attempt,
 * UNTIL three consecutive failures occur — after which no further automatic draft
 * attempts are made (the run skips with `draft_failure_cap_reached`) and no new
 * failure is recorded.
 *
 * The two side-effecting collaborators are faked: a small in-memory
 * {@link DraftStore} stands in for Postgres and a fake {@link GenerativeModelLike}
 * stands in for Gemini, so no live Postgres and no live model call is made.
 */

/** A stored follow-up in the in-memory fake store. */
interface StoredFollowUp {
  id: string;
  invoiceId: string;
  userId: string;
  tier: Tier;
  content: string;
  status: 'pending_approval' | 'approved' | 'sent' | 'discarded';
  draftedAt: number;
}

/**
 * Minimal in-memory {@link DraftStore}. Mirrors the real store's semantics for
 * the failure path: `recordDraftFailure` persists the new count and appends a
 * record, and pending follow-ups are tracked so the "no pending on failure"
 * invariant can be asserted.
 */
class InMemoryDraftStore implements DraftStore {
  private readonly invoices = new Map<string, InvoiceContext>();
  private readonly followUps: StoredFollowUp[] = [];
  private seq = 0;
  private clock = 0;

  readonly failureRecords: DraftFailureRecord[] = [];

  addInvoice(context: InvoiceContext): void {
    this.invoices.set(context.invoiceId, context);
  }

  failureCountFor(invoiceId: string): number {
    return this.invoices.get(invoiceId)?.draftFailureCount ?? 0;
  }

  pendingCountFor(invoiceId: string): number {
    return this.followUps.filter(
      (f) => f.invoiceId === invoiceId && f.status === 'pending_approval',
    ).length;
  }

  async loadInvoiceContext(invoiceId: string): Promise<InvoiceContext | null> {
    return this.invoices.get(invoiceId) ?? null;
  }

  async getMostRecentNonDiscardedTier(
    invoiceId: string,
    userId: string,
  ): Promise<Tier | null> {
    const candidates = this.followUps
      .filter(
        (f) =>
          f.invoiceId === invoiceId &&
          f.userId === userId &&
          f.status !== 'discarded',
      )
      .sort((a, b) => b.draftedAt - a.draftedAt);
    return candidates[0]?.tier ?? null;
  }

  async replacePendingFollowUp(
    input: PersistFollowUpInput,
  ): Promise<{ id: string }> {
    for (const f of this.followUps) {
      if (
        f.invoiceId === input.invoiceId &&
        f.userId === input.userId &&
        f.status === 'pending_approval'
      ) {
        f.status = 'discarded';
      }
    }
    const stored: StoredFollowUp = {
      id: `fu-${this.seq++}`,
      invoiceId: input.invoiceId,
      userId: input.userId,
      tier: input.tier,
      content: input.content,
      status: 'pending_approval',
      draftedAt: this.clock++,
    };
    this.followUps.push(stored);
    return { id: stored.id };
  }

  async recordDraftFailure(input: DraftFailureRecord): Promise<void> {
    this.failureRecords.push(input);
    const invoice = this.invoices.get(input.invoiceId);
    if (invoice) {
      invoice.draftFailureCount = input.count;
    }
  }

  async resetDraftFailure(invoiceId: string, _userId: string): Promise<void> {
    const invoice = this.invoices.get(invoiceId);
    if (invoice) {
      invoice.draftFailureCount = 0;
    }
  }
}

/** Fixed evaluation clock; the seeded due date is 10 days before -> `firm`. */
const NOW = new Date('2025-03-20T12:00:00Z');

function overdueInvoice(): InvoiceContext {
  return {
    invoiceId: 'inv-1',
    userId: 'user-1',
    clientName: 'Acme Corp',
    invoiceNumber: 42,
    amount: 1234.5,
    // 10 days before NOW -> Days_Overdue 10 -> tier "firm" (a defined tier so
    // the guard always reaches the generate node while there is no prior draft).
    dueDate: '2025-03-10',
    status: 'overdue' as Status,
    description: 'Website development',
    senderName: 'Jane Smith',
    draftFailureCount: 0,
  };
}

/** The two ways a draft attempt can fail, mirrored from `DraftFailureReason`. */
type FailureKind = 'generation_error' | 'invalid_content';

/**
 * Builds a fake model that fails in the requested way, wired to a `vi.fn` spy so
 * the test can assert whether the model was invoked for a given attempt.
 */
function failingModel(kind: FailureKind): GenerativeModelLike {
  if (kind === 'generation_error') {
    return {
      generateContent: vi.fn(async () => {
        throw new Error('gemini transient failure');
      }),
    };
  }
  // invalid_content: returns text that omits every required field (Req 8.5),
  // so content validation fails.
  return {
    generateContent: vi.fn(async () => ({
      response: { text: () => 'Please settle your outstanding balance.' },
    })),
  };
}

/** A sequence of at least MAX+2 failing attempts so the cap boundary is crossed. */
const failureSequenceArb = fc.array(
  fc.constantFrom<FailureKind>('generation_error', 'invalid_content'),
  { minLength: MAX_CONSECUTIVE_DRAFT_FAILURES + 2, maxLength: 10 },
);

describe('Property 16: draft failures are recorded, non-blocking, and capped', () => {
  it('records/increments each failure and caps automatic drafting after three', async () => {
    await fc.assert(
      fc.asyncProperty(failureSequenceArb, async (kinds) => {
        const store = new InMemoryDraftStore();
        store.addInvoice(overdueInvoice());

        for (const kind of kinds) {
          const countBefore = store.failureCountFor('inv-1');
          const recordsBefore = store.failureRecords.length;
          const model = failingModel(kind);

          const outcome = await draftFollowUp('inv-1', {
            store,
            model,
            now: () => NOW,
          });

          if (countBefore < MAX_CONSECUTIVE_DRAFT_FAILURES) {
            // Below the cap: the attempt runs, fails, and is recorded.
            expect(model.generateContent).toHaveBeenCalledTimes(1);
            expect(outcome.status).toBe('failed');
            if (outcome.status === 'failed') {
              expect(outcome.reason).toBe(kind);
            }

            // Exactly one new failure record with the incremented count.
            expect(store.failureRecords.length).toBe(recordsBefore + 1);
            const record = store.failureRecords.at(-1)!;
            expect(record.invoiceId).toBe('inv-1');
            expect(record.userId).toBe('user-1');
            expect(record.reason).toBe(kind);
            expect(record.count).toBe(countBefore + 1);
            expect(record.message).toContain('inv-1');

            // Count incremented by exactly one; no pending follow-up created.
            expect(store.failureCountFor('inv-1')).toBe(countBefore + 1);
            expect(store.pendingCountFor('inv-1')).toBe(0);

            // The cap message appears exactly on the third consecutive failure,
            // and only then (the invoice stays eligible before that).
            if (countBefore + 1 >= MAX_CONSECUTIVE_DRAFT_FAILURES) {
              expect(record.message).toContain(
                'Automatic drafting has stopped',
              );
            } else {
              expect(record.message).not.toContain(
                'Automatic drafting has stopped',
              );
            }
          } else {
            // At or beyond the cap: no further automatic drafting happens.
            expect(model.generateContent).not.toHaveBeenCalled();
            expect(outcome).toEqual({
              status: 'skipped',
              reason: 'draft_failure_cap_reached',
            });
            // No new failure record, count and pending state unchanged.
            expect(store.failureRecords.length).toBe(recordsBefore);
            expect(store.failureCountFor('inv-1')).toBe(countBefore);
            expect(store.pendingCountFor('inv-1')).toBe(0);
          }
        }

        // After a run of failures long enough to cross it, the count settles at
        // the cap and never exceeds it, and no pending follow-up was ever made.
        expect(store.failureCountFor('inv-1')).toBe(
          MAX_CONSECUTIVE_DRAFT_FAILURES,
        );
        expect(store.pendingCountFor('inv-1')).toBe(0);
      }),
      { numRuns: 200 },
    );
  });
});
