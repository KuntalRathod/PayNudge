import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  MAX_AMOUNT,
  MAX_DESCRIPTION_LENGTH,
  MIN_AMOUNT,
  validateAmount,
  validateClientId,
  validateDescription,
  validateDueDate,
  validateInvoiceForm,
} from './validate';

/**
 * Unit tests for the create-invoice form validation (Req 3.1). These mirror the
 * backend's authoritative bounds so the client-side pre-check stays in sync.
 */

describe('validateClientId', () => {
  it('accepts a non-empty id', () => {
    expect(validateClientId('c1')).toBeUndefined();
  });

  it('rejects an empty or whitespace-only id', () => {
    expect(validateClientId('')).toBeTruthy();
    expect(validateClientId('   ')).toBeTruthy();
  });
});

describe('validateAmount', () => {
  it('accepts the inclusive bounds', () => {
    expect(validateAmount(String(MIN_AMOUNT))).toBeUndefined();
    expect(validateAmount(String(MAX_AMOUNT))).toBeUndefined();
    expect(validateAmount('100')).toBeUndefined();
    expect(validateAmount('100.5')).toBeUndefined();
  });

  it('rejects empty, zero, negative, out-of-range, and non-numeric amounts', () => {
    expect(validateAmount('')).toBeTruthy();
    expect(validateAmount('0')).toBeTruthy();
    expect(validateAmount('-5')).toBeTruthy();
    expect(validateAmount('1000000000')).toBeTruthy();
    expect(validateAmount('abc')).toBeTruthy();
  });

  it('rejects more than two decimal places', () => {
    expect(validateAmount('1.234')).toBe('Amount must have at most 2 decimal places.');
  });
});

describe('validateDescription', () => {
  it('accepts a normal description', () => {
    expect(validateDescription('Design work')).toBeUndefined();
  });

  it('rejects empty, whitespace-only, and over-long descriptions', () => {
    expect(validateDescription('')).toBeTruthy();
    expect(validateDescription('   ')).toBeTruthy();
    expect(validateDescription('a'.repeat(MAX_DESCRIPTION_LENGTH + 1))).toBeTruthy();
  });

  it('accepts a description exactly at the max length', () => {
    expect(validateDescription('a'.repeat(MAX_DESCRIPTION_LENGTH))).toBeUndefined();
  });
});

describe('validateDueDate', () => {
  it('accepts a real calendar date', () => {
    expect(validateDueDate('2024-02-29')).toBeUndefined();
  });

  it('rejects missing, malformed, and impossible dates', () => {
    expect(validateDueDate('')).toBeTruthy();
    expect(validateDueDate('2024/02/29')).toBeTruthy();
    expect(validateDueDate('2023-02-30')).toBeTruthy();
    expect(validateDueDate('2023-13-01')).toBeTruthy();
  });
});

describe('validateInvoiceForm', () => {
  it('returns no errors for a fully valid submission', () => {
    const errors = validateInvoiceForm({
      clientId: 'c1',
      amount: '250.00',
      description: 'Logo design',
      dueDate: '2025-01-15',
    });
    expect(errors).toEqual({});
  });

  it('collects an error per invalid field', () => {
    const errors = validateInvoiceForm({
      clientId: '',
      amount: '0',
      description: '',
      dueDate: 'nope',
    });
    expect(errors.clientId).toBeTruthy();
    expect(errors.amount).toBeTruthy();
    expect(errors.description).toBeTruthy();
    expect(errors.dueDate).toBeTruthy();
  });

  it('accepts any amount in range with at most two decimals (property)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 99_999_999 }),
        fc.integer({ min: 0, max: 99 }),
        (whole, cents) => {
          const amount = `${whole}.${cents.toString().padStart(2, '0')}`;
          expect(validateAmount(amount)).toBeUndefined();
        },
      ),
    );
  });
});
