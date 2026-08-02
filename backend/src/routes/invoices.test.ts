import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { EmailDeliveryResult, EmailMessage } from '../lib/emailService.js';
import { createInvoicesRouter } from './invoices.js';

/**
 * Integration tests for the Invoices API router (Requirement 3: creation and
 * retrieval).
 *
 * The router is mounted on a real Express app and exercised over HTTP. The
 * Supabase dependency is replaced with an in-memory fake that simulates Row
 * Level Security: every query is implicitly scoped to the "current" user id
 * (the one the auth stub attaches), so rows owned by other users are invisible
 * to reads — exactly as Postgres RLS would enforce.
 *
 * The fake also stands in for the `create_invoice_with_number` RPC by computing
 * `max(invoice_number) + 1` for the current user, mirroring the atomic
 * per-user numbering the real Postgres function performs.
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

interface StoredProfile {
  id: string;
  business_name: string;
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
 * Chainable query builder mimicking the subset of the Supabase JS client used
 * by the router. It supports the read paths (select/eq/order/maybeSingle), the
 * conditional-update paths used by the guarded send endpoint
 * (update/eq/is/select/maybeSingle, and update/eq awaited directly), and
 * activity-event inserts (insert awaited directly).
 *
 * Ownership scoping (RLS) is applied by filtering every invoice operation to
 * `currentUserId`; a conditional update therefore never touches another user's
 * row, exactly as Postgres RLS would enforce.
 */
class FakeQuery implements PromiseLike<QueryResult> {
  private columns = '';
  private op: 'select' | 'update' | 'insert' | 'delete' = 'select';
  private updateValues: Record<string, unknown> = {};
  private insertValues: Record<string, unknown> = {};
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
    private readonly profiles: StoredProfile[],
    private readonly currentUserId: string,
  ) {}

  select(columns = ''): this {
    this.columns = columns;
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

  /** Orders rows by the captured order column, if any. Handles numeric and
   * string (e.g. ISO timestamp) columns; nulls sort last. */
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
      // RLS applies to the embedded rows too: only surface a client the current
      // user owns.
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
    if (this.op === 'insert') {
      // Only activity_events inserts flow through this path in these tests.
      const nextId = this.events.reduce((max, e) => Math.max(max, e.id), 0) + 1;
      this.events.push({
        id: nextId,
        user_id: String(this.insertValues.user_id),
        invoice_id: (this.insertValues.invoice_id as string | null) ?? null,
        type: String(this.insertValues.type),
      });
      return { data: null, error: null };
    }

    // The profiles table supports the RLS-scoped `business_name` read used to
    // resolve the sender name for invoice PDFs/emails.
    if (this.table === 'profiles') {
      const owned = this.profiles.filter((p) => p.id === this.currentUserId);
      const filtered = owned.filter((p) => this.matches(p as unknown as Record<string, unknown>));
      if (this.single) {
        const found = filtered[0] ?? null;
        return { data: found ? { ...found } : null, error: null };
      }
      return { data: filtered.map((p) => ({ ...p })), error: null };
    }

    // The follow_ups table supports RLS-scoped reads (invoice-history endpoint)
    // and RLS-scoped conditional updates (mark-paid discards any pending-approval
    // follow-up). Both are scoped to the current user, then filtered by the query
    // predicates (invoice_id + status).
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

      const filtered = owned.filter((f) => this.matches(f as unknown as Record<string, unknown>));
      const ordered = this.applyOrder(filtered);
      if (this.single) {
        const found = ordered[0] ?? null;
        return { data: found ? { ...found } : null, error: null };
      }
      return { data: ordered.map((f) => ({ ...f })), error: null };
    }

    // Invoices are RLS-scoped to the current user for both reads and updates.
    const owned = this.invoices.filter((i) => i.user_id === this.currentUserId);

    if (this.op === 'delete') {
      // RLS-scoped delete: only the current user's matching rows are removed.
      const targets = owned.filter((i) => this.matches(i as unknown as Record<string, unknown>));
      const removedIds = new Set(targets.map((i) => i.id));

      // Remove the invoice rows from the shared store.
      for (const target of targets) {
        const idx = this.invoices.indexOf(target);
        if (idx >= 0) {
          this.invoices.splice(idx, 1);
        }
      }

      // Simulate the `on delete cascade` foreign keys: removing an invoice row
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

    if (this.op === 'update') {
      const targets = owned.filter((i) => this.matches(i as unknown as Record<string, unknown>));
      for (const target of targets) {
        Object.assign(target, this.updateValues, {
          updated_at: new Date().toISOString(),
        });
      }
      if (this.single) {
        const first = targets[0] ?? null;
        return { data: first ? this.shape(first) : null, error: null };
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
  /** When true, every numbering RPC returns a unique-violation to force retries. */
  forceConflict = false;

  constructor(
    private readonly invoices: StoredInvoice[],
    private readonly clients: StoredClient[],
    private readonly events: StoredEvent[],
    private readonly followUps: StoredFollowUp[],
    private readonly profiles: StoredProfile[],
    private readonly currentUserId: string,
  ) {}

  from(table: string): FakeQuery {
    return new FakeQuery(
      table,
      this.invoices,
      this.clients,
      this.events,
      this.followUps,
      this.profiles,
      this.currentUserId,
    );
  }

  // Stands in for the create_invoice_with_number Postgres function: assigns the
  // next per-user sequential number atomically (max + 1 scoped to the user).
  async rpc(
    _fn: string,
    params: {
      p_client_id: string;
      p_amount: number;
      p_description: string;
      p_due_date: string;
    },
  ): Promise<QueryResult> {
    if (this.forceConflict) {
      return { data: null, error: { code: '23505' } };
    }

    const owned = this.invoices.filter((i) => i.user_id === this.currentUserId);
    const maxNumber = owned.reduce((max, i) => Math.max(max, i.invoice_number), 0);
    const now = new Date().toISOString();
    const row: StoredInvoice = {
      id: randomUUID(),
      user_id: this.currentUserId,
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
    this.invoices.push(row);
    return { data: { ...row }, error: null };
  }
}

/**
 * A recorded outbound email plus the injectable outcome the fake Email_Service
 * returns for the next send. `outcome` lets a test drive the success,
 * delivery-error, and timeout branches without any network call.
 */
interface FakeEmailService {
  sent: EmailMessage[];
  outcome: EmailDeliveryResult;
  sendEmail(message: EmailMessage): Promise<EmailDeliveryResult>;
}

function createFakeEmailService(): FakeEmailService {
  return {
    sent: [],
    outcome: { ok: true, id: 'email-1' },
    async sendEmail(message: EmailMessage): Promise<EmailDeliveryResult> {
      this.sent.push(message);
      return this.outcome;
    },
  };
}

// Shared in-memory database and the "logged in" user for a given test run.
let invoices: StoredInvoice[];
let clients: StoredClient[];
let events: StoredEvent[];
let followUps: StoredFollowUp[];
let profiles: StoredProfile[];
let currentUserId: string;
let fakeSupabase: FakeSupabase;
let fakeEmail: FakeEmailService;
let server: Server;
let baseUrl: string;

function buildApp(): Express {
  const app = express();
  app.use(express.json());

  // Auth stub: attaches the current user id and an RLS-scoped fake client,
  // standing in for the real `requireAuth` middleware.
  const authStub = (req: Request, _res: Response, next: NextFunction): void => {
    req.userId = currentUserId;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    req.supabase = fakeSupabase as any;
    next();
  };

  app.use(
    createInvoicesRouter({
      authMiddleware: authStub,
      emailService: fakeEmail,
      fromEmail: 'billing@example.com',
    }),
  );
  return app;
}

beforeEach(async () => {
  invoices = [];
  clients = [];
  events = [];
  followUps = [];
  profiles = [];
  currentUserId = randomUUID();
  fakeSupabase = new FakeSupabase(invoices, clients, events, followUps, profiles, currentUserId);
  fakeEmail = createFakeEmailService();
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
    draft_failure_count: 0,
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

function seedProfile(userId: string, businessName: string): StoredProfile {
  const row: StoredProfile = { id: userId, business_name: businessName };
  profiles.push(row);
  return row;
}

function validBody(clientId: string): Record<string, unknown> {
  return {
    clientId,
    amount: 250.75,
    description: 'Design work for landing page',
    dueDate: '2024-07-15',
  };
}

describe('POST /invoices', () => {
  it('creates a draft invoice numbered 1 for the user first invoice (3.1, 3.2)', async () => {
    const client = seedClient(currentUserId);
    const res = await fetch(`${baseUrl}/invoices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody(client.id)),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { invoice: StoredInvoice };
    expect(body.invoice.status).toBe('draft');
    expect(body.invoice.invoice_number).toBe(1);
    expect(body.invoice.amount).toBe(250.75);
    expect(body.invoice.description).toBe('Design work for landing page');
    expect(body.invoice.due_date).toBe('2024-07-15');
    expect(body.invoice.user_id).toBe(currentUserId);
    expect(invoices).toHaveLength(1);
  });

  it('assigns the next sequential number for subsequent invoices (3.3)', async () => {
    const client = seedClient(currentUserId);
    seedInvoice(currentUserId, { invoice_number: 1 });
    seedInvoice(currentUserId, { invoice_number: 2 });

    const res = await fetch(`${baseUrl}/invoices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody(client.id)),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { invoice: StoredInvoice };
    expect(body.invoice.invoice_number).toBe(3);
  });

  it('rejects an invalid amount with 400 and creates no invoice (3.5)', async () => {
    const client = seedClient(currentUserId);
    const res = await fetch(`${baseUrl}/invoices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...validBody(client.id), amount: 0 }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { field: string };
    expect(body.field).toBe('amount');
    expect(invoices).toHaveLength(0);
  });

  it('rejects a missing client with 400 and creates no invoice (3.6)', async () => {
    const res = await fetch(`${baseUrl}/invoices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ amount: 100, description: 'Work', dueDate: '2024-07-15' }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { field: string };
    expect(body.field).toBe('clientId');
    expect(invoices).toHaveLength(0);
  });

  it('rejects an invalid due date with 400 (3.7)', async () => {
    const client = seedClient(currentUserId);
    const res = await fetch(`${baseUrl}/invoices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...validBody(client.id), dueDate: '2024-02-30' }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { field: string };
    expect(body.field).toBe('dueDate');
    expect(invoices).toHaveLength(0);
  });

  it('returns 503 with a Retry-After hint when numbering retries are exhausted (3.4)', async () => {
    const client = seedClient(currentUserId);
    fakeSupabase.forceConflict = true;

    const res = await fetch(`${baseUrl}/invoices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(validBody(client.id)),
    });

    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).not.toBeNull();
    const body = (await res.json()) as { retryAfterSeconds: number };
    expect(body.retryAfterSeconds).toBeGreaterThan(0);
    expect(invoices).toHaveLength(0);
  });
});

describe('GET /invoices', () => {
  it('returns an empty list when the user owns no invoices (3.8)', async () => {
    const res = await fetch(`${baseUrl}/invoices`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { invoices: StoredInvoice[] };
    expect(body.invoices).toEqual([]);
  });

  it('returns only invoices owned by the requesting user (3.8)', async () => {
    seedInvoice(currentUserId, { invoice_number: 1 });
    seedInvoice(currentUserId, { invoice_number: 2 });
    seedInvoice(randomUUID(), { invoice_number: 1 });

    const res = await fetch(`${baseUrl}/invoices`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { invoices: StoredInvoice[] };
    expect(body.invoices).toHaveLength(2);
    expect(body.invoices.every((i) => i.user_id === currentUserId)).toBe(true);
    // Newest (highest number) first.
    expect(body.invoices[0]!.invoice_number).toBe(2);
    expect(body.invoices[1]!.invoice_number).toBe(1);
  });
});

describe('GET /invoices/:id', () => {
  it('returns an owned invoice with all required fields and associated client (3.8)', async () => {
    const client = seedClient(currentUserId, { name: 'Ada', email: 'ada@example.com' });
    const seeded = seedInvoice(currentUserId, {
      client_id: client.id,
      invoice_number: 5,
      amount: 400.5,
      description: 'API build',
      due_date: '2024-08-01',
      status: 'sent',
    });

    const res = await fetch(`${baseUrl}/invoices/${seeded.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      invoice: {
        amount: number;
        description: string;
        due_date: string;
        invoice_number: number;
        status: string;
        client: { id: string; name: string } | null;
      };
    };
    expect(body.invoice.amount).toBe(400.5);
    expect(body.invoice.description).toBe('API build');
    expect(body.invoice.due_date).toBe('2024-08-01');
    expect(body.invoice.invoice_number).toBe(5);
    expect(body.invoice.status).toBe('sent');
    expect(body.invoice.client?.id).toBe(client.id);
    expect(body.invoice.client?.name).toBe('Ada');
  });

  it('returns 404 not-available for an unowned invoice (3.9)', async () => {
    const seeded = seedInvoice(randomUUID(), { invoice_number: 1 });
    const res = await fetch(`${baseUrl}/invoices/${seeded.id}`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Invoice not available.');
  });

  it('returns 404 not-available for a nonexistent invoice (3.9)', async () => {
    const res = await fetch(`${baseUrl}/invoices/${randomUUID()}`);
    expect(res.status).toBe(404);
  });
});

describe('GET /invoices/:id/pdf', () => {
  it('streams a PDF for an owned invoice with the correct content-type and filename', async () => {
    seedProfile(currentUserId, 'Ada Co');
    const client = seedClient(currentUserId, { name: 'Ada', email: 'ada@example.com' });
    const seeded = seedInvoice(currentUserId, {
      client_id: client.id,
      invoice_number: 7,
      amount: 199.99,
      description: 'Consulting',
      due_date: '2024-09-01',
      status: 'sent',
    });

    const res = await fetch(`${baseUrl}/invoices/${seeded.id}/pdf`);

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="invoice-7.pdf"',
    );

    const buffer = Buffer.from(await res.arrayBuffer());
    expect(buffer.length).toBeGreaterThan(0);
    expect(buffer.toString('latin1', 0, 5)).toBe('%PDF-');
  });

  it('returns 404 not-available for an unowned invoice (ownership check)', async () => {
    const seeded = seedInvoice(randomUUID(), { invoice_number: 1 });
    const res = await fetch(`${baseUrl}/invoices/${seeded.id}/pdf`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Invoice not available.');
  });

  it('returns 404 not-available for a nonexistent invoice', async () => {
    const res = await fetch(`${baseUrl}/invoices/${randomUUID()}/pdf`);
    expect(res.status).toBe(404);
  });
});

describe('GET /invoices/:id/history', () => {
  interface HistoryBody {
    invoice: {
      amount: number;
      description: string;
      due_date: string;
      invoice_number: number;
      status: string;
      client: { id: string; name: string } | null;
    };
    follow_up_history: Array<{ id: string; tier: string; sent_at: string | null }>;
  }

  it('returns the invoice details, current status, and sent follow-ups ordered earliest→latest (11.1, 11.2)', async () => {
    const client = seedClient(currentUserId, { name: 'Grace', email: 'grace@example.com' });
    const invoice = seedInvoice(currentUserId, {
      client_id: client.id,
      invoice_number: 9,
      amount: 500.25,
      description: 'Compiler design',
      due_date: '2024-10-01',
      status: 'overdue',
    });

    // Seed sent follow-ups out of chronological order to prove the endpoint
    // orders by delivery timestamp earliest→latest.
    const firm = seedFollowUp(currentUserId, invoice.id, {
      tier: 'firm',
      sent_at: '2024-10-15T00:00:00.000Z',
    });
    const polite = seedFollowUp(currentUserId, invoice.id, {
      tier: 'polite',
      sent_at: '2024-10-08T00:00:00.000Z',
    });
    const finalNotice = seedFollowUp(currentUserId, invoice.id, {
      tier: 'final_notice',
      sent_at: '2024-10-22T00:00:00.000Z',
    });

    const res = await fetch(`${baseUrl}/invoices/${invoice.id}/history`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as HistoryBody;

    // Invoice details + current status + associated client (11.1).
    expect(body.invoice.amount).toBe(500.25);
    expect(body.invoice.description).toBe('Compiler design');
    expect(body.invoice.due_date).toBe('2024-10-01');
    expect(body.invoice.invoice_number).toBe(9);
    expect(body.invoice.status).toBe('overdue');
    expect(body.invoice.client?.id).toBe(client.id);
    expect(body.invoice.client?.name).toBe('Grace');

    // Follow-up history: only sent follow-ups, ordered earliest→latest by
    // sent_at, each with its tier and delivery timestamp (11.2).
    expect(body.follow_up_history.map((f) => f.id)).toEqual([
      polite.id,
      firm.id,
      finalNotice.id,
    ]);
    expect(body.follow_up_history.map((f) => f.tier)).toEqual([
      'polite',
      'firm',
      'final_notice',
    ]);
    expect(body.follow_up_history[0]!.sent_at).toBe('2024-10-08T00:00:00.000Z');
    expect(body.follow_up_history[2]!.sent_at).toBe('2024-10-22T00:00:00.000Z');
  });

  it('excludes non-sent follow-ups from the history (11.2)', async () => {
    const invoice = seedInvoice(currentUserId, { invoice_number: 3, status: 'overdue' });
    const sent = seedFollowUp(currentUserId, invoice.id, {
      tier: 'polite',
      status: 'sent',
      sent_at: '2024-05-01T00:00:00.000Z',
    });
    // These must be filtered out: not in "sent" status.
    seedFollowUp(currentUserId, invoice.id, {
      tier: 'firm',
      status: 'pending_approval',
      sent_at: null,
    });
    seedFollowUp(currentUserId, invoice.id, {
      tier: 'firm',
      status: 'discarded',
      sent_at: null,
    });

    const res = await fetch(`${baseUrl}/invoices/${invoice.id}/history`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as HistoryBody;
    expect(body.follow_up_history.map((f) => f.id)).toEqual([sent.id]);
  });

  it('returns an empty follow-up history when the invoice has no sent follow-ups (11.2)', async () => {
    const invoice = seedInvoice(currentUserId, { invoice_number: 4, status: 'sent' });
    // A pending follow-up exists but must not appear in the history.
    seedFollowUp(currentUserId, invoice.id, { status: 'pending_approval', sent_at: null });

    const res = await fetch(`${baseUrl}/invoices/${invoice.id}/history`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as HistoryBody;
    expect(body.follow_up_history).toEqual([]);
  });

  it('returns 404 not-available for an unowned invoice, disclosing no details or history (11.5)', async () => {
    const otherUser = randomUUID();
    const invoice = seedInvoice(otherUser, { invoice_number: 1 });
    // The other user's invoice even has a sent follow-up; none must leak.
    seedFollowUp(otherUser, invoice.id, { status: 'sent' });

    const res = await fetch(`${baseUrl}/invoices/${invoice.id}/history`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; invoice?: unknown; follow_up_history?: unknown };
    expect(body.error).toBe('Invoice not available.');
    expect(body.invoice).toBeUndefined();
    expect(body.follow_up_history).toBeUndefined();
  });

  it('returns 404 not-available for a nonexistent invoice (11.5)', async () => {
    const res = await fetch(`${baseUrl}/invoices/${randomUUID()}/history`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Invoice not available.');
  });
});

describe('POST /invoices/:id/send', () => {
  it('sends a draft invoice: delivers the email, sets status "sent", stamps sent_at, releases the lock, and records one invoice-sent event (4.1, 4.3, 4.9)', async () => {
    const client = seedClient(currentUserId, { name: 'Ada Lovelace', email: 'ada@example.com' });
    const invoice = seedInvoice(currentUserId, {
      client_id: client.id,
      invoice_number: 7,
      amount: 1234.5,
      description: 'Analytical engine consulting',
      due_date: '2024-09-01',
      status: 'draft',
    });

    const res = await fetch(`${baseUrl}/invoices/${invoice.id}/send`, { method: 'POST' });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { invoice: { status: string; sent_at: string | null } };
    expect(body.invoice.status).toBe('sent');
    expect(body.invoice.sent_at).not.toBeNull();

    // Persisted invoice transitioned and the lock was released.
    const stored = invoices.find((i) => i.id === invoice.id)!;
    expect(stored.status).toBe('sent');
    expect(stored.sent_at).not.toBeNull();
    expect(stored.send_lock_at).toBeNull();

    // Exactly one invoice-sent event recorded for the owner.
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('invoice_sent');
    expect(events[0]!.invoice_id).toBe(invoice.id);
    expect(events[0]!.user_id).toBe(currentUserId);

    // Email delivered once with all required content (4.2).
    expect(fakeEmail.sent).toHaveLength(1);
    const sent = fakeEmail.sent[0]!;
    expect(sent.from).toBe('billing@example.com');
    expect(sent.to).toBe('ada@example.com');
    const combined = `${sent.subject}\n${sent.text ?? ''}\n${sent.html ?? ''}`;
    expect(combined).toContain('Ada Lovelace');
    expect(combined).toContain('7');
    expect(combined).toContain('Analytical engine consulting');
  });

  it('retains "draft" and returns a delivery-failure message on a delivery error, releasing the lock and recording no event (4.4)', async () => {
    const client = seedClient(currentUserId, { email: 'client@example.com' });
    const invoice = seedInvoice(currentUserId, { client_id: client.id, status: 'draft' });
    fakeEmail.outcome = { ok: false, reason: 'delivery_error', message: 'Resend rejected' };

    const res = await fetch(`${baseUrl}/invoices/${invoice.id}/send`, { method: 'POST' });

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; reason: string };
    expect(body.reason).toBe('delivery_error');
    expect(body.error).toMatch(/could not be delivered/i);

    const stored = invoices.find((i) => i.id === invoice.id)!;
    expect(stored.status).toBe('draft');
    expect(stored.send_lock_at).toBeNull();
    expect(events).toHaveLength(0);
  });

  it('retains "draft" and returns a delivery-failure message on a timeout, releasing the lock (4.5)', async () => {
    const client = seedClient(currentUserId, { email: 'client@example.com' });
    const invoice = seedInvoice(currentUserId, { client_id: client.id, status: 'draft' });
    fakeEmail.outcome = { ok: false, reason: 'timeout', message: 'no confirmation in 30s' };

    const res = await fetch(`${baseUrl}/invoices/${invoice.id}/send`, { method: 'POST' });

    expect(res.status).toBe(502);
    const body = (await res.json()) as { reason: string };
    expect(body.reason).toBe('timeout');

    const stored = invoices.find((i) => i.id === invoice.id)!;
    expect(stored.status).toBe('draft');
    expect(stored.send_lock_at).toBeNull();
    expect(fakeEmail.sent).toHaveLength(1);
    expect(events).toHaveLength(0);
  });

  it('rejects a non-draft invoice with 409 and reports the current status, delivering no email (4.6)', async () => {
    const client = seedClient(currentUserId, { email: 'client@example.com' });
    const invoice = seedInvoice(currentUserId, { client_id: client.id, status: 'sent' });

    const res = await fetch(`${baseUrl}/invoices/${invoice.id}/send`, { method: 'POST' });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { status: string; error: string };
    expect(body.status).toBe('sent');
    expect(body.error).toContain('sent');
    expect(fakeEmail.sent).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it('rejects sending an unowned invoice with 403 not-authorized, delivering no email (4.7)', async () => {
    const otherUser = randomUUID();
    const client = seedClient(otherUser, { email: 'client@example.com' });
    const invoice = seedInvoice(otherUser, { client_id: client.id, status: 'draft' });

    const res = await fetch(`${baseUrl}/invoices/${invoice.id}/send`, { method: 'POST' });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/not authorized/i);
    expect(fakeEmail.sent).toHaveLength(0);
    // The other user's invoice is untouched.
    const stored = invoices.find((i) => i.id === invoice.id)!;
    expect(stored.status).toBe('draft');
    expect(stored.send_lock_at).toBeNull();
  });

  it('rejects a concurrent double-send: a second send while the lock is held is rejected with 409 and no second email (4.8)', async () => {
    const client = seedClient(currentUserId, { email: 'client@example.com' });
    // Simulate an in-progress send: the invoice is a draft with the lock held.
    const invoice = seedInvoice(currentUserId, {
      client_id: client.id,
      status: 'draft',
      send_lock_at: new Date().toISOString(),
    });

    const res = await fetch(`${baseUrl}/invoices/${invoice.id}/send`, { method: 'POST' });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/in progress/i);
    expect(fakeEmail.sent).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it('delivers at most one email across concurrent send attempts on the same draft (4.8)', async () => {
    const client = seedClient(currentUserId, { email: 'client@example.com' });
    const invoice = seedInvoice(currentUserId, { client_id: client.id, status: 'draft' });

    // Fire several sends concurrently; the atomic claim must let only one win.
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        fetch(`${baseUrl}/invoices/${invoice.id}/send`, { method: 'POST' }),
      ),
    );

    const okCount = responses.filter((r) => r.status === 200).length;
    expect(okCount).toBe(1);
    expect(fakeEmail.sent).toHaveLength(1);
    expect(events).toHaveLength(1);

    const stored = invoices.find((i) => i.id === invoice.id)!;
    expect(stored.status).toBe('sent');
    expect(stored.send_lock_at).toBeNull();
  });
});

describe('POST /invoices/:id/pay', () => {
  it('marks a "sent" invoice paid, records exactly one payment-received event, and confirms (6.1, 6.3)', async () => {
    const invoice = seedInvoice(currentUserId, { status: 'sent' });

    const res = await fetch(`${baseUrl}/invoices/${invoice.id}/pay`, { method: 'POST' });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { invoice: { status: string }; message: string };
    expect(body.invoice.status).toBe('paid');
    expect(body.message).toMatch(/marked paid/i);

    // Persisted transition.
    const stored = invoices.find((i) => i.id === invoice.id)!;
    expect(stored.status).toBe('paid');

    // Exactly one payment-received event for the owner (6.3).
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('payment_received');
    expect(events[0]!.invoice_id).toBe(invoice.id);
    expect(events[0]!.user_id).toBe(currentUserId);
  });

  it('marks an "overdue" invoice paid and records one payment-received event (6.1, 6.3)', async () => {
    const invoice = seedInvoice(currentUserId, { status: 'overdue' });

    const res = await fetch(`${baseUrl}/invoices/${invoice.id}/pay`, { method: 'POST' });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { invoice: { status: string } };
    expect(body.invoice.status).toBe('paid');

    const stored = invoices.find((i) => i.id === invoice.id)!;
    expect(stored.status).toBe('paid');
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('payment_received');
  });

  // ---------------------------------------------------------------------------
  // Payment guards (Task 7.3): concrete, clearly-labeled unit tests for the two
  // rejection branches of the mark-paid transition. Each asserts the full guard
  // contract from Requirement 6: the request is rejected with 409, the returned
  // status names the *current* (unchanged) status, the confirmation message is
  // absent, the persisted status is left exactly as it was, and no
  // payment-received event is recorded (the transition has no side effects).
  // ---------------------------------------------------------------------------

  it('GUARD (6.4): rejects paying an already-paid invoice — status stays "paid", no event, "already marked paid" message', async () => {
    const invoice = seedInvoice(currentUserId, { status: 'paid' });

    const res = await fetch(`${baseUrl}/invoices/${invoice.id}/pay`, { method: 'POST' });

    // Rejected with 409 and the already-paid message; no confirmation message (6.4).
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; status: string; message?: string };
    expect(body.error).toMatch(/already marked paid/i);
    // The response reports the current, unchanged status.
    expect(body.status).toBe('paid');
    // No success confirmation is returned on the reject path.
    expect(body.message).toBeUndefined();

    // Persisted status is left unchanged at "paid" (6.4).
    const stored = invoices.find((i) => i.id === invoice.id)!;
    expect(stored.status).toBe('paid');

    // No side effects: no payment-received event and no email dispatched (6.4).
    expect(events).toHaveLength(0);
    expect(fakeEmail.sent).toHaveLength(0);
  });

  it('GUARD (6.6): rejects paying a draft invoice — status stays "draft", no event, "draft ... cannot be marked paid" message', async () => {
    const invoice = seedInvoice(currentUserId, { status: 'draft' });

    const res = await fetch(`${baseUrl}/invoices/${invoice.id}/pay`, { method: 'POST' });

    // Rejected with 409 and the draft-cannot-be-paid message; no confirmation message (6.6).
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; status: string; message?: string };
    expect(body.error).toMatch(/draft invoice cannot be marked paid/i);
    // The response reports the current, unchanged status.
    expect(body.status).toBe('draft');
    // No success confirmation is returned on the reject path.
    expect(body.message).toBeUndefined();

    // Persisted status is left unchanged at "draft" (6.6).
    const stored = invoices.find((i) => i.id === invoice.id)!;
    expect(stored.status).toBe('draft');

    // No side effects: no payment-received event and no email dispatched (6.6).
    expect(events).toHaveLength(0);
    expect(fakeEmail.sent).toHaveLength(0);
  });

  it('rejects marking an unowned invoice paid with 403 not-authorized, leaving it unchanged (6.5)', async () => {
    const otherUser = randomUUID();
    const invoice = seedInvoice(otherUser, { status: 'sent' });

    const res = await fetch(`${baseUrl}/invoices/${invoice.id}/pay`, { method: 'POST' });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/not authorized/i);

    // The other user's invoice is untouched and no event was recorded.
    const stored = invoices.find((i) => i.id === invoice.id)!;
    expect(stored.status).toBe('sent');
    expect(events).toHaveLength(0);
  });

  it('records exactly one payment-received event even under concurrent pay attempts on the same invoice (6.1, 6.3)', async () => {
    const invoice = seedInvoice(currentUserId, { status: 'sent' });

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        fetch(`${baseUrl}/invoices/${invoice.id}/pay`, { method: 'POST' }),
      ),
    );

    const okCount = responses.filter((r) => r.status === 200).length;
    expect(okCount).toBe(1);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('payment_received');

    const stored = invoices.find((i) => i.id === invoice.id)!;
    expect(stored.status).toBe('paid');
  });

  // ---------------------------------------------------------------------------
  // Halt the chase cycle on payment (Task 13.1): marking an invoice paid clears
  // any pending draft by discarding its "pending_approval" follow-up(s)
  // (Req 10.3), while leaving already-sent/discarded follow-ups untouched. No
  // further drafting occurs because the draft worker skips non-overdue/paid
  // invoices (Req 10.2).
  // ---------------------------------------------------------------------------

  it('discards the pending-approval follow-up when the invoice is marked paid (10.2, 10.3)', async () => {
    const invoice = seedInvoice(currentUserId, { status: 'overdue' });
    const pending = seedFollowUp(currentUserId, invoice.id, {
      tier: 'firm',
      status: 'pending_approval',
      sent_at: null,
    });

    const res = await fetch(`${baseUrl}/invoices/${invoice.id}/pay`, { method: 'POST' });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { invoice: { status: string } };
    expect(body.invoice.status).toBe('paid');

    // The previously pending follow-up is now discarded (Req 10.3).
    const storedFollowUp = followUps.find((f) => f.id === pending.id)!;
    expect(storedFollowUp.status).toBe('discarded');

    // The payment still transitioned and recorded exactly one event.
    const storedInvoice = invoices.find((i) => i.id === invoice.id)!;
    expect(storedInvoice.status).toBe('paid');
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('payment_received');
  });

  it('discards every pending-approval follow-up for the invoice while leaving sent and already-discarded ones untouched (10.3)', async () => {
    const invoice = seedInvoice(currentUserId, { status: 'overdue' });
    // Already delivered — must remain "sent".
    const sent = seedFollowUp(currentUserId, invoice.id, {
      tier: 'polite',
      status: 'sent',
      sent_at: '2024-05-01T00:00:00.000Z',
    });
    // Already discarded — must remain "discarded".
    const alreadyDiscarded = seedFollowUp(currentUserId, invoice.id, {
      tier: 'polite',
      status: 'discarded',
      sent_at: null,
    });
    // Awaiting review — must be discarded on payment.
    const pending = seedFollowUp(currentUserId, invoice.id, {
      tier: 'final_notice',
      status: 'pending_approval',
      sent_at: null,
    });

    const res = await fetch(`${baseUrl}/invoices/${invoice.id}/pay`, { method: 'POST' });
    expect(res.status).toBe(200);

    expect(followUps.find((f) => f.id === pending.id)!.status).toBe('discarded');
    // Untouched: sent stays sent, already-discarded stays discarded.
    expect(followUps.find((f) => f.id === sent.id)!.status).toBe('sent');
    expect(followUps.find((f) => f.id === alreadyDiscarded.id)!.status).toBe('discarded');
  });

  it('does not touch follow-ups belonging to a different invoice when marking one paid (10.3)', async () => {
    const paidInvoice = seedInvoice(currentUserId, { invoice_number: 1, status: 'overdue' });
    const otherInvoice = seedInvoice(currentUserId, { invoice_number: 2, status: 'overdue' });

    const pendingForPaid = seedFollowUp(currentUserId, paidInvoice.id, {
      status: 'pending_approval',
      sent_at: null,
    });
    // A pending follow-up on a *different* overdue invoice must be left alone.
    const pendingForOther = seedFollowUp(currentUserId, otherInvoice.id, {
      status: 'pending_approval',
      sent_at: null,
    });

    const res = await fetch(`${baseUrl}/invoices/${paidInvoice.id}/pay`, { method: 'POST' });
    expect(res.status).toBe(200);

    expect(followUps.find((f) => f.id === pendingForPaid.id)!.status).toBe('discarded');
    expect(followUps.find((f) => f.id === pendingForOther.id)!.status).toBe('pending_approval');
  });

  it('succeeds when the paid invoice has no pending follow-up to discard (10.3)', async () => {
    const invoice = seedInvoice(currentUserId, { status: 'sent' });

    const res = await fetch(`${baseUrl}/invoices/${invoice.id}/pay`, { method: 'POST' });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { invoice: { status: string }; message: string };
    expect(body.invoice.status).toBe('paid');
    expect(body.message).toMatch(/marked paid/i);
    expect(events).toHaveLength(1);
  });
});

describe('DELETE /invoices/:id', () => {
  it('deletes an owned invoice and cascade-deletes every associated follow-up (11.7)', async () => {
    const invoice = seedInvoice(currentUserId, { invoice_number: 1, status: 'overdue' });
    // Follow-ups in a range of statuses; every one associated with the invoice
    // must be removed from retention when the invoice is deleted (Req 11.7).
    seedFollowUp(currentUserId, invoice.id, { status: 'sent', sent_at: '2024-05-01T00:00:00.000Z' });
    seedFollowUp(currentUserId, invoice.id, { status: 'pending_approval', sent_at: null });
    seedFollowUp(currentUserId, invoice.id, { status: 'discarded', sent_at: null });

    // A different invoice's follow-up must survive to prove the cascade is scoped.
    const otherInvoice = seedInvoice(currentUserId, { invoice_number: 2, status: 'sent' });
    const survivor = seedFollowUp(currentUserId, otherInvoice.id, { status: 'sent' });

    const res = await fetch(`${baseUrl}/invoices/${invoice.id}`, { method: 'DELETE' });

    // Success returns 204 with no body.
    expect(res.status).toBe(204);
    const text = await res.text();
    expect(text).toBe('');

    // The invoice row is gone.
    expect(invoices.find((i) => i.id === invoice.id)).toBeUndefined();

    // Every follow-up associated with the deleted invoice is removed (Req 11.7).
    expect(followUps.filter((f) => f.invoice_id === invoice.id)).toHaveLength(0);

    // The unrelated invoice and its follow-up are untouched.
    expect(invoices.find((i) => i.id === otherInvoice.id)).toBeDefined();
    expect(followUps.find((f) => f.id === survivor.id)).toBeDefined();
  });

  it('returns 404 not-available and removes nothing for an unowned invoice (11.7)', async () => {
    const otherUser = randomUUID();
    const invoice = seedInvoice(otherUser, { invoice_number: 1, status: 'overdue' });
    const followUp = seedFollowUp(otherUser, invoice.id, { status: 'sent' });

    const res = await fetch(`${baseUrl}/invoices/${invoice.id}`, { method: 'DELETE' });

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Invoice not available.');

    // Nothing was removed: the other user's invoice and follow-up remain.
    expect(invoices.find((i) => i.id === invoice.id)).toBeDefined();
    expect(followUps.find((f) => f.id === followUp.id)).toBeDefined();
  });

  it('returns 404 not-available and removes nothing for a nonexistent invoice (11.7)', async () => {
    seedInvoice(currentUserId, { invoice_number: 1, status: 'sent' });

    const res = await fetch(`${baseUrl}/invoices/${randomUUID()}`, { method: 'DELETE' });

    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('Invoice not available.');

    // The user's own invoice is untouched.
    expect(invoices).toHaveLength(1);
  });
});
