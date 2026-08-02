import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { createInvoicesRouter } from './invoices.js';

// Feature: paynudge, Property 25: Follow-up history contains only sent follow-ups, ordered by delivery time

/**
 * Property-based test for the invoice follow-up history (Requirement 11.2).
 *
 * **Validates: Requirements 11.2** — for any invoice, the follow-up history
 * returned by `GET /invoices/:id/history` is exactly the set of that invoice's
 * "sent" follow-ups, each carrying its escalation tier and delivery timestamp,
 * ordered from earliest delivery timestamp to latest, and is empty when none of
 * the invoice's follow-ups are in "sent" status.
 *
 * The router is mounted on a real Express app and exercised over HTTP, reusing
 * the in-memory fake-Supabase harness pattern from `invoices.test.ts`. The fake
 * simulates Row Level Security by scoping every read to the "current" user id,
 * and supports the two reads the history endpoint performs: the owned-invoice
 * lookup (with embedded client) and the RLS-scoped `follow_ups` read filtered by
 * `invoice_id` + `status` and ordered by `sent_at`.
 *
 * A single server serves every fast-check iteration; the shared in-memory state
 * (`db`) is reset at the start of each generated case so runs are independent.
 */

interface StoredClient {
  id: string;
  user_id: string;
  name: string;
  email: string;
  company: string | null;
}

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
  created_at: string;
  updated_at: string;
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
  value: unknown;
}

/** Mutable, per-iteration in-memory database shared with the fake client. */
interface Db {
  invoices: StoredInvoice[];
  clients: StoredClient[];
  followUps: StoredFollowUp[];
  currentUserId: string;
}

/**
 * Minimal chainable query builder mimicking the subset of the Supabase JS
 * client used by the history endpoint's read paths. Ownership scoping (RLS) is
 * applied by filtering every operation to the current user id (read dynamically
 * from `db`); generic `eq` predicates and a single `order` clause are then
 * applied — enough to serve both the invoice lookup and the follow-up read.
 */
class FakeQuery implements PromiseLike<QueryResult> {
  private columns = '';
  private filters: Filter[] = [];
  private single = false;
  private orderColumn: string | null = null;
  private orderAscending = true;

  constructor(
    private readonly db: Db,
    private readonly table: string,
  ) {}

  select(columns = ''): this {
    this.columns = columns;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ column, value });
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

  private embedsClient(): boolean {
    return this.columns.includes('client:clients');
  }

  private matches(row: Record<string, unknown>): boolean {
    return this.filters.every((f) => row[f.column] === f.value);
  }

  /** Orders rows by the captured column; handles string (ISO timestamp)
   * columns, with nulls sorting last. */
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

  private shapeInvoice(invoice: StoredInvoice): Record<string, unknown> {
    const base: Record<string, unknown> = { ...invoice };
    if (this.embedsClient()) {
      const client =
        this.db.clients.find(
          (c) => c.id === invoice.client_id && c.user_id === this.db.currentUserId,
        ) ?? null;
      base.client = client
        ? { id: client.id, name: client.name, email: client.email, company: client.company }
        : null;
    }
    return base;
  }

  private execute(): QueryResult {
    if (this.table === 'follow_ups') {
      const owned = this.db.followUps.filter((f) => f.user_id === this.db.currentUserId);
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

    // invoices (RLS-scoped to the current user)
    const owned = this.db.invoices.filter((i) => i.user_id === this.db.currentUserId);
    const filtered = owned.filter((i) => this.matches(i as unknown as Record<string, unknown>));
    if (this.single) {
      const found = filtered[0] ?? null;
      return { data: found ? this.shapeInvoice(found) : null, error: null };
    }
    const ordered = this.applyOrder(filtered);
    return { data: ordered.map((i) => this.shapeInvoice(i)), error: null };
  }
}

class FakeSupabase {
  constructor(private readonly db: Db) {}

  from(table: string): FakeQuery {
    return new FakeQuery(this.db, table);
  }
}

// Single shared in-memory database + server for the whole property run.
const db: Db = { invoices: [], clients: [], followUps: [], currentUserId: randomUUID() };
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
  db.clients.length = 0;
  db.followUps.length = 0;
  db.currentUserId = randomUUID();
}

/** The follow-up statuses the schema allows; only "sent" belongs in history. */
const followUpStatusArb = fc.constantFrom(
  'pending_approval',
  'approved',
  'sent',
  'discarded',
);

const tierArb = fc.constantFrom('polite', 'firm', 'final_notice');

/**
 * A generated follow-up spec. `ts` is a unique epoch-millisecond value used to
 * build a distinct delivery timestamp for "sent" follow-ups, so ordering by
 * `sent_at` is unambiguous and the assertion is deterministic.
 */
const followUpSpecArb = fc.record({
  tier: tierArb,
  status: followUpStatusArb,
  ts: fc.integer({ min: 1_600_000_000_000, max: 1_800_000_000_000 }),
});

const scenarioArb = fc.record({
  invoiceStatus: fc.constantFrom('draft', 'sent', 'overdue', 'paid'),
  // Follow-ups belonging to the invoice under test (mixed statuses). Unique on
  // `ts` so every derived delivery timestamp is distinct.
  followUps: fc.uniqueArray(followUpSpecArb, {
    maxLength: 8,
    selector: (f) => f.ts,
  }),
  // Number of "sent" follow-ups on a *different* owned invoice; must be excluded.
  otherInvoiceSent: fc.integer({ min: 0, max: 3 }),
  // Number of "sent" follow-ups owned by a *different* user; must be excluded.
  otherUserSent: fc.integer({ min: 0, max: 3 }),
});

interface HistoryResponse {
  invoice: { invoice_number: number; status: string };
  follow_up_history: Array<{ id: string; tier: string; sent_at: string | null }>;
}

describe('Property 25: Follow-up history contains only sent follow-ups, ordered by delivery time', () => {
  it('returns exactly the invoice\'s sent follow-ups with tier + delivery timestamp, ascending by sent_at, excluding non-sent/other-invoice/other-user follow-ups', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        resetDb();

        // Owned client + owned invoice under test.
        const client: StoredClient = {
          id: randomUUID(),
          user_id: db.currentUserId,
          name: 'History Client',
          email: 'history@example.com',
          company: null,
        };
        db.clients.push(client);

        const now = new Date().toISOString();
        const invoice: StoredInvoice = {
          id: randomUUID(),
          user_id: db.currentUserId,
          client_id: client.id,
          invoice_number: 1,
          amount: 100,
          description: 'History work',
          due_date: '2024-06-01',
          status: scenario.invoiceStatus,
          sent_at: null,
          created_at: now,
          updated_at: now,
        };
        db.invoices.push(invoice);

        // Seed the generated follow-ups for the invoice under test. "sent"
        // follow-ups get a distinct delivery timestamp derived from `ts`;
        // non-sent follow-ups have no delivery timestamp.
        const seeded: StoredFollowUp[] = scenario.followUps.map((spec) => {
          const isSent = spec.status === 'sent';
          return {
            id: randomUUID(),
            user_id: db.currentUserId,
            invoice_id: invoice.id,
            tier: spec.tier,
            content: 'Follow-up content.',
            status: spec.status,
            drafted_at: now,
            sent_at: isSent ? new Date(spec.ts).toISOString() : null,
            created_at: now,
          };
        });
        db.followUps.push(...seeded);

        // A different owned invoice with its own "sent" follow-ups — must not
        // leak into this invoice's history.
        const otherInvoice: StoredInvoice = {
          id: randomUUID(),
          user_id: db.currentUserId,
          client_id: client.id,
          invoice_number: 2,
          amount: 50,
          description: 'Other invoice',
          due_date: '2024-06-01',
          status: 'overdue',
          sent_at: null,
          created_at: now,
          updated_at: now,
        };
        db.invoices.push(otherInvoice);
        for (let i = 0; i < scenario.otherInvoiceSent; i += 1) {
          db.followUps.push({
            id: randomUUID(),
            user_id: db.currentUserId,
            invoice_id: otherInvoice.id,
            tier: 'polite',
            content: 'Other invoice follow-up.',
            status: 'sent',
            drafted_at: now,
            sent_at: new Date(1_500_000_000_000 + i).toISOString(),
            created_at: now,
          });
        }

        // Another user's "sent" follow-ups on the same invoice id — RLS must
        // hide them from the current user.
        const otherUserId = randomUUID();
        for (let i = 0; i < scenario.otherUserSent; i += 1) {
          db.followUps.push({
            id: randomUUID(),
            user_id: otherUserId,
            invoice_id: invoice.id,
            tier: 'firm',
            content: 'Other user follow-up.',
            status: 'sent',
            drafted_at: now,
            sent_at: new Date(1_400_000_000_000 + i).toISOString(),
            created_at: now,
          });
        }

        // Fetch the follow-up history over HTTP.
        const res = await fetch(`${baseUrl}/invoices/${invoice.id}/history`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as HistoryResponse;

        // The invoice's current status is reflected (11.1 context).
        expect(body.invoice.status).toBe(scenario.invoiceStatus);

        // Expected: only the invoice's own "sent" follow-ups, ordered ascending
        // by delivery timestamp.
        const expected = seeded
          .filter((f) => f.status === 'sent')
          .sort((a, b) => String(a.sent_at).localeCompare(String(b.sent_at)));

        // Exactly the sent set, in the correct order (by id).
        expect(body.follow_up_history.map((f) => f.id)).toEqual(expected.map((f) => f.id));

        // Each entry carries the escalation tier and delivery timestamp.
        expect(body.follow_up_history.map((f) => f.tier)).toEqual(expected.map((f) => f.tier));
        expect(body.follow_up_history.map((f) => f.sent_at)).toEqual(
          expected.map((f) => f.sent_at),
        );

        // No non-sent status ever appears (each returned id is a sent follow-up).
        const sentIds = new Set(expected.map((f) => f.id));
        expect(body.follow_up_history.every((f) => sentIds.has(f.id))).toBe(true);

        // Delivery timestamps are strictly non-decreasing (ascending order).
        for (let i = 1; i < body.follow_up_history.length; i += 1) {
          const prev = String(body.follow_up_history[i - 1]!.sent_at);
          const curr = String(body.follow_up_history[i]!.sent_at);
          expect(prev <= curr).toBe(true);
        }

        // Empty history exactly when no follow-up of the invoice is "sent".
        if (expected.length === 0) {
          expect(body.follow_up_history).toEqual([]);
        }
      }),
      { numRuns: 100 },
    );
  });
});
