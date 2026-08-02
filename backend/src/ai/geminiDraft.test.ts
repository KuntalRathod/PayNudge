import { describe, expect, it, vi } from 'vitest';

import {
  buildFollowUpPrompt,
  generateFollowUpDraft,
  validateDraftContent,
  GEMINI_MODEL,
  type FollowUpDraftInput,
  type GenerativeModelLike,
} from './geminiDraft.js';

/**
 * Unit tests for Gemini follow-up draft generation and content validation
 * (Req 8.5, 8.7).
 *
 * No live API calls: {@link generateFollowUpDraft} is exercised with a fake
 * {@link GenerativeModelLike}. The universal "valid pending follow-up" property
 * is validated separately by the property test in Task 11.6 (Property 15).
 */

const baseInput: FollowUpDraftInput = {
  clientName: 'Acme Corp',
  invoiceNumber: 42,
  amount: 1234.5,
  daysOverdue: 10,
  tier: 'firm',
  senderName: 'Jane Smith',
  description: 'Website development',
};

/** A fake model returning fixed text, so no network call is made. */
function fakeModel(text: string): GenerativeModelLike {
  return {
    generateContent: vi.fn(async () => ({ response: { text: () => text } })),
  };
}

describe('buildFollowUpPrompt', () => {
  it('embeds every required fact for the model to include', () => {
    const prompt = buildFollowUpPrompt(baseInput);
    expect(prompt).toContain('Acme Corp');
    expect(prompt).toContain('42');
    expect(prompt).toContain('$1,234.50');
    expect(prompt).toContain('10 days');
  });

  it('uses the singular "day" when exactly one day overdue', () => {
    const prompt = buildFollowUpPrompt({ ...baseInput, daysOverdue: 1 });
    expect(prompt).toContain('1 day overdue');
    expect(prompt).not.toContain('1 days');
  });

  it('reflects the escalation tier tone', () => {
    expect(buildFollowUpPrompt({ ...baseInput, tier: 'polite' })).toContain('gentle');
    expect(buildFollowUpPrompt({ ...baseInput, tier: 'firm' })).toContain('firm');
    expect(
      buildFollowUpPrompt({ ...baseInput, tier: 'final_notice' }),
    ).toContain('final-notice');
  });

  it('is deterministic for identical input', () => {
    expect(buildFollowUpPrompt(baseInput)).toBe(buildFollowUpPrompt(baseInput));
  });
});

describe('validateDraftContent', () => {
  it('passes when all required fields are present', () => {
    const content =
      'Hi Acme Corp, invoice #42 for $1,234.50 is now 10 days overdue.';
    expect(validateDraftContent(content, baseInput)).toEqual({ ok: true });
  });

  it('matches the client name case-insensitively', () => {
    const content = 'hi acme corp, invoice 42 for $1,234.50 is 10 days late.';
    expect(validateDraftContent(content, baseInput)).toEqual({ ok: true });
  });

  it('accepts a plain 2-decimal amount without a currency symbol', () => {
    const content = 'Acme Corp, invoice 42 for 1234.50 is 10 days overdue.';
    expect(validateDraftContent(content, baseInput)).toEqual({ ok: true });
  });

  it('accepts a grouped-decimal amount without a currency symbol', () => {
    const content = 'Acme Corp, invoice 42 for 1,234.50 is 10 days overdue.';
    expect(validateDraftContent(content, baseInput)).toEqual({ ok: true });
  });

  it('reports the client name as missing when absent', () => {
    const content = 'Invoice 42 for $1,234.50 is 10 days overdue.';
    const result = validateDraftContent(content, baseInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.missing).toContain('clientName');
  });

  it('reports the invoice number as missing when absent', () => {
    const content = 'Acme Corp, your balance of $1,234.50 is 10 days overdue.';
    const result = validateDraftContent(content, baseInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.missing).toContain('invoiceNumber');
  });

  it('reports the amount as missing when absent', () => {
    const content = 'Acme Corp, invoice 42 is now 10 days overdue.';
    const result = validateDraftContent(content, baseInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.missing).toContain('amount');
  });

  it('reports days overdue as missing when absent', () => {
    const content = 'Acme Corp, invoice 42 for $1,234.50 is overdue.';
    const result = validateDraftContent(content, baseInput);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.missing).toContain('daysOverdue');
  });

  it('lists every missing field at once', () => {
    const result = validateDraftContent('Please pay your invoice soon.', baseInput);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missing).toEqual(
        expect.arrayContaining(['clientName', 'invoiceNumber', 'amount', 'daysOverdue']),
      );
    }
  });

  it('treats a blank client name as unvalidatable', () => {
    const result = validateDraftContent('nothing here', {
      ...baseInput,
      clientName: '   ',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.missing).toContain('clientName');
  });
});

describe('generateFollowUpDraft', () => {
  it('returns validated content when the model output is complete', async () => {
    const model = fakeModel(
      '  Hi Acme Corp, invoice #42 for $1,234.50 is 10 days overdue.  ',
    );
    const result = await generateFollowUpDraft(model, baseInput);
    expect(result).toEqual({
      ok: true,
      content: 'Hi Acme Corp, invoice #42 for $1,234.50 is 10 days overdue.',
      tier: 'firm',
    });
    expect(model.generateContent).toHaveBeenCalledOnce();
    expect(model.generateContent).toHaveBeenCalledWith(buildFollowUpPrompt(baseInput));
  });

  it('reports invalid_content when a required field is missing', async () => {
    const model = fakeModel('Invoice 42 for $1,234.50 is 10 days overdue.');
    const result = await generateFollowUpDraft(model, baseInput);
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === 'invalid_content') {
      expect(result.missing).toContain('clientName');
      expect(result.content).toContain('Invoice 42');
    } else {
      throw new Error('expected invalid_content result');
    }
  });

  it('reports generation_error when the model call throws', async () => {
    const boom = new Error('network down');
    const model: GenerativeModelLike = {
      generateContent: vi.fn(async () => {
        throw boom;
      }),
    };
    const result = await generateFollowUpDraft(model, baseInput);
    expect(result).toEqual({ ok: false, reason: 'generation_error', error: boom });
  });
});

describe('GEMINI_MODEL', () => {
  it('targets Gemini 2.5 Flash (Req 8.7)', () => {
    expect(GEMINI_MODEL).toBe('gemini-2.5-flash');
  });
});
