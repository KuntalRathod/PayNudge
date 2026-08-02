import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  MAX_AMOUNT,
  MAX_DESCRIPTION_LENGTH,
  validateInvoiceInput,
  type InvoiceField,
} from './invoiceValidation.js';

/**
 * Property-based test for pure invoice validation.
 *
 * Feature: paynudge, Property 4: Invoice validation accepts valid input and rejects invalid input without creating a record
 *
 * Validates: Requirements 3.1, 3.5, 3.6, 3.7 — for any invoice submission, an
 * invoice validates (i.e. would be created with status "draft") if and only if
 * it references a client, the amount is between 0.01 and 999,999,999.99 with at
 * most 2 decimal places, the description is 1–2000 non-whitespace-only
 * characters, and the due date is a valid calendar date. Otherwise no record is
 * created and a field-identifying error is returned.
 *
 * ## Strategy: tagged generators + independent oracle
 *
 * Each field is generated as a `Tagged` value `{ value, valid }` where `valid`
 * is known *by construction* — valid values come from generators that only ever
 * produce acceptable inputs, invalid values from generators that only ever
 * produce unacceptable inputs. The expected outcome is then derived
 * independently of the implementation:
 *   - overall acceptance  = every field is valid
 *   - the reported field  = the FIRST invalid field in the documented
 *                           field-check order (clientId → amount → description →
 *                           due date)
 * This avoids re-implementing (and thus mirroring the bugs of) the module under
 * test inside the oracle.
 */

interface Tagged {
  value: unknown;
  valid: boolean;
}

const tag = (valid: boolean) => (value: unknown): Tagged => ({ value, valid });

// ---------------------------------------------------------------------------
// clientId
// ---------------------------------------------------------------------------

const validClientId = fc
  .string({ minLength: 1, maxLength: 40 })
  .filter((s) => s.trim().length > 0)
  .map(tag(true));

const invalidClientId = fc
  .oneof(
    fc.constant(''),
    fc.constant('   '),
    fc.constant('\t\n'),
    fc.constant(undefined),
    fc.constant(null),
    fc.integer(),
    fc.constant({}),
  )
  .map(tag(false));

const clientIdArb = fc.oneof(validClientId, invalidClientId);

// ---------------------------------------------------------------------------
// amount (accepts a number or a decimal string)
// ---------------------------------------------------------------------------

// Whole cents in [1, 999,999,999,99] map to amounts in [0.01, 999,999,999.99].
const validCents = fc.integer({ min: 1, max: 99_999_999_999 });

const validAmount = fc
  .oneof(
    validCents.map((c) => c / 100), // numeric form
    validCents.map((c) => (c / 100).toFixed(2)), // two-decimal string form
    fc.integer({ min: 1, max: 999_999_999 }).map((n) => String(n)), // integer string
  )
  .map(tag(true));

const invalidAmount = fc
  .oneof(
    fc.constant(0),
    fc.constant('0'),
    fc.integer({ min: -1_000_000, max: -1 }), // negative
    fc.constant(-0.5),
    // Strictly above the maximum.
    fc.integer({ min: 100_000_000_000, max: 200_000_000_000 }).map((c) => c / 100),
    fc.constant(MAX_AMOUNT + 0.01),
    // More than two decimal places (string is the authoritative representation).
    fc
      .tuple(fc.integer({ min: 0, max: 9999 }), fc.integer({ min: 100, max: 999_999 }))
      .map(([whole, frac]) => `${whole}.${frac}`),
    // Non-numeric / malformed strings.
    fc.constantFrom('abc', 'NaN', '1.2.3', '$5', '1e3', '', '   '),
    // Non-finite numbers and wrong types.
    fc.constantFrom(NaN, Infinity, -Infinity),
    fc.constant(null),
    fc.constant(undefined),
    fc.constant({}),
    fc.constant(true),
  )
  .map(tag(false));

const amountArb = fc.oneof(validAmount, invalidAmount);

// ---------------------------------------------------------------------------
// description (1–2000 chars, not whitespace-only)
// ---------------------------------------------------------------------------

const validDescription = fc
  .string({ minLength: 1, maxLength: MAX_DESCRIPTION_LENGTH })
  .filter((s) => s.trim().length > 0 && s.length <= MAX_DESCRIPTION_LENGTH)
  .map(tag(true));

const whitespaceOnly = fc
  .array(fc.constantFrom(' ', '\t', '\n', '\r'), { minLength: 1, maxLength: 20 })
  .map((chars) => chars.join(''));

const invalidDescription = fc
  .oneof(
    fc.constant(''),
    whitespaceOnly,
    // Longer than the maximum.
    fc
      .integer({ min: MAX_DESCRIPTION_LENGTH + 1, max: MAX_DESCRIPTION_LENGTH + 200 })
      .map((n) => 'a'.repeat(n)),
    // Wrong types.
    fc.integer(),
    fc.constant(null),
    fc.constant(undefined),
    fc.constant({}),
  )
  .map(tag(false));

const descriptionArb = fc.oneof(validDescription, invalidDescription);

// ---------------------------------------------------------------------------
// dueDate (valid ISO YYYY-MM-DD calendar date)
// ---------------------------------------------------------------------------

const validDueDate = fc
  .date({
    min: new Date('2000-01-01T00:00:00Z'),
    max: new Date('2099-12-31T00:00:00Z'),
    noInvalidDate: true,
  })
  .map((d) => d.toISOString().slice(0, 10))
  .map(tag(true));

const invalidDueDate = fc
  .oneof(
    fc.constantFrom(
      '2023-02-30', // impossible day
      '2023-02-29', // Feb 29 in a non-leap year
      '2024-13-01', // month out of range
      '2024-00-10', // month zero
      '2024-04-31', // April has 30 days
      '2024/03/15', // wrong separators
      '15-03-2024', // wrong order
      'not-a-date',
      '',
      '   ',
    ),
    fc.integer(),
    fc.constant(null),
    fc.constant(undefined),
    fc.constant({}),
  )
  .map(tag(false));

const dueDateArb = fc.oneof(validDueDate, invalidDueDate);

// ---------------------------------------------------------------------------
// Independent oracle: first invalid field in documented check order.
// ---------------------------------------------------------------------------

function expectedField(
  clientId: Tagged,
  amount: Tagged,
  description: Tagged,
  dueDate: Tagged,
): InvoiceField | null {
  if (!clientId.valid) return 'clientId';
  if (!amount.valid) return 'amount';
  if (!description.valid) return 'description';
  if (!dueDate.valid) return 'dueDate';
  return null;
}

describe('Property 4: Invoice validation accepts valid input and rejects invalid input without creating a record', () => {
  it('validates iff every field is valid, otherwise returns a field-identifying error and no record', () => {
    fc.assert(
      fc.property(
        clientIdArb,
        amountArb,
        descriptionArb,
        dueDateArb,
        (clientId, amount, description, dueDate) => {
          const input = {
            clientId: clientId.value,
            amount: amount.value,
            description: description.value,
            dueDate: dueDate.value,
          };

          const result = validateInvoiceInput(input);
          const expected = expectedField(clientId, amount, description, dueDate);

          if (expected === null) {
            // All fields valid → the invoice would be created (status "draft").
            expect(result.ok).toBe(true);
            if (result.ok) {
              expect(result.value.clientId).toBe(clientId.value);
              // Normalized amount round-trips to a canonical 2-decimal string.
              expect(result.value.amountString).toBe(result.value.amount.toFixed(2));
              expect(result.value.dueDate).toBe(dueDate.value);
            }
          } else {
            // Any invalid field → rejected, no record, error names the field.
            expect(result.ok).toBe(false);
            if (!result.ok) {
              expect(result.field).toBe(expected);
              expect(typeof result.code).toBe('string');
              expect(result.message.length).toBeGreaterThan(0);
              // No normalized record is produced on failure.
              expect('value' in result).toBe(false);
            }
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});
