import { describe, expect, it, vi } from 'vitest';

import type { Tier } from '../lib/escalation.js';
import type { Status } from '../lib/overdue.js';
import type { FollowUpDraftInput, GenerativeModelLike } from './geminiDraft.js';
import {
  MAX_CONSECUTIVE_DRAFT_FAILURES,
  SupabaseDraftStore,
  draftFollowUp,
  type DraftFailureRecord,
  type DraftStore,
  type InvoiceContext,
  type PersistFollowUpInput,
} from './draftWorker.js';

/**
 * Unit tests for the LangGraph draft worker (Req 8.1, 8.6, 10.5).
 *
 * The two side-effecting collaborators are faked: a small in-memory
 * {@link DraftStore} stands in for Postgres, and a fake {@link GenerativeModelLike}
 * stands in for Gemini. No live Postgres and no live model call is made.
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
 * In-memory {@link DraftStore} that mirrors the discard-then-insert semantics
 * and lets tests assert the at-most-one-pending invariant.
 */
class FakeDraftStore implements DraftStore {
  private readonly invoices = new Map<string, InvoiceContext>();
  readonly followUps: FakeFollowUp[] = [];
  private seq = 0;
  private clock = 0;

  loadCalls = 0;
  replaceCalls = 0;
  resetCalls = 0;
  readonly failureRecords: DraftFailureRecord[] = [];

  addInvoice(context: InvoiceContext): void {
    this.invoices.set(context.invoiceId, context);
  }

  /** Current persisted consecutive-failure count for an invoice. */
  failureCountFor(invoiceId: string): number {
    return this.invoices.get(invoiceId)?.draftFailureCount ?? 0;
  }

  /** Seeds an existing follow-up (e.g. a prior pending or sent one). */
  seedFollowUp(fu: Omit<FakeFollowUp, 'id' | 'draftedAt'>): FakeFollowUp {
    const stored: FakeFollowUp = {
      ...fu,
      id: `seed-${this.seq++}`,
      draftedAt: this.clock++,
    };
    this.followUps.push(stored);
    return stored;
  }

  pendingFor(invoiceId: string): FakeFollowUp[] {
    return this.followUps.filter(
      (f) => f.invoiceId === invoiceId && f.status === 'pending_approval',
    );
  }

  async loadInvoiceContext(invoiceId: string): Promise<InvoiceContext | null> {
    this.loadCalls++;
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
    this.replaceCalls++;
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
    this.resetCalls++;
    const invoice = this.invoices.get(invoiceId);
    if (invoice) {
      invoice.draftFailureCount = 0;
    }
  }
}

const NOW = new Date('2025-03-20T12:00:00Z');

function overdueInvoice(overrides: Partial<InvoiceContext> = {}): InvoiceContext {
  return {
    invoiceId: 'inv-1',
    userId: 'user-1',
    clientName: 'Acme Corp',
    invoiceNumber: 42,
    amount: 1234.5,
    // 10 days before NOW -> Days_Overdue 10 -> tier "firm".
    dueDate: '2025-03-10',
    status: 'overdue' as Status,
    description: 'Website development',
    senderName: 'Jane Smith',
    draftFailureCount: 0,
    ...overrides,
  };
}

/** A fake model that echoes every required fact so validation passes. */
function goodModel(): GenerativeModelLike {
  return {
    generateContent: vi.fn(async (prompt: string) => {
      // Derive a valid body from the facts embedded in the prompt is overkill;
      // instead the caller seeds inputs so we build a compliant body directly.
      return { response: { text: () => prompt } };
    }),
  };
}

/** Builds a model returning a body that includes all Req 8.5 fields for `input`. */
function compliantModelFor(input: Partial<FollowUpDraftInput> & Pick<FollowUpDraftInput, 'clientName' | 'invoiceNumber' | 'amount' | 'daysOverdue' | 'tier'>): GenerativeModelLike {
  const body =
    `Hi ${input.clientName}, invoice #${input.invoiceNumber} for ` +
    `$${input.amount.toFixed(2)} is now ${input.daysOverdue} days overdue. ` +
    `This is for ${input.description ?? 'Website development'}. ` +
    `Best regards, ${input.senderName ?? 'Jane Smith'}`;
  return {
    generateContent: vi.fn(async () => ({ response: { text: () => body } })),
  };
}

describe('draftFollowUp', () => {
  it('drafts a pending_approval follow-up for an overdue invoice with no prior', async () => {
    const store = new FakeDraftStore();
    const invoice = overdueInvoice();
    store.addInvoice(invoice);

    const model = compliantModelFor({
      clientName: invoice.clientName,
      invoiceNumber: invoice.invoiceNumber,
      amount: invoice.amount,
      daysOverdue: 10,
      tier: 'firm',
    });

    const outcome = await draftFollowUp('inv-1', {
      store,
      model,
      now: () => NOW,
    });

    expect(outcome.status).toBe('drafted');
    if (outcome.status === 'drafted') {
      expect(outcome.tier).toBe('firm');
      expect(outcome.content).toContain('Acme Corp');
    }
    // Exactly one pending follow-up now exists (Req 8.6, 10.5).
    const pending = store.pendingFor('inv-1');
    expect(pending).toHaveLength(1);
    expect(pending[0]!.status).toBe('pending_approval');
    expect(pending[0]!.tier).toBe('firm');
  });

  it('discards the existing pending follow-up before inserting the new one (Req 10.5)', async () => {
    const store = new FakeDraftStore();
    const invoice = overdueInvoice();
    store.addInvoice(invoice);

    // A stale pending follow-up at the lower "polite" tier already exists.
    const stale = store.seedFollowUp({
      invoiceId: 'inv-1',
      userId: 'user-1',
      tier: 'polite',
      content: 'old polite draft',
      status: 'pending_approval',
    });

    const model = compliantModelFor({
      clientName: invoice.clientName,
      invoiceNumber: invoice.invoiceNumber,
      amount: invoice.amount,
      daysOverdue: 10,
      tier: 'firm',
    });

    const outcome = await draftFollowUp('inv-1', { store, model, now: () => NOW });

    expect(outcome.status).toBe('drafted');
    // The stale one is discarded; only the new "firm" pending remains.
    expect(store.followUps.find((f) => f.id === stale.id)!.status).toBe('discarded');
    const pending = store.pendingFor('inv-1');
    expect(pending).toHaveLength(1);
    expect(pending[0]!.tier).toBe('firm');
  });

  it('escalates only when the tier strictly increases; drafts firm over prior polite', async () => {
    const store = new FakeDraftStore();
    const invoice = overdueInvoice(); // 10 days -> firm
    store.addInvoice(invoice);
    store.seedFollowUp({
      invoiceId: 'inv-1',
      userId: 'user-1',
      tier: 'polite',
      content: 'earlier polite',
      status: 'sent',
    });

    const model = compliantModelFor({
      clientName: invoice.clientName,
      invoiceNumber: invoice.invoiceNumber,
      amount: invoice.amount,
      daysOverdue: 10,
      tier: 'firm',
    });

    const outcome = await draftFollowUp('inv-1', { store, model, now: () => NOW });
    expect(outcome.status).toBe('drafted');
    if (outcome.status === 'drafted') expect(outcome.tier).toBe('firm');
  });

  it('skips when the current tier does not exceed the prior tier', async () => {
    const store = new FakeDraftStore();
    // 3 days overdue -> polite.
    store.addInvoice(overdueInvoice({ dueDate: '2025-03-17' }));
    store.seedFollowUp({
      invoiceId: 'inv-1',
      userId: 'user-1',
      tier: 'polite',
      content: 'already polite',
      status: 'sent',
    });

    const model = goodModel();
    const outcome = await draftFollowUp('inv-1', { store, model, now: () => NOW });

    expect(outcome).toEqual({ status: 'skipped', reason: 'tier_not_increased' });
    expect(store.replaceCalls).toBe(0);
    expect(model.generateContent).not.toHaveBeenCalled();
  });

  it('skips with not_found when the invoice does not exist', async () => {
    const store = new FakeDraftStore();
    const model = goodModel();
    const outcome = await draftFollowUp('missing', { store, model, now: () => NOW });
    expect(outcome).toEqual({ status: 'skipped', reason: 'not_found' });
    expect(model.generateContent).not.toHaveBeenCalled();
  });

  it('skips with not_overdue when the invoice is not in overdue status', async () => {
    const store = new FakeDraftStore();
    store.addInvoice(overdueInvoice({ status: 'sent' }));
    const model = goodModel();
    const outcome = await draftFollowUp('inv-1', { store, model, now: () => NOW });
    expect(outcome).toEqual({ status: 'skipped', reason: 'not_overdue' });
    expect(model.generateContent).not.toHaveBeenCalled();
  });

  it('skips with no_tier when days overdue maps to no tier', async () => {
    const store = new FakeDraftStore();
    // due_date equals the evaluation day -> Days_Overdue 0 -> no tier.
    store.addInvoice(overdueInvoice({ dueDate: '2025-03-20' }));
    const model = goodModel();
    const outcome = await draftFollowUp('inv-1', { store, model, now: () => NOW });
    expect(outcome).toEqual({ status: 'skipped', reason: 'no_tier' });
    expect(store.replaceCalls).toBe(0);
  });

  it('reports generation_error and persists nothing when the model throws', async () => {
    const store = new FakeDraftStore();
    store.addInvoice(overdueInvoice());
    const boom = new Error('gemini down');
    const model: GenerativeModelLike = {
      generateContent: vi.fn(async () => {
        throw boom;
      }),
    };

    const outcome = await draftFollowUp('inv-1', { store, model, now: () => NOW });
    expect(outcome).toEqual({ status: 'failed', reason: 'generation_error', error: boom });
    expect(store.replaceCalls).toBe(0);
    expect(store.pendingFor('inv-1')).toHaveLength(0);
  });

  it('reports invalid_content and persists nothing when the draft misses fields', async () => {
    const store = new FakeDraftStore();
    store.addInvoice(overdueInvoice());
    const model: GenerativeModelLike = {
      generateContent: vi.fn(async () => ({
        response: { text: () => 'Please pay your bill.' },
      })),
    };

    const outcome = await draftFollowUp('inv-1', { store, model, now: () => NOW });
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed' && outcome.reason === 'invalid_content') {
      expect(outcome.missing).toEqual(
        expect.arrayContaining(['clientName', 'invoiceNumber', 'amount', 'daysOverdue']),
      );
    } else {
      throw new Error('expected invalid_content failure');
    }
    expect(store.replaceCalls).toBe(0);
    expect(store.pendingFor('inv-1')).toHaveLength(0);
  });

  it('never leaves more than one pending across repeated draft runs', async () => {
    const store = new FakeDraftStore();
    store.addInvoice(overdueInvoice({ dueDate: '2025-03-06' })); // 14 days -> final_notice
    // Prior non-discarded is firm; final_notice is a strict increase.
    store.seedFollowUp({
      invoiceId: 'inv-1',
      userId: 'user-1',
      tier: 'firm',
      content: 'firm pending',
      status: 'pending_approval',
    });

    const input: FollowUpDraftInput = {
      clientName: 'Acme Corp',
      invoiceNumber: 42,
      amount: 1234.5,
      daysOverdue: 14,
      tier: 'final_notice',
      senderName: 'Jane Smith',
      description: 'Website development',
    };
    const model = compliantModelFor(input);

    await draftFollowUp('inv-1', { store, model, now: () => NOW });
    // A second run at the same tier should now skip (no strict increase).
    const second = await draftFollowUp('inv-1', { store, model, now: () => NOW });

    expect(second).toEqual({ status: 'skipped', reason: 'tier_not_increased' });
    expect(store.pendingFor('inv-1')).toHaveLength(1);
    expect(store.pendingFor('inv-1')[0]!.tier).toBe('final_notice');
  });
});

describe('draftFollowUp draft-failure counting and cap (Req 8.8, 8.9)', () => {
  /** A model that always throws, forcing a generation_error failure. */
  function throwingModel(error: unknown): GenerativeModelLike {
    return {
      generateContent: vi.fn(async () => {
        throw error;
      }),
    };
  }

  /** A model that returns content missing required fields (invalid_content). */
  function invalidContentModel(): GenerativeModelLike {
    return {
      generateContent: vi.fn(async () => ({
        response: { text: () => 'Please pay your bill.' },
      })),
    };
  }

  it('increments the failure count, records a message, and creates no pending on generation_error', async () => {
    const store = new FakeDraftStore();
    store.addInvoice(overdueInvoice({ draftFailureCount: 0 }));
    const boom = new Error('gemini down');

    const outcome = await draftFollowUp('inv-1', {
      store,
      model: throwingModel(boom),
      now: () => NOW,
    });

    expect(outcome).toEqual({ status: 'failed', reason: 'generation_error', error: boom });
    // Counter incremented by exactly one, message recorded, no pending created.
    expect(store.failureCountFor('inv-1')).toBe(1);
    expect(store.failureRecords).toHaveLength(1);
    expect(store.failureRecords[0]).toMatchObject({
      invoiceId: 'inv-1',
      userId: 'user-1',
      reason: 'generation_error',
      count: 1,
    });
    expect(store.failureRecords[0]!.message).toContain('inv-1');
    expect(store.pendingFor('inv-1')).toHaveLength(0);
  });

  it('increments the failure count and records a message on invalid_content', async () => {
    const store = new FakeDraftStore();
    store.addInvoice(overdueInvoice({ draftFailureCount: 1 }));

    const outcome = await draftFollowUp('inv-1', {
      store,
      model: invalidContentModel(),
      now: () => NOW,
    });

    expect(outcome.status).toBe('failed');
    expect(store.failureCountFor('inv-1')).toBe(2);
    expect(store.failureRecords[0]).toMatchObject({ reason: 'invalid_content', count: 2 });
    expect(store.pendingFor('inv-1')).toHaveLength(0);
  });

  it('leaves the invoice eligible for a later attempt below the cap (Req 8.8)', async () => {
    const store = new FakeDraftStore();
    store.addInvoice(overdueInvoice({ draftFailureCount: 0 }));

    // First failing attempt.
    await draftFollowUp('inv-1', { store, model: throwingModel(new Error('a')), now: () => NOW });
    expect(store.failureCountFor('inv-1')).toBe(1);

    // A subsequent attempt is still made (not capped) and increments again.
    const model = invalidContentModel();
    await draftFollowUp('inv-1', { store, model, now: () => NOW });
    expect(model.generateContent).toHaveBeenCalledTimes(1);
    expect(store.failureCountFor('inv-1')).toBe(2);
  });

  it('records a cap message on the third consecutive failure (Req 8.9)', async () => {
    const store = new FakeDraftStore();
    store.addInvoice(overdueInvoice({ draftFailureCount: 2 }));

    const outcome = await draftFollowUp('inv-1', {
      store,
      model: throwingModel(new Error('still down')),
      now: () => NOW,
    });

    expect(outcome.status).toBe('failed');
    expect(store.failureCountFor('inv-1')).toBe(MAX_CONSECUTIVE_DRAFT_FAILURES);
    const record = store.failureRecords.at(-1)!;
    expect(record.count).toBe(MAX_CONSECUTIVE_DRAFT_FAILURES);
    expect(record.message).toContain('Automatic drafting has stopped');
  });

  it('stops automatic drafting once the cap is reached and records no new failure (Req 8.9)', async () => {
    const store = new FakeDraftStore();
    store.addInvoice(overdueInvoice({ draftFailureCount: MAX_CONSECUTIVE_DRAFT_FAILURES }));
    const model = throwingModel(new Error('never called'));

    const outcome = await draftFollowUp('inv-1', { store, model, now: () => NOW });

    expect(outcome).toEqual({ status: 'skipped', reason: 'draft_failure_cap_reached' });
    // Model is never called and no new failure is recorded once capped.
    expect(model.generateContent).not.toHaveBeenCalled();
    expect(store.failureRecords).toHaveLength(0);
    expect(store.replaceCalls).toBe(0);
    expect(store.failureCountFor('inv-1')).toBe(MAX_CONSECUTIVE_DRAFT_FAILURES);
  });

  it('resets the failure count to zero after a successful draft (Req 8.8)', async () => {
    const store = new FakeDraftStore();
    const invoice = overdueInvoice({ draftFailureCount: 2 }); // 10 days -> firm
    store.addInvoice(invoice);

    const model = compliantModelFor({
      clientName: invoice.clientName,
      invoiceNumber: invoice.invoiceNumber,
      amount: invoice.amount,
      daysOverdue: 10,
      tier: 'firm',
    });

    const outcome = await draftFollowUp('inv-1', { store, model, now: () => NOW });

    expect(outcome.status).toBe('drafted');
    expect(store.resetCalls).toBe(1);
    expect(store.failureCountFor('inv-1')).toBe(0);
    expect(store.pendingFor('inv-1')).toHaveLength(1);
  });

  it('does not issue a reset write when the count is already zero on success', async () => {
    const store = new FakeDraftStore();
    const invoice = overdueInvoice({ draftFailureCount: 0 });
    store.addInvoice(invoice);

    const model = compliantModelFor({
      clientName: invoice.clientName,
      invoiceNumber: invoice.invoiceNumber,
      amount: invoice.amount,
      daysOverdue: 10,
      tier: 'firm',
    });

    const outcome = await draftFollowUp('inv-1', { store, model, now: () => NOW });

    expect(outcome.status).toBe('drafted');
    expect(store.resetCalls).toBe(0);
  });
});

// --- SupabaseDraftStore: verify query construction and user_id scoping -------

/**
 * A minimal recording fake of the Supabase query builder. Each `from()` returns
 * a fresh builder whose terminal result is looked up by table + operation, and
 * which records the filters/payload so tests can assert `user_id` scoping.
 */
interface RecordedCall {
  table: string;
  op: 'select' | 'update' | 'insert';
  filters: Array<[string, string, unknown]>;
  payload?: Record<string, unknown>;
}

type QueryResult = { data: unknown; error: unknown };

class FakeQueryBuilder implements PromiseLike<QueryResult> {
  op: RecordedCall['op'] = 'select';
  readonly filters: RecordedCall['filters'] = [];
  payload?: Record<string, unknown>;
  private committed = false;

  constructor(
    private readonly table: string,
    private readonly results: Record<string, QueryResult>,
    private readonly calls: RecordedCall[],
  ) {}

  /** Records the call once and resolves to the result keyed by table + op. */
  private commit(): QueryResult {
    if (!this.committed) {
      this.committed = true;
      this.calls.push({
        table: this.table,
        op: this.op,
        filters: this.filters,
        payload: this.payload,
      });
    }
    return this.results[`${this.table}:${this.op}`] ?? { data: null, error: null };
  }

  select(): this {
    return this;
  }
  update(payload: Record<string, unknown>): this {
    this.op = 'update';
    this.payload = payload;
    return this;
  }
  insert(payload: Record<string, unknown>): this {
    this.op = 'insert';
    this.payload = payload;
    return this;
  }
  eq(col: string, val: unknown): this {
    this.filters.push(['eq', col, val]);
    return this;
  }
  neq(col: string, val: unknown): this {
    this.filters.push(['neq', col, val]);
    return this;
  }
  order(): this {
    return this;
  }
  limit(): this {
    return this;
  }
  async maybeSingle(): Promise<QueryResult> {
    return this.commit();
  }
  async single(): Promise<QueryResult> {
    return this.commit();
  }
  // Thenable so an awaited builder without .single()/.maybeSingle() (e.g. an
  // update) still records and resolves.
  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.commit()).then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

/** A fake Supabase client returning queued results keyed by `table:op`. */
function fakeSupabase(results: Record<string, QueryResult>, calls: RecordedCall[]) {
  return {
    from(table: string) {
      return new FakeQueryBuilder(table, results, calls);
    },
  };
}

describe('SupabaseDraftStore', () => {
  it('loads and maps an invoice row, coercing amount and reading client name', async () => {
    const calls: RecordedCall[] = [];
    const supabase = fakeSupabase(
      {
        'invoices:select': {
          data: {
            id: 'inv-1',
            user_id: 'user-1',
            invoice_number: 7,
            amount: '2500.00',
            due_date: '2025-03-01',
            status: 'overdue',
            description: 'Logo design',
            draft_failure_count: 2,
            clients: { name: 'Globex' },
          },
          error: null,
        },
        'profiles:select': {
          data: { business_name: 'Smith Design Co' },
          error: null,
        },
      },
      calls,
    );

    const store = new SupabaseDraftStore(supabase as never);
    const ctx = await store.loadInvoiceContext('inv-1');

    expect(ctx).toEqual({
      invoiceId: 'inv-1',
      userId: 'user-1',
      clientName: 'Globex',
      invoiceNumber: 7,
      amount: 2500,
      dueDate: '2025-03-01',
      status: 'overdue',
      description: 'Logo design',
      senderName: 'Smith Design Co',
      draftFailureCount: 2,
    });
    expect(calls[0]!.filters).toContainEqual(['eq', 'id', 'inv-1']);
  });

  it('returns null when the invoice is absent', async () => {
    const calls: RecordedCall[] = [];
    const supabase = fakeSupabase(
      { 'invoices:select': { data: null, error: null } },
      calls,
    );
    const store = new SupabaseDraftStore(supabase as never);
    expect(await store.loadInvoiceContext('nope')).toBeNull();
  });

  it('reads latest non-discarded tier scoped by user_id and excluding discarded', async () => {
    const calls: RecordedCall[] = [];
    const supabase = fakeSupabase(
      { 'follow_ups:select': { data: { tier: 'firm' }, error: null } },
      calls,
    );
    const store = new SupabaseDraftStore(supabase as never);

    const tier = await store.getMostRecentNonDiscardedTier('inv-1', 'user-1');
    expect(tier).toBe('firm');
    const call = calls[0]!;
    expect(call.filters).toContainEqual(['eq', 'invoice_id', 'inv-1']);
    expect(call.filters).toContainEqual(['eq', 'user_id', 'user-1']);
    expect(call.filters).toContainEqual(['neq', 'status', 'discarded']);
  });

  it('discards existing pending (scoped by user_id) then inserts the new pending', async () => {
    const calls: RecordedCall[] = [];
    const supabase = fakeSupabase(
      {
        'follow_ups:update': { data: null, error: null },
        'follow_ups:insert': { data: { id: 'new-fu' }, error: null },
      },
      calls,
    );
    const store = new SupabaseDraftStore(supabase as never);

    const { id } = await store.replacePendingFollowUp({
      invoiceId: 'inv-1',
      userId: 'user-1',
      tier: 'firm',
      content: 'body',
    });

    expect(id).toBe('new-fu');

    const update = calls.find((c) => c.op === 'update')!;
    expect(update.payload).toEqual({ status: 'discarded' });
    expect(update.filters).toContainEqual(['eq', 'invoice_id', 'inv-1']);
    expect(update.filters).toContainEqual(['eq', 'user_id', 'user-1']);
    expect(update.filters).toContainEqual(['eq', 'status', 'pending_approval']);

    const insert = calls.find((c) => c.op === 'insert')!;
    expect(insert.payload).toMatchObject({
      invoice_id: 'inv-1',
      user_id: 'user-1',
      tier: 'firm',
      content: 'body',
      status: 'pending_approval',
    });
  });

  it('records a draft failure by writing the new count scoped by user_id', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const calls: RecordedCall[] = [];
    const supabase = fakeSupabase({ 'invoices:update': { data: null, error: null } }, calls);
    const store = new SupabaseDraftStore(supabase as never);

    await store.recordDraftFailure({
      invoiceId: 'inv-1',
      userId: 'user-1',
      reason: 'generation_error',
      count: 2,
      message: 'draft failed',
    });

    const update = calls.find((c) => c.op === 'update')!;
    expect(update.table).toBe('invoices');
    expect(update.payload).toEqual({ draft_failure_count: 2 });
    expect(update.filters).toContainEqual(['eq', 'id', 'inv-1']);
    expect(update.filters).toContainEqual(['eq', 'user_id', 'user-1']);
    // The draft-failure message is recorded as a structured server log.
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('resets the draft failure count to zero scoped by user_id', async () => {
    const calls: RecordedCall[] = [];
    const supabase = fakeSupabase({ 'invoices:update': { data: null, error: null } }, calls);
    const store = new SupabaseDraftStore(supabase as never);

    await store.resetDraftFailure('inv-1', 'user-1');

    const update = calls.find((c) => c.op === 'update')!;
    expect(update.table).toBe('invoices');
    expect(update.payload).toEqual({ draft_failure_count: 0 });
    expect(update.filters).toContainEqual(['eq', 'id', 'inv-1']);
    expect(update.filters).toContainEqual(['eq', 'user_id', 'user-1']);
  });
});
