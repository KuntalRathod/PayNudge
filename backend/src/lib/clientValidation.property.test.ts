import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  COMPANY_MAX_LENGTH,
  NAME_MAX_LENGTH,
  validateClient,
  type ClientField,
  type ClientInput,
  type ClientValidationCode,
} from './clientValidation.js';

/**
 * Property-based test for the pure client validation logic.
 *
 * Feature: paynudge, Property 3: Client validation accepts valid input and rejects invalid input without side effects
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.9, 2.10 — for any client
 * submission (create or update), the submission succeeds and persists exactly
 * the submitted (normalized) values if and only if the name is 1–200
 * characters, the email conforms to standard email format, and the company
 * (when present) is at most 200 characters; otherwise the submission is
 * rejected, a message identifying the offending field is returned, and the
 * input is left unchanged (no side effects).
 *
 * Strategy: rather than re-deriving validity from the module's private email
 * regex (which would make the test circular), each field is generated from
 * disjoint, self-labeling pools of clearly-valid and clearly-invalid values.
 * The generator therefore knows the expected outcome up front, and the test
 * asserts the module agrees — both the accept/reject decision and, on success,
 * the exact normalized values.
 */

const LOWER = 'abcdefghijklmnopqrstuvwxyz'.split('');
const ALNUM =
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split('');

/** Non-empty run of chars drawn from `chars`, joined into a string. */
function tokenArb(chars: string[], minLength: number, maxLength: number): fc.Arbitrary<string> {
  return fc.array(fc.constantFrom(...chars), { minLength, maxLength }).map((a) => a.join(''));
}

/** Leading/trailing whitespace used to exercise trimming/normalization. */
const padArb = fc.constantFrom('', ' ', '  ', '\t', ' \n ');

/**
 * A raw field value together with everything the oracle needs: its validity
 * `kind`, and (when the field is valid) the `normalized` value the module
 * should persist.
 */
interface FieldCase<TKind extends string> {
  raw: string | null | undefined;
  kind: TKind;
  normalized?: string | null;
}

// --- Name ------------------------------------------------------------------
// Valid: trims to 1..200 chars. Missing: blank/absent. too_long: trims to >200.

type NameKind = 'valid' | 'missing' | 'too_long';

const validName: fc.Arbitrary<FieldCase<NameKind>> = fc
  .tuple(padArb, tokenArb(ALNUM, 1, NAME_MAX_LENGTH), padArb)
  .map(([pre, core, post]) => ({
    raw: `${pre}${core}${post}`,
    kind: 'valid' as const,
    normalized: core,
  }));

const missingName: fc.Arbitrary<FieldCase<NameKind>> = fc
  .constantFrom<string | null | undefined>(undefined, null, '', '   ', '\t', ' \n ')
  .map((raw) => ({ raw, kind: 'missing' as const }));

const tooLongName: fc.Arbitrary<FieldCase<NameKind>> = tokenArb(
  ALNUM,
  NAME_MAX_LENGTH + 1,
  NAME_MAX_LENGTH + 50,
).map((raw) => ({ raw, kind: 'too_long' as const }));

const nameArb = fc.oneof(validName, missingName, tooLongName);

// --- Email -----------------------------------------------------------------
// Valid: local@domain.tld built from allowed chars (optionally whitespace
// padded). Missing: blank/absent. invalid_format: clearly malformed, non-blank.

type EmailKind = 'valid' | 'missing' | 'invalid_format';

const validEmail: fc.Arbitrary<FieldCase<EmailKind>> = fc
  .tuple(
    padArb,
    tokenArb(ALNUM, 1, 20),
    tokenArb(ALNUM, 1, 20),
    tokenArb(LOWER, 2, 6),
    padArb,
  )
  .map(([pre, local, domain, tld, post]) => {
    const email = `${local}@${domain}.${tld}`;
    return { raw: `${pre}${email}${post}`, kind: 'valid' as const, normalized: email };
  });

const missingEmail: fc.Arbitrary<FieldCase<EmailKind>> = fc
  .constantFrom<string | null | undefined>(undefined, null, '', '   ', '\t')
  .map((raw) => ({ raw, kind: 'missing' as const }));

const invalidEmail: fc.Arbitrary<FieldCase<EmailKind>> = fc
  .constantFrom(
    'not-an-email',
    'plainaddress',
    'foo@',
    '@bar.com',
    'a b@c.com',
    'foo@bar',
    'foo@@bar.com',
    'foo@bar.c',
    'foo@.com',
    'foo bar',
  )
  .map((raw) => ({ raw, kind: 'invalid_format' as const }));

const emailArb = fc.oneof(validEmail, missingEmail, invalidEmail);

// --- Company ---------------------------------------------------------------
// Optional. absent: blank/absent -> normalizes to null. valid: trims to
// 1..200 -> stored. too_long: trims to >200.

type CompanyKind = 'absent' | 'valid' | 'too_long';

const absentCompany: fc.Arbitrary<FieldCase<CompanyKind>> = fc
  .constantFrom<string | null | undefined>(undefined, null, '', '   ', '\t')
  .map((raw) => ({ raw, kind: 'absent' as const, normalized: null }));

const validCompany: fc.Arbitrary<FieldCase<CompanyKind>> = fc
  .tuple(padArb, tokenArb(ALNUM, 1, COMPANY_MAX_LENGTH), padArb)
  .map(([pre, core, post]) => ({
    raw: `${pre}${core}${post}`,
    kind: 'valid' as const,
    normalized: core,
  }));

const tooLongCompany: fc.Arbitrary<FieldCase<CompanyKind>> = tokenArb(
  ALNUM,
  COMPANY_MAX_LENGTH + 1,
  COMPANY_MAX_LENGTH + 50,
).map((raw) => ({ raw, kind: 'too_long' as const }));

const companyArb = fc.oneof(absentCompany, validCompany, tooLongCompany);

interface Scenario {
  name: FieldCase<NameKind>;
  email: FieldCase<EmailKind>;
  company: FieldCase<CompanyKind>;
}

const scenarioArb: fc.Arbitrary<Scenario> = fc.record({
  name: nameArb,
  email: emailArb,
  company: companyArb,
});

/**
 * Independent oracle: computes the first offending field (in the documented
 * order name -> email -> company) and its code, or `null` when the submission
 * is entirely valid.
 */
function expectedFailure(
  s: Scenario,
): { field: ClientField; code: ClientValidationCode } | null {
  if (s.name.kind !== 'valid') {
    return { field: 'name', code: s.name.kind === 'missing' ? 'missing' : 'too_long' };
  }
  if (s.email.kind !== 'valid') {
    return { field: 'email', code: s.email.kind === 'missing' ? 'missing' : 'invalid_format' };
  }
  if (s.company.kind === 'too_long') {
    return { field: 'company', code: 'too_long' };
  }
  return null;
}

describe('Property 3: Client validation accepts valid input and rejects invalid input without side effects', () => {
  it('accepts iff name/email/company are valid, persists normalized values, and never mutates input', () => {
    fc.assert(
      fc.property(scenarioArb, (s) => {
        const input: ClientInput = { name: s.name.raw, email: s.email.raw, company: s.company.raw };
        const snapshot = structuredClone(input);

        const result = validateClient(input);
        const expected = expectedFailure(s);

        if (expected === null) {
          // Biconditional (accept side): valid input succeeds with exactly the
          // submitted values, normalized (trimmed name/email, trimmed company
          // or null).
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.value).toEqual({
              name: s.name.normalized,
              email: s.email.normalized,
              company: s.company.normalized ?? null,
            });
          }
        } else {
          // Biconditional (reject side): invalid input is rejected, and the
          // failure identifies the first offending field with the right code.
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.field).toBe(expected.field);
            expect(result.code).toBe(expected.code);
            expect(typeof result.message).toBe('string');
            expect(result.message.length).toBeGreaterThan(0);
          }
        }

        // No side effects: the input object is left exactly as submitted.
        expect(input).toEqual(snapshot);
      }),
      { numRuns: 200 },
    );
  });
});
