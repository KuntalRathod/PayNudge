import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  COMPANY_MAX_LENGTH,
  NAME_MAX_LENGTH,
  fieldFromMessage,
  type ClientField,
} from './types';

/**
 * Unit + property tests for the client-management field mapping helper.
 *
 * `fieldFromMessage` recovers which input to highlight from a backend 400
 * message (the shared API client only surfaces the message string, not the
 * structured `field`). These tests pin the mapping the create/edit form relies
 * on (Req 2.1) to highlight the offending field.
 */
describe('fieldFromMessage', () => {
  it('maps the backend name-error messages to the name field', () => {
    expect(fieldFromMessage('Client name is required.')).toBe('name');
    expect(fieldFromMessage('Client name must be at most 200 characters.')).toBe('name');
  });

  it('maps the backend email-error messages to the email field', () => {
    expect(fieldFromMessage('Client email is required.')).toBe('email');
    expect(fieldFromMessage('Client email must be a valid email address.')).toBe('email');
  });

  it('maps the backend company-error message to the company field', () => {
    expect(fieldFromMessage('Client company must be at most 200 characters.')).toBe('company');
  });

  it('returns null when no known field is mentioned', () => {
    expect(fieldFromMessage('Something went wrong. Please try again.')).toBeNull();
    expect(fieldFromMessage('')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(fieldFromMessage('NAME is required')).toBe('name');
    expect(fieldFromMessage('Invalid EMAIL format')).toBe('email');
  });

  // Property: whenever a field keyword appears in a message, the helper returns
  // a valid ClientField (never throws, always a known field or null).
  it('always returns a valid field or null for arbitrary strings', () => {
    const validFields: ClientField[] = ['name', 'email', 'company'];
    fc.assert(
      fc.property(fc.string(), (message) => {
        const result = fieldFromMessage(message);
        expect(result === null || validFields.includes(result)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

describe('length bounds mirror the backend contract', () => {
  it('exposes the 200-char name and company maxima (Req 2.1, 2.4)', () => {
    expect(NAME_MAX_LENGTH).toBe(200);
    expect(COMPANY_MAX_LENGTH).toBe(200);
  });
});
