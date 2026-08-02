import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { createInvoicesRouter } from './invoices.js';

// Feature: paynudge, Property 5: Invoice retrieval round-trips stored fields

/**
 * Property-based test for invoice retrieval (Requirement 3.8, 11.1).
 *
 * **Validates: Requirements 3.8, 11.1** — for any created invoice, retrieving
 * it by its owner returns the same amount, description, due date, invoice
 * number, associated client, and current status that were stored.
 *
 * The router is mounted on a real Express app and exercised over HTTP, reusing
 * the in-memory fake-Supabase harness pattern from `invoices.test.ts`. The fake
 * simulates Row Level Security by scoping every query to the "current" user id
 * and stands in for the `create_invoice_with_number` RPC by assigning the next
 * per-user sequential number.
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
  draft_failure_count: number;
  send_lock_at: string | null;
  created_at: string;
  updated_at: string;
}

interface QueryResult {
  data: unknown;
  error: { message?: string; code?: string } | null;
}

/** Mutable, per-iteration in-memory database shared with the fake client. */
interface Db {
  invoices: StoredInvoice[];
  clients: StoredClient[];
  currentUserId: string;
}

/**
 * Minimal chainable query builder mimicking the subset of the Supabase JS
 * client used by the router's read paths. Ownership scoping (RLS) is applied by
 * filtering every operation to the current user id, read dynamically from `db`.
 */
class FakeQuery implements PromiseLike<QueryResult> {
  private columns = '';
  private idFilter: string | null = null;
  private mode: 'list' | 'maybeSingle' = 'list';

  constructor(private readonly db: Db) {}

  select(columns = ''): this {
    this.columns = columns;
    return this;
  }

  eq(column: string, value: string): this {
    if (column === 'id') {
      this.idFilter = value;
    }
    return this;
  }

  order(_column: string, _opts: { ascending: boolean }): this {
    this.mode = 'list';
    return this;
  }

  maybeSingle(): Promise<QueryResult> {
    this.mode = 'maybeSingle';
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

  private shape(invoice: StoredInvoice): Record<string, unknown> {
    const base: Record<string, unknown> = { ...invoice };
    if (this.embedsClient()) {
      // RLS applies to the embedded rows too: only surface a client the current
      // user owns.
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
    const owned = this.db.invoices.filter((i) => i.user_id === this.db.currentUserId);

    if (this.mode === 'list') {
      const sorted = [...owned].sort((a, b) => b.invoice_number - a.invoice_number);
      return { data: sorted.map((i) => this.shape(i)), error: null };
    }

    const found = owned.find((i) => i.id === this.idFilter) ?? null;
    return { data: found ? this.shape(found) : null, error: null };
  }
}

class FakeSupabase {
  constructor(private readonly db: Db) {}

  from(_table: string): FakeQuery {
    return new FakeQuery(this.db);
  }

  // Stands in for the create_invoice_with_number Postgres function: assigns the
  // next per-user sequential number atomically (max + 1 scoped to the user) and
  // persists the submitted amount, description, and due date verbatim.
  async rpc(
    _fn: string,
    params: {
      p_client_id: string;
      p_amount: number;
      p_description: string;
      p_due_date: string;
    },
  ): Promise<QueryResult> {
    const owned = this.db.invoices.filter((i) => i.user_id === this.db.currentUserId);
    const maxNumber = owned.reduce((max, i) => Math.max(max, i.invoice_number), 0);
    const now = new Date().toISOString();
    const row: StoredInvoice = {
      id: randomUUID(),
      user_id: this.db.currentUserId,
      client_id: params.p_client_id,
      invoice_number: maxNumber + 1,
      amount: params.p_amount,
      description: params.p_description,
      due_date: params.p_due_date,
      status: 'draft',
      sent_at: null,
      draft_failure_count: 0,
      send_lock_at: null,
      created_at: now,
      updated_at: now,
    };
    this.db.invoices.push(row);
    return { data: { ...row }, error: null };
  }
}

// Single shared in-memory database + server for the whole property run.
const db: Db = { invoices: [], clients: [], currentUserId: randomUUID() };
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
  db.currentUserId = randomUUID();
}

/** A valid, non-whitespace-only string that survives invoice validation. */
const meaningfulText = fc
  .string({ minLength: 1, maxLength: 200 })
  .filter((s) => s.trim().length > 0 && s.length <= 2000);

/**
 * Valid invoice amount: 0.01 .. 999,999,999.99 with at most 2 decimal places.
 * Generated as an integer number of cents to avoid unrepresentable values.
 */
const amountArb = fc.integer({ min: 1, max: 99_999_999_999 }).map((cents) => cents / 100);

/** A valid ISO calendar date in `YYYY-MM-DD` form. */
const dueDateArb = fc
  .date({ min: new Date('1970-01-01T00:00:00Z'), max: new Date('2100-12-31T00:00:00Z') })
  .map((d) => d.toISOString().slice(0, 10));

/** Every legal invoice status, used to exercise "current stored status" round-trip. */
const statusArb = fc.constantFrom('draft', 'sent', 'overdue', 'paid');

const clientArb = fc.record({
  name: meaningfulText,
  email: fc
    .tuple(
      fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
      fc.constantFrom('example.com', 'test.org', 'mail.co'),
    )
    .map(([local, domain]) => `${local.replace(/\s/g, '')}@${domain}`),
  company: fc.option(meaningfulText, { nil: null }),
});

const caseArb = fc.record({
  client: clientArb,
  amount: amountArb,
  description: meaningfulText,
  dueDate: dueDateArb,
  status: statusArb,
});

interface DetailResponse {
  invoice: {
    amount: number;
    description: string;
    due_date: string;
    invoice_number: number;
    status: string;
    client: { id: string; name: string; email: string; company: string | null } | null;
  };
}

describe('Property 5: Invoice retrieval round-trips stored fields', () => {
  it('returns the same amount, description, due date, number, client, and status that were stored', async () => {
    await fc.assert(
      fc.asyncProperty(caseArb, async (testCase) => {
        resetDb();

        // Seed an owned client to associate with the invoice.
        const clientRow: StoredClient = {
          id: randomUUID(),
          user_id: db.currentUserId,
          name: testCase.client.name,
          email: testCase.client.email,
          company: testCase.client.company,
        };
        db.clients.push(clientRow);

        // Create the invoice through the API.
        const createRes = await fetch(`${baseUrl}/invoices`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            clientId: clientRow.id,
            amount: testCase.amount,
            description: testCase.description,
            dueDate: testCase.dueDate,
          }),
        });
        expect(createRes.status).toBe(201);
        const created = (await createRes.json()) as { invoice: StoredInvoice };

        // Simulate the invoice reaching an arbitrary current status in storage,
        // so retrieval must reflect the *stored current* status (Req 3.8, 11.1).
        const stored = db.invoices.find((i) => i.id === created.invoice.id);
        expect(stored).toBeDefined();
        stored!.status = testCase.status;

        // Retrieve the invoice by its owner.
        const getRes = await fetch(`${baseUrl}/invoices/${created.invoice.id}`);
        expect(getRes.status).toBe(200);
        const { invoice } = (await getRes.json()) as DetailResponse;

        // Every stored field round-trips unchanged.
        expect(invoice.amount).toBe(testCase.amount);
        expect(invoice.description).toBe(testCase.description);
        expect(invoice.due_date).toBe(testCase.dueDate);
        expect(invoice.invoice_number).toBe(created.invoice.invoice_number);
        expect(invoice.status).toBe(testCase.status);

        // The associated client is returned in full.
        expect(invoice.client).not.toBeNull();
        expect(invoice.client?.id).toBe(clientRow.id);
        expect(invoice.client?.name).toBe(clientRow.name);
        expect(invoice.client?.email).toBe(clientRow.email);
        expect(invoice.client?.company).toBe(clientRow.company);
      }),
      { numRuns: 100 },
    );
  });
});
