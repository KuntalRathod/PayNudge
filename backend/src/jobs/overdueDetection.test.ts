import { describe, expect, it, vi } from 'vitest';

import type { Status } from '../lib/overdue.js';
import {
  DAILY_INTERVAL_MS,
  runOverdueDetection,
  SupabaseOverdueDetectionStore,
  startOverdueDetectionSchedule,
  type DetectionInvoice,
  type DraftJob,
  type OverdueDetectionStore,
} from './overdueDetection.js';

/**
 * Unit tests for the daily overdue-detection job (Req 7.1).
 *
 * The store, clock, and drafter are all faked: an in-memory
 * {@link OverdueDetectionStore} stands in for Postgres and an array-backed
 * enqueue stands in for the draft worker. No live Postgres and no live Gemini
 * call is made.
 */

/** In-memory {@link OverdueDetectionStore} recording transitions per invoice. */
class FakeOverdueStore implements OverdueDetectionStore {
  private readonly invoices = new Map<string, DetectionInvoice>();
  markOverdueCalls: Array<{ invoiceId: string; userId: string }> = [];

  seed(invoice: DetectionInvoice): void {
    this.invoices.set(invoice.id, { ...invoice });
  }

  statusOf(invoiceId: string): Status | undefined {
    return this.invoices.get(invoiceId)?.status;
  }

  async loadAllInvoices(): Promise<DetectionInvoice[]> {
    return [...this.invoices.values()].map((i) => ({ ...i }));
  }

  async markOverdue(invoiceId: string, userId: string): Promise<void> {
    this.markOverdueCalls.push({ invoiceId, userId });
    const invoice = this.invoices.get(invoiceId);
    if (invoice) {
      // Mirror the conditional `status = 'sent'` production write.
      if (invoice.status === 'sent') {
        invoice.status = 'overdue';
      }
    }
  }
}

/** A clock fixed at a specific instant. */
function fixedNow(iso: string): () => Date {
  const date = new Date(iso);
  return () => date;
}

const NOW = '2025-03-20T12:00:00Z';

describe('runOverdueDetection', () => {
  it('transitions only sent invoices past their due date to overdue', async () => {
    const store = new FakeOverdueStore();
    // Past-due sent -> should transition.
    store.seed({ id: 'a', userId: 'u1', status: 'sent', dueDate: '2025-03-10' });
    // Sent but not yet due -> stays sent.
    store.seed({ id: 'b', userId: 'u1', status: 'sent', dueDate: '2025-03-25' });
    // Draft / paid past due -> never changed.
    store.seed({ id: 'c', userId: 'u2', status: 'draft', dueDate: '2025-01-01' });
    store.seed({ id: 'd', userId: 'u2', status: 'paid', dueDate: '2025-01-01' });

    const jobs: DraftJob[] = [];
    const summary = await runOverdueDetection({
      store,
      enqueueDraft: (job) => {
        jobs.push(job);
      },
      now: fixedNow(NOW),
    });

    expect(store.statusOf('a')).toBe('overdue');
    expect(store.statusOf('b')).toBe('sent');
    expect(store.statusOf('c')).toBe('draft');
    expect(store.statusOf('d')).toBe('paid');

    expect(summary.evaluated).toBe(4);
    expect(summary.transitioned).toBe(1);
    // Only the newly-overdue invoice was persisted.
    expect(store.markOverdueCalls).toEqual([{ invoiceId: 'a', userId: 'u1' }]);
  });

  it('leaves a sent invoice due exactly today unchanged (strictly-later rule)', async () => {
    const store = new FakeOverdueStore();
    store.seed({ id: 'a', userId: 'u1', status: 'sent', dueDate: '2025-03-20' });

    const summary = await runOverdueDetection({
      store,
      enqueueDraft: () => {},
      now: fixedNow(NOW),
    });

    expect(store.statusOf('a')).toBe('sent');
    expect(summary.transitioned).toBe(0);
  });

  it('is idempotent: a second pass persists no further transitions', async () => {
    const store = new FakeOverdueStore();
    store.seed({ id: 'a', userId: 'u1', status: 'sent', dueDate: '2025-03-10' });
    store.seed({ id: 'b', userId: 'u1', status: 'sent', dueDate: '2025-03-25' });

    const first = await runOverdueDetection({
      store,
      enqueueDraft: () => {},
      now: fixedNow(NOW),
    });
    expect(first.transitioned).toBe(1);

    const second = await runOverdueDetection({
      store,
      enqueueDraft: () => {},
      now: fixedNow(NOW),
    });

    // No new transition and no new persisted write on the second pass.
    expect(second.transitioned).toBe(0);
    expect(store.markOverdueCalls).toHaveLength(1);
    expect(store.statusOf('a')).toBe('overdue');
    expect(store.statusOf('b')).toBe('sent');
  });

  it('recomputes days_overdue as whole calendar days since the due date', async () => {
    const store = new FakeOverdueStore();
    // 10 days before NOW.
    store.seed({ id: 'a', userId: 'u1', status: 'sent', dueDate: '2025-03-10' });
    // Already overdue, 14 days before NOW.
    store.seed({ id: 'b', userId: 'u1', status: 'overdue', dueDate: '2025-03-06' });

    const jobs: DraftJob[] = [];
    await runOverdueDetection({
      store,
      enqueueDraft: (job) => {
        jobs.push(job);
      },
      now: fixedNow(NOW),
    });

    const byId = new Map(jobs.map((j) => [j.invoiceId, j.daysOverdue]));
    expect(byId.get('a')).toBe(10);
    expect(byId.get('b')).toBe(14);
  });

  it('enqueues every overdue invoice (newly-transitioned and already-overdue)', async () => {
    const store = new FakeOverdueStore();
    store.seed({ id: 'a', userId: 'u1', status: 'sent', dueDate: '2025-03-10' }); // -> overdue
    store.seed({ id: 'b', userId: 'u2', status: 'overdue', dueDate: '2025-03-01' }); // stays overdue
    store.seed({ id: 'c', userId: 'u1', status: 'sent', dueDate: '2025-03-30' }); // stays sent
    store.seed({ id: 'd', userId: 'u2', status: 'paid', dueDate: '2025-01-01' }); // never

    const jobs: DraftJob[] = [];
    const summary = await runOverdueDetection({
      store,
      enqueueDraft: (job) => {
        jobs.push(job);
      },
      now: fixedNow(NOW),
    });

    const enqueuedIds = jobs.map((j) => j.invoiceId).sort();
    expect(enqueuedIds).toEqual(['a', 'b']);
    expect(summary.enqueued).toBe(2);
    // Enqueue payloads carry the owning user for the guarded drafter.
    expect(jobs.find((j) => j.invoiceId === 'a')?.userId).toBe('u1');
    expect(jobs.find((j) => j.invoiceId === 'b')?.userId).toBe('u2');
  });

  it('records enqueue errors without aborting the rest of the pass', async () => {
    const store = new FakeOverdueStore();
    store.seed({ id: 'a', userId: 'u1', status: 'overdue', dueDate: '2025-03-10' });
    store.seed({ id: 'b', userId: 'u1', status: 'overdue', dueDate: '2025-03-11' });

    const boom = new Error('drafter unavailable');
    const summary = await runOverdueDetection({
      store,
      enqueueDraft: (job) => {
        if (job.invoiceId === 'a') {
          throw boom;
        }
      },
      now: fixedNow(NOW),
    });

    expect(summary.enqueued).toBe(1); // only 'b' succeeded
    expect(summary.enqueueErrors).toEqual([{ invoiceId: 'a', error: boom }]);
  });

  it('returns an empty summary when there are no invoices', async () => {
    const store = new FakeOverdueStore();
    const summary = await runOverdueDetection({
      store,
      enqueueDraft: () => {},
      now: fixedNow(NOW),
    });
    expect(summary).toEqual({
      evaluated: 0,
      transitioned: 0,
      enqueued: 0,
      enqueueErrors: [],
    });
  });
});

describe('startOverdueDetectionSchedule', () => {
  it('runs immediately on start and reports the summary', async () => {
    const store = new FakeOverdueStore();
    store.seed({ id: 'a', userId: 'u1', status: 'sent', dueDate: '2025-03-10' });

    const onComplete = vi.fn();
    const handle = startOverdueDetectionSchedule(
      { store, enqueueDraft: () => {}, now: fixedNow(NOW) },
      { onComplete },
    );

    // Allow the immediate async run to settle.
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(onComplete.mock.calls[0]![0]).toMatchObject({ transitioned: 1 });

    handle.stop();
  });

  it('re-runs on each interval tick and stops when cancelled', async () => {
    vi.useFakeTimers();
    try {
      const store = new FakeOverdueStore();
      const onComplete = vi.fn();

      const handle = startOverdueDetectionSchedule(
        { store, enqueueDraft: () => {}, now: fixedNow(NOW) },
        { runImmediately: false, onComplete, intervalMs: DAILY_INTERVAL_MS },
      );

      // First daily tick.
      await vi.advanceTimersByTimeAsync(DAILY_INTERVAL_MS);
      expect(onComplete).toHaveBeenCalledTimes(1);

      // Second daily tick.
      await vi.advanceTimersByTimeAsync(DAILY_INTERVAL_MS);
      expect(onComplete).toHaveBeenCalledTimes(2);

      handle.stop();

      // No further runs after stop.
      await vi.advanceTimersByTimeAsync(DAILY_INTERVAL_MS * 3);
      expect(onComplete).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports run failures via onError instead of throwing', async () => {
    const failing: OverdueDetectionStore = {
      loadAllInvoices: () => Promise.reject(new Error('db down')),
      markOverdue: () => Promise.resolve(),
    };
    const onError = vi.fn();

    const handle = startOverdueDetectionSchedule(
      { store: failing, enqueueDraft: () => {} },
      { onError },
    );

    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
    expect((onError.mock.calls[0]![0] as Error).message).toBe('db down');

    handle.stop();
  });
});

/**
 * Smoke test: the overdue-detection cron is scheduled to evaluate every invoice
 * at least once per calendar day (Req 7.1).
 *
 * This bundles the three things that together prove the "at least daily"
 * guarantee for a long-lived process:
 *   1. the configured interval is <= 24h, so a run happens at least once per day;
 *   2. the schedule actually triggers a run immediately on start and on every
 *      daily tick (it is wired up, not just declared); and
 *   3. `stop()` halts further runs so the schedule is cancellable.
 */
describe('overdue-detection scheduling smoke test (Req 7.1)', () => {
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;

  it('is configured to run at least once per calendar day', () => {
    // The default interval must be no longer than a calendar day; otherwise the
    // "evaluate each invoice at least once per calendar day" guarantee breaks.
    expect(DAILY_INTERVAL_MS).toBeGreaterThan(0);
    expect(DAILY_INTERVAL_MS).toBeLessThanOrEqual(ONE_DAY_MS);
  });

  it('triggers a run immediately and on each daily tick, then stops when cancelled', async () => {
    vi.useFakeTimers();
    try {
      const store = new FakeOverdueStore();
      const onComplete = vi.fn();

      // Use the production default interval (no override) so the smoke test
      // exercises exactly what ships.
      const handle = startOverdueDetectionSchedule(
        { store, enqueueDraft: () => {}, now: fixedNow(NOW) },
        { onComplete },
      );

      // 1. Runs immediately on start (before any interval elapses).
      await vi.advanceTimersByTimeAsync(0);
      expect(onComplete).toHaveBeenCalledTimes(1);

      // 2. Advancing exactly one calendar day triggers the next run.
      await vi.advanceTimersByTimeAsync(ONE_DAY_MS);
      expect(onComplete).toHaveBeenCalledTimes(2);

      // ...and again on the following day: at least one run per calendar day.
      await vi.advanceTimersByTimeAsync(ONE_DAY_MS);
      expect(onComplete).toHaveBeenCalledTimes(3);

      // 3. stop() halts further runs.
      handle.stop();
      await vi.advanceTimersByTimeAsync(ONE_DAY_MS * 3);
      expect(onComplete).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

// --- SupabaseOverdueDetectionStore: query construction & user_id scoping -----

interface RecordedCall {
  table: string;
  op: 'select' | 'update';
  filters: Array<[string, string, unknown]>;
  payload?: Record<string, unknown>;
}

type QueryResult = { data: unknown; error: unknown };

/** Minimal recording fake of the Supabase query builder. */
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
  eq(col: string, val: unknown): this {
    this.filters.push(['eq', col, val]);
    return this;
  }
  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.commit()).then(
      onfulfilled ?? undefined,
      onrejected ?? undefined,
    );
  }
}

function fakeSupabase(results: Record<string, QueryResult>, calls: RecordedCall[]) {
  return {
    from(table: string) {
      return new FakeQueryBuilder(table, results, calls);
    },
  };
}

describe('SupabaseOverdueDetectionStore', () => {
  it('loads and maps all invoice rows', async () => {
    const calls: RecordedCall[] = [];
    const supabase = fakeSupabase(
      {
        'invoices:select': {
          data: [
            { id: 'a', user_id: 'u1', status: 'sent', due_date: '2025-03-10' },
            { id: 'b', user_id: 'u2', status: 'overdue', due_date: '2025-03-01' },
          ],
          error: null,
        },
      },
      calls,
    );

    const store = new SupabaseOverdueDetectionStore(supabase as never);
    const invoices = await store.loadAllInvoices();

    expect(invoices).toEqual([
      { id: 'a', userId: 'u1', status: 'sent', dueDate: '2025-03-10' },
      { id: 'b', userId: 'u2', status: 'overdue', dueDate: '2025-03-01' },
    ]);
  });

  it('marks overdue with a write conditional on status=sent and scoped by user_id', async () => {
    const calls: RecordedCall[] = [];
    const supabase = fakeSupabase({ 'invoices:update': { data: null, error: null } }, calls);
    const store = new SupabaseOverdueDetectionStore(supabase as never);

    await store.markOverdue('inv-1', 'user-1');

    const update = calls.find((c) => c.op === 'update')!;
    expect(update.table).toBe('invoices');
    expect(update.payload).toEqual({ status: 'overdue' });
    expect(update.filters).toContainEqual(['eq', 'id', 'inv-1']);
    expect(update.filters).toContainEqual(['eq', 'user_id', 'user-1']);
    expect(update.filters).toContainEqual(['eq', 'status', 'sent']);
  });

  it('throws when the load query returns an error', async () => {
    const calls: RecordedCall[] = [];
    const supabase = fakeSupabase(
      { 'invoices:select': { data: null, error: { message: 'boom' } } },
      calls,
    );
    const store = new SupabaseOverdueDetectionStore(supabase as never);
    await expect(store.loadAllInvoices()).rejects.toThrow('boom');
  });
});
