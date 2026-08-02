import { describe, expect, it } from 'vitest';

import {
  compareTiers,
  shouldDraft,
  tierForDaysOverdue,
  tierRank,
  type Tier,
} from './escalation.js';

/**
 * Unit tests for the pure escalation-tier mapping and escalation-decision
 * logic (Requirements 8.2, 8.3, 8.4, 10.1).
 *
 * These cover concrete examples, boundaries, and the documented behavior for
 * days < 1. The universal properties are validated separately by the property
 * tests in Tasks 11.2 (Property 14) and 11.3 (Property 22).
 */

describe('tierForDaysOverdue', () => {
  it('maps 1 <= days < 7 to polite', () => {
    expect(tierForDaysOverdue(1)).toBe('polite');
    expect(tierForDaysOverdue(6)).toBe('polite');
  });

  it('maps 7 <= days < 14 to firm', () => {
    expect(tierForDaysOverdue(7)).toBe('firm');
    expect(tierForDaysOverdue(13)).toBe('firm');
  });

  it('maps days >= 14 to final_notice', () => {
    expect(tierForDaysOverdue(14)).toBe('final_notice');
    expect(tierForDaysOverdue(1000)).toBe('final_notice');
  });

  it('returns null for days < 1 (no tier defined)', () => {
    expect(tierForDaysOverdue(0)).toBeNull();
    expect(tierForDaysOverdue(-5)).toBeNull();
    expect(tierForDaysOverdue(0.9)).toBeNull();
  });

  it('floors fractional days to whole calendar days', () => {
    expect(tierForDaysOverdue(6.9)).toBe('polite');
    expect(tierForDaysOverdue(13.5)).toBe('firm');
  });

  it('returns null for non-finite inputs (kept total and deterministic)', () => {
    expect(tierForDaysOverdue(Number.NaN)).toBeNull();
    expect(tierForDaysOverdue(Number.POSITIVE_INFINITY)).toBeNull();
    expect(tierForDaysOverdue(Number.NEGATIVE_INFINITY)).toBeNull();
  });
});

describe('tierRank / compareTiers', () => {
  it('orders polite < firm < final_notice', () => {
    expect(tierRank('polite')).toBeLessThan(tierRank('firm'));
    expect(tierRank('firm')).toBeLessThan(tierRank('final_notice'));
  });

  it('compareTiers reflects the strict order', () => {
    expect(compareTiers('polite', 'firm')).toBeLessThan(0);
    expect(compareTiers('final_notice', 'polite')).toBeGreaterThan(0);
    expect(compareTiers('firm', 'firm')).toBe(0);
  });
});

describe('shouldDraft', () => {
  it('drafts when there is no prior non-discarded follow-up and a tier applies', () => {
    expect(shouldDraft(1, null)).toBe(true);
    expect(shouldDraft(20, null)).toBe(true);
  });

  it('does not draft when days < 1 (no tier applies), even with no prior', () => {
    expect(shouldDraft(0, null)).toBe(false);
    expect(shouldDraft(-3, null)).toBe(false);
  });

  it('drafts only on a strict tier increase', () => {
    // polite prior, still polite -> no draft
    expect(shouldDraft(3, 'polite')).toBe(false);
    // polite prior, now firm -> draft
    expect(shouldDraft(7, 'polite')).toBe(true);
    // firm prior, now final_notice -> draft
    expect(shouldDraft(14, 'firm')).toBe(true);
    // final_notice prior, still final_notice -> no draft
    expect(shouldDraft(30, 'final_notice')).toBe(false);
  });

  it('does not draft when the current tier is lower than the prior tier', () => {
    // Current maps to polite but prior was already firm.
    expect(shouldDraft(3, 'firm')).toBe(false);
    expect(shouldDraft(10, 'final_notice')).toBe(false);
  });

  it('does not draft when days < 1 regardless of prior tier', () => {
    const priors: Array<Tier> = ['polite', 'firm', 'final_notice'];
    for (const prior of priors) {
      expect(shouldDraft(0, prior)).toBe(false);
    }
  });
});
