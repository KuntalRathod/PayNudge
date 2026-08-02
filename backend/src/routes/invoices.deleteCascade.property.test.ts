import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';

import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { afterEach, describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { createInvoicesRouter } from './invoices.js';

// Feature: paynudge, Property 27: Deleting an invoice cascades to its follow-ups

/**
 * Property-based test for the invoice delete cascade.
 *
 * **Validates: Requirements 11.7** — *for any* owned invoice with an arbitrary
 * set of associated follow-ups, `DELETE /invoices/:id` removes the invoice
 * record and every follow-up record associated with that invoice, and neither
 * is retained afterward. Follow-ups belonging to other invoices are untouched.
 *
 * The router is mounted on a real Express app and driven over HTTP. The
 * Supabase dependency is replaced with a self-contained in-memory fake that
 * simulates Row Level Security (every operation is scoped to the current user)
 * and the `on delete cascade` foreign key from `follow_ups` to `invoices`
 * (removing an invoice row removes every follow-up whose `invoice_id` matches).
 * This mirrors the harness used by the invoices integration tests.
 */

interface StoredInvoice {
  id: string;
  user_id: string;
  client_id: string;
  invoice_number: number;
  status: string;
}

interface StoredFollowUp {
  id: string;
  user_id: string;
  invoice_id: string;
  tier: string;
  status: string;
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
 * Chainable query builder mimicking the subset of the Supabase JS client the
 * delete handler uses (delete/eq/select/maybeSingle) plus the follow-up reads
 * this test performs to assert retention. Every invoice/follow-up operation is
 * scoped to `currentUserId`, exactly as Postgres RLS would enforce.
 */
class FakeQuery implements PromiseLike<QueryResult> {
  private op: 'select' | 'delete' = 'select';
  private filters: Filter[] = [];
  private single = false;

  constructor(
    private readonly table: string,
    private readonly invoices: StoredInvoice[],
    private readonly followUps: StoredFollowUp[],
    private readonly currentUserId: string,
  ) {}

  select(_columns = ''): this {
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

  private matches(row: Record<string, unknown>): boolean {
    return this.filters.every((f) => row[f.column] === f.value);
  }

  private execute(): QueryResult {
    if (this.table === 'follow_ups') {
      // RLS-scoped read of the current user's follow-ups (used by assertions).
      const owned = this.followUps.filter((f) => f.user_id === this.currentUserId);
      const filtered = owned.filter((f) => this.matches(f as unknown as Record<string, unknown>));
      return { data: filtered.map((f) => ({ ...f })), error: null };
    }

    // Invoices are RLS-scoped to the current user.
    const owned = this.invoices.filter((i) => i.user_id === this.currentUserId);

    if (this.op === 'delete') {
      const targets = owned.filter((i) => this.matches(i as unknown as Record<string, unknown>));
      const removedIds = new Set(targets.map((i) => i.id));

      // Remove the invoice rows from the shared store.
      for (const target of targets) {
        const idx = this.invoices.indexOf(target);
        if (idx >= 0) {
          this.invoices.splice(idx, 1);
        }
      }

      // Simulate the `on delete cascade` foreign key: removing an invoice row
      // removes every associated follow-up from retention (Req 11.7).
      for (let i = this.followUps.length - 1; i >= 0; i -= 1) {
        if (removedIds.has(this.followUps[i]!.invoice_id)) {
          this.followUps.splice(i, 1);
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
      return { data: found ? { ...found } : null, error: null };
    }
    return { data: filtered.map((i) => ({ ...i })), error: null };
  }
}

class FakeSupabase {
  constructor(
    private readonly invoices: StoredInvoice[],
    private readonly followUps: StoredFollowUp[],
    private readonly currentUserId: string,
  ) {}

  from(table: string): FakeQuery {
    return new FakeQuery(table, this.invoices, this.followUps, this.currentUserId);
  }
}

// Shared in-memory database and the "logged in" user for a given case.
let invoices: StoredInvoice[];
let followUps: StoredFollowUp[];
let currentUserId: string;
let fakeSupabase: FakeSupabase;
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

  app.use(createInvoicesRouter({ authMiddleware: authStub }));
  return app;
}

/** Starts a fresh app+store for one property case and returns the base URL. */
async function startHarness(seed: {
  invoices: StoredInvoice[];
  followUps: StoredFollowUp[];
  userId: string;
}): Promise<void> {
  invoices = seed.invoices;
  followUps = seed.followUps;
  currentUserId = seed.userId;
  fakeSupabase = new FakeSupabase(invoices, followUps, currentUserId);
  const app = buildApp();
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
}

async function stopHarness(): Promise<void> {
  if (server) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

afterEach(async () => {
  await stopHarness();
});

const tierArb = fc.constantFrom('polite', 'firm', 'final_notice');
const followUpStatusArb = fc.constantFrom('pending_approval', 'sent', 'discarded');

/**
 * A scenario for one property case:
 *   - `target`: the owned invoice that will be deleted, with N associated
 *     follow-ups (0..8).
 *   - `otherOwned`: another owned invoice with its own follow-ups that must
 *     survive the delete (proves the cascade is scoped to the target).
 */
const scenarioArb = fc.record({
  userId: fc.uuid(),
  targetFollowUpCount: fc.integer({ min: 0, max: 8 }),
  targetFollowUpSpecs: fc.array(
    fc.record({ tier: tierArb, status: followUpStatusArb }),
    { minLength: 0, maxLength: 8 },
  ),
  otherFollowUpSpecs: fc.array(
    fc.record({ tier: tierArb, status: followUpStatusArb }),
    { minLength: 0, maxLength: 6 },
  ),
});

describe('Property 27: Deleting an invoice cascades to its follow-ups', () => {
  it('removes the invoice and every associated follow-up, leaving others untouched', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async (scenario) => {
        const userId = scenario.userId;
        const targetInvoiceId = randomUUID();
        const otherInvoiceId = randomUUID();

        const targetInvoice: StoredInvoice = {
          id: targetInvoiceId,
          user_id: userId,
          client_id: randomUUID(),
          invoice_number: 1,
          status: 'overdue',
        };
        const otherInvoice: StoredInvoice = {
          id: otherInvoiceId,
          user_id: userId,
          client_id: randomUUID(),
          invoice_number: 2,
          status: 'sent',
        };

        const targetFollowUps: StoredFollowUp[] = scenario.targetFollowUpSpecs.map((spec) => ({
          id: randomUUID(),
          user_id: userId,
          invoice_id: targetInvoiceId,
          tier: spec.tier,
          status: spec.status,
        }));
        const otherFollowUps: StoredFollowUp[] = scenario.otherFollowUpSpecs.map((spec) => ({
          id: randomUUID(),
          user_id: userId,
          invoice_id: otherInvoiceId,
          tier: spec.tier,
          status: spec.status,
        }));

        await startHarness({
          invoices: [targetInvoice, otherInvoice],
          followUps: [...targetFollowUps, ...otherFollowUps],
          userId,
        });

        try {
          // Delete the target invoice.
          const res = await fetch(`${baseUrl}/invoices/${targetInvoiceId}`, {
            method: 'DELETE',
          });
          expect(res.status).toBe(204);

          // The invoice record is gone.
          expect(invoices.some((i) => i.id === targetInvoiceId)).toBe(false);

          // Every follow-up associated with the deleted invoice is gone.
          expect(followUps.some((f) => f.invoice_id === targetInvoiceId)).toBe(false);
          for (const fu of targetFollowUps) {
            expect(followUps.some((f) => f.id === fu.id)).toBe(false);
          }

          // The other owned invoice and all of its follow-ups are untouched.
          expect(invoices.some((i) => i.id === otherInvoiceId)).toBe(true);
          for (const fu of otherFollowUps) {
            expect(followUps.some((f) => f.id === fu.id)).toBe(true);
          }
          expect(followUps.filter((f) => f.invoice_id === otherInvoiceId)).toHaveLength(
            otherFollowUps.length,
          );
        } finally {
          await stopHarness();
        }
      }),
      { numRuns: 100 },
    );
  });
});
