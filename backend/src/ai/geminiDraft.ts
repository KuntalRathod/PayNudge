/**
 * Gemini follow-up draft generation and content validation (Req 8.5, 8.7).
 *
 * This module has three concerns, split so the logic stays testable without
 * ever making a live API call:
 *
 *   1. {@link buildFollowUpPrompt} — a PURE function that composes the prompt
 *      sent to Gemini from the client name, invoice amount, invoice number,
 *      Days_Overdue, and Escalation_Tier. No I/O.
 *
 *   2. {@link validateDraftContent} — a PURE function that checks generated
 *      content includes the client name, invoice amount, invoice number, and
 *      Days_Overdue value (Req 8.5), returning a pass/fail signal listing any
 *      missing fields. No I/O.
 *
 *   3. {@link generateFollowUpDraft} — the single I/O boundary. It calls a
 *      Gemini model (Gemini 2.5 Flash, Req 8.7) to generate content, then
 *      validates it. The model is passed in as a {@link GenerativeModelLike},
 *      so tests inject a fake and never hit the network. {@link createGeminiModel}
 *      builds the real client from `GOOGLE_API_KEY` for production use.
 *
 * The LangGraph worker, persistence, and draft-failure counting are handled
 * separately (Tasks 11.5 / 11.8); this module only produces and validates a
 * draft's content.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';

import type { Tier } from '../lib/escalation.js';
import { formatAmount } from '../lib/invoiceEmail.js';

/** The Gemini model used for follow-up drafting (Req 8.7). */
export const GEMINI_MODEL = 'gemini-3.1-flash-lite';

/**
 * Structured input for drafting a follow-up email.
 *
 * @property clientName    Display name of the billed Client (Req 8.5).
 * @property invoiceNumber Per-user sequential invoice number (Req 8.5).
 * @property amount        Invoice amount as a number in whole currency units
 *                         (e.g. `1234.5` -> 1,234.50). Rendered with 2 decimals.
 * @property daysOverdue   Whole calendar days the invoice is overdue (Req 8.5).
 * @property tier          Escalation_Tier that sets the tone of the message.
 * @property senderName    Business/sender name to sign off the email (never a
 *                         placeholder like "[Your Name]").
 * @property description   Description of the work billed on the invoice, so the
 *                         client has full context.
 * @property currency      Optional ISO 4217 currency for amount formatting.
 *                         Defaults to `"USD"`.
 * @property locale        Optional BCP 47 locale for amount formatting.
 *                         Defaults to `"en-US"`.
 */
export interface FollowUpDraftInput {
  clientName: string;
  invoiceNumber: number;
  amount: number;
  daysOverdue: number;
  tier: Tier;
  senderName: string;
  description: string;
  currency?: string;
  locale?: string;
  /**
   * Optional extra sign-off lines from the user's Settings (e.g. a title,
   * phone number, or company tagline) appended after the sender name in the
   * email's closing. Omitted from the prompt (and email) when not provided.
   */
  emailSignature?: string | null;
}

/** Human-readable tone guidance for each Escalation_Tier. */
const TIER_GUIDANCE: Record<Tier, string> = {
  polite:
    'Use a friendly, gentle, and understanding tone. Assume the client simply ' +
    'forgot. Give them the benefit of the doubt and make paying easy.',
  firm:
    'Use a professional and firm tone. Be clear that payment is now noticeably ' +
    'overdue and that you expect it to be settled promptly, while remaining ' +
    'courteous.',
  final_notice:
    'Use a serious, direct final-notice tone. Make clear this is the last ' +
    'reminder before further action, while staying professional and free of ' +
    'threats or insults.',
};

/**
 * Amount threshold above which the "polite" tier should still use a
 * professional tone rather than overly casual greetings. In whole currency
 * units (e.g. 10000 = $10,000).
 */
export const HIGH_AMOUNT_THRESHOLD = 10_000;

/**
 * Composes the prompt sent to Gemini for a follow-up email (Req 8.5, 8.7).
 *
 * PURE and deterministic. The prompt instructs the model to write a follow-up
 * whose tone matches the {@link Tier} and that MUST embed the client name, the
 * exact invoice number, the exact formatted amount, and the Days_Overdue value
 * so the generated content satisfies Req 8.5. The email is signed with the
 * sender's business name and includes the invoice description for context.
 */
export function buildFollowUpPrompt(input: FollowUpDraftInput): string {
  const {
    clientName,
    invoiceNumber,
    amount,
    daysOverdue,
    tier,
    senderName,
    description,
    currency,
    locale,
    emailSignature,
  } = input;

  const formattedAmount = formatAmount(amount, currency, locale);
  const dayWord = daysOverdue === 1 ? 'day' : 'days';

  // For high-value invoices at the "polite" tier, nudge the tone to be more
  // professional rather than overly casual.
  let toneGuidance = TIER_GUIDANCE[tier];
  if (tier === 'polite' && amount >= HIGH_AMOUNT_THRESHOLD) {
    toneGuidance =
      'Use a polite yet professional tone. The amount is significant, so avoid ' +
      'overly casual greetings like "I hope you\'re having a great week!". Be ' +
      'respectful and clear, assume the client simply forgot, but maintain a ' +
      'business-appropriate register throughout.';
  }

  return [
    'You are an assistant that drafts a payment follow-up email on behalf of a',
    'freelancer to their client about an overdue invoice.',
    '',
    `Tone: ${toneGuidance}`,
    '',
    'Facts you MUST use exactly as given and include verbatim in the email body:',
    `- Client name: ${clientName}`,
    `- Invoice number: ${invoiceNumber}`,
    `- Amount due: ${formattedAmount}`,
    `- Days overdue: ${daysOverdue} ${dayWord}`,
    `- Description of work: ${description}`,
    `- Sender/sign-off name: ${senderName}`,
    '',
    'Requirements for your response:',
    `- Address the client by name (${clientName}).`,
    `- Reference the invoice by its number (${invoiceNumber}).`,
    `- State the amount due (${formattedAmount}).`,
    `- State that it is ${daysOverdue} ${dayWord} overdue.`,
    `- Mention what the invoice is for (${description}).`,
    `- Sign off the email using the sender name "${senderName}"${
      emailSignature && emailSignature.trim().length > 0
        ? ` followed by these additional sign-off lines exactly as given:\n  "${emailSignature.trim()}"`
        : ''
    } — do NOT use`,
    '  any placeholder like "[Your Name]" or "[Company Name]".',
    '- Do NOT include any payment links, URLs, or placeholder text like',
    '  "[Insert Link]" — there is no payment link feature.',
    '- Do NOT use any square-bracket placeholders like "[...]" anywhere in the',
    '  email. Every piece of information you need is provided above.',
    '- Keep it concise (a short email, not a letter).',
    '- Return only the email body text, with no subject line, preamble,',
    '  markdown, or placeholders.',
  ].join('\n');
}

/** Outcome of validating generated draft content (Req 8.5). */
export type DraftContentValidation =
  | { ok: true }
  | { ok: false; missing: string[] };

/** Builds the candidate string representations of the invoice amount. */
function amountRepresentations(
  amount: number,
  currency?: string,
  locale?: string,
): string[] {
  const reps = new Set<string>();

  // Currency-formatted, matching how the prompt renders it (e.g. "$1,234.50").
  reps.add(formatAmount(amount, currency, locale));

  if (Number.isFinite(amount)) {
    // Plain fixed 2-decimal form (e.g. "1234.50").
    reps.add(amount.toFixed(2));

    // Grouped decimal form without a currency symbol (e.g. "1,234.50").
    try {
      reps.add(
        new Intl.NumberFormat(locale ?? 'en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }).format(amount),
      );
    } catch {
      // Ignore locale errors; the other representations remain.
    }
  } else {
    reps.add(String(amount));
  }

  return [...reps].filter((r) => r.length > 0);
}

/**
 * Validates that generated content includes every field required by Req 8.5:
 * the client name, invoice amount, invoice number, and Days_Overdue value.
 *
 * PURE and deterministic. Presence is checked by substring match: the client
 * name is matched case-insensitively (after trimming), while the numeric
 * fields are matched against reasonable string representations (the invoice
 * number, and the amount as currency-formatted, plain 2-decimal, and
 * grouped-decimal forms). Returns `{ ok: true }` when all fields are present,
 * otherwise `{ ok: false, missing }` naming each absent field.
 */
export function validateDraftContent(
  content: string,
  input: FollowUpDraftInput,
): DraftContentValidation {
  const missing: string[] = [];

  const haystack = typeof content === 'string' ? content : '';
  const lower = haystack.toLowerCase();

  // Client name (case-insensitive, trimmed). A blank name cannot be validated.
  const name = input.clientName.trim();
  if (name.length === 0 || !lower.includes(name.toLowerCase())) {
    missing.push('clientName');
  }

  // Invoice number.
  if (!haystack.includes(String(input.invoiceNumber))) {
    missing.push('invoiceNumber');
  }

  // Invoice amount (any accepted representation).
  const amountReps = amountRepresentations(
    input.amount,
    input.currency,
    input.locale,
  );
  if (!amountReps.some((rep) => haystack.includes(rep))) {
    missing.push('amount');
  }

  // Days_Overdue value.
  if (!haystack.includes(String(input.daysOverdue))) {
    missing.push('daysOverdue');
  }

  return missing.length === 0 ? { ok: true } : { ok: false, missing };
}

/**
 * Regex that detects unresolved square-bracket placeholder patterns in
 * generated content, such as `[Your Name]`, `[Insert Link]`, `[Company]`, etc.
 *
 * Matches `[` followed by content that looks like a placeholder instruction:
 * starts with an uppercase letter, has at least 3 alpha characters total, and
 * may contain spaces between words. This avoids false positives on content that
 * legitimately includes short bracket references (e.g. `[EU]`, `[v2]`).
 */
export const PLACEHOLDER_PATTERN = /\[[A-Z][A-Za-z]{2,}(?: [A-Za-z]+)*\]/;

/**
 * Checks generated draft content for unresolved square-bracket placeholder
 * patterns. Returns `{ ok: true }` when no placeholders are found, otherwise
 * `{ ok: false, placeholders }` listing the offending matches.
 *
 * PURE and deterministic.
 */
export function validateNoPlaceholders(
  content: string,
): { ok: true } | { ok: false; placeholders: string[] } {
  const matches = content.match(/\[[A-Z][A-Za-z]{2,}(?: [A-Za-z]+)*\]/g);
  if (!matches || matches.length === 0) {
    return { ok: true };
  }
  return { ok: false, placeholders: matches };
}

/**
 * Minimal structural interface of the Gemini generative model used here. It
 * matches the shape of `GenerativeModel` returned by `@google/generative-ai`
 * but is narrowed to only what this module needs, so tests can inject a fake
 * implementation and avoid live API calls.
 */
export interface GenerativeModelLike {
  generateContent(prompt: string): Promise<{ response: { text(): string } }>;
}

/**
 * Builds a real Gemini 2.5 Flash model client (Req 8.7) authenticated with the
 * provided `GOOGLE_API_KEY`. Production callers pass `getConfig().GOOGLE_API_KEY`.
 * Kept separate from {@link generateFollowUpDraft} so the draft logic stays
 * injectable and testable.
 */
export function createGeminiModel(apiKey: string): GenerativeModelLike {
  const client = new GoogleGenerativeAI(apiKey);
  return client.getGenerativeModel({ model: GEMINI_MODEL });
}

/** Result of a draft generation attempt. */
export type DraftGenerationResult =
  | { ok: true; content: string; tier: Tier }
  | { ok: false; reason: 'generation_error'; error: unknown }
  | { ok: false; reason: 'invalid_content'; missing: string[]; content: string };

/**
 * Timeout (ms) for a single Gemini `generateContent` call. If the model does
 * not respond within this window the generation is treated as a failure so the
 * HTTP request can resolve instead of hanging indefinitely.
 */
export const GENERATION_TIMEOUT_MS = 30_000;

/**
 * Generates a follow-up draft with Gemini and validates its content (Req 8.5,
 * 8.7).
 *
 * The single I/O boundary of this module. It builds the prompt, calls the
 * injected model, and validates the returned text:
 *   - `generation_error` — the model call threw (network/API error).
 *   - `invalid_content`  — the model returned text missing a required field.
 *   - `contains_placeholders` — the model returned text with unresolved
 *     square-bracket placeholders like "[Your Name]" or "[Insert Link]".
 *   - success            — validated content plus the input tier.
 *
 * The model is injected so tests supply a fake; no live call happens in tests.
 * This function does not persist anything or count failures — the worker
 * (Tasks 11.5 / 11.8) owns those side effects.
 */
export async function generateFollowUpDraft(
  model: GenerativeModelLike,
  input: FollowUpDraftInput,
): Promise<DraftGenerationResult> {
  const prompt = buildFollowUpPrompt(input);

  let content: string;
  try {
    const result = await Promise.race([
      model.generateContent(prompt),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Gemini generation timed out')), GENERATION_TIMEOUT_MS),
      ),
    ]);
    content = result.response.text().trim();
  } catch (error) {
    return { ok: false, reason: 'generation_error', error };
  }

  const validation = validateDraftContent(content, input);
  if (!validation.ok) {
    return { ok: false, reason: 'invalid_content', missing: validation.missing, content };
  }

  // Reject content containing unresolved bracket-style placeholders like
  // "[Your Name]" or "[Insert Link]". This counts as invalid content.
  const placeholderCheck = validateNoPlaceholders(content);
  if (!placeholderCheck.ok) {
    return {
      ok: false,
      reason: 'invalid_content',
      missing: [`unresolved_placeholders: ${placeholderCheck.placeholders.join(', ')}`],
      content,
    };
  }

  return { ok: true, content, tier: input.tier };
}
