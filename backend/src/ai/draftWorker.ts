/**
 * LangGraph follow-up draft worker (Requirements 8.1, 8.6, 10.5).
 *
 * `draftFollowUp(invoiceId, deps)` runs a small LangGraph state machine that
 * turns an overdue invoice into a single `pending_approval` follow-up:
 *
 *   load -> tier -> guard -> generate -> validate -> (persist | recordFailure)
 *
 * mirroring the "AI Agent Flow (LangGraph)" diagram in the design:
 *
 *   1. LOAD     — read the invoice + client and compute Days_Overdue from the
 *                 due date and the current date; also read the tier of the most
 *                 recent non-discarded follow-up for the escalation guard and
 *                 the invoice's `draft_failure_count` for the failure cap.
 *   2. TIER     — map Days_Overdue to an Escalation_Tier (pure, {@link tierForDaysOverdue}).
 *   3. GUARD    — stop drafting once the invoice has hit the consecutive
 *                 draft-failure cap ({@link MAX_CONSECUTIVE_DRAFT_FAILURES}, Req 8.9);
 *                 otherwise draft only when the current tier strictly exceeds
 *                 the prior tier (pure, {@link shouldDraft}).
 *   4. GENERATE — call the injected Gemini model and validate its content
 *                 ({@link generateFollowUpDraft}).
 *   5a. PERSIST — on a valid draft, discard any existing `pending_approval`
 *                 follow-up for the invoice, insert the newly drafted one as
 *                 `pending_approval` (Req 8.6, 10.5), and reset
 *                 `draft_failure_count` to 0 (Req 8.8). The partial unique index
 *                 `follow_ups_one_pending_per_invoice` is the storage-level
 *                 backstop for the at-most-one-pending invariant.
 *   5b. RECORD  — on a generation error or invalid content, increment
 *      FAILURE    `draft_failure_count`, record a draft-failure message, and
 *                 create NO pending follow-up (Req 8.8); the message notes when
 *                 the third consecutive failure stops automatic drafting (Req 8.9).
 *
 * ## Injectable, testable boundaries
 *
 * The two side-effecting collaborators — the database and Gemini — are injected
 * so the worker is unit-testable with fakes and NEVER touches live Postgres or
 * a live model in tests:
 *
 *   - {@link DraftStore} abstracts every database read/write. The production
 *     implementation {@link SupabaseDraftStore} uses a background-job Supabase
 *     client (service role, which bypasses RLS) and therefore filters follow-up
 *     reads/writes EXPLICITLY by `user_id`, per the design's background-job rule.
 *   - {@link GenerativeModelLike} is the Gemini model (see `geminiDraft.ts`).
 *
 * ## Out of scope for this module
 *
 * The cron scheduling (Task 10.4 / Req 7.1) is handled elsewhere. This module
 * owns draft-failure counting and the 3-attempt cap (Req 8.8, 8.9): failures
 * increment the counter and record a draft-failure message but never create a
 * pending follow-up, and once the cap is reached no further automatic draft is
 * attempted.
 */

import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import {
  shouldDraft,
  tierForDaysOverdue,
  type Tier,
} from '../lib/escalation.js';
import { computeDaysOverdue, type Status } from '../lib/overdue.js';
import {
  generateFollowUpDraft,
  type FollowUpDraftInput,
  type GenerativeModelLike,
} from './geminiDraft.js';

/**
 * The invoice + client facts the worker needs to draft a follow-up, loaded in
 * the LOAD step. `amount` is a plain number in whole currency units and
 * `dueDate` is an ISO `YYYY-MM-DD` date string.
 */
export interface InvoiceContext {
  invoiceId: string;
  userId: string;
  clientName: string;
  invoiceNumber: number;
  amount: number;
  dueDate: string;
  status: Status;
  /** Description of the work billed on the invoice. */
  description: string;
  /**
   * Business/sender name from the user's profile, used to sign the follow-up
   * email. Falls back to the email prefix when not explicitly set.
   */
  senderName: string;
  /**
   * Optional extra sign-off lines from the user's profile (Settings: Email
   * Signature), appended after the sender name in generated follow-ups.
   * Optional so existing callers/fixtures that predate this field keep
   * working; treated as "none" when omitted.
   */
  emailSignature?: string | null;
  /**
   * Number of consecutive failed draft attempts recorded for this invoice
   * (`invoices.draft_failure_count`). Reset to 0 on a successful draft; once it
   * reaches {@link MAX_CONSECUTIVE_DRAFT_FAILURES} automatic drafting stops
   * (Req 8.8, 8.9).
   */
  draftFailureCount: number;
}

/**
 * The number of consecutive failed draft attempts after which automatic
 * drafting for an invoice stops (Req 8.9). Once `draft_failure_count` reaches
 * this value the worker skips with `draft_failure_cap_reached` and never calls
 * the model again for that invoice until the counter is reset by a success.
 */
export const MAX_CONSECUTIVE_DRAFT_FAILURES = 3;

/** Facts required to persist a freshly drafted follow-up. */
export interface PersistFollowUpInput {
  invoiceId: string;
  userId: string;
  tier: Tier;
  content: string;
}

/** Why a draft attempt failed, mirrored from {@link DraftOutcome}. */
export type DraftFailureReason = 'generation_error' | 'invalid_content';

/**
 * Facts required to record a single draft-failure (Req 8.8, 8.9). The worker
 * has already computed `count` as the new (post-increment) consecutive-failure
 * count and `message` as the human-readable draft-failure message (which notes
 * when the cap has been reached).
 */
export interface DraftFailureRecord {
  invoiceId: string;
  userId: string;
  reason: DraftFailureReason;
  /** New consecutive draft-failure count to persist (previous + 1). */
  count: number;
  /** Human-readable draft-failure message associated with the invoice. */
  message: string;
}

/**
 * Database port for the draft worker. All persistence goes through this
 * interface so the worker can be exercised with an in-memory fake — no live
 * Postgres in tests. The Supabase-backed implementation is
 * {@link SupabaseDraftStore}.
 */
export interface DraftStore {
  /**
   * Loads the invoice and its client, or `null` when the invoice does not
   * exist. Implementations resolve the client name via the invoice's
   * `client_id`.
   */
  loadInvoiceContext(invoiceId: string): Promise<InvoiceContext | null>;

  /**
   * Returns the Escalation_Tier of the most recent NON-discarded follow-up for
   * the invoice (ordered by draft time, newest first), or `null` when the
   * invoice has no non-discarded follow-up. Scoped explicitly by `user_id`.
   */
  getMostRecentNonDiscardedTier(
    invoiceId: string,
    userId: string,
  ): Promise<Tier | null>;

  /**
   * Discards any existing `pending_approval` follow-up for the invoice and then
   * inserts the newly drafted follow-up as `pending_approval` (Req 8.6, 10.5),
   * returning the new follow-up id. Relies on the partial unique index
   * `follow_ups_one_pending_per_invoice` as the at-most-one-pending backstop.
   * Scoped explicitly by `user_id`.
   */
  replacePendingFollowUp(input: PersistFollowUpInput): Promise<{ id: string }>;

  /**
   * Records a failed draft attempt (Req 8.8, 8.9): sets the invoice's
   * `draft_failure_count` to `input.count` (the new consecutive-failure count)
   * and records the draft-failure `message` associated with the invoice. Creates
   * NO follow-up. Scoped explicitly by `user_id`.
   */
  recordDraftFailure(input: DraftFailureRecord): Promise<void>;

  /**
   * Resets the invoice's `draft_failure_count` to 0 after a successful draft
   * (Req 8.8). Scoped explicitly by `user_id`.
   */
  resetDraftFailure(invoiceId: string, userId: string): Promise<void>;
}

/** Why a draft attempt did not produce a follow-up (no failure recorded). */
export type DraftSkipReason =
  /** The invoice id did not resolve to an invoice. */
  | 'not_found'
  /** The invoice is not in `overdue` status, so no chase applies (Req 8.1). */
  | 'not_overdue'
  /** Days_Overdue maps to no tier (< 1 day overdue). */
  | 'no_tier'
  /** The current tier does not strictly exceed the prior tier (Req 10.1). */
  | 'tier_not_increased'
  /**
   * The invoice has reached {@link MAX_CONSECUTIVE_DRAFT_FAILURES} consecutive
   * draft failures, so automatic drafting has stopped (Req 8.9).
   */
  | 'draft_failure_cap_reached';

/** Outcome of a {@link draftFollowUp} run. */
export type DraftOutcome =
  | { status: 'drafted'; followUpId: string; tier: Tier; content: string }
  | { status: 'skipped'; reason: DraftSkipReason }
  | { status: 'failed'; reason: 'generation_error'; error: unknown }
  | { status: 'failed'; reason: 'invalid_content'; missing: string[] };

/** Dependencies for {@link draftFollowUp}. */
export interface DraftDeps {
  /** Database port (see {@link SupabaseDraftStore} for production). */
  store: DraftStore;
  /** Injected Gemini model; tests pass a fake so no live call is made. */
  model: GenerativeModelLike;
  /** Clock used to compute Days_Overdue. Defaults to `() => new Date()`. */
  now?: () => Date;
  /** Optional ISO 4217 currency for amount formatting (default USD). */
  currency?: string;
  /** Optional BCP 47 locale for amount formatting (default en-US). */
  locale?: string;
}

/**
 * LangGraph state for the draft flow. Channels have no reducers: each node
 * overwrites the fields it computes.
 */
const DraftStateAnnotation = Annotation.Root({
  invoiceId: Annotation<string>,
  context: Annotation<InvoiceContext | null>,
  daysOverdue: Annotation<number>,
  priorTier: Annotation<Tier | null>,
  tier: Annotation<Tier | null>,
  content: Annotation<string | null>,
  outcome: Annotation<DraftOutcome | null>,
});

type DraftState = typeof DraftStateAnnotation.State;

/**
 * Builds the human-readable draft-failure message recorded for a failed attempt
 * (Req 8.8, 8.9). PURE. Describes the failure cause and, once the consecutive
 * failure `count` reaches {@link MAX_CONSECUTIVE_DRAFT_FAILURES}, notes that
 * automatic drafting has stopped for the invoice.
 */
export function buildDraftFailureMessage(
  invoiceId: string,
  outcome: Extract<DraftOutcome, { status: 'failed' }>,
  count: number,
): string {
  const cause =
    outcome.reason === 'generation_error'
      ? `the Gemini model call failed (${
          outcome.error instanceof Error
            ? outcome.error.message
            : String(outcome.error)
        })`
      : `the generated content was invalid (missing: ${outcome.missing.join(', ')})`;

  const base =
    `Draft attempt ${count} for invoice ${invoiceId} failed because ${cause}. ` +
    `No pending follow-up was created.`;

  if (count >= MAX_CONSECUTIVE_DRAFT_FAILURES) {
    return (
      `${base} Automatic drafting has stopped after ` +
      `${MAX_CONSECUTIVE_DRAFT_FAILURES} consecutive failures.`
    );
  }
  return base;
}

/**
 * Builds and compiles the LangGraph state machine for the draft flow, with the
 * store and model captured from `deps`. Exposed separately from
 * {@link draftFollowUp} so the graph can be inspected or reused.
 */
export function buildDraftGraph(deps: DraftDeps) {
  const now = deps.now ?? (() => new Date());

  /** LOAD: read invoice/client, compute Days_Overdue, read prior tier. */
  async function loadNode(state: DraftState): Promise<Partial<DraftState>> {
    const context = await deps.store.loadInvoiceContext(state.invoiceId);
    if (context === null) {
      return { context: null, outcome: { status: 'skipped', reason: 'not_found' } };
    }

    // The worker only chases invoices currently in `overdue` status (Req 8.1).
    if (context.status !== 'overdue') {
      return { context, outcome: { status: 'skipped', reason: 'not_overdue' } };
    }

    const daysOverdue = computeDaysOverdue(context.dueDate, now());
    const priorTier = await deps.store.getMostRecentNonDiscardedTier(
      context.invoiceId,
      context.userId,
    );

    return { context, daysOverdue, priorTier };
  }

  /** TIER: map Days_Overdue to an Escalation_Tier (pure). */
  function tierNode(state: DraftState): Partial<DraftState> {
    return { tier: tierForDaysOverdue(state.daysOverdue) };
  }

  /**
   * GUARD: stop drafting once the failure cap is reached (Req 8.9), then draft
   * only on a strict tier increase (pure).
   */
  function guardNode(state: DraftState): Partial<DraftState> {
    // Cap first: a capped invoice never drafts, regardless of tier (Req 8.9).
    if (state.context!.draftFailureCount >= MAX_CONSECUTIVE_DRAFT_FAILURES) {
      return {
        outcome: { status: 'skipped', reason: 'draft_failure_cap_reached' },
      };
    }
    if (state.tier === null) {
      return { outcome: { status: 'skipped', reason: 'no_tier' } };
    }
    if (!shouldDraft(state.daysOverdue, state.priorTier)) {
      return { outcome: { status: 'skipped', reason: 'tier_not_increased' } };
    }
    return {};
  }

  /** GENERATE + VALIDATE: call the injected model and validate its content. */
  async function generateNode(state: DraftState): Promise<Partial<DraftState>> {
    // `context` and `tier` are guaranteed set once we reach this node.
    const context = state.context!;
    const tier = state.tier!;

    const input: FollowUpDraftInput = {
      clientName: context.clientName,
      invoiceNumber: context.invoiceNumber,
      amount: context.amount,
      daysOverdue: state.daysOverdue,
      tier,
      senderName: context.senderName,
      description: context.description,
      currency: deps.currency,
      locale: deps.locale,
      emailSignature: context.emailSignature,
    };

    const result = await generateFollowUpDraft(deps.model, input);
    if (!result.ok) {
      if (result.reason === 'generation_error') {
        return {
          outcome: { status: 'failed', reason: 'generation_error', error: result.error },
        };
      }
      return {
        outcome: { status: 'failed', reason: 'invalid_content', missing: result.missing },
      };
    }

    return { content: result.content };
  }

  /**
   * PERSIST: discard existing pending, insert the new pending follow-up, and
   * reset the consecutive draft-failure counter on success (Req 8.8).
   */
  async function persistNode(state: DraftState): Promise<Partial<DraftState>> {
    const context = state.context!;
    const tier = state.tier!;
    const content = state.content!;

    const { id } = await deps.store.replacePendingFollowUp({
      invoiceId: context.invoiceId,
      userId: context.userId,
      tier,
      content,
    });

    // A successful draft clears any accumulated consecutive failures (Req 8.8).
    // Only write when there is something to reset.
    if (context.draftFailureCount > 0) {
      await deps.store.resetDraftFailure(context.invoiceId, context.userId);
    }

    return { outcome: { status: 'drafted', followUpId: id, tier, content } };
  }

  /**
   * RECORD FAILURE: increment `draft_failure_count`, record a draft-failure
   * message, and create no pending follow-up (Req 8.8). The message notes when
   * the third consecutive failure stops automatic drafting (Req 8.9). The
   * `failed` outcome set by GENERATE is preserved unchanged.
   */
  async function recordFailureNode(
    state: DraftState,
  ): Promise<Partial<DraftState>> {
    const context = state.context!;
    // `outcome` is guaranteed to be a `failed` outcome when we reach this node.
    const outcome = state.outcome as Extract<DraftOutcome, { status: 'failed' }>;

    const count = context.draftFailureCount + 1;
    await deps.store.recordDraftFailure({
      invoiceId: context.invoiceId,
      userId: context.userId,
      reason: outcome.reason,
      count,
      message: buildDraftFailureMessage(context.invoiceId, outcome, count),
    });

    return {};
  }

  /** Route out of LOAD: stop early when the load produced a skip outcome. */
  function afterLoad(state: DraftState): 'computeTier' | typeof END {
    return state.outcome === null ? 'computeTier' : END;
  }

  /** Route out of GUARD: stop when the guard skipped, otherwise generate. */
  function afterGuard(state: DraftState): 'generate' | typeof END {
    return state.outcome === null ? 'generate' : END;
  }

  /** Route out of GENERATE: persist on success, record the failure otherwise. */
  function afterGenerate(state: DraftState): 'persist' | 'recordFailure' {
    return state.outcome === null ? 'persist' : 'recordFailure';
  }

  return new StateGraph(DraftStateAnnotation)
    .addNode('load', loadNode)
    .addNode('computeTier', tierNode)
    .addNode('guard', guardNode)
    .addNode('generate', generateNode)
    .addNode('persist', persistNode)
    .addNode('recordFailure', recordFailureNode)
    .addEdge(START, 'load')
    .addConditionalEdges('load', afterLoad, ['computeTier', END])
    .addEdge('computeTier', 'guard')
    .addConditionalEdges('guard', afterGuard, ['generate', END])
    .addConditionalEdges('generate', afterGenerate, ['persist', 'recordFailure'])
    .addEdge('persist', END)
    .addEdge('recordFailure', END)
    .compile();
}

/**
 * Drafts a follow-up for one invoice by running the LangGraph flow (Req 8.1,
 * 8.6, 10.5).
 *
 * Loads the invoice/client and computes Days_Overdue, maps it to an
 * Escalation_Tier, guards on a strict tier increase, generates and validates
 * the content with the injected Gemini model, then — for a valid draft —
 * discards any existing `pending_approval` follow-up and inserts the new one as
 * `pending_approval`. Returns a {@link DraftOutcome} describing what happened;
 * it never throws for the normal skip/fail paths (store errors still propagate).
 */
export async function draftFollowUp(
  invoiceId: string,
  deps: DraftDeps,
): Promise<DraftOutcome> {
  const graph = buildDraftGraph(deps);
  const finalState = await graph.invoke({
    invoiceId,
    context: null,
    daysOverdue: 0,
    priorTier: null,
    tier: null,
    content: null,
    outcome: null,
  });

  // Every terminal path sets `outcome`; this fallback is defensive only.
  return (
    finalState.outcome ?? { status: 'skipped', reason: 'not_found' }
  );
}

/** Shape of an invoice row joined with its client, as selected from Supabase. */
interface InvoiceRow {
  id: string;
  user_id: string;
  invoice_number: number;
  amount: number | string;
  due_date: string;
  status: Status;
  description: string;
  draft_failure_count: number;
  clients: { name: string } | { name: string }[] | null;
}

/** Extracts the client name from Supabase's embedded relation shape. */
function clientNameFromRow(clients: InvoiceRow['clients']): string {
  if (clients === null) {
    return '';
  }
  const client = Array.isArray(clients) ? clients[0] : clients;
  return client?.name ?? '';
}

/**
 * Supabase-backed {@link DraftStore} for background jobs.
 *
 * Uses the service-role client (which bypasses RLS) and therefore filters
 * follow-up reads and writes EXPLICITLY by `user_id`, per the design's rule
 * for background jobs that act on behalf of many users.
 */
export class SupabaseDraftStore implements DraftStore {
  constructor(private readonly supabase: SupabaseClient) {}

  async loadInvoiceContext(invoiceId: string): Promise<InvoiceContext | null> {
    const { data, error } = await this.supabase
      .from('invoices')
      .select(
        'id, user_id, invoice_number, amount, due_date, status, description, draft_failure_count, clients(name)',
      )
      .eq('id', invoiceId)
      .maybeSingle<InvoiceRow>();

    if (error) {
      throw new Error(`Failed to load invoice ${invoiceId}: ${error.message}`);
    }
    if (!data) {
      return null;
    }

    // Load the user's profile to get business_name (and optional email
    // signature) for the email sign-off. Falls back to email prefix if the
    // profile doesn't exist or business_name is empty.
    let senderName = '';
    const { data: profile } = await this.supabase
      .from('profiles')
      .select('business_name, email_signature')
      .eq('id', data.user_id)
      .maybeSingle<{ business_name: string; email_signature: string | null }>();

    if (profile?.business_name && profile.business_name.trim().length > 0) {
      senderName = profile.business_name.trim();
    }
    const emailSignature =
      profile?.email_signature && profile.email_signature.trim().length > 0
        ? profile.email_signature.trim()
        : undefined;

    // If profile is missing or business_name is empty, fall back to user email prefix.
    if (!senderName) {
      const { data: userData } = await this.supabase.auth.admin.getUserById(data.user_id);
      const email = userData?.user?.email ?? '';
      senderName = email.split('@')[0] || 'The Team';
    }

    return {
      invoiceId: data.id,
      userId: data.user_id,
      clientName: clientNameFromRow(data.clients),
      invoiceNumber: data.invoice_number,
      amount: Number(data.amount),
      dueDate: data.due_date,
      status: data.status,
      description: data.description,
      senderName,
      emailSignature,
      draftFailureCount: data.draft_failure_count ?? 0,
    };
  }

  async getMostRecentNonDiscardedTier(
    invoiceId: string,
    userId: string,
  ): Promise<Tier | null> {
    const { data, error } = await this.supabase
      .from('follow_ups')
      .select('tier')
      .eq('invoice_id', invoiceId)
      .eq('user_id', userId)
      .neq('status', 'discarded')
      .order('drafted_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ tier: Tier }>();

    if (error) {
      throw new Error(
        `Failed to load latest follow-up tier for invoice ${invoiceId}: ${error.message}`,
      );
    }
    return data?.tier ?? null;
  }

  async replacePendingFollowUp(
    input: PersistFollowUpInput,
  ): Promise<{ id: string }> {
    // 1) Discard any existing pending follow-up for this invoice (Req 10.5).
    const { error: discardError } = await this.supabase
      .from('follow_ups')
      .update({ status: 'discarded' })
      .eq('invoice_id', input.invoiceId)
      .eq('user_id', input.userId)
      .eq('status', 'pending_approval');

    if (discardError) {
      throw new Error(
        `Failed to discard pending follow-up for invoice ${input.invoiceId}: ${discardError.message}`,
      );
    }

    // 1b) Compute this follow-up's sequence number (1st, 2nd, 3rd...) for the
    //     invoice, for display in the follow-ups UI and invoice timeline.
    const { count } = await this.supabase
      .from('follow_ups')
      .select('id', { count: 'exact', head: true })
      .eq('invoice_id', input.invoiceId)
      .eq('user_id', input.userId);
    const followUpNumber = (count ?? 0) + 1;

    // 2) Insert the newly drafted follow-up as pending_approval (Req 8.6). The
    //    partial unique index `follow_ups_one_pending_per_invoice` is the
    //    at-most-one-pending backstop if a concurrent pending row slipped in.
    const { data, error: insertError } = await this.supabase
      .from('follow_ups')
      .insert({
        invoice_id: input.invoiceId,
        user_id: input.userId,
        tier: input.tier,
        content: input.content,
        status: 'pending_approval',
        follow_up_number: followUpNumber,
      })
      .select('id')
      .single<{ id: string }>();

    if (insertError || !data) {
      throw new Error(
        `Failed to insert pending follow-up for invoice ${input.invoiceId}: ${insertError?.message ?? 'no row returned'}`,
      );
    }

    // 3) Log the "Follow-up drafted" timeline event (best-effort: a logging
    //    failure must never fail the draft itself).
    try {
      await this.supabase.from('activity_events').insert({
        user_id: input.userId,
        invoice_id: input.invoiceId,
        type: 'follow_up_drafted',
        metadata: { tier: input.tier, follow_up_number: followUpNumber },
      });
    } catch {
      // Timeline logging is best-effort.
    }

    return { id: data.id };
  }

  async recordDraftFailure(input: DraftFailureRecord): Promise<void> {
    // Persist the new consecutive-failure count on the invoice (Req 8.8). The
    // worker computes `count` from the value read during LOAD; drafting is a
    // per-invoice background job, so there is no concurrent writer to race.
    const { error } = await this.supabase
      .from('invoices')
      .update({ draft_failure_count: input.count })
      .eq('id', input.invoiceId)
      .eq('user_id', input.userId);

    if (error) {
      throw new Error(
        `Failed to record draft failure for invoice ${input.invoiceId}: ${error.message}`,
      );
    }

    // Record the draft-failure message associated with the invoice. The current
    // schema has no dedicated draft-failure table (and `activity_events` only
    // admits send/payment types), so the message is recorded as a structured
    // server-side log entry keyed by invoice and user.
    console.warn(
      `[draft-failure] invoice=${input.invoiceId} user=${input.userId} ` +
        `reason=${input.reason} count=${input.count} :: ${input.message}`,
    );
  }

  async resetDraftFailure(invoiceId: string, userId: string): Promise<void> {
    const { error } = await this.supabase
      .from('invoices')
      .update({ draft_failure_count: 0 })
      .eq('id', invoiceId)
      .eq('user_id', userId);

    if (error) {
      throw new Error(
        `Failed to reset draft failure count for invoice ${invoiceId}: ${error.message}`,
      );
    }
  }
}

/** Connection settings for the background-job (service-role) Supabase client. */
export interface BackgroundClientConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
}

/**
 * Builds a background-job Supabase client authenticated with the service-role
 * key. It bypasses RLS, so callers (e.g. {@link SupabaseDraftStore}) MUST scope
 * queries explicitly by `user_id`. Session persistence and token refresh are
 * disabled since this is a stateless server-side client.
 */
export function createBackgroundSupabaseClient(
  config: BackgroundClientConfig,
): SupabaseClient {
  return createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
