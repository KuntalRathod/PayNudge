import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { afterAll, beforeAll, describe, it } from 'vitest';
import fc from 'fast-check';

import { createInvoicesRouter } from './invoices.js';

// Feature: paynudge, Property 24: Payment halts the chase cycle and clears pending drafts

/**
 * Property-based test for payment halting the Chase_Cycle.
 *
 * **Validates: Requirements 10.2, 10.3**
 *
 * *For any* invoice in the Chase_Cycle (a "sent" or "overdue" invoice),
 * transitioning it to "paid" via `POST /invoices/:id/pay`:
 *
 *   - sets every one of that invoice's "pending_approval" follow-ups to
 *     "discarded" (Req 10.3), and
 *   - leaves every already-"sent"/"discarded"/"approved" follow-up of that
 *     invoice untouched (Req 10.3 targets only pending drafts), and
 *   - leaves follow-ups belonging to *other* invoices untouched, and
 *   - leaves no "pending_approval" follow-up for the paid invoice — modeling the
 *     removal from the Chase_Cycle so no further drafting occurs (Req 10.2),
 *     because the draft worker only drafts for overdue/unpaid invoices.
 *
 * The pay endpoint is driven over real HTTP against an in-memory fake Supabase
 * that simulates Row Level Security (all operations scoped to the current user)
 * and the follow_ups conditional-update path the mark-paid handler relies on.
 * Randomized follow-up sets of varying statuses are generated for a
 * sent/overdue invoice on every iteration.
 */

// ---------------------------------------------------------------------------
// In-memory fake Supabase (mirrors the harness in invoices.test.ts). It is
// self-contained here so this property test does not depend on that file.
// ---------------------------------------------------------------------------

interface StoredInvoice {
  id: string;
  user_id: string;
  client_id: string;
  invoice_number: number;
  amount: number;
  description: string;
  due_date: string;
  status: string;
  sent_at: string | null;
  draft_failure_count: number;
  send_lock_at: string | null;
  created_at: string;
  updated_at: string;
}

interface StoredEvent {
  id: number;
  user_id: string;
  invoice_id: string | null;
  type: string;
}

interface StoredFollowUp {
  id: string;
  user_id: string;
  invoice_id: string;
  tier: string;
  content: string;
  status: string;
  drafted_at: string;
  sent_at: string | null;
  created_at: string;
}

interface QueryResult {
  data: unknown;
  error: { message?: string; code?: string } | null;
}

interface Filter {
  column: string;
  op: 'eq' | 'is' | 'in';
  value: unknown;
}

class FakeQuery implements PromiseLike<QueryResult> {
  private op: 'select' | 'update' | 'insert' = 'select';
  private updateValues: Record<string, unknown> = {};
  private insertValues: Record<string, unknown> = {};
  private filters: Filter[] = [];
  private single = false;
  private orderColumn: string | null = null;
  private orderAscending = true;

  constructor(
    private readonly table: string,
    private readonly invoices: StoredInvoice[],
    private readonly events: StoredEvent[],
    private readonly followUps: StoredFollowUp[],
    private readonly currentUserId: string,
  ) {}

  select(_columns = ''): this {
    return this;
  }

  update(values: Record<string, unknown>): this {
    this.op = 'update';
    this.updateValues = values;
    return this;
  }

  insert(values: Record<string, unknown>): this {
    this.op = 'insert';
    this.insertValues = values;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ column, op: 'eq', value });
    return this;
  }

  is(column: string, value: unknown): this {
    this.filters.push({ column, op: 'is', value });
    return this;
  }

  in(column: string, values: unknown[]): this {
    this.filters.push({ column, op: 'in', value: values });
    return this;
  }

  order(column: string, opts: { ascending: boolean }): this {
    this.orderColumn = column;
    this.orderAscending = opts.ascending;
    return this;
  }

  maybeSingle(): Promise<QueryResult> {
    this.single = true;
    return Promise.resolve(this.execute());
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private matches(row: Record<string, unknown>): boolean {
    return this.filters.every((f) => {
      const actual = row[f.column];
      if (f.op === 'in') {
        return Array.isArray(f.value) && f.value.includes(actual);
      }
      return actual === f.value;
    });
  }

  private applyOrder<T>(rows: T[]): T[] {
    if (!this.orderColumn) {
      return rows;
    }
    const column = this.orderColumn;
    const dir = this.orderAscending ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = (a as Record<string, unknown>)[column];
      const bv = (b as Record<string, unknown>)[column];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') {
        return (av - bv) * dir;
      }
      return String(av).localeCompare(String(bv)) * dir;
    });
  }

  private execute(): QueryResult {
    if (this.op === 'insert') {
      // Only activity_events inserts flow through this path here.
      const nextId = this.events.reduce((max, e) => Math.max(max, e.id), 0) + 1;
      this.events.push({
        id: nextId,
        user_id: String(this.insertValues.user_id),
        invoice_id: (this.insertValues.invoice_id as string | null) ?? null,
        type: String(this.insertValues.type),
      });
      return { data: null, error: null };
    }

    // The follow_ups table supports RLS-scoped conditional updates (mark-paid
    // discards any pending-approval follow-up) and RLS-scoped reads.
    if (this.table === 'follow_ups') {
      const owned = this.followUps.filter((f) => f.user_id === this.currentUserId);

      if (this.op === 'update') {
        const targets = owned.filter((f) =>
          this.matches(f as unknown as Record<string, unknown>),
        );
        for (const target of targets) {
          Object.assign(target, this.updateValues);
        }
        if (this.single) {
          const first = targets[0] ?? null;
          return { data: first ? { ...first } : null, error: null };
        }
        return { data: null, error: null };
      }

      const filtered = owned.filter((f) =>
        this.matches(f as unknown as Record<string, unknown>),
      );
      const ordered = this.applyOrder(filtered);
      if (this.single) {
        const found = ordered[0] ?? null;
        return { data: found ? { ...found } : null, error: null };
      }
      return { data: ordered.map((f) => ({ ...f })), error: null };
    }

    // Invoices are RLS-scoped to the current user for both reads and updates.
    const owned = this.invoices.filter((i) => i.user_id === this.currentUserId);

    if (this.op === 'update') {
      const targets = owned.filter((i) => this.matches(i as unknown as Record<string, unknown>));
      for (const target of targets) {
        Object.assign(target, this.updateValues, { updated_at: new Date().toISOString() });
      }
      if (this.single) {
        const first = targets[0] ?? null;
        return { data: first ? { ...first } : null, error: null };
      }
      return { data: null, error: null };
    }

    // select
    const filtered = owned.filter((i) => this.matches(i as unknown as Record<string, unknown>));
    if (this.single) {
      const found = filtered[0] ?? null;
      return { data: found ? { ...found } : null, error: null };
    }
    const ordered = this.applyOrder(filtered);
    return { data: ordered.map((i) => ({ ...i })), error: null };
  }
}

class FakeSupabase {
  constructor(
    private readonly invoices: StoredInvoice[],
    private readonly events: StoredEvent[],
    private readonly followUps: StoredFollowUp[],
    private readonly currentUserId: string,
  ) {}

  from(table: string): FakeQuery {
    return new FakeQuery(table, this.invoices, this.events, this.followUps, this.currentUserId);
  }
}

// ---------------------------------------------------------------------------
// Mutable shared state referenced by the auth stub. Reset on every property
// iteration via {@link resetDb} so each generated scenario runs on a clean DB.
// ---------------------------------------------------------------------------

interface Db {
  invoices: StoredInvoice[];
  events: StoredEvent[];
  followUps: StoredFollowUp[];
  currentUserId: string;
  supabase: FakeSupabase;
}

let db: Db;
let server: Server;
let baseUrl: string;

function resetDb(): Db {
  const invoices: StoredInvoice[] = [];
  const events: StoredEvent[] = [];
  const followUps: StoredFollowUp[] = [];
  const currentUserId = randomUUID();
  const supabase = new FakeSupabase(invoices, events, followUps, currentUserId);
  db = { invoices, events, followUps, currentUserId, supabase };
  return db;
}

function buildApp(): Express {
  const app = express();
  app.use(express.json());

  // Auth stub reads the *current* mutable db at request time so it always sees
  // the state the active property iteration set up.
  const authStub = (req: Request, _res: Response, next: NextFunction): void => {
    req.userId = db.currentUserId;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    req.supabase = db.supabase as any;
    next();
  };

  app.use(createInvoicesRouter({ authMiddleware: authStub }));
  return app;
}

function makeInvoice(userId: string, overrides: Partial<StoredInvoice> = {}): StoredInvoice {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    user_id: userId,
    client_id: randomUUID(),
    invoice_number: 1,
    amount: 100,
    description: 'Work',
    due_date: '2024-06-01',
    status: 'overdue',
    sent_at: now,
    draft_failure_count: 0,
    send_lock_at: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function makeFollowUp(
  userId: string,
  invoiceId: string,
  status: string,
): StoredFollowUp {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    user_id: userId,
    invoice_id: invoiceId,
    tier: 'polite',
    content: 'Please pay your invoice.',
    status,
    drafted_at: now,
    sent_at: status === 'sent' ? now : null,
    created_at: now,
  };
}

beforeAll(async () => {
  resetDb();
  const app = buildApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// ---------------------------------------------------------------------------
// Generators.
// ---------------------------------------------------------------------------

/** The four possible follow-up statuses (Req: Follow_Up_Status enum). */
const followUpStatusArb = fc.constantFrom(
  'pending_approval',
  'approved',
  'sent',
  'discarded',
);

/** A chase-cycle invoice is one currently in "sent" or "overdue" status. */
const chaseStatusArb = fc.constantFrom('sent', 'overdue');

describe('Property 24: Payment halts the chase cycle and clears pending drafts', () => {
  it('discards every pending-approval follow-up of a paid invoice, leaves others untouched, and clears the chase cycle (10.2, 10.3)', async () => {
    await fc.assert(
      fc.asyncProperty(
        chaseStatusArb,
        // Statuses of the paid invoice's own follow-ups (any mix, any count).
        fc.array(followUpStatusArb, { minLength: 0, maxLength: 8 }),
        // Statuses of a *different* invoice's follow-ups (must be untouched).
        fc.array(followUpStatusArb, { minLength: 0, maxLength: 5 }),
        async (invoiceStatus, ownStatuses, otherStatuses) => {
          const { currentUserId } = resetDb();

          // The invoice being paid — in the chase cycle (sent/overdue).
          const paidInvoice = makeInvoice(currentUserId, {
            invoice_number: 1,
            status: invoiceStatus,
          });
          db.invoices.push(paidInvoice);

          // A second chase-cycle invoice whose follow-ups must be left alone.
          const otherInvoice = makeInvoice(currentUserId, {
            invoice_number: 2,
            status: 'overdue',
          });
          db.invoices.push(otherInvoice);

          // Follow-ups for the paid invoice, recording each one's original status.
          const ownFollowUps = ownStatuses.map((status) => {
            const fu = makeFollowUp(currentUserId, paidInvoice.id, status);
            db.followUps.push(fu);
            return { id: fu.id, originalStatus: status };
          });

          // Follow-ups for the other invoice.
          const otherFollowUps = otherStatuses.map((status) => {
            const fu = makeFollowUp(currentUserId, otherInvoice.id, status);
            db.followUps.push(fu);
            return { id: fu.id, originalStatus: status };
          });

          // Drive the pay endpoint over HTTP.
          const res = await fetch(`${baseUrl}/invoices/${paidInvoice.id}/pay`, {
            method: 'POST',
          });

          // The transition succeeds and the invoice is now paid (Req 6.1).
          if (res.status !== 200) return false;
          const body = (await res.json()) as { invoice: { status: string } };
          if (body.invoice.status !== 'paid') return false;

          const byId = (id: string): StoredFollowUp =>
            db.followUps.find((f) => f.id === id) as StoredFollowUp;

          // (Req 10.3) Every own follow-up: pending_approval -> discarded; every
          // other status is left exactly as it was.
          for (const { id, originalStatus } of ownFollowUps) {
            const current = byId(id).status;
            if (originalStatus === 'pending_approval') {
              if (current !== 'discarded') return false;
            } else if (current !== originalStatus) {
              return false;
            }
          }

          // (Req 10.2) No pending_approval follow-up remains for the paid invoice:
          // the chase cycle is halted so no further drafting occurs.
          const remainingPending = db.followUps.filter(
            (f) => f.invoice_id === paidInvoice.id && f.status === 'pending_approval',
          );
          if (remainingPending.length !== 0) return false;

          // (Req 10.3) Follow-ups of a different invoice are untouched — even
          // pending_approval ones, since discarding is scoped to the paid invoice.
          for (const { id, originalStatus } of otherFollowUps) {
            if (byId(id).status !== originalStatus) return false;
          }

          return true;
        },
      ),
      { numRuns: 200 },
    );
  });
});
