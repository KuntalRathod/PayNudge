import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { createClientsRouter } from './clients.js';

// Feature: paynudge, Property 26: Client history returns all owned invoices for that client with statuses

/**
 * Property-based test for the client-history endpoint (Requirement 11).
 *
 * **Validates: Requirements 11.3** — for any client the caller owns,
 * `GET /clients/:id/history` returns *every* invoice associated with that
 * client together with each invoice's *current* status, and nothing else.
 * Invoices belonging to the caller's other clients, and invoices owned by
 * other users entirely, must be excluded from the result.
 *
 * The router is mounted on a real Express app and exercised over HTTP, reusing
 * the in-memory fake-Supabase harness pattern from `clients.test.ts`. The fake
 * simulates Row Level Security by scoping every read to the "current" user id,
 * so rows owned by other users are invisible — exactly as Postgres RLS
 * enforces. A single server serves every fast-check iteration; the shared
 * in-memory state is reset at the start of each generated case so runs are
 * independent.
 */

interface StoredClient {
  id: string;
  user_id: string;
  name: string;
  email: string;
  company: string | null;
  created_at: string;
  updated_at: string;
}

interface StoredInvoice {
  id: string;
  user_id: string;
  client_id: string;
  invoice_number: number;
  amount: string;
  description: string;
  due_date: string;
  status: string;
  created_at: string;
}

interface QueryResult {
  data: unknown;
  error: { message: string } | null;
}

/** Mutable, per-iteration in-memory database shared with the fake client. */
interface Db {
  clients: StoredClient[];
  invoices: StoredInvoice[];
  currentUserId: string;
}

/**
 * Chainable query builder mimicking the subset of the Supabase JS client the
 * history handler uses: the ownership read on `clients`
 * (`select/eq('id')/maybeSingle`) and the invoice read on `invoices`
 * (`select/eq('client_id')/order`). Both are RLS-scoped to the current user,
 * so an unowned client or invoice is never matched.
 */
class FakeQuery implements PromiseLike<QueryResult> {
  private idFilter: string | null = null;
  private clientIdFilter: string | null = null;

  constructor(
    private readonly table: string,
    private readonly db: Db,
  ) {}

  select(_columns?: string): this {
    return this;
  }

  eq(column: string, value: string): this {
    if (column === 'id') {
      this.idFilter = value;
    } else if (column === 'client_id') {
      this.clientIdFilter = value;
    }
    return this;
  }

  order(_column: string, _opts: { ascending: boolean }): this {
    return this;
  }

  maybeSingle(): Promise<QueryResult> {
    return Promise.resolve(this.execute());
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private execute(): QueryResult {
    if (this.table === 'invoices') {
      const owned = this.db.invoices.filter(
        (inv) =>
          inv.user_id === this.db.currentUserId &&
          (this.clientIdFilter === null || inv.client_id === this.clientIdFilter),
      );
      const sorted = [...owned].sort((a, b) => b.invoice_number - a.invoice_number);
      return { data: sorted.map((inv) => ({ ...inv })), error: null };
    }

    // clients: RLS-scoped ownership read.
    const owned = this.db.clients.filter((c) => c.user_id === this.db.currentUserId);
    const found = owned.find((c) => c.id === this.idFilter) ?? null;
    return { data: found ? { ...found } : null, error: null };
  }
}

class FakeSupabase {
  constructor(private readonly db: Db) {}

  from(table: string): FakeQuery {
    return new FakeQuery(table, this.db);
  }
}

// Single shared in-memory database + server for the whole property run.
const db: Db = { clients: [], invoices: [], currentUserId: randomUUID() };
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

  app.use(createClientsRouter({ authMiddleware: authStub }));
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
  db.clients.length = 0;
  db.invoices.length = 0;
  db.currentUserId = randomUUID();
}

/** Every legal invoice status the history endpoint may surface. */
const statusArb = fc.constantFrom('draft', 'sent', 'overdue', 'paid');

let nextInvoiceNumber = 1;

function addClient(userId: string): StoredClient {
  const now = new Date().toISOString();
  const row: StoredClient = {
    id: randomUUID(),
    user_id: userId,
    name: 'Client',
    email: 'client@example.com',
    company: null,
    created_at: now,
    updated_at: now,
  };
  db.clients.push(row);
  return row;
}

function addInvoice(userId: string, clientId: string, status: string): StoredInvoice {
  const now = new Date().toISOString();
  const row: StoredInvoice = {
    id: randomUUID(),
    user_id: userId,
    client_id: clientId,
    invoice_number: nextInvoiceNumber++,
    amount: '100.00',
    description: 'Work',
    due_date: '2024-06-01',
    status,
    created_at: now,
  };
  db.invoices.push(row);
  return row;
}

/**
 * A generated scenario:
 *  - `targetStatuses`: statuses of the invoices belonging to the owned target
 *     client (may be empty).
 *  - `otherClientStatuses`: statuses of invoices on a *second* client the same
 *     user owns — must be excluded from the target's history.
 *  - `foreignStatuses`: statuses of invoices owned by a *different* user — must
 *     be excluded (RLS).
 */
const scenarioArb = fc.record({
  targetStatuses: fc.array(statusArb, { maxLength: 8 }),
  otherClientStatuses: fc.array(statusArb, { maxLength: 5 }),
  foreignStatuses: fc.array(statusArb, { maxLength: 5 }),
});

describe('Property 26: Client history returns all owned invoices for that client with statuses', () => {
  it('returns exactly the owned client invoices, each with its current status, excluding others', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        resetDb();

        // The owned target client and its invoices (the expected result set).
        const target = addClient(db.currentUserId);
        const expected = new Map<string, string>();
        for (const status of scenario.targetStatuses) {
          const inv = addInvoice(db.currentUserId, target.id, status);
          expected.set(inv.id, status);
        }

        // A second client owned by the same user — its invoices must NOT leak.
        const otherClient = addClient(db.currentUserId);
        for (const status of scenario.otherClientStatuses) {
          addInvoice(db.currentUserId, otherClient.id, status);
        }

        // A different user owns a client (reusing the target id is impossible
        // since ids are unique) with invoices — RLS must hide these entirely.
        const foreignUser = randomUUID();
        const foreignClient = addClient(foreignUser);
        for (const status of scenario.foreignStatuses) {
          addInvoice(foreignUser, foreignClient.id, status);
        }

        const res = await fetch(`${baseUrl}/clients/${target.id}/history`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as { invoices: StoredInvoice[] };

        // Every returned invoice belongs to the target client (nothing leaks).
        expect(body.invoices.every((inv) => inv.client_id === target.id)).toBe(true);

        // The returned id set is exactly the target client's invoice id set —
        // all owned invoices are present, no extras (Req 11.3).
        expect(new Set(body.invoices.map((inv) => inv.id))).toEqual(new Set(expected.keys()));
        expect(body.invoices).toHaveLength(expected.size);

        // Each returned invoice carries its correct current status (Req 11.3).
        for (const inv of body.invoices) {
          expect(inv.status).toBe(expected.get(inv.id));
        }
      }),
      { numRuns: 100 },
    );
  });
});
