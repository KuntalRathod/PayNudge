// Feature: paynudge, Property 20: Confirmed follow-up delivery transitions to sent, appends history, and records an event

import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, it } from 'vitest';

import type { EmailDeliveryResult, EmailMessage } from '../lib/emailService.js';
import { createFollowUpsRouter } from './followUps.js';

/**
 * Property-based test for the confirmed follow-up delivery flow of the
 * Follow-ups API router (Requirement 9, Property 20).
 *
 * The router is mounted on a real Express app and the approve endpoint is
 * driven over HTTP. The Supabase dependency is replaced with an in-memory fake
 * that simulates Row Level Security (every operation is scoped to the current
 * user id), mirrors PostgREST resource embedding (each follow-up carries its
 * associated invoice and nested client), and supports the conditional-update
 * and activity-event-insert paths the approve endpoint uses. The Email_Service
 * is a fake that always confirms delivery, so the confirmed-delivery branch is
 * exercised across randomized follow-up/invoice/client contexts with no
 * network call.
 *
 * Property 20: For any approved/pending follow-up delivered with a confirmed
 * delivery outcome, the follow-up transitions to "sent", its delivery
 * timestamp (sent_at) is stamped — appending it to the invoice's follow-up
 * history alongside its escalation tier — and exactly one follow-up-sent
 * activity event is recorded.
 *
 * Validates: Requirements 9.7, 9.8
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

interface EqFilter {
  column: string;
  value: unknown;
}

/**
 * Minimal chainable query builder mimicking the subset of the Supabase JS
 * client used by the follow-ups router: the read path
 * (`select().eq().maybeSingle()`), the conditional-update path
 * (`update().eq().eq().select().maybeSingle()`), and activity-event inserts
 * (`insert()` awaited directly). Ownership scoping (RLS) filters the backing
 * collection to `currentUserId`.
 */
class FakeQuery implements PromiseLike<QueryResult> {
  private op: 'select' | 'update' | 'insert' = 'select';
  private updateValues: Record<string, unknown> = {};
  private insertValues: Record<string, unknown> = {};
  private readonly eqs: EqFilter[] = [];
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

  private shape(row: StoredFollowUp): Record<string, unknown> {
    const { user_id: _userId, ...rest } = row;
    return { ...rest };
  }

  private execute(): QueryResult {
    if (this.op === 'insert') {
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
    const result = owned.filter((r) => this.matches(r));
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
 * A fake Email_Service that records outbound emails and returns an injectable
 * outcome. For this property the outcome is always a confirmed delivery.
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

// Shared in-memory state; the auth stub reads these module-level bindings on
// every request, so resetting them between property runs is picked up live.
let followUps: StoredFollowUp[] = [];
let events: StoredEvent[] = [];
let currentUserId: string = randomUUID();
let fakeEmail: FakeEmailService = createFakeEmailService();
let server: Server;
let baseUrl: string;

function buildApp(): Express {
  const app = express();
  app.use(express.json());

  const authStub = (req: Request, _res: Response, next: NextFunction): void => {
    req.userId = currentUserId;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    req.supabase = new FakeSupabase(followUps, events, currentUserId) as any;
    next();
  };

  app.use(
    createFollowUpsRouter({
      authMiddleware: authStub,
      // A fresh service is created per request so the outcome is always the
      // confirmed delivery set on the module-level fake at request time.
      get emailService(): FakeEmailService {
        return fakeEmail;
      },
      fromEmail: 'reminders@example.com',
    }),
  );
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

/** The escalation tiers a follow-up can carry into its history entry. */
const TIERS = ['polite', 'firm', 'final_notice'] as const;

/** A randomized follow-up / invoice / client delivery context. */
interface DeliveryContext {
  userId: string;
  tier: string;
  content: string;
  invoiceNumber: number;
  amount: number;
  dueDate: string;
  clientName: string;
  clientEmail: string;
  emailId: string;
}

const contextArb: fc.Arbitrary<DeliveryContext> = fc.record({
  userId: fc.uuid(),
  tier: fc.constantFrom(...TIERS),
  // Non-empty, within the 10,000-character limit.
  content: fc.string({ minLength: 1, maxLength: 500 }).filter((s) => s.trim().length > 0),
  invoiceNumber: fc.integer({ min: 1, max: 1_000_000 }),
  amount: fc.double({ min: 0.01, max: 1_000_000, noNaN: true, noDefaultInfinity: true }),
  dueDate: fc
    .date({ min: new Date('2020-01-01T00:00:00.000Z'), max: new Date('2030-12-31T00:00:00.000Z') })
    .map((d) => d.toISOString().slice(0, 10)),
  clientName: fc.string({ minLength: 1, maxLength: 60 }).filter((s) => s.trim().length > 0),
  clientEmail: fc.emailAddress(),
  emailId: fc.string({ minLength: 1, maxLength: 24 }),
});

interface ApproveBody {
  follow_up?: { id: string; status: string; tier: string; sent_at: string | null };
}

/** Whether a string is a valid, round-trippable ISO-8601 timestamp. */
function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

describe('Property 20: confirmed follow-up delivery transitions to sent, appends history, records an event', () => {
  it('sets "sent", stamps the delivery timestamp into history, and records exactly one event (9.7, 9.8)', async () => {
    await fc.assert(
      fc.asyncProperty(contextArb, async (ctx) => {
        // Fresh in-memory state and a confirming Email_Service for this run.
        followUps = [];
        events = [];
        currentUserId = ctx.userId;
        fakeEmail = createFakeEmailService();
        fakeEmail.outcome = { ok: true, id: ctx.emailId };

        const invoiceId = randomUUID();
        const followUpId = randomUUID();
        const followUp: StoredFollowUp = {
          id: followUpId,
          user_id: ctx.userId,
          invoice_id: invoiceId,
          tier: ctx.tier,
          content: ctx.content,
          status: 'pending_approval',
          drafted_at: new Date('2024-01-01T00:00:00.000Z').toISOString(),
          sent_at: null,
          invoice: {
            invoice_number: ctx.invoiceNumber,
            amount: ctx.amount,
            due_date: ctx.dueDate,
            client: { name: ctx.clientName, email: ctx.clientEmail },
          },
        };
        followUps.push(followUp);

        const res = await fetch(`${baseUrl}/follow-ups/${followUpId}/approve`, {
          method: 'POST',
        });

        // Confirmed delivery yields a 200 with the sent follow-up.
        if (res.status !== 200) return false;
        const body = (await res.json()) as ApproveBody;

        // (a) Transition to "sent" in the response and in the store.
        if (body.follow_up?.status !== 'sent') return false;

        const stored = followUps.find((f) => f.id === followUpId);
        if (!stored || stored.status !== 'sent') return false;

        // (b) Delivery timestamp stamped and appended to the invoice's history.
        //     The follow-up history is the set of "sent" follow-ups for the
        //     invoice, each carrying its escalation tier and delivery
        //     timestamp (Req 9.7). Verify the follow-up now qualifies as a
        //     history entry: sent, with a valid stamped timestamp and its tier
        //     preserved against the originating invoice.
        if (!isIsoTimestamp(stored.sent_at)) return false;
        if (!isIsoTimestamp(body.follow_up.sent_at)) return false;
        if (stored.tier !== ctx.tier) return false;
        if (body.follow_up.tier !== ctx.tier) return false;
        if (stored.invoice_id !== invoiceId) return false;

        const history = followUps.filter(
          (f) => f.invoice_id === invoiceId && f.status === 'sent',
        );
        const inHistory = history.some(
          (f) => f.id === followUpId && isIsoTimestamp(f.sent_at) && f.tier === ctx.tier,
        );
        if (!inHistory) return false;

        // (c) Exactly one follow-up-sent activity event for the owner (Req 9.8).
        const sentEvents = events.filter((e) => e.type === 'follow_up_sent');
        if (sentEvents.length !== 1) return false;
        const event = sentEvents[0]!;
        if (event.invoice_id !== invoiceId) return false;
        if (event.user_id !== ctx.userId) return false;

        return true;
      }),
      { numRuns: 100 },
    );
  });
});
