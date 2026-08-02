import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { EmailDeliveryResult, EmailMessage } from '../lib/emailService.js';
import { createFollowUpsRouter } from './followUps.js';

/**
 * Integration tests for the Follow-ups API router (Requirement 9).
 *
 * The router is mounted on a real Express app and exercised over HTTP. The
 * Supabase dependency is replaced with an in-memory fake that simulates Row
 * Level Security: every operation is implicitly scoped to the "current" user id
 * (the one the auth stub attaches), so follow-ups owned by other users are
 * invisible — exactly as Postgres RLS would enforce. The fake also mimics
 * PostgREST resource embedding by returning each follow-up with its associated
 * invoice (number, amount, due date) and nested client already joined in, and
 * supports the conditional-update / activity-event-insert paths the mutating
 * endpoints use. The Email_Service is a fake whose outcome each test controls,
 * so the delivery success, delivery-error, and timeout branches are exercised
 * with no network call.
 */

/** Embedded client shape returned alongside an invoice (PostgREST embedding). */
interface EmbeddedClient {
  name: string;
  email?: string;
}

/** Embedded invoice shape returned alongside a follow-up (PostgREST embedding). */
interface EmbeddedInvoice {
  invoice_number: number;
  amount?: number;
  due_date?: string;
  client: EmbeddedClient | null;
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
  // Pre-joined embedded context, standing in for PostgREST resource embedding.
  invoice: EmbeddedInvoice | null;
}

interface StoredEvent {
  id: number;
  user_id: string;
  invoice_id: string | null;
  type: string;
}

interface QueryResult {
  data: unknown;
  error: { message?: string } | null;
}

/** A filter accumulated on the fake query builder. */
interface EqFilter {
  column: string;
  value: unknown;
}

/**
 * Minimal chainable query builder mimicking the subset of the Supabase JS
 * client used by the follow-ups router. It supports the read path
 * (`select().eq().order()` / `.maybeSingle()`), the conditional-update path
 * (`update().eq().eq().select().maybeSingle()`), and activity-event inserts
 * (`insert()` awaited directly).
 *
 * Ownership scoping (RLS) is applied by filtering the backing collection to
 * `currentUserId`, so a read or conditional update never touches another user's
 * row, exactly as Postgres RLS would enforce.
 */
class FakeQuery implements PromiseLike<QueryResult> {
  private op: 'select' | 'update' | 'insert' = 'select';
  private updateValues: Record<string, unknown> = {};
  private insertValues: Record<string, unknown> = {};
  private readonly eqs: EqFilter[] = [];
  private orderColumn: keyof StoredFollowUp | null = null;
  private orderAscending = true;
  private single = false;

  constructor(
    private readonly rows: StoredFollowUp[],
    private readonly events: StoredEvent[],
    private readonly currentUserId: string,
  ) {}

  select(_columns?: string): this {
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
    this.eqs.push({ column, value });
    return this;
  }

  order(column: string, options?: { ascending?: boolean }): this {
    this.orderColumn = column as keyof StoredFollowUp;
    this.orderAscending = options?.ascending ?? true;
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

  private matches(row: StoredFollowUp): boolean {
    return this.eqs.every(
      (f) => (row as unknown as Record<string, unknown>)[f.column] === f.value,
    );
  }

  /** Strips the internal user_id column, mirroring the selected projection. */
  private shape(row: StoredFollowUp): Record<string, unknown> {
    const { user_id: _userId, ...rest } = row;
    return { ...rest };
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

    // RLS: only the current user's rows are ever visible/mutable.
    const owned = this.rows.filter((r) => r.user_id === this.currentUserId);

    if (this.op === 'update') {
      const targets = owned.filter((r) => this.matches(r));
      for (const target of targets) {
        Object.assign(target, this.updateValues);
      }
      if (this.single) {
        const first = targets[0] ?? null;
        return { data: first ? this.shape(first) : null, error: null };
      }
      return { data: null, error: null };
    }

    // select
    let result = owned.filter((r) => this.matches(r));

    if (this.orderColumn !== null) {
      const column = this.orderColumn;
      const direction = this.orderAscending ? 1 : -1;
      result = [...result].sort((a, b) => {
        const av = a[column] as string;
        const bv = b[column] as string;
        if (av < bv) return -1 * direction;
        if (av > bv) return 1 * direction;
        return 0;
      });
    }

    if (this.single) {
      const found = result[0] ?? null;
      return { data: found ? this.shape(found) : null, error: null };
    }
    return { data: result.map((r) => this.shape(r)), error: null };
  }
}

class FakeSupabase {
  constructor(
    private readonly followUps: StoredFollowUp[],
    private readonly events: StoredEvent[],
    private readonly currentUserId: string,
  ) {}

  from(table: string): FakeQuery {
    if (table === 'follow_ups' || table === 'activity_events') {
      return new FakeQuery(this.followUps, this.events, this.currentUserId);
    }
    throw new Error(`Unexpected table: ${table}`);
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
let followUps: StoredFollowUp[];
let events: StoredEvent[];
let currentUserId: string;
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
    req.supabase = new FakeSupabase(followUps, events, currentUserId) as any;
    next();
  };

  app.use(
    createFollowUpsRouter({
      authMiddleware: authStub,
      emailService: fakeEmail,
      fromEmail: 'reminders@example.com',
    }),
  );
  return app;
}

beforeEach(async () => {
  followUps = [];
  events = [];
  currentUserId = randomUUID();
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

let invoiceSeq = 0;
function seedFollowUp(userId: string, overrides: Partial<StoredFollowUp> = {}): StoredFollowUp {
  invoiceSeq += 1;
  const row: StoredFollowUp = {
    id: randomUUID(),
    user_id: userId,
    invoice_id: randomUUID(),
    tier: 'polite',
    content: 'Please pay your invoice.',
    status: 'pending_approval',
    drafted_at: new Date('2024-01-01T00:00:00.000Z').toISOString(),
    sent_at: null,
    invoice: {
      invoice_number: invoiceSeq,
      amount: 100,
      due_date: '2024-01-01',
      client: { name: 'Acme Co', email: 'acme@example.com' },
    },
    ...overrides,
  };
  followUps.push(row);
  return row;
}

interface FollowUpListItem {
  id: string;
  invoice_id: string;
  tier: string;
  content: string;
  status: string;
  drafted_at: string;
  invoice: EmbeddedInvoice | null;
}

interface ListBody {
  follow_ups: FollowUpListItem[];
}

describe('GET /follow-ups?status=pending_approval', () => {
  it('returns an empty list when the user owns no pending follow-ups (9.2)', async () => {
    const res = await fetch(`${baseUrl}/follow-ups?status=pending_approval`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListBody;
    expect(Array.isArray(body.follow_ups)).toBe(true);
    expect(body.follow_ups).toEqual([]);
  });

  it('returns pending follow-ups ordered most-recently-drafted first (9.2)', async () => {
    const oldest = seedFollowUp(currentUserId, {
      drafted_at: new Date('2024-01-01T00:00:00.000Z').toISOString(),
    });
    const middle = seedFollowUp(currentUserId, {
      drafted_at: new Date('2024-02-01T00:00:00.000Z').toISOString(),
    });
    const newest = seedFollowUp(currentUserId, {
      drafted_at: new Date('2024-03-01T00:00:00.000Z').toISOString(),
    });

    const res = await fetch(`${baseUrl}/follow-ups?status=pending_approval`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListBody;
    const ids = body.follow_ups.map((f) => f.id);
    expect(ids).toEqual([newest.id, middle.id, oldest.id]);
  });

  it('includes content and associated invoice number, amount, due date, and client name (9.2)', async () => {
    seedFollowUp(currentUserId, {
      content: 'Kindly settle invoice #7.',
      invoice: {
        invoice_number: 7,
        amount: 1250.5,
        due_date: '2024-05-15',
        client: { name: 'Globex LLC' },
      },
    });

    const res = await fetch(`${baseUrl}/follow-ups?status=pending_approval`);
    const body = (await res.json()) as ListBody;
    expect(body.follow_ups).toHaveLength(1);
    const item = body.follow_ups[0]!;
    expect(item.content).toBe('Kindly settle invoice #7.');
    expect(item.invoice).toEqual({
      invoice_number: 7,
      amount: 1250.5,
      due_date: '2024-05-15',
      client: { name: 'Globex LLC' },
    });
  });

  it('excludes follow-ups that are not in pending_approval status (9.2)', async () => {
    const pending = seedFollowUp(currentUserId, { status: 'pending_approval' });
    seedFollowUp(currentUserId, { status: 'approved' });
    seedFollowUp(currentUserId, { status: 'sent' });
    seedFollowUp(currentUserId, { status: 'discarded' });

    const res = await fetch(`${baseUrl}/follow-ups?status=pending_approval`);
    const body = (await res.json()) as ListBody;
    const ids = body.follow_ups.map((f) => f.id);
    expect(ids).toEqual([pending.id]);
  });

  it('never returns follow-ups owned by other users (9.2, RLS)', async () => {
    const otherUser = randomUUID();
    seedFollowUp(otherUser, { status: 'pending_approval' });
    const mine = seedFollowUp(currentUserId, { status: 'pending_approval' });

    const res = await fetch(`${baseUrl}/follow-ups?status=pending_approval`);
    const body = (await res.json()) as ListBody;
    const ids = body.follow_ups.map((f) => f.id);
    expect(ids).toEqual([mine.id]);
  });

  it('defaults to pending_approval when no status query param is provided (9.2)', async () => {
    const mine = seedFollowUp(currentUserId, { status: 'pending_approval' });
    seedFollowUp(currentUserId, { status: 'sent' });

    const res = await fetch(`${baseUrl}/follow-ups`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ListBody;
    const ids = body.follow_ups.map((f) => f.id);
    expect(ids).toEqual([mine.id]);
  });

  it('rejects an unsupported status filter with 400', async () => {
    const res = await fetch(`${baseUrl}/follow-ups?status=discarded`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { field: string };
    expect(body.field).toBe('status');
  });

  it('lists sent follow-ups when status=sent', async () => {
    const res = await fetch(`${baseUrl}/follow-ups?status=sent`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { follow_ups: unknown[] };
    expect(Array.isArray(body.follow_ups)).toBe(true);
  });
});

interface ActionBody {
  follow_up?: { id: string; status: string; content: string; sent_at: string | null };
  error?: string;
  status?: string;
  code?: string;
  reason?: string;
}

describe('PUT /follow-ups/:id/content', () => {
  it('replaces the drafted content with valid non-empty content (9.3)', async () => {
    const fu = seedFollowUp(currentUserId, { content: 'Old draft.' });

    const res = await fetch(`${baseUrl}/follow-ups/${fu.id}/content`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'Kindly settle your invoice at your earliest.' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as ActionBody;
    expect(body.follow_up?.content).toBe('Kindly settle your invoice at your earliest.');
    expect(body.follow_up?.status).toBe('pending_approval');

    const stored = followUps.find((f) => f.id === fu.id)!;
    expect(stored.content).toBe('Kindly settle your invoice at your earliest.');
  });

  it('rejects empty content with 400 and retains the existing content (9.4)', async () => {
    const fu = seedFollowUp(currentUserId, { content: 'Original content.' });

    const res = await fetch(`${baseUrl}/follow-ups/${fu.id}/content`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: '' }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as ActionBody;
    expect(body.code).toBe('CONTENT_EMPTY');

    const stored = followUps.find((f) => f.id === fu.id)!;
    expect(stored.content).toBe('Original content.');
  });

  it('rejects content over 10,000 characters with 400 and retains the existing content (9.4)', async () => {
    const fu = seedFollowUp(currentUserId, { content: 'Original content.' });

    const res = await fetch(`${baseUrl}/follow-ups/${fu.id}/content`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'x'.repeat(10_001) }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as ActionBody;
    expect(body.code).toBe('CONTENT_TOO_LONG');

    const stored = followUps.find((f) => f.id === fu.id)!;
    expect(stored.content).toBe('Original content.');
  });

  it('rejects editing a non-pending follow-up with 409 and leaves it unchanged (9.11)', async () => {
    const fu = seedFollowUp(currentUserId, { status: 'approved', content: 'Locked content.' });

    const res = await fetch(`${baseUrl}/follow-ups/${fu.id}/content`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'A new draft that should be ignored.' }),
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as ActionBody;
    expect(body.status).toBe('approved');
    expect(body.error).toMatch(/not pending approval/i);

    const stored = followUps.find((f) => f.id === fu.id)!;
    expect(stored.content).toBe('Locked content.');
    expect(stored.status).toBe('approved');
  });

  it('returns 404 not-available for an unowned follow-up (RLS)', async () => {
    const fu = seedFollowUp(randomUUID(), { content: 'Someone else.' });

    const res = await fetch(`${baseUrl}/follow-ups/${fu.id}/content`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: 'Attempted edit.' }),
    });

    expect(res.status).toBe(404);
    const stored = followUps.find((f) => f.id === fu.id)!;
    expect(stored.content).toBe('Someone else.');
  });
});

describe('POST /follow-ups/:id/approve', () => {
  it('approves, delivers, sets "sent", stamps sent_at, and records one follow-up-sent event (9.5-9.8)', async () => {
    const fu = seedFollowUp(currentUserId, {
      content: 'Please remit payment for invoice #12.',
      tier: 'firm',
      invoice: {
        invoice_number: 12,
        amount: 500,
        due_date: '2024-02-01',
        client: { name: 'Ada Lovelace', email: 'ada@example.com' },
      },
    });

    const res = await fetch(`${baseUrl}/follow-ups/${fu.id}/approve`, { method: 'POST' });

    expect(res.status).toBe(200);
    const body = (await res.json()) as ActionBody;
    expect(body.follow_up?.status).toBe('sent');
    expect(body.follow_up?.sent_at).not.toBeNull();

    // Persisted transition with a delivery timestamp appended to history (9.7).
    const stored = followUps.find((f) => f.id === fu.id)!;
    expect(stored.status).toBe('sent');
    expect(stored.sent_at).not.toBeNull();

    // Exactly one follow-up-sent event recorded for the owner (9.8).
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('follow_up_sent');
    expect(events[0]!.invoice_id).toBe(fu.invoice_id);
    expect(events[0]!.user_id).toBe(currentUserId);

    // Email delivered once to the client with the drafted content (9.6).
    expect(fakeEmail.sent).toHaveLength(1);
    const sent = fakeEmail.sent[0]!;
    expect(sent.from).toBe('reminders@example.com');
    expect(sent.to).toBe('ada@example.com');
    expect(sent.text).toBe('Please remit payment for invoice #12.');
    expect(sent.subject).toContain('12');
  });

  it('retains "approved" and returns a delivery-failure message on a delivery error, recording no event (9.9)', async () => {
    const fu = seedFollowUp(currentUserId, {
      invoice: {
        invoice_number: 3,
        client: { name: 'Client', email: 'client@example.com' },
      },
    });
    fakeEmail.outcome = { ok: false, reason: 'delivery_error', message: 'Resend rejected' };

    const res = await fetch(`${baseUrl}/follow-ups/${fu.id}/approve`, { method: 'POST' });

    expect(res.status).toBe(502);
    const body = (await res.json()) as ActionBody;
    expect(body.reason).toBe('delivery_error');
    expect(body.error).toMatch(/could not be delivered/i);

    const stored = followUps.find((f) => f.id === fu.id)!;
    expect(stored.status).toBe('approved');
    expect(stored.sent_at).toBeNull();
    expect(events).toHaveLength(0);
  });

  // TIMEOUT BRANCH (Req 9.9): IF the Email_Service does not confirm successful
  // delivery of an approved Follow_Up email within 30 seconds, THEN the System
  // SHALL retain the Follow_Up_Status as "approved" and return a
  // delivery-failure message to the User. This exercises the explicit `timeout`
  // delivery outcome (distinct from the `delivery_error` branch above) and
  // asserts every part of that requirement: the status is left at "approved"
  // (never advances to "sent"), sent_at is never stamped, no follow_up_sent
  // activity event is recorded, and a delivery-failure message with reason
  // "timeout" is returned to the caller.
  it('retains "approved" and returns a delivery-failure message on a delivery timeout (9.9)', async () => {
    const fu = seedFollowUp(currentUserId, {
      invoice: {
        invoice_number: 4,
        client: { name: 'Client', email: 'client@example.com' },
      },
    });
    // The Email_Service accepted the send but never confirmed delivery within
    // the 30s window — the timeout outcome (not a hard delivery error).
    fakeEmail.outcome = { ok: false, reason: 'timeout', message: 'no confirmation in 30s' };

    const res = await fetch(`${baseUrl}/follow-ups/${fu.id}/approve`, { method: 'POST' });

    // A delivery-failure message with the timeout reason is returned (9.9).
    expect(res.status).toBe(502);
    const body = (await res.json()) as ActionBody;
    expect(body.reason).toBe('timeout');
    expect(body.error).toMatch(/could not be delivered/i);
    expect(body.error).toMatch(/remains approved/i);
    // No "sent" follow-up is echoed back — the transition did not complete.
    expect(body.follow_up).toBeUndefined();

    // Status is retained as "approved" and never advances to "sent" (9.9).
    const stored = followUps.find((f) => f.id === fu.id)!;
    expect(stored.status).toBe('approved');
    expect(stored.status).not.toBe('sent');
    // The delivery timestamp is never stamped on a timeout (9.9).
    expect(stored.sent_at).toBeNull();
    // Delivery was attempted exactly once against the client email (9.6).
    expect(fakeEmail.sent).toHaveLength(1);
    expect(fakeEmail.sent[0]!.to).toBe('client@example.com');
    // No follow-up-sent event is recorded because delivery was not confirmed (9.9 vs 9.8).
    expect(events).toHaveLength(0);
  });

  it('rejects approving a non-pending follow-up with 409, delivering no email (9.11)', async () => {
    const fu = seedFollowUp(currentUserId, { status: 'sent' });

    const res = await fetch(`${baseUrl}/follow-ups/${fu.id}/approve`, { method: 'POST' });

    expect(res.status).toBe(409);
    const body = (await res.json()) as ActionBody;
    expect(body.status).toBe('sent');
    expect(body.error).toMatch(/not pending approval/i);
    expect(fakeEmail.sent).toHaveLength(0);
    expect(events).toHaveLength(0);
  });

  it('returns 404 not-available for an unowned follow-up, delivering no email (RLS)', async () => {
    const fu = seedFollowUp(randomUUID());

    const res = await fetch(`${baseUrl}/follow-ups/${fu.id}/approve`, { method: 'POST' });

    expect(res.status).toBe(404);
    expect(fakeEmail.sent).toHaveLength(0);
    const stored = followUps.find((f) => f.id === fu.id)!;
    expect(stored.status).toBe('pending_approval');
  });

  it('delivers at most one email across concurrent approvals on the same follow-up (9.6)', async () => {
    const fu = seedFollowUp(currentUserId, {
      invoice: {
        invoice_number: 9,
        client: { name: 'Client', email: 'client@example.com' },
      },
    });

    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        fetch(`${baseUrl}/follow-ups/${fu.id}/approve`, { method: 'POST' }),
      ),
    );

    const okCount = responses.filter((r) => r.status === 200).length;
    expect(okCount).toBe(1);
    expect(fakeEmail.sent).toHaveLength(1);
    expect(events).toHaveLength(1);

    const stored = followUps.find((f) => f.id === fu.id)!;
    expect(stored.status).toBe('sent');
  });
});

describe('POST /follow-ups/:id/discard', () => {
  it('discards a pending follow-up and delivers nothing (9.10)', async () => {
    const fu = seedFollowUp(currentUserId);

    const res = await fetch(`${baseUrl}/follow-ups/${fu.id}/discard`, { method: 'POST' });

    expect(res.status).toBe(200);
    const body = (await res.json()) as ActionBody;
    expect(body.follow_up?.status).toBe('discarded');

    const stored = followUps.find((f) => f.id === fu.id)!;
    expect(stored.status).toBe('discarded');
    expect(fakeEmail.sent).toHaveLength(0);
    // No email is sent, but a "follow-up discarded" timeline event is logged.
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('follow_up_discarded');
  });

  it('rejects discarding a non-pending follow-up with 409 and leaves it unchanged (9.11)', async () => {
    const fu = seedFollowUp(currentUserId, { status: 'sent' });

    const res = await fetch(`${baseUrl}/follow-ups/${fu.id}/discard`, { method: 'POST' });

    expect(res.status).toBe(409);
    const body = (await res.json()) as ActionBody;
    expect(body.status).toBe('sent');
    expect(body.error).toMatch(/not pending approval/i);

    const stored = followUps.find((f) => f.id === fu.id)!;
    expect(stored.status).toBe('sent');
  });

  it('returns 404 not-available for an unowned follow-up (RLS)', async () => {
    const fu = seedFollowUp(randomUUID());

    const res = await fetch(`${baseUrl}/follow-ups/${fu.id}/discard`, { method: 'POST' });

    expect(res.status).toBe(404);
    const stored = followUps.find((f) => f.id === fu.id)!;
    expect(stored.status).toBe('pending_approval');
  });
});
