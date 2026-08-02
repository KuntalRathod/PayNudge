import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  editFollowUp,
  MAX_CONTENT_LENGTH,
  type FollowUpResult,
} from './followUp.js';

// Feature: paynudge, Property 19: Follow-up content edits are validated and round-trip

/**
 * Property-based test for pure follow-up content-edit validation.
 *
 * **Validates: Requirements 9.3, 9.4** — for a pending follow-up, submitting
 * edited content replaces the stored content if and only if the content is a
 * non-empty string of at most {@link MAX_CONTENT_LENGTH} (10,000) characters;
 * otherwise the edit is rejected and the existing content is retained.
 */

/**
 * Applies an edit against a simulated stored record and returns the resulting
 * content the caller would keep: the replacement on success, or the existing
 * content on rejection (a rejected edit retains existing content per Req 9.4).
 */
function contentAfterEdit(existingContent: string, result: FollowUpResult): string {
  if (result.ok && result.content !== undefined) {
    return result.content;
  }
  return existingContent;
}

/** Existing stored content on a pending follow-up (always a valid non-empty string). */
const existingContentArb = fc
  .string({ minLength: 1, maxLength: 500 })
  .filter((s) => s.length > 0);

/**
 * Edited-content candidates spanning the full validation input space:
 *   - valid: non-empty strings within the bound (incl. the exact boundary)
 *   - empty: the empty string (rejected)
 *   - too long: strings exceeding the bound (rejected)
 *   - non-string: treated as empty and rejected
 */
const editContentArb = fc.oneof(
  // Valid content across a range of lengths, including the exact boundary.
  fc.string({ minLength: 1, maxLength: 200 }).filter((s) => s.length > 0),
  fc.constant('a'.repeat(MAX_CONTENT_LENGTH)),
  // Empty content — rejected.
  fc.constant(''),
  // Too long — just over the bound and further over.
  fc.constant('a'.repeat(MAX_CONTENT_LENGTH + 1)),
  fc
    .integer({ min: 1, max: 50 })
    .map((extra) => 'x'.repeat(MAX_CONTENT_LENGTH + extra)),
  // Non-string inputs — treated as empty and rejected.
  fc.constant(null),
  fc.constant(undefined),
  fc.integer(),
  fc.boolean(),
);

describe('Property 19: Follow-up content edits are validated and round-trip', () => {
  it('replaces content iff non-empty and <= 10,000 chars, otherwise retains existing', () => {
    fc.assert(
      fc.property(existingContentArb, editContentArb, (existingContent, newContent) => {
        const result = editFollowUp('pending_approval', newContent);

        const isValid =
          typeof newContent === 'string' &&
          newContent.length > 0 &&
          newContent.length <= MAX_CONTENT_LENGTH;

        const finalContent = contentAfterEdit(existingContent, result);

        if (isValid) {
          // Accepted: stays pending, and the stored content round-trips exactly.
          expect(result.ok).toBe(true);
          if (result.ok) {
            expect(result.status).toBe('pending_approval');
            expect(result.content).toBe(newContent);
          }
          expect(finalContent).toBe(newContent);
        } else {
          // Rejected: existing content is retained unchanged.
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.code).toMatch(/CONTENT_(EMPTY|TOO_LONG)/);
          }
          expect(finalContent).toBe(existingContent);
        }
      }),
      { numRuns: 200 },
    );
  });
});
