import { describe, expect, it } from 'vitest';

import { validateSettings } from './settingsValidation.js';

describe('validateSettings', () => {
  it('accepts a minimal valid submission with defaulted cadence', () => {
    const result = validateSettings({ business_name: 'Jane Smith' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.business_name).toBe('Jane Smith');
      expect(result.value.business_address).toBeNull();
      expect(result.value.payment_instructions).toBeNull();
      expect(result.value.default_payment_terms).toBeNull();
      expect(result.value.email_signature).toBeNull();
      expect(result.value.cadence_polite_days).toBe(1);
      expect(result.value.cadence_firm_days).toBe(7);
      expect(result.value.cadence_final_notice_days).toBe(14);
    }
  });

  it('rejects a missing business name', () => {
    const result = validateSettings({ business_name: '  ' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.field).toBe('business_name');
      expect(result.code).toBe('missing');
    }
  });

  it('normalizes optional blank fields to null and trims provided ones', () => {
    const result = validateSettings({
      business_name: 'Acme',
      business_address: '  123 Main St  ',
      payment_instructions: '',
      default_payment_terms: 'Net 15',
      email_signature: '   ',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.business_address).toBe('123 Main St');
      expect(result.value.payment_instructions).toBeNull();
      expect(result.value.default_payment_terms).toBe('Net 15');
      expect(result.value.email_signature).toBeNull();
    }
  });

  it('rejects an out-of-order cadence', () => {
    const result = validateSettings({
      business_name: 'Acme',
      cadence_polite_days: 10,
      cadence_firm_days: 5,
      cadence_final_notice_days: 20,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('invalid_order');
    }
  });

  it('rejects a non-integer cadence value', () => {
    const result = validateSettings({
      business_name: 'Acme',
      cadence_polite_days: 1.5,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.field).toBe('cadence_polite_days');
      expect(result.code).toBe('invalid_type');
    }
  });

  it('rejects a business name exceeding the max length', () => {
    const result = validateSettings({ business_name: 'a'.repeat(201) });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.field).toBe('business_name');
      expect(result.code).toBe('too_long');
    }
  });

  it('falls back to the caller-supplied current cadence when fields are omitted', () => {
    const result = validateSettings(
      { business_name: 'Acme' },
      { polite: 2, firm: 9, finalNotice: 20 },
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.cadence_polite_days).toBe(2);
      expect(result.value.cadence_firm_days).toBe(9);
      expect(result.value.cadence_final_notice_days).toBe(20);
    }
  });
});
