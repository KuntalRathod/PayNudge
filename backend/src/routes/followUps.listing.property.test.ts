import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { createFollowUpsRouter } from './followUps.js';

// Feature: paynudge, Property 18: Pending follow-up listing is ordered and context-complete

/**
 * Property-based test for the pending follow-up listing endpoint
 * (`GET /follow-ups?status=pending_approval`).
 *
 * **Validates: Requirements 9.2** — for any set of pending follow-ups owned by a
 * user, the listing returns them ordered from most recently drafted to least
 * recently drafted (`drafted_at` descending), each including the drafted email
 * content and the associated invoice number, amount, due date, and client name.
 *
 * The router is mounted on a real Express app and exercised over HTTP, reusing
 * the in-memory fake-Supabase harness pattern from `followUps.test.ts`. The fake
 * simulates Row Level Security by scoping every query to the "current" user id
 * and mimics PostgREST resource embedding by returning each follow-up with its
 * associated invoice (number, amount, due date) and nested client already
 * joined in.
 *
 * A single server serves every fast-check iteration; the shared in-memory state
 * is reset at the start of each generated case so runs are independent. Each
 * case seeds a randomized set of pending follow-ups (with distinct random
 * `drafted_at` timestamps and embedded invoice/client context) plus noise rows —
 * non-pending follow-ups the same user owns and a pending follow-up owned by
 * another user — none of which may appear in the listing.
 */

/** Embedded client shape returned alongside an invoice (PostgREST embedding). */
interface EmbeddedClient {
  name: string;
  email?: string;
}

/** Embedded invoice shape returned alongside a follow-up (PostgREST embedding). */
interface EmbeddedInvoice {
  invoice_number: number;
  amount: number;
  due_date: string;
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

interface QueryResult {
  data: unknown;
  error: { message?: string } | null;
}

/** A filter accumulated on the fake query builder. */
interface EqFilter {
  column: string;
  value: unknown;
}

/** Mutable, per-iteration in-memory database shared with the fake client. */
interface Db {
  followUps: StoredFollowUp[];
  currentUserId: string;
}

/**
 * Minimal chainable query builder mimicking the subset of the Supabase JS
 * client used by the listing endpoint (`select().eq().order()`). Ownership
 * scoping (RLS) is applied by filtering the backing collection to the current
 * user id, read dynamically from `db`, so a read never touches another user's
 * row — exactly as Postgres RLS would enforce.
 */
class FakeQuery implements PromiseLike<QueryResult> {
  private readonly eqs: EqFilter[] = [];
  private orderColumn: keyof StoredFollowUp | null = null;
  private orderAscending = true;

  constructor(private readonly db: Db) {}

  select(_columns?: string): this {
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
    const { user_id: _userId, sent_at: _sentAt, ...rest } = row;
    return { ...rest };
  }

  private execute(): QueryResult {
    // RLS: only the current user's rows are ever visible.
    const owned = this.db.followUps.filter((r) => r.user_id === this.db.currentUserId);
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

    return { data: result.map((r) => this.shape(r)), error: null };
  }
}

class FakeSupabase {
  constructor(private readonly db: Db) {}

  from(table: string): FakeQuery {
    if (table === 'follow_ups' || table === 'activity_events') {
      return new FakeQuery(this.db);
    }
    throw new Error(`Unexpected table: ${table}`);
  }
}

// Single shared in-memory database + server for the whole property run.
const db: Db = { followUps: [], currentUserId: randomUUID() };
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

  app.use(createFollowUpsRouter({ authMiddleware: authStub }));
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
  db.followUps.length = 0;
  db.currentUserId = randomUUID();
}

/** A non-whitespace-only string used for content and client names. */
const meaningfulText = fc
  .string({ minLength: 1, maxLength: 120 })
  .filter((s) => s.trim().length > 0);

/** A valid invoice amount: 0.01 .. 9,999,999.99, generated as integer cents. */
const amountArb = fc.integer({ min: 1, max: 999_999_999 }).map((cents) => cents / 100);

/** A positive invoice number. */
const invoiceNumberArb = fc.integer({ min: 1, max: 1_000_000 });

/** A valid ISO calendar date in `YYYY-MM-DD` form. */
const dueDateArb = fc
  .date({ min: new Date('1970-01-01T00:00:00Z'), max: new Date('2100-12-31T00:00:00Z') })
  .map((d) => d.toISOString().slice(0, 10));

/** Every legal escalation tier. */
const tierArb = fc.constantFrom('polite', 'firm', 'final_notice');

/**
 * A single pending follow-up specification. `draftedOffsetSeconds` is made
 * unique across the set (see below) so that `drafted_at` timestamps are
 * distinct and the descending order is unambiguous.
 */
const pendingSpecArb = fc.record({
  draftedOffsetSeconds: fc.integer({ min: 0, max: 5_000_000 }),
  content: meaningfulText,
  tier: tierArb,
  invoiceNumber: invoiceNumberArb,
  amount: amountArb,
  dueDate: dueDateArb,
  clientName: meaningfulText,
});

/** Statuses that must be excluded from the pending listing. */
const nonPendingStatusArb = fc.constantFrom('approved', 'sent', 'discarded');

const caseArb = fc.record({
  // A set of pending follow-ups with distinct drafted_at offsets.
  pending: fc.uniqueArray(pendingSpecArb, {
    selector: (s) => s.draftedOffsetSeconds,
    minLength: 0,
    maxLength: 8,
  }),
  // Noise: non-pending follow-ups the same user owns.
  noiseStatuses: fc.array(nonPendingStatusArb, { maxLength: 4 }),
  // Noise: how many pending follow-ups a *different* user owns.
  otherUserPendingCount: fc.integer({ min: 0, max: 3 }),
});

const BASE_DRAFTED_AT = Date.parse('2024-01-01T00:00:00.000Z');

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

describe('Property 18: Pending follow-up listing is ordered and context-complete', () => {
  it('returns the owner\'s pending follow-ups newest-drafted-first with full invoice/client context', async () => {
    await fc.assert(
      fc.asyncProperty(caseArb, async (testCase) => {
        resetDb();

        // Seed the pending follow-ups owned by the current user, recording the
        // expected context so we can assert it round-trips.
        const expected = testCase.pending.map((spec) => {
          const id = randomUUID();
          const draftedAt = new Date(
            BASE_DRAFTED_AT + spec.draftedOffsetSeconds * 1000,
          ).toISOString();
          const invoice: EmbeddedInvoice = {
            invoice_number: spec.invoiceNumber,
            amount: spec.amount,
            due_date: spec.dueDate,
            client: { name: spec.clientName },
          };
          db.followUps.push({
            id,
            user_id: db.currentUserId,
            invoice_id: randomUUID(),
            tier: spec.tier,
            content: spec.content,
            status: 'pending_approval',
            drafted_at: draftedAt,
            sent_at: null,
            invoice,
          });
          return { id, draftedAt, content: spec.content, invoice };
        });

        // Noise 1: non-pending follow-ups owned by the current user. These must
        // never appear in the pending listing (Req 9.2).
        for (const status of testCase.noiseStatuses) {
          db.followUps.push({
            id: randomUUID(),
            user_id: db.currentUserId,
            invoice_id: randomUUID(),
            tier: 'polite',
            content: 'noise',
            status,
            drafted_at: new Date(BASE_DRAFTED_AT + 9_000_000_000).toISOString(),
            sent_at: null,
            invoice: {
              invoice_number: 1,
              amount: 1,
              due_date: '2024-01-01',
              client: { name: 'Noise' },
            },
          });
        }

        // Noise 2: pending follow-ups owned by a *different* user. RLS must hide
        // them from the current user's listing (Req 9.2).
        const otherUser = randomUUID();
        for (let i = 0; i < testCase.otherUserPendingCount; i += 1) {
          db.followUps.push({
            id: randomUUID(),
            user_id: otherUser,
            invoice_id: randomUUID(),
            tier: 'firm',
            content: 'someone else',
            status: 'pending_approval',
            drafted_at: new Date(BASE_DRAFTED_AT + 8_000_000_000).toISOString(),
            sent_at: null,
            invoice: {
              invoice_number: 2,
              amount: 2,
              due_date: '2024-01-02',
              client: { name: 'Other' },
            },
          });
        }

        const res = await fetch(`${baseUrl}/follow-ups?status=pending_approval`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as ListBody;

        // The listing contains exactly the current user's pending follow-ups.
        expect(body.follow_ups).toHaveLength(expected.length);

        // Ordering: most recently drafted first (drafted_at descending).
        const expectedOrder = [...expected].sort((a, b) =>
          a.draftedAt < b.draftedAt ? 1 : a.draftedAt > b.draftedAt ? -1 : 0,
        );
        expect(body.follow_ups.map((f) => f.id)).toEqual(expectedOrder.map((e) => e.id));

        // The returned drafted_at values are themselves in non-increasing order.
        const draftedAts = body.follow_ups.map((f) => f.drafted_at);
        for (let i = 1; i < draftedAts.length; i += 1) {
          expect(draftedAts[i - 1]! >= draftedAts[i]!).toBe(true);
        }

        // Context-complete: every returned item carries its drafted content and
        // the associated invoice number, amount, due date, and client name.
        const expectedById = new Map<string, (typeof expected)[number]>(
          expected.map((e) => [e.id, e]),
        );
        for (const item of body.follow_ups) {
          const exp = expectedById.get(item.id);
          expect(exp).toBeDefined();
          expect(item.status).toBe('pending_approval');
          expect(item.content).toBe(exp!.content);
          expect(item.invoice).not.toBeNull();
          expect(item.invoice!.invoice_number).toBe(exp!.invoice.invoice_number);
          expect(item.invoice!.amount).toBe(exp!.invoice.amount);
          expect(item.invoice!.due_date).toBe(exp!.invoice.due_date);
          expect(item.invoice!.client?.name).toBe(exp!.invoice.client?.name);
        }
      }),
      { numRuns: 100 },
    );
  });
});
