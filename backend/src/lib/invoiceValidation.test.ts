import { describe, expect, it } from 'vitest';

import {
  MAX_AMOUNT,
  MAX_DESCRIPTION_LENGTH,
  validateAmount,
  validateClientId,
  validateDescription,
  validateDueDate,
  validateInvoiceInput,
  type RawInvoiceInput,
} from './invoiceValidation.js';

/**
 * Unit tests for invoice validation (Requirements 3.1, 3.5, 3.6, 3.7).
 * Example-based cases and edge cases that complement the property test
 * (Task 5.2 / Property 4).
 */

const validInput: RawInvoiceInput = {
  clientId: 'client-123',
  amount: 100.5,
  description: 'Design work for landing page',
  dueDate: '2024-03-15',
};

describe('validateClientId', () => {
  it('accepts a non-empty string id', () => {
    expect(validateClientId('abc')).toEqual({ ok: true, value: 'abc' });
  });

  it.each([undefined, null, '', '   ', 42, {}])('rejects %p', (value) => {
    const result = validateClientId(value);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.field).toBe('clientId');
      expect(result.error.code).toBe('CLIENT_REQUIRED');
    }
  });
});

describe('validateAmount', () => {
  it('accepts the inclusive minimum 0.01', () => {
    expect(validateAmount(0.01)).toEqual({ ok: true, value: 0.01 });
  });

  it('accepts the inclusive maximum', () => {
    expect(validateAmount(MAX_AMOUNT)).toEqual({ ok: true, value: MAX_AMOUNT });
  });

  it('accepts a decimal string with two places', () => {
    expect(validateAmount('250.75')).toEqual({ ok: true, value: 250.75 });
  });

  it('accepts an integer string', () => {
    expect(validateAmount('40')).toEqual({ ok: true, value: 40 });
  });

  it('rejects zero as out of range', () => {
    const result = validateAmount(0);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('AMOUNT_OUT_OF_RANGE');
  });

  it('rejects negative amounts', () => {
    const result = validateAmount(-5);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('AMOUNT_OUT_OF_RANGE');
  });

  it('rejects amounts above the maximum', () => {
    const result = validateAmount(1_000_000_000);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('AMOUNT_OUT_OF_RANGE');
  });

  it('rejects more than two decimal places (number)', () => {
    const result = validateAmount(10.123);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('AMOUNT_TOO_MANY_DECIMALS');
  });

  it('rejects more than two decimal places (string)', () => {
    const result = validateAmount('10.123');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('AMOUNT_TOO_MANY_DECIMALS');
  });

  it.each(['abc', 'NaN', '', '  '])('rejects non-numeric / empty string %p', (value) => {
    const result = validateAmount(value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.field).toBe('amount');
  });

  it.each([NaN, Infinity, -Infinity])('rejects non-finite number %p', (value) => {
    const result = validateAmount(value);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('AMOUNT_NOT_NUMERIC');
  });
});

describe('validateDescription', () => {
  it('accepts a normal description', () => {
    expect(validateDescription('Consulting')).toEqual({ ok: true, value: 'Consulting' });
  });

  it('accepts a description at the maximum length', () => {
    const maxDesc = 'a'.repeat(MAX_DESCRIPTION_LENGTH);
    expect(validateDescription(maxDesc)).toEqual({ ok: true, value: maxDesc });
  });

  it('rejects an empty description', () => {
    const result = validateDescription('');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DESCRIPTION_REQUIRED');
  });

  it('rejects a whitespace-only description', () => {
    const result = validateDescription('   \t\n');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DESCRIPTION_WHITESPACE_ONLY');
  });

  it('rejects a description over the maximum length', () => {
    const result = validateDescription('a'.repeat(MAX_DESCRIPTION_LENGTH + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DESCRIPTION_TOO_LONG');
  });
});

describe('validateDueDate', () => {
  it('accepts a valid calendar date', () => {
    expect(validateDueDate('2024-02-29')).toEqual({ ok: true, value: '2024-02-29' });
  });

  it('rejects an impossible calendar date', () => {
    const result = validateDueDate('2023-02-30');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DUE_DATE_INVALID');
  });

  it('rejects Feb 29 in a non-leap year', () => {
    const result = validateDueDate('2023-02-29');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DUE_DATE_INVALID');
  });

  it.each(['2024/03/15', '15-03-2024', 'not-a-date', '2024-13-01', '2024-00-10'])(
    'rejects malformed / out-of-range date %p',
    (value) => {
      const result = validateDueDate(value);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.field).toBe('dueDate');
    },
  );

  it('rejects a missing date', () => {
    const result = validateDueDate(undefined);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('DUE_DATE_REQUIRED');
  });
});

describe('validateInvoiceInput', () => {
  it('accepts a fully valid submission and returns normalized values', () => {
    const result = validateInvoiceInput(validInput);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        clientId: 'client-123',
        amount: 100.5,
        amountString: '100.50',
        description: 'Design work for landing page',
        dueDate: '2024-03-15',
      });
    }
  });

  it('checks fields in order: clientId first', () => {
    const result = validateInvoiceInput({
      clientId: '',
      amount: -1,
      description: '',
      dueDate: 'bad',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe('clientId');
  });

  it('checks amount before description and dueDate', () => {
    const result = validateInvoiceInput({
      ...validInput,
      amount: 0,
      description: '',
      dueDate: 'bad',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe('amount');
  });

  it('checks description before dueDate', () => {
    const result = validateInvoiceInput({ ...validInput, description: '   ', dueDate: 'bad' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe('description');
  });

  it('reports dueDate when it is the only invalid field', () => {
    const result = validateInvoiceInput({ ...validInput, dueDate: '2023-02-30' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.field).toBe('dueDate');
  });
});
