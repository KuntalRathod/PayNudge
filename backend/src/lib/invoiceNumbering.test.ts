import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_MAX_ATTEMPTS,
  UNIQUE_VIOLATION_CODE,
  computeBackoffDelayMs,
  createInvoiceWithNumber,
  isUniqueViolation,
  type InsertAttemptResult,
  type InvoiceInsertExecutor,
  type NewInvoiceInput,
} from './invoiceNumbering.js';

/**
 * Unit tests for the atomic invoice-numbering retry-on-conflict loop
 * (Requirements 3.2, 3.3, 3.4).
 *
 * These exercise the pure retry/backoff control flow with a FAKE executor and
 * an injected sleep + random, so no live Postgres and no real waiting are
 * involved. Concurrency against a real transactional Postgres is covered by the
 * (skipped) property test in task 5.4 / Property 1.
 */

const input: NewInvoiceInput = {
  clientId: 'client-1',
  amount: 100.5,
  description: 'Work',
  dueDate: '2024-03-15',
};

const created = (invoiceNumber: number): InsertAttemptResult<{ invoice_number: number }> => ({
  status: 'created',
  invoice: { invoice_number: invoiceNumber },
});

const conflict: InsertAttemptResult<{ invoice_number: number }> = { status: 'conflict' };

/** A fake executor that returns a scripted sequence of attempt results. */
function scriptedExecutor(
  results: InsertAttemptResult<{ invoice_number: number }>[],
): { executor: InvoiceInsertExecutor<{ invoice_number: number }>; calls: () => number } {
  let index = 0;
  const executor: InvoiceInsertExecutor<{ invoice_number: number }> = async () => {
    const result = results[index] ?? conflict;
    index += 1;
    return result;
  };
  return { executor, calls: () => index };
}

// A no-op sleep so tests never actually wait on backoff.
const noSleep = async (): Promise<void> => {};
// Deterministic jitter source.
const fixedRandom = (): number => 0.5;

describe('isUniqueViolation', () => {
  it('detects a Postgres unique-violation by SQLSTATE', () => {
    expect(isUniqueViolation({ code: UNIQUE_VIOLATION_CODE })).toBe(true);
  });

  it.each([
    { code: '23503' },
    { code: undefined },
    null,
    undefined,
    'error',
    {},
  ])('returns false for %p', (value) => {
    expect(isUniqueViolation(value)).toBe(false);
  });
});

describe('computeBackoffDelayMs', () => {
  it('applies full jitter within the exponential cap', () => {
    // retryIndex 0 -> exp = base = 40; jitter 0.5 -> 20
    expect(
      computeBackoffDelayMs(0, { baseDelayMs: 40, maxDelayMs: 1000, random: () => 0.5 }),
    ).toBe(20);
    // retryIndex 2 -> exp = 40 * 4 = 160; jitter 0.5 -> 80
    expect(
      computeBackoffDelayMs(2, { baseDelayMs: 40, maxDelayMs: 1000, random: () => 0.5 }),
    ).toBe(80);
  });

  it('caps the exponential growth at maxDelayMs', () => {
    // exp would be 40 * 2^10, capped at 100; jitter 0.99 -> floor(99) = 99
    expect(
      computeBackoffDelayMs(10, { baseDelayMs: 40, maxDelayMs: 100, random: () => 0.99 }),
    ).toBe(99);
  });

  it('never returns a negative delay', () => {
    expect(
      computeBackoffDelayMs(0, { baseDelayMs: 10, maxDelayMs: 100, random: () => 0 }),
    ).toBe(0);
  });
});

describe('createInvoiceWithNumber', () => {
  it('returns the created invoice on the first successful attempt', async () => {
    const { executor, calls } = scriptedExecutor([created(1)]);

    const outcome = await createInvoiceWithNumber(input, executor, {
      sleep: noSleep,
      random: fixedRandom,
    });

    expect(outcome).toEqual({ ok: true, invoice: { invoice_number: 1 }, attempts: 1 });
    expect(calls()).toBe(1);
  });

  it('retries after unique-violations and then succeeds', async () => {
    const { executor, calls } = scriptedExecutor([conflict, conflict, created(7)]);

    const outcome = await createInvoiceWithNumber(input, executor, {
      sleep: noSleep,
      random: fixedRandom,
    });

    expect(outcome).toEqual({ ok: true, invoice: { invoice_number: 7 }, attempts: 3 });
    expect(calls()).toBe(3);
  });

  it('returns RETRY_EXHAUSTED with a retry hint when all attempts conflict', async () => {
    const { executor, calls } = scriptedExecutor([conflict, conflict, conflict]);

    const outcome = await createInvoiceWithNumber(input, executor, {
      maxAttempts: 3,
      retryAfterSeconds: 2,
      sleep: noSleep,
      random: fixedRandom,
    });

    expect(outcome).toEqual({
      ok: false,
      code: 'RETRY_EXHAUSTED',
      attempts: 3,
      retryAfterSeconds: 2,
    });
    expect(calls()).toBe(3);
  });

  it('defaults to the documented maximum number of attempts', async () => {
    const { executor, calls } = scriptedExecutor([]); // always conflict

    const outcome = await createInvoiceWithNumber(input, executor, {
      sleep: noSleep,
      random: fixedRandom,
    });

    expect(outcome.ok).toBe(false);
    expect(calls()).toBe(DEFAULT_MAX_ATTEMPTS);
  });

  it('sleeps between attempts but not after the final attempt', async () => {
    const { executor } = scriptedExecutor([conflict, conflict, created(2)]);
    const sleep = vi.fn(async () => {});

    await createInvoiceWithNumber(input, executor, { sleep, random: fixedRandom });

    // Two conflicts before success -> two backoff sleeps.
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('does not sleep at all when exhausted on a single permitted attempt', async () => {
    const { executor } = scriptedExecutor([conflict]);
    const sleep = vi.fn(async () => {});

    const outcome = await createInvoiceWithNumber(input, executor, {
      maxAttempts: 1,
      sleep,
      random: fixedRandom,
    });

    expect(outcome.ok).toBe(false);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('propagates non-conflict executor errors without retrying', async () => {
    let calls = 0;
    const executor: InvoiceInsertExecutor<{ invoice_number: number }> = async () => {
      calls += 1;
      throw new Error('connection reset');
    };

    await expect(
      createInvoiceWithNumber(input, executor, { sleep: noSleep, random: fixedRandom }),
    ).rejects.toThrow('connection reset');
    expect(calls).toBe(1);
  });

  it('rejects an invalid maxAttempts', async () => {
    const { executor } = scriptedExecutor([created(1)]);

    await expect(
      createInvoiceWithNumber(input, executor, { maxAttempts: 0 }),
    ).rejects.toBeInstanceOf(RangeError);
  });
});
