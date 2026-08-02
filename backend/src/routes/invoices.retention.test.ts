import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createInvoicesRouter } from './invoices.js';

/**
 * Retention across a no-op — Requirement 11.4.
 *
 * Req 11.4: "THE System SHALL retain every sent Invoice record and every sent
 * Follow_Up record for a User until the User deletes the associated Invoice."
 *
 * This suite proves the retention contract end-to-end over HTTP:
 *   1. A sent invoice and its sent follow-up are retrievable via
 *      GET /invoices/:id/history.
 *   2. They remain retrievable — unchanged — across unrelated read operations
 *      (no-ops that do not delete the invoice): listing invoices, fetching the
 *      invoice detail, and re-reading the history. Nothing is expired or purged
 *      merely by the passage of reads.
 *   3. Only an explicit DELETE /invoices/:id removes the invoice, at which point
 *      the invoice and its sent follow-up are gone (history → 404, the follow-up
 *      is no longer retained).
 *
 * The suite is fully self-contained: it defines its own in-memory fake Supabase
 * client that simulates Row Level Security (every query scoped to the current
 * user) and the `on delete cascade` from invoices to follow-ups, so no live
 * database or auth service is required.
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
  send_lock_at: string | null;
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

/**
 * Chainable query builder covering the read/delete paths this suite exercises:
 * select/eq/order/maybeSingle for invoices (with optional client embedding) and
 * follow-ups, and the RLS-scoped delete that cascades to follow-ups. Every
 * operation is scoped to `currentUserId`, mirroring Postgres RLS.
 */
class FakeQuery implements PromiseLike<QueryResult> {
  private columns = '';
  private op: 'select' | 'delete' = 'select';
  private filters: Filter[] = [];
  private single = false;
  private orderColumn: string | null = null;
  private orderAscending = true;

  constructor(
    private readonly table: string,
    private readonly invoices: StoredInvoice[],
    private readonly clients: StoredClient[],
    private readonly events: StoredEvent[],
    private readonly followUps: StoredFollowUp[],
    private readonly currentUserId: string,
  ) {}

  select(columns = ''): this {
    this.columns = columns;
    return this;
  }

  delete(): this {
    this.op = 'delete';
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

  private embedsClient(): boolean {
    return this.columns.includes('client:clients');
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

  private shape(invoice: StoredInvoice): Record<string, unknown> {
    const base: Record<string, unknown> = { ...invoice };
    if (this.embedsClient()) {
      const client =
        this.clients.find(
          (c) => c.id === invoice.client_id && c.user_id === this.currentUserId,
        ) ?? null;
      base.client = client
        ? { id: client.id, name: client.name, email: client.email, company: client.company }
        : null;
    }
    return base;
  }

  private execute(): QueryResult {
    if (this.table === 'follow_ups') {
      const owned = this.followUps.filter((f) => f.user_id === this.currentUserId);
      const filtered = owned.filter((f) => this.matches(f as unknown as Record<string, unknown>));
      const ordered = this.applyOrder(filtered);
      if (this.single) {
        const found = ordered[0] ?? null;
        return { data: found ? { ...found } : null, error: null };
      }
      return { data: ordered.map((f) => ({ ...f })), error: null };
    }

    // invoices — RLS-scoped to the current user.
    const owned = this.invoices.filter((i) => i.user_id === this.currentUserId);

    if (this.op === 'delete') {
      const targets = owned.filter((i) => this.matches(i as unknown as Record<string, unknown>));
      const removedIds = new Set(targets.map((i) => i.id));

      for (const target of targets) {
        const idx = this.invoices.indexOf(target);
        if (idx >= 0) {
          this.invoices.splice(idx, 1);
        }
      }

      // Simulate the `on delete cascade` foreign keys: removing an invoice
      // removes every associated follow-up and activity event from retention.
      for (let i = this.followUps.length - 1; i >= 0; i -= 1) {
        if (removedIds.has(this.followUps[i]!.invoice_id)) {
          this.followUps.splice(i, 1);
        }
      }
      for (let i = this.events.length - 1; i >= 0; i -= 1) {
        const invoiceId = this.events[i]!.invoice_id;
        if (invoiceId != null && removedIds.has(invoiceId)) {
          this.events.splice(i, 1);
        }
      }

      if (this.single) {
        const first = targets[0] ?? null;
        return { data: first ? { id: first.id } : null, error: null };
      }
      return { data: null, error: null };
    }

    // select
    const filtered = owned.filter((i) => this.matches(i as unknown as Record<string, unknown>));
    if (this.single) {
      const found = filtered[0] ?? null;
      return { data: found ? this.shape(found) : null, error: null };
    }
    const ordered = this.applyOrder(filtered);
    return { data: ordered.map((i) => this.shape(i)), error: null };
  }
}

class FakeSupabase {
  constructor(
    private readonly invoices: StoredInvoice[],
    private readonly clients: StoredClient[],
    private readonly events: StoredEvent[],
    private readonly followUps: StoredFollowUp[],
    private readonly currentUserId: string,
  ) {}

  from(table: string): FakeQuery {
    return new FakeQuery(
      table,
      this.invoices,
      this.clients,
      this.events,
      this.followUps,
      this.currentUserId,
    );
  }
}

let invoices: StoredInvoice[];
let clients: StoredClient[];
let events: StoredEvent[];
let followUps: StoredFollowUp[];
let currentUserId: string;
let fakeSupabase: FakeSupabase;
let server: Server;
let baseUrl: string;

function buildApp(): Express {
  const app = express();
  app.use(express.json());

  const authStub = (req: Request, _res: Response, next: NextFunction): void => {
    req.userId = currentUserId;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    req.supabase = fakeSupabase as any;
    next();
  };

  app.use(createInvoicesRouter({ authMiddleware: authStub }));
  return app;
}

beforeEach(async () => {
  invoices = [];
  clients = [];
  events = [];
  followUps = [];
  currentUserId = randomUUID();
  fakeSupabase = new FakeSupabase(invoices, clients, events, followUps, currentUserId);
  const app = buildApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function seedClient(userId: string, overrides: Partial<StoredClient> = {}): StoredClient {
  const row: StoredClient = {
    id: randomUUID(),
    user_id: userId,
    name: 'Seed Client',
    email: 'seed@example.com',
    company: null,
    ...overrides,
  };
  clients.push(row);
  return row;
}

function seedInvoice(userId: string, overrides: Partial<StoredInvoice> = {}): StoredInvoice {
  const now = new Date().toISOString();
  const row: StoredInvoice = {
    id: randomUUID(),
    user_id: userId,
    client_id: randomUUID(),
    invoice_number: 1,
    amount: 100,
    description: 'Seed work',
    due_date: '2024-06-01',
    status: 'draft',
    sent_at: null,
    send_lock_at: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
  invoices.push(row);
  return row;
}

function seedFollowUp(
  userId: string,
  invoiceId: string,
  overrides: Partial<StoredFollowUp> = {},
): StoredFollowUp {
  const now = new Date().toISOString();
  const row: StoredFollowUp = {
    id: randomUUID(),
    user_id: userId,
    invoice_id: invoiceId,
    tier: 'polite',
    content: 'Kindly settle your invoice.',
    status: 'sent',
    drafted_at: now,
    sent_at: now,
    created_at: now,
    ...overrides,
  };
  followUps.push(row);
  return row;
}

interface HistoryBody {
  invoice: { invoice_number: number; status: string };
  follow_up_history: Array<{ id: string; tier: string; sent_at: string | null }>;
}

describe('Retention across a no-op (Req 11.4)', () => {
  it('retains a sent invoice and its sent follow-up across unrelated reads, and removes them only on delete', async () => {
    // Seed a SENT invoice with a SENT follow-up (the records Req 11.4 retains).
    const client = seedClient(currentUserId, { name: 'Ada', email: 'ada@example.com' });
    const invoice = seedInvoice(currentUserId, {
      client_id: client.id,
      invoice_number: 7,
      status: 'sent',
      sent_at: '2024-07-01T00:00:00.000Z',
    });
    const followUp = seedFollowUp(currentUserId, invoice.id, {
      tier: 'polite',
      status: 'sent',
      sent_at: '2024-07-08T00:00:00.000Z',
    });

    // Baseline: history returns the sent invoice and its sent follow-up.
    const before = await fetch(`${baseUrl}/invoices/${invoice.id}/history`);
    expect(before.status).toBe(200);
    const beforeBody = (await before.json()) as HistoryBody;
    expect(beforeBody.invoice.invoice_number).toBe(7);
    expect(beforeBody.invoice.status).toBe('sent');
    expect(beforeBody.follow_up_history.map((f) => f.id)).toEqual([followUp.id]);

    // No-ops: perform unrelated reads that do NOT delete the invoice.
    // Req 11.4 requires retention "until the User deletes the associated Invoice",
    // so none of these reads may expire or purge the records.
    const list = await fetch(`${baseUrl}/invoices`);
    expect(list.status).toBe(200);
    const detail = await fetch(`${baseUrl}/invoices/${invoice.id}`);
    expect(detail.status).toBe(200);
    const reread = await fetch(`${baseUrl}/invoices/${invoice.id}/history`);
    expect(reread.status).toBe(200);

    // After the no-ops the sent invoice and sent follow-up are still retained,
    // unchanged.
    const after = await fetch(`${baseUrl}/invoices/${invoice.id}/history`);
    expect(after.status).toBe(200);
    const afterBody = (await after.json()) as HistoryBody;
    expect(afterBody.invoice.invoice_number).toBe(7);
    expect(afterBody.invoice.status).toBe('sent');
    expect(afterBody.follow_up_history.map((f) => f.id)).toEqual([followUp.id]);

    // The underlying store still holds both records.
    expect(invoices.some((i) => i.id === invoice.id)).toBe(true);
    expect(followUps.some((f) => f.id === followUp.id)).toBe(true);

    // Retention ends only when the User deletes the associated invoice.
    const del = await fetch(`${baseUrl}/invoices/${invoice.id}`, { method: 'DELETE' });
    expect(del.status).toBe(204);

    // Now the invoice history is no longer available and the sent follow-up has
    // been removed from retention (cascade).
    const gone = await fetch(`${baseUrl}/invoices/${invoice.id}/history`);
    expect(gone.status).toBe(404);
    const goneBody = (await gone.json()) as { error: string };
    expect(goneBody.error).toBe('Invoice not available.');

    expect(invoices.some((i) => i.id === invoice.id)).toBe(false);
    expect(followUps.some((f) => f.id === followUp.id)).toBe(false);
  });

  it('retains records independently per invoice: deleting one invoice does not remove another sent invoice and its follow-up', async () => {
    const client = seedClient(currentUserId, { name: 'Grace', email: 'grace@example.com' });
    const keep = seedInvoice(currentUserId, {
      client_id: client.id,
      invoice_number: 1,
      status: 'sent',
      sent_at: '2024-05-01T00:00:00.000Z',
    });
    const keepFollowUp = seedFollowUp(currentUserId, keep.id, {
      tier: 'polite',
      status: 'sent',
      sent_at: '2024-05-08T00:00:00.000Z',
    });
    const remove = seedInvoice(currentUserId, {
      client_id: client.id,
      invoice_number: 2,
      status: 'sent',
      sent_at: '2024-06-01T00:00:00.000Z',
    });
    seedFollowUp(currentUserId, remove.id, { status: 'sent' });

    // Deleting one invoice is a targeted operation, not a no-op for that record,
    // but it must retain every OTHER sent invoice and follow-up (Req 11.4).
    const del = await fetch(`${baseUrl}/invoices/${remove.id}`, { method: 'DELETE' });
    expect(del.status).toBe(204);

    const history = await fetch(`${baseUrl}/invoices/${keep.id}/history`);
    expect(history.status).toBe(200);
    const body = (await history.json()) as HistoryBody;
    expect(body.invoice.invoice_number).toBe(1);
    expect(body.follow_up_history.map((f) => f.id)).toEqual([keepFollowUp.id]);

    expect(invoices.some((i) => i.id === keep.id)).toBe(true);
    expect(followUps.some((f) => f.id === keepFollowUp.id)).toBe(true);
  });
});
