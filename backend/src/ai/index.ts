/**
 * AI layer for PayNudge.
 *
 * Houses the Gemini-backed follow-up draft generation and the (later) LangGraph
 * draft worker. Pure prompt-building and content-validation helpers live
 * alongside the single Gemini I/O boundary, with the model injected so the
 * logic is testable without live API calls.
 */

export {
  GEMINI_MODEL,
  HIGH_AMOUNT_THRESHOLD,
  PLACEHOLDER_PATTERN,
  buildFollowUpPrompt,
  validateDraftContent,
  validateNoPlaceholders,
  createGeminiModel,
  generateFollowUpDraft,
  type FollowUpDraftInput,
  type DraftContentValidation,
  type GenerativeModelLike,
  type DraftGenerationResult,
} from './geminiDraft.js';

export {
  draftFollowUp,
  buildDraftGraph,
  buildDraftFailureMessage,
  SupabaseDraftStore,
  createBackgroundSupabaseClient,
  MAX_CONSECUTIVE_DRAFT_FAILURES,
  type DraftStore,
  type DraftDeps,
  type DraftOutcome,
  type DraftSkipReason,
  type DraftFailureReason,
  type DraftFailureRecord,
  type InvoiceContext,
  type PersistFollowUpInput,
  type BackgroundClientConfig,
} from './draftWorker.js';
