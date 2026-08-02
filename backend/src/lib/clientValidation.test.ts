import { describe, expect, it } from 'vitest';

import {
  COMPANY_MAX_LENGTH,
  NAME_MAX_LENGTH,
  validateClient,
  type ClientValidationFailure,
} from './clientValidation.js';

/**
 * Example-based unit tests for client validation (Requirement 2.1–2.5, 2.10).
 * The dedicated property test (Property 3) is implemented separately in
 * task 4.2.
 */

function expectFailure(result: ReturnType<typeof validateClient>): ClientValidationFailure {
  if (result.ok) {
    throw new Error('expected validation to fail');
  }
  return result;
}

describe('validateClient', () => {
  it('accepts a valid client and normalizes (trims) values', () => {
    const result = validateClient({
      name: '  Ada Lovelace  ',
      email: '  ada@example.com ',
      company: '  Analytical Engines  ',
    });

    expect(result).toEqual({
      ok: true,
      value: { name: 'Ada Lovelace', email: 'ada@example.com', company: 'Analytical Engines' },
    });
  });

  it('treats an absent company as null (company is optional)', () => {
    const result = validateClient({ name: 'Grace', email: 'grace@example.com' });
    expect(result).toEqual({
      ok: true,
      value: { name: 'Grace', email: 'grace@example.com', company: null },
    });
  });

  it('treats a blank company as null', () => {
    const result = validateClient({ name: 'Grace', email: 'grace@example.com', company: '   ' });
    expect(result.ok && result.value.company).toBeNull();
  });

  it('accepts boundary-length name (200 chars) and company (200 chars)', () => {
    const result = validateClient({
      name: 'a'.repeat(NAME_MAX_LENGTH),
      email: 'edge@example.com',
      company: 'c'.repeat(COMPANY_MAX_LENGTH),
    });
    expect(result.ok).toBe(true);
  });

  it('rejects a missing name as missing', () => {
    const fail = expectFailure(validateClient({ email: 'x@example.com' }));
    expect(fail.field).toBe('name');
    expect(fail.code).toBe('missing');
  });

  it('rejects a blank/whitespace-only name as missing', () => {
    const fail = expectFailure(validateClient({ name: '   ', email: 'x@example.com' }));
    expect(fail.field).toBe('name');
    expect(fail.code).toBe('missing');
  });

  it('rejects a name longer than 200 characters as too_long', () => {
    const fail = expectFailure(
      validateClient({ name: 'a'.repeat(NAME_MAX_LENGTH + 1), email: 'x@example.com' }),
    );
    expect(fail.field).toBe('name');
    expect(fail.code).toBe('too_long');
  });

  it('rejects a missing email as missing', () => {
    const fail = expectFailure(validateClient({ name: 'Ada' }));
    expect(fail.field).toBe('email');
    expect(fail.code).toBe('missing');
  });

  it('rejects a malformed email as invalid_format', () => {
    const fail = expectFailure(validateClient({ name: 'Ada', email: 'not-an-email' }));
    expect(fail.field).toBe('email');
    expect(fail.code).toBe('invalid_format');
  });

  it('rejects a company longer than 200 characters as too_long', () => {
    const fail = expectFailure(
      validateClient({
        name: 'Ada',
        email: 'ada@example.com',
        company: 'c'.repeat(COMPANY_MAX_LENGTH + 1),
      }),
    );
    expect(fail.field).toBe('company');
    expect(fail.code).toBe('too_long');
  });

  it('reports name before email when both are invalid (stable field order)', () => {
    const fail = expectFailure(validateClient({ name: '', email: 'bad' }));
    expect(fail.field).toBe('name');
  });
});
