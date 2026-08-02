/**
 * Settings/Profile validation (pure logic).
 *
 * Framework-free, side-effect-free validation for the expanded Company/Profile
 * Settings submission: business name, business address, payment instructions,
 * default payment terms, email signature, and per-tier follow-up cadence (days
 * overdue before each escalation tier). Mirrors the style of
 * {@link import('./clientValidation.js').validateClient}: every optional text
 * field is trimmed and normalized to `null` when blank, and the cadence values
 * must be positive integers in strictly increasing order (polite < firm <
 * final_notice) so the escalation ladder stays coherent.
 */

/** Fields that can be reported as invalid, in field-check order. */
export type SettingsField =
  | 'business_name'
  | 'business_address'
  | 'payment_instructions'
  | 'default_payment_terms'
  | 'email_signature'
  | 'cadence_polite_days'
  | 'cadence_firm_days'
  | 'cadence_final_notice_days';

export type SettingsValidationCode = 'missing' | 'too_long' | 'invalid_type' | 'invalid_order';

/** Raw, unvalidated settings submission. */
export interface SettingsInput {
  business_name?: unknown;
  business_address?: unknown;
  payment_instructions?: unknown;
  default_payment_terms?: unknown;
  email_signature?: unknown;
  cadence_polite_days?: unknown;
  cadence_firm_days?: unknown;
  cadence_final_notice_days?: unknown;
}

/** Normalized settings values produced on successful validation. */
export interface NormalizedSettings {
  business_name: string;
  business_address: string | null;
  payment_instructions: string | null;
  default_payment_terms: string | null;
  email_signature: string | null;
  cadence_polite_days: number;
  cadence_firm_days: number;
  cadence_final_notice_days: number;
}

export interface SettingsValidationSuccess {
  ok: true;
  value: NormalizedSettings;
}

export interface SettingsValidationFailure {
  ok: false;
  field: SettingsField;
  code: SettingsValidationCode;
  message: string;
}

export type SettingsValidationResult = SettingsValidationSuccess | SettingsValidationFailure;

export const BUSINESS_NAME_MAX_LENGTH = 200;
export const BUSINESS_ADDRESS_MAX_LENGTH = 2000;
export const PAYMENT_INSTRUCTIONS_MAX_LENGTH = 4000;
export const DEFAULT_PAYMENT_TERMS_MAX_LENGTH = 100;
export const EMAIL_SIGNATURE_MAX_LENGTH = 2000;

function trimOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function failure(
  field: SettingsField,
  code: SettingsValidationCode,
  message: string,
): SettingsValidationFailure {
  return { ok: false, field, code, message };
}

/** Parses a cadence day-count field: must be a finite integer >= 1. */
function parseCadenceDays(
  value: unknown,
  field: SettingsField,
  fallback: number,
): { ok: true; days: number } | SettingsValidationFailure {
  if (value === undefined || value === null || value === '') {
    return { ok: true, days: fallback };
  }
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num) || !Number.isInteger(num) || num < 1) {
    return failure(field, 'invalid_type', `${field} must be a whole number of at least 1.`);
  }
  return { ok: true, days: num };
}

/** Default cadence (mirrors the escalation-tier day thresholds). */
export const DEFAULT_CADENCE = {
  polite: 1,
  firm: 7,
  finalNotice: 14,
} as const;

/**
 * Validates a settings submission (Req: Improved Company/Profile Settings).
 *
 * Returns `{ ok: true, value }` with normalized values when every field is
 * valid, otherwise `{ ok: false, field, code, message }` for the first field
 * that fails, checked in a stable, documented order. Pure: never mutates its
 * input and has no side effects.
 */
export function validateSettings(
  input: SettingsInput,
  currentCadence: { polite: number; firm: number; finalNotice: number } = {
    polite: DEFAULT_CADENCE.polite,
    firm: DEFAULT_CADENCE.firm,
    finalNotice: DEFAULT_CADENCE.finalNotice,
  },
): SettingsValidationResult {
  // 1. business_name — required, 1-200 characters after trimming.
  const businessName = trimOrEmpty(input.business_name);
  if (businessName.length === 0) {
    return failure('business_name', 'missing', 'Business/sender name is required.');
  }
  if (businessName.length > BUSINESS_NAME_MAX_LENGTH) {
    return failure(
      'business_name',
      'too_long',
      `Business name must be at most ${BUSINESS_NAME_MAX_LENGTH} characters.`,
    );
  }

  // 2. business_address — optional.
  const businessAddress = trimOrEmpty(input.business_address);
  if (businessAddress.length > BUSINESS_ADDRESS_MAX_LENGTH) {
    return failure(
      'business_address',
      'too_long',
      `Business address must be at most ${BUSINESS_ADDRESS_MAX_LENGTH} characters.`,
    );
  }

  // 3. payment_instructions — optional.
  const paymentInstructions = trimOrEmpty(input.payment_instructions);
  if (paymentInstructions.length > PAYMENT_INSTRUCTIONS_MAX_LENGTH) {
    return failure(
      'payment_instructions',
      'too_long',
      `Payment instructions must be at most ${PAYMENT_INSTRUCTIONS_MAX_LENGTH} characters.`,
    );
  }

  // 4. default_payment_terms — optional (e.g. "Net 15", "Due on receipt").
  const defaultPaymentTerms = trimOrEmpty(input.default_payment_terms);
  if (defaultPaymentTerms.length > DEFAULT_PAYMENT_TERMS_MAX_LENGTH) {
    return failure(
      'default_payment_terms',
      'too_long',
      `Default payment terms must be at most ${DEFAULT_PAYMENT_TERMS_MAX_LENGTH} characters.`,
    );
  }

  // 5. email_signature — optional extra sign-off lines.
  const emailSignature = trimOrEmpty(input.email_signature);
  if (emailSignature.length > EMAIL_SIGNATURE_MAX_LENGTH) {
    return failure(
      'email_signature',
      'too_long',
      `Email signature must be at most ${EMAIL_SIGNATURE_MAX_LENGTH} characters.`,
    );
  }

  // 6-8. Cadence: each must be a positive whole number, and the three must be
  // strictly increasing (polite < firm < final_notice) so escalation makes
  // sense.
  const polite = parseCadenceDays(
    input.cadence_polite_days,
    'cadence_polite_days',
    currentCadence.polite,
  );
  if (!polite.ok) return polite;

  const firm = parseCadenceDays(input.cadence_firm_days, 'cadence_firm_days', currentCadence.firm);
  if (!firm.ok) return firm;

  const finalNotice = parseCadenceDays(
    input.cadence_final_notice_days,
    'cadence_final_notice_days',
    currentCadence.finalNotice,
  );
  if (!finalNotice.ok) return finalNotice;

  if (!(polite.days < firm.days && firm.days < finalNotice.days)) {
    return failure(
      'cadence_firm_days',
      'invalid_order',
      'Cadence thresholds must strictly increase: polite < firm < final notice.',
    );
  }

  return {
    ok: true,
    value: {
      business_name: businessName,
      business_address: businessAddress.length > 0 ? businessAddress : null,
      payment_instructions: paymentInstructions.length > 0 ? paymentInstructions : null,
      default_payment_terms: defaultPaymentTerms.length > 0 ? defaultPaymentTerms : null,
      email_signature: emailSignature.length > 0 ? emailSignature : null,
      cadence_polite_days: polite.days,
      cadence_firm_days: firm.days,
      cadence_final_notice_days: finalNotice.days,
    },
  };
}
