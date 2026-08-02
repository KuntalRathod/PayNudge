/**
 * Client validation (pure logic) — Requirement 2.
 *
 * Framework-free, side-effect-free validation for Client submissions. The same
 * rules apply to both create (Req 2.1–2.5) and update (Req 2.9, 2.10), so a
 * single {@link validateClient} function serves both flows.
 *
 * Rules:
 *   - name    : required; 1–200 characters after trimming. Missing/blank is
 *               rejected; anything longer than 200 characters is rejected.
 *   - email   : required; must conform to a standard email format after
 *               trimming.
 *   - company : OPTIONAL; when present (non-blank after trimming) it must be at
 *               most 200 characters. Absent/blank company is normalized to
 *               `null`.
 *
 * On success the result carries the NORMALIZED values (trimmed name and email,
 * trimmed company or `null`). On failure the result identifies the FIRST
 * offending field using a stable, documented field-check order:
 *
 *     1. name  →  2. email  →  3. company
 *
 * This ordering is deterministic so callers (and property tests) always get a
 * single, predictable field/code for any given invalid input.
 */

/** Fields that can be reported as invalid, in field-check order. */
export type ClientField = 'name' | 'email' | 'company';

/**
 * Machine-readable reason a field was rejected:
 *   - `missing`        : a required value was absent or blank.
 *   - `too_long`       : the value exceeded its maximum length bound.
 *   - `invalid_format` : the value did not match its required format.
 */
export type ClientValidationCode = 'missing' | 'too_long' | 'invalid_format';

/** Raw, unvalidated client submission (create or update). */
export interface ClientInput {
  name?: string | null;
  email?: string | null;
  company?: string | null;
}

/** Normalized client values produced on successful validation. */
export interface NormalizedClient {
  name: string;
  email: string;
  /** Trimmed company, or `null` when no company was provided. */
  company: string | null;
}

/** Discriminated success result. */
export interface ClientValidationSuccess {
  ok: true;
  value: NormalizedClient;
}

/** Discriminated failure result identifying the first offending field. */
export interface ClientValidationFailure {
  ok: false;
  field: ClientField;
  code: ClientValidationCode;
  message: string;
}

/** Discriminated union returned by {@link validateClient}. */
export type ClientValidationResult = ClientValidationSuccess | ClientValidationFailure;

/** Inclusive minimum length for a client name. */
export const NAME_MIN_LENGTH = 1;
/** Inclusive maximum length for a client name. */
export const NAME_MAX_LENGTH = 200;
/** Inclusive maximum length for a client company. */
export const COMPANY_MAX_LENGTH = 200;

/**
 * Standard email format: a local part, an `@`, a dotted domain, and a
 * 2+ character alphabetic top-level label. This rejects obvious non-emails
 * (no `@`, no domain, trailing/leading dots) while accepting ordinary
 * addresses.
 */
const EMAIL_REGEX = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/;

/** Coerces a possibly-null/undefined value to a trimmed string. */
function trimOrEmpty(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function failure(
  field: ClientField,
  code: ClientValidationCode,
  message: string,
): ClientValidationFailure {
  return { ok: false, field, code, message };
}

/**
 * Validates a client submission for create or update.
 *
 * Returns `{ ok: true, value }` with normalized values when every field is
 * valid, otherwise `{ ok: false, field, code, message }` for the first field
 * that fails, checked in the order name → email → company. The function is
 * pure: it never mutates its input and has no side effects, so a rejected
 * submission leaves any existing stored record untouched (Req 2.10).
 */
export function validateClient(input: ClientInput): ClientValidationResult {
  // 1. Name — required, 1–200 characters after trimming.
  const name = trimOrEmpty(input.name);
  if (name.length === 0) {
    return failure('name', 'missing', 'Client name is required.');
  }
  if (name.length > NAME_MAX_LENGTH) {
    return failure(
      'name',
      'too_long',
      `Client name must be at most ${NAME_MAX_LENGTH} characters.`,
    );
  }

  // 2. Email — required, standard email format after trimming.
  const email = trimOrEmpty(input.email);
  if (email.length === 0) {
    return failure('email', 'missing', 'Client email is required.');
  }
  if (!EMAIL_REGEX.test(email)) {
    return failure('email', 'invalid_format', 'Client email must be a valid email address.');
  }

  // 3. Company — optional; when present must be at most 200 characters.
  const company = trimOrEmpty(input.company);
  if (company.length > COMPANY_MAX_LENGTH) {
    return failure(
      'company',
      'too_long',
      `Client company must be at most ${COMPANY_MAX_LENGTH} characters.`,
    );
  }

  return {
    ok: true,
    value: {
      name,
      email,
      company: company.length > 0 ? company : null,
    },
  };
}
