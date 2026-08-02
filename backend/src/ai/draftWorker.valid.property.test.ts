import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { tierForDaysOverdue, type Tier } from '../lib/escalation.js';
import { MS_PER_DAY, type Status } from '../lib/overdue.js';
import type { FollowUpDraftInput, GenerativeModelLike } from './geminiDraft.js';
import { validateDraftContent } from './geminiDraft.js';
import {
  draftFollowUp,
  type DraftFailureRecord,
  type DraftStore,
  type InvoiceContext,
  type PersistFollowUpInput,
} from './draftWorker.js';

// Feature: paynudge, Property 15: Drafting an overdue invoice produces a valid pending follow-up

/**
 * Property-based test for the LangGraph follow-up draft worker.
 *
 * **Validates: Requirements 8.1, 8.5, 8.6** — for any overdue invoice with no
 * existing pending follow-up, a successful draft attempt (the injected model
 * returns content that includes every required field) creates EXACTLY ONE
 * follow-up in `pending_approval` status whose content includes the client
 * name, the invoice amount, the invoice number, and the Days_Overdue value.
 *
 * The two side-effecting collaborators are faked so no live Postgres and no
 * live Gemini call is made: an in-memory {@link DraftStore} stands in for the
 * database, and a compliant fake {@link GenerativeModelLike} echoes every field
 * required by {@link validateDraftContent}.
 */

/** A stored follow-up in the in-memory fake store. */
interface FakeFollowUp {
  id: string;
  invoiceId: string;
  userId: string;
  tier: Tier;
  content: string;
  status: 'pending_approval' | 'approved' | 'sent' | 'discarded';
  draftedAt: number;
}

/**
 * In-memory {@link DraftStore} mirroring the discard-then-insert semantics of
 * the production store, so the test can assert the at-most-one-pending
 * invariant (Req 8.6, 10.5).
 */
class FakeDraftStore implements DraftStore {
  private readonly invoices = new Map<string, InvoiceContext>();
  readonly followUps: FakeFollowUp[] = [];
  private seq = 0;
  private clock = 0;

  readonly failureRecords: DraftFailureRecord[] = [];

  addInvoice(context: InvoiceContext): void {
    this.invoices.set(context.invoiceId, context);
  }

  pendingFor(invoiceId: string): FakeFollowUp[] {
    return this.followUps.filter(
      (f) => f.invoiceId === invoiceId && f.status === 'pending_approval',
    );
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
    // Discard any existing pending for this invoice+user (Req 10.5).
    for (const f of this.followUps) {
      if (
        f.invoiceId === input.invoiceId &&
        f.userId === input.userId &&
        f.status === 'pending_approval'
      ) {
        f.status = 'discarded';
      }
    }
    const stored: FakeFollowUp = {
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

/**
 * A fixed evaluation instant. Days_Overdue is computed by the worker from the
 * invoice due date relative to this clock, so a due date `n` days before this
 * instant yields exactly `Days_Overdue === n`.
 */
const NOW = new Date('2025-06-15T12:00:00Z');
/** UTC calendar-day number of {@link NOW} (time-of-day collapsed). */
const NOW_DAY = Math.floor(Date.UTC(2025, 5, 15) / MS_PER_DAY);

/** ISO `YYYY-MM-DD` due date that is exactly `daysOverdue` days before NOW. */
function dueDateForDaysOverdue(daysOverdue: number): string {
  const due = new Date((NOW_DAY - daysOverdue) * MS_PER_DAY);
  const year = due.getUTCFullYear();
  const month = String(due.getUTCMonth() + 1).padStart(2, '0');
  const day = String(due.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * A compliant fake model: it returns a body that embeds every field required
 * by {@link validateDraftContent} (client name, invoice number, amount as a
 * fixed-2-decimal representation, and the Days_Overdue value) so a draft
 * attempt succeeds. Also includes the sender name to avoid placeholder detection.
 */
function compliantModelFor(input: FollowUpDraftInput): GenerativeModelLike {
  const body =
    `Hi ${input.clientName}, invoice #${input.invoiceNumber} for ` +
    `$${input.amount.toFixed(2)} is now ${input.daysOverdue} days overdue. ` +
    `This is for ${input.description}. ` +
    `Best regards, ${input.senderName}`;
  return {
    generateContent: async () => ({ response: { text: () => body } }),
  };
}

describe('draftFollowUp — valid pending follow-up (Property 15)', () => {
  it('drafts exactly one valid pending_approval follow-up for any overdue invoice with no existing pending', () => {
    return fc.assert(
      fc.asyncProperty(
        // Days_Overdue >= 1 so a tier is always defined; spans all three tiers.
        fc.integer({ min: 1, max: 400 }),
        // Non-blank client name (must survive trim + case-insensitive match).
        fc.string({ minLength: 1, maxLength: 40 }).filter((s) => s.trim().length > 0),
        // Per-user sequential invoice number.
        fc.integer({ min: 1, max: 1_000_000 }),
        // Amount in whole currency units, generated from cents for exact 2dp.
        fc.integer({ min: 1, max: 1_000_000_00 }),
        async (daysOverdue, clientName, invoiceNumber, amountCents) => {
          const amount = amountCents / 100;
          const store = new FakeDraftStore();

          const invoice: InvoiceContext = {
            invoiceId: 'inv-1',
            userId: 'user-1',
            clientName,
            invoiceNumber,
            amount,
            dueDate: dueDateForDaysOverdue(daysOverdue),
            status: 'overdue' as Status,
            description: 'Consulting services',
            senderName: 'Test Sender',
            draftFailureCount: 0,
          };
          store.addInvoice(invoice);

          const expectedTier = tierForDaysOverdue(daysOverdue) as Tier;
          const draftInput: FollowUpDraftInput = {
            clientName,
            invoiceNumber,
            amount,
            daysOverdue,
            tier: expectedTier,
            senderName: 'Test Sender',
            description: 'Consulting services',
          };
          const model = compliantModelFor(draftInput);

          const outcome = await draftFollowUp('inv-1', {
            store,
            model,
            now: () => NOW,
          });

          // A successful draft attempt produces a `drafted` outcome (Req 8.1).
          expect(outcome.status).toBe('drafted');

          // Exactly one pending follow-up exists, in `pending_approval` (Req 8.6).
          const pending = store.pendingFor('inv-1');
          expect(pending).toHaveLength(1);
          expect(pending[0]!.status).toBe('pending_approval');
          expect(pending[0]!.tier).toBe(expectedTier);

          // Its content includes every required field (Req 8.5): the validator
          // passes, and each field is present directly.
          const content = pending[0]!.content;
          expect(validateDraftContent(content, draftInput)).toEqual({ ok: true });
          expect(content.toLowerCase()).toContain(clientName.trim().toLowerCase());
          expect(content).toContain(String(invoiceNumber));
          expect(content).toContain(amount.toFixed(2));
          expect(content).toContain(String(daysOverdue));
        },
      ),
      { numRuns: 200 },
    );
  });
});
