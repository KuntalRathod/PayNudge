/**
 * Follow-ups API router — Requirement 9 (Human-in-the-Loop Approval).
 *
 * Endpoint implemented by this task (requires a valid Supabase JWT via
 * {@link requireAuth}):
 *
 *   GET /follow-ups?status=pending_approval
 *       List every Follow_Up owned by the caller in "pending_approval" status,
 *       ordered from most-recently drafted to least-recently drafted, each
 *       including the drafted email content and the associated Invoice number,
 *       amount, due date, and Client name (Req 9.2).
 *
 *   PUT  /follow-ups/:id/content   Replace the drafted content of a pending
 *       follow-up with validated, non-empty content of at most 10,000
 *       characters, retaining the existing content on an invalid edit
 *       (Req 9.3, 9.4, 9.11).
 *
 *   POST /follow-ups/:id/approve   Approve a pending follow-up (→ "approved"),
 *       deliver its content to the client email through the Email_Service
 *       within 30s, and on confirmed delivery transition it to "sent", stamp
 *       the delivery timestamp (appending it to the invoice's follow-up
 *       history), and record a follow-up-sent activity event. On a delivery
 *       error or timeout the follow-up is retained as "approved" and a
 *       delivery-failure message is returned (Req 9.5–9.9, 9.11).
 *
 *   POST /follow-ups/:id/discard   Discard a pending follow-up (→ "discarded")
 *       without delivering anything (Req 9.10, 9.11).
 *
 * Every mutating action is gated on the follow-up being in "pending_approval"
 * status. From any other status the action is rejected, the status is left
 * unchanged, and a "not pending approval" message is returned (Req 9.11). The
 * gate is enforced twice: first via the pure {@link editFollowUp}/
 * {@link approveFollowUp}/{@link discardFollowUp} reducer against the row's
 * read-back status, and again via a conditional update that only touches a row
 * still in "pending_approval", so a concurrent transition cannot slip through.
 *
 * ## Ownership
 *
 * Ownership is enforced by Row Level Security: the query runs on the
 * request-scoped `req.supabase` client whose JWT resolves `auth.uid()` to the
 * caller, and the embedded `invoices`/`clients` rows are RLS-scoped too. A
 * follow-up owned by another user is invisible, so the listing only ever
 * reflects the requester's pending follow-ups.
 *
 * ## Associated context
 *
 * The invoice number, amount, due date, and client name are fetched in a
 * single round trip via PostgREST resource embedding
 * (`invoice:invoices(...)` with a nested `client:clients(name)`), so no
 * follow-up read needs a second query.
 *
 * The router accepts an injectable auth middleware so it can be integration
 * tested with an in-memory fake Supabase client and without a live auth
 * service.
 */

import { Router, type Request, type RequestHandler, type Response } from 'express';

import { createGeminiModel, generateFollowUpDraft, type GenerativeModelLike } from '../ai/geminiDraft.js';
import { getConfig } from '../config/index.js';
import { createResendEmailService, type EmailService } from '../lib/emailService.js';
import type { Tier } from '../lib/escalation.js';
import { approveFollowUp, discardFollowUp, editFollowUp } from '../lib/followUp.js';
import { computeDaysOverdue } from '../lib/overdue.js';
import { requireAuth } from '../middleware/auth.js';

/** The table backing follow-up records. */
const FOLLOW_UPS_TABLE = 'follow_ups';

/** The table backing the activity feed. */
const ACTIVITY_EVENTS_TABLE = 'activity_events';

/** The only follow-up status this listing endpoint serves (Req 9.2). */
const PENDING_APPROVAL = 'pending_approval';

/**
 * Default sender address for outgoing follow-up emails. Injectable via
 * {@link FollowUpsRouterOptions.fromEmail} so deployments (and tests) can
 * override it without changing code.
 */
const DEFAULT_FROM_EMAIL = 'onboarding@resend.dev';

/**
 * Columns returned for each pending follow-up, embedding the associated invoice
 * (number, amount, due date) and, nested within it, the client name. RLS
 * applies to the embedded rows as well.
 */
const FOLLOW_UP_LIST_COLUMNS =
  'id, invoice_id, tier, content, status, drafted_at, follow_up_number, ' +
  'invoice:invoices(invoice_number, amount, due_date, client:clients(name))';

/**
 * Columns returned when reading/writing a single follow-up for the mutating
 * actions. Carries the fields the caller echoes back (status, content, tier,
 * delivery timestamp) so no extra read is needed after a write.
 */
const FOLLOW_UP_ACTION_COLUMNS =
  'id, invoice_id, tier, content, status, drafted_at, sent_at, follow_up_number';

/**
 * Columns read before approval: the follow-up's own fields plus the embedded
 * invoice number and the associated client's name and email, so the email can
 * be composed and delivered without a second query. RLS applies to the embedded
 * rows too.
 */
const FOLLOW_UP_APPROVE_COLUMNS =
  'id, invoice_id, tier, content, status, follow_up_number, ' +
  'invoice:invoices(invoice_number, client:clients(name, email))';

/** Sends a generic 500 when the database layer reports an unexpected error. */
function sendServerError(res: Response): void {
  res.status(500).json({ error: 'An unexpected error occurred.' });
}

/** Sends the standard "follow-up not available" 404 (missing/unowned row). */
function sendNotAvailable(res: Response): void {
  res.status(404).json({ error: 'Follow-up not available.' });
}

/**
 * Sends the standard "not pending approval" rejection (Req 9.11): the action is
 * refused, the status is reported unchanged, and no write has occurred.
 */
function sendNotPending(res: Response, status: string): void {
  res.status(409).json({
    error: 'The follow-up is not pending approval.',
    status,
  });
}

/**
 * GET /follow-ups — list the caller's pending follow-ups newest-drafted first
 * (Req 9.2).
 *
 * The `status` query parameter is optional and defaults to "pending_approval";
 * this endpoint only serves pending follow-ups, so any other explicit value is
 * rejected with 400. Results are ordered by `drafted_at` descending so the most
 * recently drafted follow-up appears first, and each row carries the drafted
 * content plus the embedded invoice number, amount, due date, and client name.
 */
const handleList: RequestHandler = async (req: Request, res: Response): Promise<void> => {
  const statusParam = req.query.status;
  // Only a single "pending_approval" filter is supported here (Req 9.2).
  if (statusParam !== undefined && statusParam !== PENDING_APPROVAL) {
    res.status(400).json({
      error: `Unsupported status filter. Only "${PENDING_APPROVAL}" is supported.`,
      field: 'status',
    });
    return;
  }

  const { data, error } = await req.supabase
    .from(FOLLOW_UPS_TABLE)
    .select(FOLLOW_UP_LIST_COLUMNS)
    .eq('status', PENDING_APPROVAL)
    .order('drafted_at', { ascending: false });

  if (error) {
    sendServerError(res);
    return;
  }

  res.status(200).json({ follow_ups: data ?? [] });
};

/** The lifecycle status of a follow-up as read back from the store. */
type FollowUpStatus = 'pending_approval' | 'approved' | 'sent' | 'discarded';

/**
 * PUT /follow-ups/:id/content — replace a pending follow-up's drafted content
 * (Req 9.3, 9.4, 9.11).
 *
 * The current status and content are read first (RLS-scoped). The pure
 * {@link editFollowUp} reducer then decides the outcome:
 *   - not pending      -> 409, status unchanged, content retained (Req 9.11).
 *   - empty/too long    -> 400 with the content-length message, content
 *                         retained (Req 9.4).
 *   - valid             -> the content is replaced via a conditional update that
 *                         only touches a row still "pending_approval" (Req 9.3).
 */
const handleEditContent: RequestHandler = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const followUpId = req.params.id as string;

  const read = await req.supabase
    .from(FOLLOW_UPS_TABLE)
    .select('id, status, content')
    .eq('id', followUpId)
    .maybeSingle();

  if (read.error) {
    sendServerError(res);
    return;
  }

  const row = read.data as { status: FollowUpStatus } | null;
  if (!row) {
    // Missing or unowned — indistinguishable under RLS.
    sendNotAvailable(res);
    return;
  }

  const bodyContent = (req.body ?? {}).content as unknown;
  const result = editFollowUp(row.status, bodyContent);

  if (!result.ok) {
    if (result.code === 'NOT_PENDING') {
      sendNotPending(res, row.status);
      return;
    }
    // Invalid content (empty or too long): reject and retain existing content
    // (Req 9.4). No write has occurred.
    res.status(400).json({ error: result.message, code: result.code });
    return;
  }

  // Valid edit: replace the content, but only while still pending (Req 9.3).
  const update = await req.supabase
    .from(FOLLOW_UPS_TABLE)
    .update({ content: result.content })
    .eq('id', followUpId)
    .eq('status', PENDING_APPROVAL)
    .select(FOLLOW_UP_ACTION_COLUMNS)
    .maybeSingle();

  if (update.error) {
    sendServerError(res);
    return;
  }
  if (!update.data) {
    // A concurrent transition moved the row out of "pending_approval" between
    // the read and the write; leave it unchanged (Req 9.11).
    sendNotPending(res, row.status);
    return;
  }

  res.status(200).json({ follow_up: update.data });
};

/**
 * The follow-up row shape (with embedded invoice/client) read before approval.
 */
interface FollowUpWithInvoice {
  id: string;
  invoice_id: string;
  tier: string;
  content: string;
  status: FollowUpStatus;
  follow_up_number: number | null;
  invoice: {
    invoice_number: number;
    client: { name: string; email: string } | null;
  } | null;
}

/**
 * POST /follow-ups/:id/approve — approve a pending follow-up and deliver it
 * (Req 9.5–9.9, 9.11).
 *
 * Flow: read the follow-up with its client email (RLS-scoped); gate on
 * {@link approveFollowUp}; transition "pending_approval" -> "approved" via a
 * conditional update (Req 9.5); deliver the content to the client email through
 * the Email_Service within the 30s window (Req 9.6). On CONFIRMED delivery, set
 * "sent", stamp the delivery timestamp — appending it to the invoice's
 * follow-up history (Req 9.7) — and record exactly one follow-up-sent activity
 * event (Req 9.8). On a delivery ERROR or TIMEOUT, the follow-up is retained as
 * "approved" and a delivery-failure message is returned (Req 9.9).
 */
function createApproveHandler(deps: {
  getEmailService: () => Promise<EmailService>;
  fromEmail: string;
}): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    const followUpId = req.params.id as string;

    const read = await req.supabase
      .from(FOLLOW_UPS_TABLE)
      .select(FOLLOW_UP_APPROVE_COLUMNS)
      .eq('id', followUpId)
      .maybeSingle();

    if (read.error) {
      sendServerError(res);
      return;
    }

    const followUp = read.data as FollowUpWithInvoice | null;
    if (!followUp) {
      sendNotAvailable(res);
      return;
    }

    const gate = approveFollowUp(followUp.status);
    if (!gate.ok) {
      sendNotPending(res, followUp.status);
      return;
    }

    // Transition to "approved" (Req 9.5), only while still pending so a
    // concurrent action cannot double-approve.
    const approve = await req.supabase
      .from(FOLLOW_UPS_TABLE)
      .update({ status: 'approved' })
      .eq('id', followUpId)
      .eq('status', PENDING_APPROVAL)
      .select(FOLLOW_UP_ACTION_COLUMNS)
      .maybeSingle();

    if (approve.error) {
      sendServerError(res);
      return;
    }
    if (!approve.data) {
      // Someone transitioned it between the read and the update.
      sendNotPending(res, followUp.status);
      return;
    }

    const client = followUp.invoice?.client;
    if (!client?.email) {
      // Defensive: an approved follow-up whose client email cannot be resolved
      // cannot be delivered. It remains "approved" (Req 9.9).
      res.status(502).json({
        error: 'The follow-up could not be delivered because the client email is unavailable.',
        reason: 'delivery_error',
      });
      return;
    }

    // Deliver within the 30s confirmation window (Req 9.6). The Email_Service
    // resolves with an explicit delivery signal rather than throwing.
    const emailService = await deps.getEmailService();
    const subject = followUp.invoice
      ? `Reminder: Invoice #${followUp.invoice.invoice_number}`
      : 'Payment reminder';
    const delivery = await emailService.sendEmail({
      from: deps.fromEmail,
      to: client.email,
      subject,
      text: followUp.content,
    });

    if (!delivery.ok) {
      // Delivery error or timeout: retain "approved" and return a
      // delivery-failure message (Req 9.9).
      res.status(502).json({
        error: 'The follow-up email could not be delivered. The follow-up remains approved.',
        reason: delivery.reason,
      });
      return;
    }

    // Confirmed delivery: transition to "sent" and stamp the delivery timestamp,
    // appending the follow-up to the invoice's history (Req 9.7).
    const deliveredAt = new Date().toISOString();
    const finalize = await req.supabase
      .from(FOLLOW_UPS_TABLE)
      .update({ status: 'sent', sent_at: deliveredAt })
      .eq('id', followUpId)
      .select(FOLLOW_UP_ACTION_COLUMNS)
      .maybeSingle();

    if (finalize.error || !finalize.data) {
      sendServerError(res);
      return;
    }

    // Record exactly one follow-up-sent activity event (Req 9.8), carrying the
    // tier and follow-up number for the invoice timeline. user_id is supplied
    // explicitly to satisfy the RLS with-check on insert.
    const event = await req.supabase.from(ACTIVITY_EVENTS_TABLE).insert({
      user_id: req.userId,
      invoice_id: followUp.invoice_id,
      type: 'follow_up_sent',
      metadata: { tier: followUp.tier, follow_up_number: followUp.follow_up_number },
    });

    if (event.error) {
      sendServerError(res);
      return;
    }

    res.status(200).json({ follow_up: finalize.data });
  };
}

/**
 * POST /follow-ups/:id/discard — discard a pending follow-up without delivering
 * anything (Req 9.10, 9.11).
 *
 * The status is read first (RLS-scoped) and gated on {@link discardFollowUp};
 * from any non-pending status the action is rejected and nothing changes
 * (Req 9.11). Otherwise the follow-up transitions "pending_approval" ->
 * "discarded" via a conditional update and no email is sent (Req 9.10).
 */
const handleDiscard: RequestHandler = async (req: Request, res: Response): Promise<void> => {
  const followUpId = req.params.id as string;

  const read = await req.supabase
    .from(FOLLOW_UPS_TABLE)
    .select('id, invoice_id, tier, status')
    .eq('id', followUpId)
    .maybeSingle();

  if (read.error) {
    sendServerError(res);
    return;
  }

  const row = read.data as { invoice_id: string; tier: string; status: FollowUpStatus } | null;
  if (!row) {
    sendNotAvailable(res);
    return;
  }

  const gate = discardFollowUp(row.status);
  if (!gate.ok) {
    sendNotPending(res, row.status);
    return;
  }

  const update = await req.supabase
    .from(FOLLOW_UPS_TABLE)
    .update({ status: 'discarded' })
    .eq('id', followUpId)
    .eq('status', PENDING_APPROVAL)
    .select(FOLLOW_UP_ACTION_COLUMNS)
    .maybeSingle();

  if (update.error) {
    sendServerError(res);
    return;
  }
  if (!update.data) {
    sendNotPending(res, row.status);
    return;
  }

  // Log the "Follow-up discarded" timeline event (best-effort).
  try {
    await req.supabase.from(ACTIVITY_EVENTS_TABLE).insert({
      user_id: req.userId,
      invoice_id: row.invoice_id,
      type: 'follow_up_discarded',
      metadata: { tier: row.tier },
    });
  } catch {
    // Timeline logging is best-effort.
  }

  res.status(200).json({ follow_up: update.data });
};

/** Escalation tiers accepted by the "regenerate with different tone" action. */
const VALID_TONES: readonly string[] = ['polite', 'firm', 'final_notice'];

/**
 * Columns read before regenerating: the follow-up's own fields plus the
 * embedded invoice (number, amount, due date, description) and client name,
 * so a fresh draft can be composed without additional queries.
 */
const FOLLOW_UP_REGENERATE_COLUMNS =
  'id, invoice_id, tier, status, follow_up_number, ' +
  'invoice:invoices(invoice_number, amount, due_date, description, client:clients(name))';

/** The follow-up + embedded invoice/client shape read before regeneration. */
interface FollowUpForRegenerate {
  id: string;
  invoice_id: string;
  tier: string;
  status: FollowUpStatus;
  follow_up_number: number | null;
  invoice: {
    invoice_number: number;
    amount: number | string;
    due_date: string;
    description: string;
    client: { name: string } | null;
  } | null;
}

/** The table backing user profiles (for the sender name on regenerated drafts). */
const PROFILES_TABLE = 'profiles';

/**
 * POST /follow-ups/:id/regenerate — regenerate a pending follow-up's drafted
 * content with a different tone (Polite / Firm / Final Notice).
 *
 * Only valid while the follow-up is `pending_approval` (mirrors the edit/
 * approve/discard gate). Accepts `{ tone: 'polite' | 'firm' | 'final_notice' }`
 * in the body. Regenerates content via the same Gemini draft pipeline the
 * background worker uses, then replaces the follow-up's content and tier
 * in place (its id, drafted_at, and follow_up_number are preserved — this is
 * an edit of the existing draft, not a new one).
 */
function createRegenerateHandler(deps: { getModel: () => GenerativeModelLike }): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    const followUpId = req.params.id as string;
    const tone = (req.body ?? {}).tone as unknown;

    if (typeof tone !== 'string' || !VALID_TONES.includes(tone)) {
      res.status(400).json({
        error: `tone must be one of: ${VALID_TONES.join(', ')}.`,
        field: 'tone',
      });
      return;
    }

    const read = await req.supabase
      .from(FOLLOW_UPS_TABLE)
      .select(FOLLOW_UP_REGENERATE_COLUMNS)
      .eq('id', followUpId)
      .maybeSingle();

    if (read.error) {
      sendServerError(res);
      return;
    }

    const followUp = read.data as FollowUpForRegenerate | null;
    if (!followUp) {
      sendNotAvailable(res);
      return;
    }
    if (followUp.status !== PENDING_APPROVAL) {
      sendNotPending(res, followUp.status);
      return;
    }
    if (!followUp.invoice) {
      sendServerError(res);
      return;
    }

    const { senderName, emailSignature } = await (async () => {
      try {
        const { data } = await req.supabase
          .from(PROFILES_TABLE)
          .select('business_name, email_signature')
          .eq('id', req.userId)
          .maybeSingle<{ business_name: string; email_signature: string | null }>();
        const name = data?.business_name?.trim();
        const signature = data?.email_signature?.trim();
        return {
          senderName: name && name.length > 0 ? name : 'Your Business',
          emailSignature: signature && signature.length > 0 ? signature : undefined,
        };
      } catch {
        return { senderName: 'Your Business', emailSignature: undefined };
      }
    })();

    const daysOverdue = computeDaysOverdue(followUp.invoice.due_date, new Date());

    const model = deps.getModel();
    const result = await generateFollowUpDraft(model, {
      clientName: followUp.invoice.client?.name ?? 'Client',
      invoiceNumber: followUp.invoice.invoice_number,
      amount: Number(followUp.invoice.amount),
      daysOverdue: Math.max(daysOverdue, 1),
      tier: tone as Tier,
      senderName,
      description: followUp.invoice.description,
      emailSignature,
    });

    if (!result.ok) {
      console.error('[regenerate] draft generation failed:', JSON.stringify({
        reason: result.reason,
        error: 'error' in result ? String((result as { error?: unknown }).error) : undefined,
        missing: 'missing' in result ? (result as { missing?: string[] }).missing : undefined,
      }));
      res.status(502).json({
        error: 'Could not regenerate the follow-up draft. Please try again.',
        reason: result.reason,
      });
      return;
    }

    const update = await req.supabase
      .from(FOLLOW_UPS_TABLE)
      .update({ content: result.content, tier: tone })
      .eq('id', followUpId)
      .eq('status', PENDING_APPROVAL)
      .select(FOLLOW_UP_ACTION_COLUMNS)
      .maybeSingle();

    if (update.error) {
      sendServerError(res);
      return;
    }
    if (!update.data) {
      sendNotPending(res, followUp.status);
      return;
    }

    res.status(200).json({ follow_up: update.data });
  };
}

/** Options for {@link createFollowUpsRouter}. */
export interface FollowUpsRouterOptions {
  /**
   * Auth middleware applied to every route. Defaults to the process-wide
   * {@link requireAuth}. Tests inject a stub that attaches `req.userId` and a
   * fake `req.supabase`.
   */
  authMiddleware?: RequestHandler;
  /**
   * Email_Service used by the approve endpoint. Defaults to a lazily-constructed
   * Resend-backed service built from `RESEND_API_KEY`. Tests inject a fake so
   * no network call is made.
   */
  emailService?: EmailService;
  /**
   * Sender address for outgoing follow-up emails. Defaults to
   * {@link DEFAULT_FROM_EMAIL}.
   */
  fromEmail?: string;
  /**
   * Gemini model used by the regenerate endpoint. Defaults to a
   * lazily-constructed model built from `GOOGLE_API_KEY`. Tests inject a fake
   * so no network call is made.
   */
  model?: GenerativeModelLike;
}

/**
 * Builds the Follow-ups API router. Every route is guarded by the provided auth
 * middleware (defaults to {@link requireAuth}), which attaches `req.userId`
 * and the RLS-scoped `req.supabase` client the handlers rely on.
 */
export function createFollowUpsRouter(options: FollowUpsRouterOptions = {}): Router {
  const auth = options.authMiddleware ?? requireAuth;
  const fromEmail = options.fromEmail ?? DEFAULT_FROM_EMAIL;

  // The real Resend service is built lazily and memoized so that (a) importing
  // this router never requires a populated environment, and (b) it is only
  // constructed once, on the first real approval. Tests inject `emailService`.
  let emailServicePromise: Promise<EmailService> | undefined;
  const getEmailService = (): Promise<EmailService> => {
    if (options.emailService) {
      return Promise.resolve(options.emailService);
    }
    if (!emailServicePromise) {
      emailServicePromise = createResendEmailService(getConfig().RESEND_API_KEY);
    }
    return emailServicePromise;
  };

  const handleApprove = createApproveHandler({ getEmailService, fromEmail });

  // The real Gemini model is built lazily so importing this router never
  // requires a populated environment. Tests inject `model`.
  let modelInstance: GenerativeModelLike | undefined;
  const getModel = (): GenerativeModelLike => {
    if (options.model) {
      return options.model;
    }
    if (!modelInstance) {
      modelInstance = createGeminiModel(getConfig().GOOGLE_API_KEY);
    }
    return modelInstance;
  };

  const handleRegenerate = createRegenerateHandler({ getModel });

  const router = Router();

  router.get('/follow-ups', auth, handleList);
  router.put('/follow-ups/:id/content', auth, handleEditContent);
  router.post('/follow-ups/:id/approve', auth, handleApprove);
  router.post('/follow-ups/:id/discard', auth, handleDiscard);
  router.post('/follow-ups/:id/regenerate', auth, handleRegenerate);

  return router;
}
