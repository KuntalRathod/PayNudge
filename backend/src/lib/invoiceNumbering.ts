/**
 * Atomic per-user sequential invoice numbering with retry-on-conflict
 * (Requirements 3.2, 3.3, 3.4).
 *
 * ## What this module does
 *
 * It assigns the next invoice number for a user by INSERTing a row whose
 * `invoice_number` is computed, in a single atomic statement, as
 * `coalesce(max(invoice_number), 0) + 1` scoped to that user. The exact SQL is
 * the one specified in design.md ("Per-User Sequential Invoice Numbering"):
 *
 * ```sql
 * insert into public.invoices
 *   (user_id, client_id, invoice_number, amount, description, due_date, status)
 * select
 *   $1, $2,
 *   coalesce(max(invoice_number), 0) + 1,
 *   $3, $4, $5, 'draft'
 * from public.invoices
 * where user_id = $1
 * returning *;
 * ```
 *
 * Because Supabase / PostgREST cannot express an `INSERT ... SELECT` through the
 * query builder, that statement lives in a Postgres function
 * (`public.create_invoice_with_number`, see migration 0003) invoked here via
 * `supabase.rpc(...)`. The function runs `SECURITY INVOKER`, so `auth.uid()`
 * resolves to the request's user and RLS applies — the request-scoped Supabase
 * client from the auth middleware is passed straight through.
 *
 * ## Why retry-on-conflict
 *
 * The hard correctness backstop is the `unique (user_id, invoice_number)`
 * constraint. If two creations for the same user run concurrently they can both
 * compute the same `max + 1`; one commits and the other fails with a Postgres
 * unique-violation (`23505`). This module catches `23505` and retries with a
 * bounded, jittered exponential backoff. On retry the losing request recomputes
 * a fresh `max + 1` and succeeds. When the bounded retries are exhausted it
 * returns a `RETRY_EXHAUSTED` outcome carrying a retry hint; the create endpoint
 * (task 5.5) maps that to HTTP 503.
 *
 * ## Testability
 *
 * The retry/backoff loop is pure control flow parameterized by an injectable
 * {@link InvoiceInsertExecutor}, an injectable random source, and an injectable
 * sleep function. This lets the retry-on-conflict behaviour be unit-tested with
 * a fake executor and without a live Postgres, deterministic jitter, and no real
 * waiting. The Supabase wiring is isolated in
 * {@link createSupabaseInvoiceExecutor}.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** Postgres SQLSTATE for a unique-violation. */
export const UNIQUE_VIOLATION_CODE = '23505';

/** Default number of insert attempts (1 initial try + up to 4 retries). */
export const DEFAULT_MAX_ATTEMPTS = 5;
/** Default base backoff delay (milliseconds) for the first retry. */
export const DEFAULT_BASE_DELAY_MS = 25;
/** Default ceiling for a single backoff delay (milliseconds). */
export const DEFAULT_MAX_DELAY_MS = 500;
/** Default retry hint (seconds) surfaced when retries are exhausted. */
export const DEFAULT_RETRY_AFTER_SECONDS = 1;

/** The name of the Postgres function that performs the atomic numbering. */
export const CREATE_INVOICE_RPC = 'create_invoice_with_number';

/**
 * The validated fields needed to create an invoice. `user_id` is intentionally
 * absent: it is resolved server-side from `auth.uid()` inside the RPC so a
 * caller can never assign an invoice to another user.
 */
export interface NewInvoiceInput {
  clientId: string;
  /** Numeric amount with at most two decimal places (already validated). */
  amount: number;
  description: string;
  /** ISO calendar date, `YYYY-MM-DD`. */
  dueDate: string;
}

/** A persisted invoice row as returned by the numbering RPC. */
export interface InvoiceRecord {
  id: string;
  user_id: string;
  client_id: string;
  invoice_number: number;
  /** Postgres `numeric` is returned as a string by supabase-js. */
  amount: string | number;
  description: string;
  due_date: string;
  status: string;
  sent_at: string | null;
  draft_failure_count: number;
  send_lock_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Result of a single insert attempt. `conflict` specifically means a
 * unique-violation on `(user_id, invoice_number)` — the only error the retry
 * loop treats as retryable. Any other failure must be raised as a thrown error
 * by the executor so it propagates unchanged.
 */
export type InsertAttemptResult<T> =
  | { status: 'created'; invoice: T }
  | { status: 'conflict' };

/** An injectable routine that performs one atomic numbered insert attempt. */
export type InvoiceInsertExecutor<T> = (
  input: NewInvoiceInput,
) => Promise<InsertAttemptResult<T>>;

/** Tuning + injectable dependencies for the retry loop. */
export interface RetryOptions {
  /** Maximum total attempts (must be ≥ 1). Defaults to {@link DEFAULT_MAX_ATTEMPTS}. */
  maxAttempts?: number;
  /** Base backoff delay in ms. Defaults to {@link DEFAULT_BASE_DELAY_MS}. */
  baseDelayMs?: number;
  /** Per-delay ceiling in ms. Defaults to {@link DEFAULT_MAX_DELAY_MS}. */
  maxDelayMs?: number;
  /** Retry hint (seconds) on exhaustion. Defaults to {@link DEFAULT_RETRY_AFTER_SECONDS}. */
  retryAfterSeconds?: number;
  /** Jitter source in [0, 1). Injectable for deterministic tests. Defaults to `Math.random`. */
  random?: () => number;
  /** Sleep function. Injectable so tests need not wait. Defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Outcome of {@link createInvoiceWithNumber}.
 *
 * `ok: true` carries the created invoice and how many attempts it took. The
 * `RETRY_EXHAUSTED` failure means every attempt hit a unique-violation; it
 * carries a `retryAfterSeconds` hint the endpoint maps to an HTTP 503 with a
 * `Retry-After` header.
 */
export type CreateInvoiceOutcome<T> =
  | { ok: true; invoice: T; attempts: number }
  | { ok: false; code: 'RETRY_EXHAUSTED'; attempts: number; retryAfterSeconds: number };

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Detects a Postgres unique-violation from an arbitrary error shape.
 *
 * supabase-js surfaces DB errors as objects with a `code` property carrying the
 * SQLSTATE; a unique-violation is `23505`. This narrows an `unknown` error
 * without assuming the full `PostgrestError` type.
 */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === UNIQUE_VIOLATION_CODE
  );
}

/**
 * Computes a single "full jitter" exponential backoff delay in milliseconds.
 *
 * The uncapped exponential target for retry `retryIndex` (0-based: 0 is the
 * delay before the first retry) is `baseDelayMs * 2^retryIndex`, capped at
 * `maxDelayMs`. Full jitter then picks a delay uniformly in `[0, cap)` using the
 * injected `random`, which spreads concurrent losers apart to reduce repeated
 * collisions. The result is a non-negative integer.
 */
export function computeBackoffDelayMs(
  retryIndex: number,
  options: { baseDelayMs: number; maxDelayMs: number; random: () => number },
): number {
  const exponential = options.baseDelayMs * 2 ** Math.max(0, retryIndex);
  const cap = Math.min(options.maxDelayMs, exponential);
  const jittered = options.random() * cap;
  return Math.max(0, Math.floor(jittered));
}

/**
 * Creates an invoice with an atomically assigned, per-user sequential number,
 * retrying on unique-violation with bounded jittered backoff
 * (Requirements 3.2, 3.3, 3.4).
 *
 * The provided {@link InvoiceInsertExecutor} performs each atomic insert. On a
 * `conflict` result the loop backs off (except after the final attempt) and
 * tries again; on `created` it returns immediately. If every attempt conflicts,
 * it returns a `RETRY_EXHAUSTED` outcome with a retry hint. Non-conflict errors
 * thrown by the executor are not caught here and propagate to the caller.
 *
 * @throws {RangeError} if `maxAttempts` is less than 1.
 */
export async function createInvoiceWithNumber<T>(
  input: NewInvoiceInput,
  executor: InvoiceInsertExecutor<T>,
  options: RetryOptions = {},
): Promise<CreateInvoiceOutcome<T>> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError('maxAttempts must be an integer >= 1');
  }

  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const retryAfterSeconds = options.retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS;
  const random = options.random ?? Math.random;
  const sleep = options.sleep ?? defaultSleep;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = await executor(input);

    if (result.status === 'created') {
      return { ok: true, invoice: result.invoice, attempts: attempt };
    }

    // Unique-violation: back off before another attempt, unless this was the
    // last permitted attempt.
    if (attempt < maxAttempts) {
      const delayMs = computeBackoffDelayMs(attempt - 1, { baseDelayMs, maxDelayMs, random });
      await sleep(delayMs);
    }
  }

  return { ok: false, code: 'RETRY_EXHAUSTED', attempts: maxAttempts, retryAfterSeconds };
}

/**
 * Builds an {@link InvoiceInsertExecutor} backed by a request-scoped Supabase
 * client. Each call invokes the `create_invoice_with_number` RPC, which runs the
 * design's atomic `INSERT ... SELECT coalesce(max(invoice_number),0)+1 ...`
 * statement under the caller's RLS context.
 *
 * A `23505` error is translated into a `conflict` result so the retry loop can
 * handle it; any other error is rethrown unchanged.
 */
export function createSupabaseInvoiceExecutor(
  supabase: SupabaseClient,
): InvoiceInsertExecutor<InvoiceRecord> {
  return async (input) => {
    const { data, error } = await supabase.rpc(CREATE_INVOICE_RPC, {
      p_client_id: input.clientId,
      p_amount: input.amount,
      p_description: input.description,
      p_due_date: input.dueDate,
    });

    if (error) {
      if (isUniqueViolation(error)) {
        return { status: 'conflict' };
      }
      throw error;
    }

    // The function returns a single invoice row. Depending on how PostgREST
    // shapes a composite return, `data` may arrive as the row or a one-element
    // array; normalize to the row.
    const invoice = (Array.isArray(data) ? data[0] : data) as InvoiceRecord;
    return { status: 'created', invoice };
  };
}
