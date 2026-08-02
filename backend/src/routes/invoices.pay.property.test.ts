import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { createInvoicesRouter } from './invoices.js';

// Feature: paynudge, Property 11: Marking payment is a valid-status-only transition with an event

/**
 * Property-based test for the mark-paid transition (Requirement 6).
 *
 * **Validates: Requirements 6.1, 6.3, 6.4, 6.6** — for any invoice, marking it
 * paid succeeds and records exactly one payment-received event *if and only if*
 * it is owned by the caller and currently in "sent" or "overdue" status. A
 * mark-paid request on a "draft" invoice, an already "paid" invoice, or an
 * unowned invoice leaves the status unchanged and records no event.
 *
 * The router is mounted on a real Express app and exercised over HTTP, reusing
 * the in-memory fake-Supabase harness pattern from `invoices.test.ts`. The fake
 * simulates Row Level Security by scoping every invoice operation to the
 * "current" user id, so an invoice owned by another user is invisible to reads
 * and untouched by the conditional update — exactly as Postgres RLS enforces.
 *
 * A single server serves every fast-check iteration; the shared in-memory state
 * (`db`) is reset at the start of each generated case so runs are independent.
 */

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

interface QueryResult {
  data: unknown;
  error: { message?: string; code?: string } | null;
}

interface Filter {
  column: string;
  op: 'eq' | 'is' | 'in';
  value: unknown;
}

/** Mutable, per-iteration in-memory database shared with the fake client. */
interface Db {
  invoices: StoredInvoice[];
  events: StoredEvent[];
  currentUserId: string;
}

/**
 * Chainable query builder mimicking the subset of the Supabase JS client the
 * pay handler uses: the conditional-transition update
 * (`update/eq/in/select/maybeSingle`), the explanatory read-back
 * (`select/eq/maybeSingle`), and the activity-event insert (`insert` awaited
 * directly). Ownership scoping (RLS) is applied by filtering every invoice
 * operation to the current user id, so an unowned invoice is never matched.
 */
class FakeQuery implements PromiseLike<QueryResult> {
  private op: 'select' | 'update' | 'insert' = 'select';
  private updateValues: Record<string, unknown> = {};
  private insertValues: Record<string, unknown> = {};
  private filters: Filter[] = [];
  private single = false;

  constructor(private readonly db: Db) {}

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

  private matches(invoice: StoredInvoice): boolean {
    return this.filters.every((f) => {
      const actual = (invoice as unknown as Record<string, unknown>)[f.column];
      if (f.op === 'in') {
        return Array.isArray(f.value) && f.value.includes(actual);
      }
      return actual === f.value;
    });
  }

  private execute(): QueryResult {
    if (this.op === 'insert') {
      // Only activity_events inserts flow through this path in these tests.
      const nextId = this.db.events.reduce((max, e) => Math.max(max, e.id), 0) + 1;
      this.db.events.push({
        id: nextId,
        user_id: String(this.insertValues.user_id),
        invoice_id: (this.insertValues.invoice_id as string | null) ?? null,
        type: String(this.insertValues.type),
      });
      return { data: null, error: null };
    }

    // Invoices are RLS-scoped to the current user for both reads and updates.
    const owned = this.db.invoices.filter((i) => i.user_id === this.db.currentUserId);

    if (this.op === 'update') {
      const targets = owned.filter((i) => this.matches(i));
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
    const filtered = owned.filter((i) => this.matches(i));
    const found = filtered[0] ?? null;
    return { data: found ? { ...found } : null, error: null };
  }
}

class FakeSupabase {
  constructor(private readonly db: Db) {}

  from(_table: string): FakeQuery {
    return new FakeQuery(this.db);
  }
}

// Single shared in-memory database + server for the whole property run.
const db: Db = { invoices: [], events: [], currentUserId: randomUUID() };
const fakeSupabase = new FakeSupabase(db);
let server: Server;
let baseUrl: string;

function buildApp(): Express {
  const app = express();
  app.use(express.json());

  // Auth stub: attaches the current user id and an RLS-scoped fake client,
  // standing in for the real `requireAuth` middleware.
  const authStub = (req: Request, _res: Response, next: NextFunction): void => {
    req.userId = db.currentUserId;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    req.supabase = fakeSupabase as any;
    next();
  };

  app.use(createInvoicesRouter({ authMiddleware: authStub }));
  return app;
}

beforeAll(async () => {
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

/** Resets shared state so each generated case runs against a clean database. */
function resetDb(): void {
  db.invoices.length = 0;
  db.events.length = 0;
  db.currentUserId = randomUUID();
}

/** Every legal invoice status the mark-paid endpoint may encounter. */
const statusArb = fc.constantFrom('draft', 'sent', 'overdue', 'paid');

const caseArb = fc.record({
  status: statusArb,
  // Whether the seeded invoice is owned by the caller or by some other user.
  owned: fc.boolean(),
});

/** Seeds one invoice with the given status and ownership; returns its id. */
function seedInvoice(status: string, owned: boolean): string {
  const now = new Date().toISOString();
  const id = randomUUID();
  db.invoices.push({
    id,
    user_id: owned ? db.currentUserId : randomUUID(),
    client_id: randomUUID(),
    invoice_number: 1,
    amount: 100,
    description: 'Seed work',
    due_date: '2024-06-01',
    status,
    sent_at: status === 'draft' ? null : now,
    draft_failure_count: 0,
    send_lock_at: null,
    created_at: now,
    updated_at: now,
  });
  return id;
}

describe('Property 11: Marking payment is a valid-status-only transition with an event', () => {
  it('marks paid + records exactly one event iff owned and sent/overdue; otherwise unchanged with no event', async () => {
    await fc.assert(
      fc.asyncProperty(caseArb, async ({ status, owned }) => {
        resetDb();
        const invoiceId = seedInvoice(status, owned);

        const res = await fetch(`${baseUrl}/invoices/${invoiceId}/pay`, { method: 'POST' });

        const stored = db.invoices.find((i) => i.id === invoiceId)!;
        const paymentEvents = db.events.filter(
          (e) => e.type === 'payment_received' && e.invoice_id === invoiceId,
        );

        // The transition is valid exactly when the invoice is owned and its
        // current status is "sent" or "overdue" (Req 6.1).
        const shouldTransition = owned && (status === 'sent' || status === 'overdue');

        if (shouldTransition) {
          // Succeeds, flips to "paid", and confirms (Req 6.1).
          expect(res.status).toBe(200);
          const body = (await res.json()) as { invoice: { status: string }; message: string };
          expect(body.invoice.status).toBe('paid');
          expect(body.message).toMatch(/marked paid/i);
          expect(stored.status).toBe('paid');

          // Records exactly one payment-received event for the owner (Req 6.3).
          expect(paymentEvents).toHaveLength(1);
          expect(paymentEvents[0]!.user_id).toBe(db.currentUserId);
          expect(db.events).toHaveLength(1);
        } else {
          // No transition: status is unchanged and no event is recorded
          // (Req 6.4 already-paid, Req 6.6 draft, ownership guard for unowned).
          expect(res.status).not.toBe(200);
          expect(stored.status).toBe(status);
          expect(paymentEvents).toHaveLength(0);
          expect(db.events).toHaveLength(0);

          if (!owned) {
            // Unowned invoice: not-authorized, indistinguishable under RLS.
            expect(res.status).toBe(403);
          } else if (status === 'paid') {
            // Already paid: reported as such and left unchanged (Req 6.4).
            expect(res.status).toBe(409);
            const body = (await res.json()) as { error: string; status: string };
            expect(body.error).toMatch(/already marked paid/i);
            expect(body.status).toBe('paid');
          } else {
            // Draft cannot be marked paid (Req 6.6).
            expect(res.status).toBe(409);
            const body = (await res.json()) as { error: string; status: string };
            expect(body.error).toMatch(/draft invoice cannot be marked paid/i);
            expect(body.status).toBe('draft');
          }
        }
      }),
      { numRuns: 100 },
    );
  });
});
