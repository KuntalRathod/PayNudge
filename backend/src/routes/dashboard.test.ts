import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDashboardRouter } from './dashboard.js';

/**
 * Integration tests for the Dashboard API router (Requirement 5).
 *
 * The router is mounted on a real Express app and exercised over HTTP. The
 * Supabase dependency is replaced with an in-memory fake that simulates Row
 * Level Security: every `select` is implicitly scoped to the "current" user id
 * (the one the auth stub attaches), so rows owned by other users are invisible
 * to reads — exactly as Postgres RLS would enforce. The dashboard aggregates
 * therefore only ever reflect the requesting user's data.
 */

interface StoredInvoice {
  id: string;
  user_id: string;
  status: string;
  amount: number;
}

interface StoredFollowUp {
  id: string;
  user_id: string;
  status: string;
}

interface StoredEvent {
  id: number;
  user_id: string;
  type: string;
  created_at: string;
}

interface QueryResult {
  data: unknown;
  error: { message?: string } | null;
}

/**
 * Minimal chainable query builder mimicking the subset of the Supabase JS
 * client used by the dashboard router (only `select`, awaited directly).
 * Ownership scoping (RLS) is applied by filtering the backing collection to
 * `currentUserId`.
 */
class FakeQuery implements PromiseLike<QueryResult> {
  constructor(
    private readonly rows: Array<{ user_id: string }>,
    private readonly currentUserId: string,
  ) {}

  select(_columns?: string): this {
    return this;
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }

  private execute(): QueryResult {
    const owned = this.rows
      .filter((r) => r.user_id === this.currentUserId)
      .map((r) => ({ ...r }));
    return { data: owned, error: null };
  }
}

class FakeSupabase {
  constructor(
    private readonly invoices: StoredInvoice[],
    private readonly followUps: StoredFollowUp[],
    private readonly events: StoredEvent[],
    private readonly currentUserId: string,
  ) {}

  from(table: string): FakeQuery {
    if (table === 'invoices') {
      return new FakeQuery(this.invoices, this.currentUserId);
    }
    if (table === 'follow_ups') {
      return new FakeQuery(this.followUps, this.currentUserId);
    }
    if (table === 'activity_events') {
      return new FakeQuery(this.events, this.currentUserId);
    }
    throw new Error(`Unexpected table: ${table}`);
  }
}

// Shared in-memory database and the "logged in" user for a given test run.
let invoices: StoredInvoice[];
let followUps: StoredFollowUp[];
let events: StoredEvent[];
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
    req.supabase = new FakeSupabase(invoices, followUps, events, currentUserId) as any;
    next();
  };

  app.use(createDashboardRouter({ authMiddleware: authStub }));
  return app;
}

beforeEach(async () => {
  invoices = [];
  followUps = [];
  events = [];
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

function seedInvoice(userId: string, overrides: Partial<StoredInvoice> = {}): StoredInvoice {
  const row: StoredInvoice = {
    id: randomUUID(),
    user_id: userId,
    status: 'draft',
    amount: 100,
    ...overrides,
  };
  invoices.push(row);
  return row;
}

function seedFollowUp(userId: string, overrides: Partial<StoredFollowUp> = {}): StoredFollowUp {
  const row: StoredFollowUp = {
    id: randomUUID(),
    user_id: userId,
    status: 'pending_approval',
    ...overrides,
  };
  followUps.push(row);
  return row;
}

let eventSeq = 0;
function seedEvent(userId: string, overrides: Partial<StoredEvent> = {}): StoredEvent {
  eventSeq += 1;
  const row: StoredEvent = {
    id: eventSeq,
    user_id: userId,
    type: 'invoice_sent',
    created_at: new Date('2024-01-01T00:00:00.000Z').toISOString(),
    ...overrides,
  };
  events.push(row);
  return row;
}

interface DashboardBody {
  outstanding_total: number;
  overdue_count: number;
  pending_follow_up_count: number;
  activity_events: Array<{ id: number; type: string; created_at: string }>;
}

describe('GET /dashboard', () => {
  it('returns zeros and an empty feed when the user owns nothing (5.2, 5.6)', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DashboardBody;
    expect(body.outstanding_total).toBe(0);
    expect(body.overdue_count).toBe(0);
    expect(body.pending_follow_up_count).toBe(0);
    expect(Array.isArray(body.activity_events)).toBe(true);
    expect(body.activity_events).toEqual([]);
  });

  // Requirement 5.6: IF the User owns no invoice-sent, follow-up-sent, or
  // payment-received events when the Dashboard opens, THEN the Dashboard SHALL
  // display an empty Activity_Feed. This must hold even when OTHER users own
  // events — RLS keeps those invisible, so the requester's feed stays empty.
  it('returns an empty activity feed when the user owns no events (5.6)', async () => {
    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DashboardBody;
    expect(Array.isArray(body.activity_events)).toBe(true);
    expect(body.activity_events).toEqual([]);
  });

  it('returns an empty activity feed when only other users own events (5.6)', async () => {
    // Several events exist, but all belong to other users. The requesting user
    // owns none, so their Activity_Feed must be empty.
    const otherUserA = randomUUID();
    const otherUserB = randomUUID();
    seedEvent(otherUserA, { created_at: new Date('2024-06-01T00:00:00.000Z').toISOString() });
    seedEvent(otherUserA, { created_at: new Date('2024-07-01T00:00:00.000Z').toISOString() });
    seedEvent(otherUserB, { created_at: new Date('2024-08-01T00:00:00.000Z').toISOString() });

    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DashboardBody;
    expect(Array.isArray(body.activity_events)).toBe(true);
    expect(body.activity_events).toEqual([]);
  });

  it('sums only sent and overdue invoice amounts into the outstanding total (5.1, 5.7)', async () => {
    seedInvoice(currentUserId, { status: 'sent', amount: 100.5 });
    seedInvoice(currentUserId, { status: 'overdue', amount: 200.25 });
    seedInvoice(currentUserId, { status: 'draft', amount: 999 });
    seedInvoice(currentUserId, { status: 'paid', amount: 999 });

    const res = await fetch(`${baseUrl}/dashboard`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as DashboardBody;
    expect(body.outstanding_total).toBe(300.75);
  });

  it('counts overdue invoices and pending follow-ups (5.3, 5.4)', async () => {
    seedInvoice(currentUserId, { status: 'overdue', amount: 10 });
    seedInvoice(currentUserId, { status: 'overdue', amount: 20 });
    seedInvoice(currentUserId, { status: 'sent', amount: 30 });
    seedFollowUp(currentUserId, { status: 'pending_approval' });
    seedFollowUp(currentUserId, { status: 'sent' });
    seedFollowUp(currentUserId, { status: 'discarded' });

    const res = await fetch(`${baseUrl}/dashboard`);
    const body = (await res.json()) as DashboardBody;
    expect(body.overdue_count).toBe(2);
    expect(body.pending_follow_up_count).toBe(1);
  });

  it('returns activity events ordered by created_at desc then id desc (5.5)', async () => {
    const older = seedEvent(currentUserId, {
      created_at: new Date('2024-01-01T00:00:00.000Z').toISOString(),
    });
    // Same timestamp: tie broken by descending id.
    const tieLow = seedEvent(currentUserId, {
      created_at: new Date('2024-02-01T00:00:00.000Z').toISOString(),
    });
    const tieHigh = seedEvent(currentUserId, {
      created_at: new Date('2024-02-01T00:00:00.000Z').toISOString(),
    });

    const res = await fetch(`${baseUrl}/dashboard`);
    const body = (await res.json()) as DashboardBody;
    const ids = body.activity_events.map((e) => e.id);
    expect(ids).toEqual([tieHigh.id, tieLow.id, older.id]);
  });

  it('caps the activity feed at the 20 most recent events (5.5)', async () => {
    for (let i = 0; i < 25; i += 1) {
      const day = String(i + 1).padStart(2, '0');
      seedEvent(currentUserId, {
        created_at: new Date(`2024-03-${day}T00:00:00.000Z`).toISOString(),
      });
    }

    const res = await fetch(`${baseUrl}/dashboard`);
    const body = (await res.json()) as DashboardBody;
    expect(body.activity_events).toHaveLength(20);
    // The most recent event (day 25) is first.
    expect(body.activity_events[0]!.created_at).toBe(
      new Date('2024-03-25T00:00:00.000Z').toISOString(),
    );
  });

  it('reflects only the requesting user data across all aggregates (5.1, 5.3, 5.4, 5.5)', async () => {
    const otherUser = randomUUID();
    // Other user's data must never leak into any aggregate.
    seedInvoice(otherUser, { status: 'overdue', amount: 5000 });
    seedFollowUp(otherUser, { status: 'pending_approval' });
    seedEvent(otherUser, { created_at: new Date('2024-12-31T00:00:00.000Z').toISOString() });

    // The requesting user's own data.
    seedInvoice(currentUserId, { status: 'sent', amount: 42 });
    seedFollowUp(currentUserId, { status: 'pending_approval' });
    seedEvent(currentUserId, { created_at: new Date('2024-05-01T00:00:00.000Z').toISOString() });

    const res = await fetch(`${baseUrl}/dashboard`);
    const body = (await res.json()) as DashboardBody;
    expect(body.outstanding_total).toBe(42);
    expect(body.overdue_count).toBe(0);
    expect(body.pending_follow_up_count).toBe(1);
    expect(body.activity_events).toHaveLength(1);
    expect(body.activity_events[0]!.created_at).toBe(
      new Date('2024-05-01T00:00:00.000Z').toISOString(),
    );
  });

  it('excludes a paid invoice from the outstanding total and overdue count (5.7, 5.8)', async () => {
    // An invoice that was overdue but is now paid must not count toward either
    // the outstanding total or the overdue count.
    seedInvoice(currentUserId, { status: 'paid', amount: 1000 });
    seedInvoice(currentUserId, { status: 'overdue', amount: 250 });

    const res = await fetch(`${baseUrl}/dashboard`);
    const body = (await res.json()) as DashboardBody;
    expect(body.outstanding_total).toBe(250);
    expect(body.overdue_count).toBe(1);
  });
});
