import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createClientsRouter } from './clients.js';

/**
 * Integration tests for the Clients API router (Requirement 2).
 *
 * The router is mounted on a real Express app and exercised over HTTP. The
 * Supabase dependency is replaced with an in-memory fake that simulates Row
 * Level Security: every query is implicitly scoped to the "current" user id
 * (the one the auth stub attaches), so rows owned by other users are invisible
 * to reads and unaffected by writes — exactly as Postgres RLS would enforce.
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

/**
 * Minimal chainable query builder mimicking the subset of the Supabase JS
 * client used by the router. Ownership scoping (RLS) is applied by filtering
 * every operation to `currentUserId`.
 *
 * The `clients` table supports insert/update/select; the `invoices` table is
 * read-only here (client-history endpoint) and is filtered by `client_id`.
 */
class FakeQuery implements PromiseLike<QueryResult> {
  private op: 'insert' | 'select' | 'update' = 'select';
  private insertRow: Record<string, unknown> | null = null;
  private updatePatch: Record<string, unknown> | null = null;
  private idFilter: string | null = null;
  private clientIdFilter: string | null = null;
  private mode: 'list' | 'single' | 'maybeSingle' = 'list';

  constructor(
    private readonly table: string,
    private readonly clientsDb: StoredClient[],
    private readonly invoicesDb: StoredInvoice[],
    private readonly currentUserId: string,
  ) {}

  insert(row: Record<string, unknown>): this {
    this.op = 'insert';
    this.insertRow = row;
    return this;
  }

  update(patch: Record<string, unknown>): this {
    this.op = 'update';
    this.updatePatch = patch;
    return this;
  }

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
    this.mode = 'list';
    return this;
  }

  single(): Promise<QueryResult> {
    this.mode = 'single';
    return Promise.resolve(this.execute());
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

  private execute(): QueryResult {
    if (this.table === 'invoices') {
      return this.executeInvoices();
    }
    return this.executeClients();
  }

  private executeInvoices(): QueryResult {
    // Read-only, RLS-scoped to the caller and filtered by client_id.
    const owned = this.invoicesDb.filter(
      (inv) =>
        inv.user_id === this.currentUserId &&
        (this.clientIdFilter === null || inv.client_id === this.clientIdFilter),
    );
    const sorted = [...owned].sort((a, b) => b.invoice_number - a.invoice_number);
    return { data: sorted.map((inv) => ({ ...inv })), error: null };
  }

  private executeClients(): QueryResult {
    if (this.op === 'insert') {
      const row = this.insertRow ?? {};
      const now = new Date().toISOString();
      const stored: StoredClient = {
        id: randomUUID(),
        user_id: String(row.user_id),
        name: String(row.name),
        email: String(row.email),
        company: (row.company as string | null) ?? null,
        created_at: now,
        updated_at: now,
      };
      this.clientsDb.push(stored);
      return { data: { ...stored }, error: null };
    }

    if (this.op === 'update') {
      const target = this.clientsDb.find(
        (c) => c.id === this.idFilter && c.user_id === this.currentUserId,
      );
      if (!target) {
        // RLS: zero rows affected for a missing/unowned row.
        return { data: null, error: null };
      }
      const patch = this.updatePatch ?? {};
      target.name = String(patch.name);
      target.email = String(patch.email);
      target.company = (patch.company as string | null) ?? null;
      target.updated_at = new Date().toISOString();
      return { data: { ...target }, error: null };
    }

    // select
    const owned = this.clientsDb.filter((c) => c.user_id === this.currentUserId);
    if (this.mode === 'list') {
      const sorted = [...owned].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      return { data: sorted.map((c) => ({ ...c })), error: null };
    }
    const found = owned.find((c) => c.id === this.idFilter) ?? null;
    return { data: found ? { ...found } : null, error: null };
  }
}

class FakeSupabase {
  constructor(
    private readonly clientsDb: StoredClient[],
    private readonly invoicesDb: StoredInvoice[],
    private readonly currentUserId: string,
  ) {}

  from(table: string): FakeQuery {
    return new FakeQuery(table, this.clientsDb, this.invoicesDb, this.currentUserId);
  }
}

// Shared in-memory database and the "logged in" user for a given test run.
let db: StoredClient[];
let invoicesDb: StoredInvoice[];
let currentUserId: string;
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
    req.supabase = new FakeSupabase(db, invoicesDb, currentUserId) as any;
    next();
  };

  app.use(createClientsRouter({ authMiddleware: authStub }));
  return app;
}

beforeEach(async () => {
  db = [];
  invoicesDb = [];
  currentUserId = randomUUID();
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
  const now = new Date().toISOString();
  const row: StoredClient = {
    id: randomUUID(),
    user_id: userId,
    name: 'Seed Client',
    email: 'seed@example.com',
    company: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
  db.push(row);
  return row;
}

let nextInvoiceNumber = 1;

function seedInvoice(
  userId: string,
  clientId: string,
  overrides: Partial<StoredInvoice> = {},
): StoredInvoice {
  const now = new Date().toISOString();
  const row: StoredInvoice = {
    id: randomUUID(),
    user_id: userId,
    client_id: clientId,
    invoice_number: nextInvoiceNumber++,
    amount: '100.00',
    description: 'Seed invoice',
    due_date: '2024-01-01',
    status: 'sent',
    created_at: now,
    ...overrides,
  };
  invoicesDb.push(row);
  return row;
}

describe('POST /clients', () => {
  it('creates a client owned by the authenticated user (2.1, 2.2)', async () => {
    const res = await fetch(`${baseUrl}/clients`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Ada', email: 'ada@example.com', company: 'Analytical' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { client: StoredClient };
    expect(body.client.name).toBe('Ada');
    expect(body.client.email).toBe('ada@example.com');
    expect(body.client.company).toBe('Analytical');
    expect(body.client.user_id).toBe(currentUserId);
    expect(db).toHaveLength(1);
  });

  it('rejects a missing name with 400 and writes nothing (2.3)', async () => {
    const res = await fetch(`${baseUrl}/clients`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'x@example.com' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { field: string; code: string };
    expect(body.field).toBe('name');
    expect(body.code).toBe('missing');
    expect(db).toHaveLength(0);
  });

  it('rejects a malformed email with 400 (2.5)', async () => {
    const res = await fetch(`${baseUrl}/clients`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Ada', email: 'not-an-email' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { field: string };
    expect(body.field).toBe('email');
    expect(db).toHaveLength(0);
  });
});

describe('GET /clients', () => {
  it('returns an empty array when the user owns no clients (2.6)', async () => {
    const res = await fetch(`${baseUrl}/clients`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { clients: StoredClient[] };
    // Req 2.6: the client list must be an actual (empty) array, not null/undefined.
    expect(Array.isArray(body.clients)).toBe(true);
    expect(body.clients).toEqual([]);
    expect(body.clients).toHaveLength(0);
  });

  it('returns an empty array when only other users own clients (2.6)', async () => {
    // The requesting user owns nothing, but other users do: the list must
    // still come back empty (emptiness driven by ownership, not by an empty db).
    seedClient(randomUUID(), { name: 'Other A' });
    seedClient(randomUUID(), { name: 'Other B' });

    const res = await fetch(`${baseUrl}/clients`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { clients: StoredClient[] };
    expect(body.clients).toEqual([]);
  });

  it('returns only clients owned by the requesting user (2.7)', async () => {
    seedClient(currentUserId, { name: 'Mine A' });
    seedClient(currentUserId, { name: 'Mine B' });
    seedClient(randomUUID(), { name: 'Someone Else' });

    const res = await fetch(`${baseUrl}/clients`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { clients: StoredClient[] };
    expect(body.clients).toHaveLength(2);
    expect(body.clients.every((c) => c.user_id === currentUserId)).toBe(true);
  });
});

describe('GET /clients/:id', () => {
  it('returns the full owned client record when selected by id (2.8)', async () => {
    // Req 2.8: selecting an existing owned client returns that exact client,
    // with all of its stored fields intact (so it can be reused as an invoice
    // recipient).
    const seeded = seedClient(currentUserId, {
      name: 'Owned',
      email: 'owned@example.com',
      company: 'OwnedCo',
    });
    const res = await fetch(`${baseUrl}/clients/${seeded.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { client: StoredClient };
    expect(body.client.id).toBe(seeded.id);
    expect(body.client.user_id).toBe(currentUserId);
    expect(body.client.name).toBe('Owned');
    expect(body.client.email).toBe('owned@example.com');
    expect(body.client.company).toBe('OwnedCo');
  });

  it('selects the requested owned client even when the user owns several (2.8)', async () => {
    // Selecting one owned client returns that specific client, not another
    // one the user happens to own.
    seedClient(currentUserId, { name: 'First', email: 'first@example.com' });
    const target = seedClient(currentUserId, { name: 'Target', email: 'target@example.com' });
    seedClient(currentUserId, { name: 'Third', email: 'third@example.com' });

    const res = await fetch(`${baseUrl}/clients/${target.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { client: StoredClient };
    expect(body.client.id).toBe(target.id);
    expect(body.client.name).toBe('Target');
  });

  it('returns 404 not-available for an unowned client', async () => {
    const seeded = seedClient(randomUUID(), { name: 'Not Mine' });
    const res = await fetch(`${baseUrl}/clients/${seeded.id}`);
    expect(res.status).toBe(404);
  });

  it('returns 404 not-available for a nonexistent client', async () => {
    const res = await fetch(`${baseUrl}/clients/${randomUUID()}`);
    expect(res.status).toBe(404);
  });
});

describe('PUT /clients/:id', () => {
  it('updates an owned client with valid values (2.9)', async () => {
    const seeded = seedClient(currentUserId, { name: 'Old', email: 'old@example.com' });
    const res = await fetch(`${baseUrl}/clients/${seeded.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'New', email: 'new@example.com', company: 'NewCo' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { client: StoredClient };
    expect(body.client.name).toBe('New');
    expect(body.client.email).toBe('new@example.com');
    expect(body.client.company).toBe('NewCo');
    expect(db[0]!.name).toBe('New');
  });

  it('rejects an invalid update with 400 and preserves the record (2.10)', async () => {
    const seeded = seedClient(currentUserId, { name: 'Keep', email: 'keep@example.com' });
    const res = await fetch(`${baseUrl}/clients/${seeded.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '', email: 'keep@example.com' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { field: string };
    expect(body.field).toBe('name');
    // Record left unchanged.
    expect(db[0]!.name).toBe('Keep');
  });

  it('rejects updating an unowned client with 403 not-authorized and no change (2.11)', async () => {
    // Req 2.11: an update to a client the caller does not own is rejected with
    // a not-authorized message, and the stored record is preserved unchanged.
    const otherUser = randomUUID();
    const seeded = seedClient(otherUser, {
      name: 'Untouchable',
      email: 'other@example.com',
      company: 'OtherCo',
    });
    const res = await fetch(`${baseUrl}/clients/${seeded.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Hacked', email: 'hacked@example.com', company: 'HackedCo' }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/not authorized/i);
    // The other user's record is untouched in every field.
    expect(db).toHaveLength(1);
    expect(db[0]!.user_id).toBe(otherUser);
    expect(db[0]!.name).toBe('Untouchable');
    expect(db[0]!.email).toBe('other@example.com');
    expect(db[0]!.company).toBe('OtherCo');
  });

  it('returns 403 not-authorized without side effects when updating a valid but unowned client (2.11)', async () => {
    // Even with a fully valid payload, an update targeting another user's
    // client must not create or modify any record.
    const otherUser = randomUUID();
    const seeded = seedClient(otherUser, { name: 'Owned By Other', email: 'owner@example.com' });
    const res = await fetch(`${baseUrl}/clients/${seeded.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Valid New Name', email: 'valid@example.com' }),
    });
    expect(res.status).toBe(403);
    expect(db).toHaveLength(1);
    expect(db[0]!.name).toBe('Owned By Other');
    expect(db[0]!.email).toBe('owner@example.com');
  });
});

describe('GET /clients/:id/history', () => {
  it('returns all invoices for an owned client with their current statuses (11.3)', async () => {
    // Req 11.3: the client history returns every invoice associated with the
    // owned client together with each invoice's current status.
    const client = seedClient(currentUserId, { name: 'Historic' });
    seedInvoice(currentUserId, client.id, { status: 'paid' });
    seedInvoice(currentUserId, client.id, { status: 'overdue' });
    seedInvoice(currentUserId, client.id, { status: 'sent' });

    const res = await fetch(`${baseUrl}/clients/${client.id}/history`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { invoices: StoredInvoice[] };
    expect(body.invoices).toHaveLength(3);
    expect(body.invoices.every((inv) => inv.client_id === client.id)).toBe(true);
    // Every invoice carries its current status.
    expect(new Set(body.invoices.map((inv) => inv.status))).toEqual(
      new Set(['paid', 'overdue', 'sent']),
    );
  });

  it('returns only invoices for the requested client, not the user\'s other clients (11.3)', async () => {
    const target = seedClient(currentUserId, { name: 'Target' });
    const other = seedClient(currentUserId, { name: 'Other Client' });
    const mine1 = seedInvoice(currentUserId, target.id, { status: 'sent' });
    const mine2 = seedInvoice(currentUserId, target.id, { status: 'paid' });
    seedInvoice(currentUserId, other.id, { status: 'draft' });

    const res = await fetch(`${baseUrl}/clients/${target.id}/history`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { invoices: StoredInvoice[] };
    expect(body.invoices).toHaveLength(2);
    expect(new Set(body.invoices.map((inv) => inv.id))).toEqual(new Set([mine1.id, mine2.id]));
  });

  it('returns an empty list for an owned client with no invoices (11.3)', async () => {
    const client = seedClient(currentUserId, { name: 'No Invoices' });
    const res = await fetch(`${baseUrl}/clients/${client.id}/history`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { invoices: StoredInvoice[] };
    expect(Array.isArray(body.invoices)).toBe(true);
    expect(body.invoices).toEqual([]);
  });

  it('returns 404 not-available for an unowned client and no invoice records (11.6)', async () => {
    // Req 11.6: history of a client the caller does not own is rejected as
    // not-available and discloses no invoice records.
    const otherUser = randomUUID();
    const client = seedClient(otherUser, { name: 'Not Mine' });
    seedInvoice(otherUser, client.id, { status: 'sent' });

    const res = await fetch(`${baseUrl}/clients/${client.id}/history`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error?: string; invoices?: unknown };
    expect(body.invoices).toBeUndefined();
    expect(body.error).toMatch(/not available/i);
  });

  it('returns 404 not-available for a nonexistent client (11.6)', async () => {
    const res = await fetch(`${baseUrl}/clients/${randomUUID()}/history`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { invoices?: unknown };
    expect(body.invoices).toBeUndefined();
  });
});
