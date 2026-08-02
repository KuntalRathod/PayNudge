/**
 * Invoices API router — Requirement 3 (Invoice Creation & Retrieval).
 *
 * Endpoints implemented by this task (all require a valid Supabase JWT via
 * {@link requireAuth}):
 *
 *   POST   /invoices        Create a draft invoice with an atomically assigned,
 *                           per-user sequential invoice number (Req 3.1–3.4).
 *   GET    /invoices        List the authenticated user's invoices (Req 3.8 read
 *                           scope; empty list when none).
 *   GET    /invoices/:id    Fetch a single owned invoice with its amount,
 *                           description, due date, invoice number, associated
 *                           client, and status (Req 3.8); missing/unowned →
 *                           404 "not available" (Req 3.9).
 *
 *   POST   /invoices/:id/send  Send a draft invoice (Req 4).
 *   POST   /invoices/:id/pay   Mark a sent/overdue invoice as paid (Req 6).
 *
 *   GET    /invoices/:id/history  Return the invoice detail and current status
 *                                 plus its follow-up history — the list of the
 *                                 invoice's "sent" follow-ups with tier and
 *                                 delivery timestamp, ordered earliest→latest
 *                                 (Req 11.1, 11.2); missing/unowned → 404
 *                                 "not available" with no details (Req 11.5).
 *
 *   DELETE /invoices/:id    Delete an owned invoice and cascade-delete every
 *                           follow-up associated with it from retention
 *                           (Req 11.7); missing/unowned → 404 "not available"
 *                           removing nothing (Req 3.9 disclosure rule).
 *
 * ## Ownership
 *
 * Ownership is enforced by Row Level Security: every query runs on the
 * request-scoped `req.supabase` client whose JWT resolves `auth.uid()` to the
 * caller. A row the user does not own is invisible, so a GET of a missing or
 * unowned invoice returns no row and is reported as "not available" without
 * disclosing whether the record exists (Req 3.9).
 *
 * ## Creation
 *
 * `POST /invoices` validates the body with the shared {@link validateInvoiceInput}
 * pure function (400 with a field-identifying message, no write, on failure) and
 * then delegates numbering to {@link createInvoiceWithNumber}, backed by the
 * request-scoped Supabase executor. When concurrent creations exhaust the
 * bounded retry budget the create returns HTTP 503 with a `Retry-After` hint so
 * the caller can retry safely (Req 3.4).
 *
 * The router accepts an injectable auth middleware so it can be integration
 * tested with an in-memory fake Supabase client and without a live auth service.
 */

import { Router, type Request, type RequestHandler, type Response } from 'express';

import { getConfig } from '../config/index.js';
import { createResendEmailService, type EmailService } from '../lib/emailService.js';
import { buildInvoiceEmail } from '../lib/invoiceEmail.js';
import {
  createInvoiceWithNumber,
  createSupabaseInvoiceExecutor,
} from '../lib/invoiceNumbering.js';
import { generateInvoicePdf } from '../lib/invoicePdf.js';
import { validateInvoiceInput } from '../lib/invoiceValidation.js';
import { requireAuth } from '../middleware/auth.js';

/** The table backing invoice records. */
const INVOICES_TABLE = 'invoices';

/** The table backing the activity feed. */
const ACTIVITY_EVENTS_TABLE = 'activity_events';

/** The table backing follow-up records (read for invoice history). */
const FOLLOW_UPS_TABLE = 'follow_ups';

/** The table backing the business-name profile used on invoice PDFs/emails. */
const PROFILES_TABLE = 'profiles';

/** Fallback sender name when the caller has no profile row or an empty business_name. */
const DEFAULT_SENDER_NAME = 'Your Business';

/** The only follow-up status included in the follow-up history (Req 11.2). */
const SENT_STATUS = 'sent';

/**
 * Follow-up status for a draft awaiting the user's review. On payment, any
 * follow-up left in this status for the invoice is discarded (Req 10.3).
 */
const PENDING_APPROVAL_STATUS = 'pending_approval';

/** Terminal follow-up status applied to pending drafts when payment lands. */
const DISCARDED_STATUS = 'discarded';

/**
 * Default sender address for outgoing invoice emails. Injectable via
 * {@link InvoicesRouterOptions.fromEmail} so deployments (and tests) can
 * override it without changing code.
 */
const DEFAULT_FROM_EMAIL = 'onboarding@resend.dev';

/**
 * Columns returned for a list entry. The list does not embed the full client
 * to keep payloads small; the detail endpoint embeds the associated client.
 */
const INVOICE_LIST_COLUMNS =
  'id, user_id, client_id, invoice_number, amount, description, due_date, status, created_at';

/**
 * Columns for the detail endpoint. Embeds the associated client via a
 * PostgREST resource embedding so retrieval returns the associated Client
 * (Req 3.8). RLS applies to the embedded `clients` rows too.
 */
const INVOICE_DETAIL_COLUMNS =
  'id, user_id, client_id, invoice_number, amount, description, due_date, status, created_at, ' +
  'client:clients(id, name, email, company)';

/**
 * Columns returned by the send endpoint's claim/finalize updates. Includes
 * `send_lock_at` (needed to reason about the processing lock) and embeds the
 * associated client so the email content can be composed without a second read.
 */
const SEND_INVOICE_COLUMNS =
  'id, user_id, client_id, invoice_number, amount, description, due_date, status, ' +
  'sent_at, send_lock_at, created_at, client:clients(id, name, email, company)';

/**
 * Columns returned by the pay endpoint's transition update and its explanatory
 * read-back. No client embedding is needed to mark payment.
 */
const PAY_INVOICE_COLUMNS =
  'id, user_id, client_id, invoice_number, amount, description, due_date, status, sent_at, ' +
  'paid_at, payment_note, created_at';

/** Statuses from which an invoice may transition to "paid" (Req 6.1). */
const PAYABLE_STATUSES = ['sent', 'overdue'];

/**
 * Columns returned for each entry of the follow-up history: the escalation
 * tier and the delivery timestamp of a "sent" follow-up (Req 11.2). `id` is
 * included so callers can key the entries stably.
 */
const FOLLOW_UP_HISTORY_COLUMNS = 'id, tier, sent_at';

/** Sends the standard "invoice not available" 404 (read of missing/unowned). */
function sendNotAvailable(res: Response): void {
  res.status(404).json({ error: 'Invoice not available.' });
}

/** The subset of profile fields that flow into generated PDFs/emails. */
interface SenderProfile {
  senderName: string;
  businessAddress: string | null;
  paymentInstructions: string | null;
  defaultPaymentTerms: string | null;
}

/**
 * Resolves the caller's full sender profile (business name, address, payment
 * instructions, default payment terms) for invoice PDFs (Improved Company/
 * Profile Settings feature). Never throws — a lookup failure degrades to safe
 * defaults rather than blocking PDF generation or an invoice send.
 */
async function resolveSenderProfile(req: Request): Promise<SenderProfile> {
  try {
    const { data } = await req.supabase
      .from(PROFILES_TABLE)
      .select('business_name, business_address, payment_instructions, default_payment_terms')
      .eq('id', req.userId)
      .maybeSingle<{
        business_name: string;
        business_address: string | null;
        payment_instructions: string | null;
        default_payment_terms: string | null;
      }>();

    const name = data?.business_name?.trim();
    return {
      senderName: name && name.length > 0 ? name : DEFAULT_SENDER_NAME,
      businessAddress: data?.business_address ?? null,
      paymentInstructions: data?.payment_instructions ?? null,
      defaultPaymentTerms: data?.default_payment_terms ?? null,
    };
  } catch {
    return {
      senderName: DEFAULT_SENDER_NAME,
      businessAddress: null,
      paymentInstructions: null,
      defaultPaymentTerms: null,
    };
  }
}

/** Sends a generic 500 when the database layer reports an unexpected error. */
function sendServerError(res: Response): void {
  res.status(500).json({ error: 'An unexpected error occurred.' });
}

/**
 * POST /invoices — create a draft invoice with an atomically assigned per-user
 * sequential number (Req 3.1, 3.2, 3.3, 3.4).
 *
 * Validation runs first; an invalid payload is rejected with 400 and a
 * field-identifying body before any write (Req 3.5–3.7). Numbering is delegated
 * to {@link createInvoiceWithNumber}, which retries on unique-violation; if the
 * retry budget is exhausted we surface 503 with a `Retry-After` hint.
 */
const handleCreate: RequestHandler = async (req: Request, res: Response): Promise<void> => {
  const validation = validateInvoiceInput(req.body ?? {});
  if (!validation.ok) {
    res.status(400).json({
      error: validation.message,
      field: validation.field,
      code: validation.code,
    });
    return;
  }

  const { clientId, amount, description, dueDate } = validation.value;
  const executor = createSupabaseInvoiceExecutor(req.supabase);

  let outcome;
  try {
    outcome = await createInvoiceWithNumber(
      { clientId, amount, description, dueDate },
      executor,
    );
  } catch {
    // A non-conflict database error (e.g. connection failure) propagated out
    // of the numbering routine. Never leak internals to the caller.
    sendServerError(res);
    return;
  }

  if (!outcome.ok) {
    // Every attempt hit a unique-violation under concurrency (Req 3.4). Ask the
    // caller to retry after a short hint.
    res.setHeader('Retry-After', String(outcome.retryAfterSeconds));
    res.status(503).json({
      error: 'Could not assign an invoice number due to high concurrency. Please retry.',
      retryAfterSeconds: outcome.retryAfterSeconds,
    });
    return;
  }

  // Record the "Created" timeline event (best-effort: a logging failure must
  // never fail the create itself, since the invoice already exists).
  try {
    await req.supabase.from(ACTIVITY_EVENTS_TABLE).insert({
      user_id: req.userId,
      invoice_id: outcome.invoice.id,
      type: 'invoice_created',
    });
  } catch {
    // Never let timeline logging block invoice creation.
  }

  res.status(201).json({ invoice: outcome.invoice });
};

/**
 * GET /invoices — list every invoice owned by the caller, newest first
 * (Req 3.8 read scope). RLS scopes the result set to the caller, so an owner
 * with no invoices receives an empty array.
 */
const handleList: RequestHandler = async (req: Request, res: Response): Promise<void> => {
  const { data, error } = await req.supabase
    .from(INVOICES_TABLE)
    .select(INVOICE_LIST_COLUMNS)
    .order('invoice_number', { ascending: false });

  if (error) {
    sendServerError(res);
    return;
  }

  res.status(200).json({ invoices: data ?? [] });
};

/**
 * GET /invoices/:id — fetch a single owned invoice with its amount, description,
 * due date, invoice number, associated client, and status (Req 3.8). A missing
 * or unowned id yields no row under RLS and is reported as "not available"
 * without disclosing whether the record exists (Req 3.9).
 */
const handleGet: RequestHandler = async (req: Request, res: Response): Promise<void> => {
  const { data, error } = await req.supabase
    .from(INVOICES_TABLE)
    .select(INVOICE_DETAIL_COLUMNS)
    .eq('id', req.params.id)
    .maybeSingle();

  if (error) {
    sendServerError(res);
    return;
  }
  if (!data) {
    sendNotAvailable(res);
    return;
  }

  res.status(200).json({ invoice: data });
};

/**
 * GET /invoices/:id/pdf — stream a generated invoice PDF for an owned invoice.
 *
 * Ownership is enforced the same way as {@link handleGet}: the read runs on
 * the RLS-scoped `req.supabase`, so a missing or unowned id yields no row and
 * is reported as "not available" without disclosing whether the record
 * exists. The PDF is rendered ENTIRELY IN MEMORY by {@link generateInvoicePdf}
 * and streamed directly as the response body — nothing is ever written to
 * the backend's (ephemeral) filesystem, so the document always reflects the
 * invoice's current data and status.
 */
const handleGetPdf: RequestHandler = async (req: Request, res: Response): Promise<void> => {
  const { data, error } = await req.supabase
    .from(INVOICES_TABLE)
    .select(INVOICE_DETAIL_COLUMNS)
    .eq('id', req.params.id)
    .maybeSingle();

  if (error) {
    sendServerError(res);
    return;
  }

  const invoice = data as InvoiceWithClient | null;
  if (!invoice) {
    sendNotAvailable(res);
    return;
  }

  const senderProfile = await resolveSenderProfile(req);

  let pdf: Buffer;
  try {
    pdf = await generateInvoicePdf({
      senderName: senderProfile.senderName,
      invoiceNumber: invoice.invoice_number,
      amount: Number(invoice.amount),
      description: invoice.description,
      dueDate: invoice.due_date,
      clientName: invoice.client?.name ?? 'Client',
      clientEmail: invoice.client?.email ?? '',
      status: invoice.status,
      businessAddress: senderProfile.businessAddress,
      paymentInstructions: senderProfile.paymentInstructions,
      paymentTerms: senderProfile.defaultPaymentTerms,
    });
  } catch {
    sendServerError(res);
    return;
  }

  res.status(200);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="invoice-${invoice.invoice_number}.pdf"`,
  );
  res.send(pdf);
};

/**
 * DELETE /invoices/:id — delete an owned invoice, cascade-deleting every
 * follow-up associated with it (Req 11.7).
 *
 * The delete is a single RLS-scoped statement returning the deleted row so the
 * handler can tell whether anything was removed:
 *
 * ```sql
 * delete from public.invoices where id = :id returning id;
 * ```
 *
 * Because RLS scopes the delete to the caller, a missing or unowned id matches
 * no row and removes nothing; we report "not available" without disclosing
 * whether the record exists (Req 3.9 disclosure rule). The cascade to
 * `follow_ups` (and `activity_events`) is enforced at the database layer by the
 * `on delete cascade` foreign keys, so removing the invoice row removes every
 * associated follow-up from retention (Req 11.7). On success we return 204 with
 * no body.
 */
const handleDelete: RequestHandler = async (req: Request, res: Response): Promise<void> => {
  const { data, error } = await req.supabase
    .from(INVOICES_TABLE)
    .delete()
    .eq('id', req.params.id)
    .select('id')
    .maybeSingle();

  if (error) {
    sendServerError(res);
    return;
  }
  if (!data) {
    // No row deleted: missing or unowned under RLS. Do not disclose existence.
    sendNotAvailable(res);
    return;
  }

  // The invoice and its cascaded follow-ups have been removed (Req 11.7).
  res.status(204).end();
};

/** Shape of a follow-up history entry returned by the history endpoint. */
interface FollowUpHistoryRow {
  id: string;
  tier: string;
  sent_at: string | null;
}

/**
 * GET /invoices/:id/history — return the invoice's amount, description, due
 * date, invoice number, associated client, and current status (Req 11.1),
 * together with its follow-up history (Req 11.2).
 *
 * Ownership is confirmed first by reading the invoice under RLS: a missing or
 * unowned id yields no row and is reported as "not available" without any
 * invoice details or follow-up history and without disclosing whether the
 * record exists (Req 11.5). Only after ownership is established do we read the
 * follow-up history — the invoice's follow-ups in "sent" status, each with its
 * escalation tier and delivery timestamp, ordered from earliest delivery
 * timestamp to latest. An invoice with no sent follow-ups yields an empty list
 * (Req 11.2). The follow-up read is itself RLS-scoped to the caller.
 */
const handleHistory: RequestHandler = async (req: Request, res: Response): Promise<void> => {
  const invoiceId = req.params.id;

  // 1. Fetch the owned invoice with its detail fields and current status
  //    (Req 11.1). RLS hides unowned/missing rows, so no row → not available
  //    with no details or history disclosed (Req 11.5).
  const { data: invoice, error: invoiceError } = await req.supabase
    .from(INVOICES_TABLE)
    .select(INVOICE_DETAIL_COLUMNS)
    .eq('id', invoiceId)
    .maybeSingle();

  if (invoiceError) {
    sendServerError(res);
    return;
  }
  if (!invoice) {
    sendNotAvailable(res);
    return;
  }

  // 2. Read the follow-up history: only "sent" follow-ups for this invoice,
  //    each with tier and delivery timestamp, ordered earliest→latest by
  //    sent_at; empty when none (Req 11.2).
  const { data: followUps, error: followUpError } = await req.supabase
    .from(FOLLOW_UPS_TABLE)
    .select(FOLLOW_UP_HISTORY_COLUMNS)
    .eq('invoice_id', invoiceId)
    .eq('status', SENT_STATUS)
    .order('sent_at', { ascending: true });

  if (followUpError) {
    sendServerError(res);
    return;
  }

  res.status(200).json({
    invoice,
    follow_up_history: (followUps ?? []) as FollowUpHistoryRow[],
  });
};

/** Shape of an activity_events row as read for the invoice timeline. */
interface ActivityEventRow {
  id: number;
  type: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

/**
 * GET /invoices/:id/timeline — the full chronological activity timeline for an
 * owned invoice (Invoice Activity Timeline feature): Created, Sent, Became
 * Overdue, Follow-up drafted, Follow-up approved & sent, Follow-up discarded,
 * Marked as Paid — each with a timestamp and event-specific metadata.
 *
 * Ownership is confirmed first by reading the invoice under RLS: a missing or
 * unowned id yields no row and is reported as "not available" without
 * disclosing whether the record exists, mirroring {@link handleGet}. Events
 * are returned oldest-first so the UI can render a top-to-bottom chronological
 * list.
 */
const handleTimeline: RequestHandler = async (req: Request, res: Response): Promise<void> => {
  const invoiceId = req.params.id;

  const { data: invoice, error: invoiceError } = await req.supabase
    .from(INVOICES_TABLE)
    .select(INVOICE_DETAIL_COLUMNS)
    .eq('id', invoiceId)
    .maybeSingle();

  if (invoiceError) {
    sendServerError(res);
    return;
  }
  if (!invoice) {
    sendNotAvailable(res);
    return;
  }

  const { data: events, error: eventsError } = await req.supabase
    .from(ACTIVITY_EVENTS_TABLE)
    .select('id, type, metadata, created_at')
    .eq('invoice_id', invoiceId)
    .order('created_at', { ascending: true })
    .order('id', { ascending: true });

  if (eventsError) {
    sendServerError(res);
    return;
  }

  res.status(200).json({
    invoice,
    timeline: (events ?? []) as ActivityEventRow[],
  });
};

/**
 * The shape of an invoice row (with embedded client) the send handler reads
 * back from the conditional-claim and finalize updates.
 */
interface InvoiceWithClient {
  id: string;
  user_id: string;
  invoice_number: number;
  amount: string | number;
  description: string;
  due_date: string;
  status: string;
  send_lock_at: string | null;
  client: { id: string; name: string; email: string; company: string | null } | null;
}

/**
 * POST /invoices/:id/send — send a draft invoice, guarded so that concurrent
 * clicks deliver at most one email (Req 4.1, 4.3–4.9).
 *
 * ## Processing lock (at-most-once)
 *
 * The first thing the handler does is CLAIM a short-lived processing lock via a
 * single conditional update:
 *
 * ```sql
 * update public.invoices
 *    set send_lock_at = now()
 *  where id = :id and status = 'draft' and send_lock_at is null
 * returning *;
 * ```
 *
 * Because the predicate and the write are one atomic statement, only one of any
 * number of concurrent send attempts can flip `send_lock_at` from null and
 * receive the row (Req 4.8). RLS additionally scopes the update to the caller,
 * so an unowned invoice is never claimed (Req 4.7).
 *
 * ## After a failed claim
 *
 * No row returned means the invoice was not a lockable draft. We read it back
 * (still RLS-scoped) to explain why:
 *   - no row               -> unowned/nonexistent -> 403 not-authorized (Req 4.7).
 *   - status != 'draft'    -> 409 with the current status (Req 4.6).
 *   - draft + lock held    -> a send is already in progress -> 409 (Req 4.8).
 *
 * ## After a successful claim
 *
 * We compose the email (Req 4.2) and deliver it through the Email_Service with
 * the 30s confirmation window (Req 4.1). On CONFIRMED delivery we set the status
 * to "sent", stamp `sent_at`, release the lock, and record exactly one
 * invoice_sent activity event (Req 4.3, 4.9). On a delivery ERROR or TIMEOUT we
 * keep the status "draft", release the lock so the invoice can be retried, and
 * return a delivery-failure message (Req 4.4, 4.5).
 */
function createSendHandler(deps: {
  getEmailService: () => Promise<EmailService>;
  fromEmail: string;
}): RequestHandler {
  return async (req: Request, res: Response): Promise<void> => {
    // The `:id` route param is always present for a matched send route.
    const invoiceId = req.params.id as string;
    const nowIso = new Date().toISOString();

    // 1. Atomically claim the processing lock (Req 4.8). RLS scopes this to the
    //    caller, so an unowned invoice yields no row (Req 4.7).
    const claim = await req.supabase
      .from(INVOICES_TABLE)
      .update({ send_lock_at: nowIso })
      .eq('id', invoiceId)
      .eq('status', 'draft')
      .is('send_lock_at', null)
      .select(SEND_INVOICE_COLUMNS)
      .maybeSingle();

    if (claim.error) {
      sendServerError(res);
      return;
    }

    const claimed = claim.data as InvoiceWithClient | null;

    if (!claimed) {
      // Could not claim: explain why by reading the current row (RLS-scoped).
      const current = await req.supabase
        .from(INVOICES_TABLE)
        .select('id, status, send_lock_at')
        .eq('id', invoiceId)
        .maybeSingle();

      if (current.error) {
        sendServerError(res);
        return;
      }

      const row = current.data as { status: string; send_lock_at: string | null } | null;

      if (!row) {
        // Unowned or nonexistent — indistinguishable under RLS (Req 4.7).
        res.status(403).json({ error: 'You are not authorized to send this invoice.' });
        return;
      }

      if (row.status !== 'draft') {
        // Non-draft invoice: reject and report the current status (Req 4.6).
        res.status(409).json({
          error: `Invoice cannot be sent because its status is "${row.status}".`,
          status: row.status,
        });
        return;
      }

      // Draft but the lock is held: a send is already in progress (Req 4.8).
      res.status(409).json({ error: 'A send is already in progress for this invoice.' });
      return;
    }

    // 2. Compose the invoice email content (Req 4.2).
    const client = claimed.client;
    if (!client?.email) {
      // Defensive: an owned draft without a resolvable client email cannot be
      // delivered. Release the lock and report a server error.
      await releaseLock(req, invoiceId);
      sendServerError(res);
      return;
    }

    const email = buildInvoiceEmail({
      clientName: client.name,
      invoiceNumber: claimed.invoice_number,
      amount: Number(claimed.amount),
      description: claimed.description,
      dueDate: claimed.due_date,
    });

    // 2b. Generate the invoice PDF in memory to attach to the outgoing email
    //     (best-effort: a PDF generation failure must never block the send —
    //     the email still goes out without the attachment, and the failure is
    //     logged).
    let attachments: { filename: string; content: Buffer }[] | undefined;
    try {
      const senderProfile = await resolveSenderProfile(req);
      const pdf = await generateInvoicePdf({
        senderName: senderProfile.senderName,
        invoiceNumber: claimed.invoice_number,
        amount: Number(claimed.amount),
        description: claimed.description,
        dueDate: claimed.due_date,
        clientName: client.name,
        clientEmail: client.email,
        status: 'sent',
        businessAddress: senderProfile.businessAddress,
        paymentInstructions: senderProfile.paymentInstructions,
        paymentTerms: senderProfile.defaultPaymentTerms,
      });
      attachments = [{ filename: `invoice-${claimed.invoice_number}.pdf`, content: pdf }];
    } catch (pdfError) {
      console.error(
        `Failed to generate PDF attachment for invoice ${invoiceId}; sending email without it.`,
        pdfError,
      );
    }

    // 3. Deliver within the 30s confirmation window (Req 4.1). The Email_Service
    //    resolves with an explicit delivery signal rather than throwing.
    const emailService = await deps.getEmailService();
    const delivery = await emailService.sendEmail({
      from: deps.fromEmail,
      to: client.email,
      subject: email.subject,
      text: email.text,
      html: email.html,
      attachments,
    });

    if (!delivery.ok) {
      // Delivery error or timeout: retain "draft", release the lock so the
      // invoice can be retried, and return a delivery-failure message
      // (Req 4.4, 4.5).
      await releaseLock(req, invoiceId);
      res.status(502).json({
        error: 'The invoice email could not be delivered. The invoice remains a draft.',
        reason: delivery.reason,
      });
      return;
    }

    // 4. Confirmed delivery: transition to "sent", stamp sent_at, release the
    //    lock (Req 4.3).
    const finalize = await req.supabase
      .from(INVOICES_TABLE)
      .update({ status: 'sent', sent_at: nowIso, send_lock_at: null })
      .eq('id', invoiceId)
      .select(SEND_INVOICE_COLUMNS)
      .maybeSingle();

    if (finalize.error || !finalize.data) {
      sendServerError(res);
      return;
    }

    // 5. Record exactly one invoice-sent activity event (Req 4.9). user_id is
    //    supplied explicitly to satisfy the RLS with-check on insert.
    const event = await req.supabase.from(ACTIVITY_EVENTS_TABLE).insert({
      user_id: req.userId,
      invoice_id: invoiceId,
      type: 'invoice_sent',
    });

    if (event.error) {
      sendServerError(res);
      return;
    }

    res.status(200).json({ invoice: finalize.data });
  };
}

/**
 * Releases the processing lock for an invoice (best-effort), leaving the status
 * unchanged. Used on delivery error/timeout so a draft can be retried.
 */
async function releaseLock(req: Request, invoiceId: string): Promise<void> {
  await req.supabase
    .from(INVOICES_TABLE)
    .update({ send_lock_at: null })
    .eq('id', invoiceId);
}

/**
 * POST /invoices/:id/pay — mark an owned "sent"/"overdue" invoice as "paid"
 * (Req 6.1–6.6).
 *
 * ## Valid-status-only transition
 *
 * The transition is a single conditional update, RLS-scoped to the caller:
 *
 * ```sql
 * update public.invoices
 *    set status = 'paid'
 *  where id = :id and status in ('sent','overdue')
 * returning *;
 * ```
 *
 * Because the status predicate and the write are one atomic statement, only an
 * owned invoice currently in "sent" or "overdue" is flipped to "paid" (Req 6.1).
 * Marking payment removes the amount from the Outstanding_Total by construction,
 * since the total sums only "sent"/"overdue" invoices (Req 6.2).
 *
 * ## After a no-op update
 *
 * No row returned means the invoice was not a payable, owned invoice. We read it
 * back (still RLS-scoped) to explain why and leave the status unchanged:
 *   - no row            -> unowned/nonexistent -> 403 not-authorized (Req 6.5).
 *   - status == 'paid'  -> 409 "already marked paid" (Req 6.4).
 *   - status == 'draft' -> 409 "a draft invoice cannot be marked paid" (Req 6.6).
 *
 * ## After a successful transition
 *
 * We record exactly one payment-received activity event (Req 6.3), then halt the
 * chase cycle for the invoice: any follow-up still in "pending_approval" status
 * is discarded via a single RLS-scoped conditional update (Req 10.3). This
 * clears pending drafts, and because the draft worker only drafts for
 * overdue/unpaid invoices, no further follow-ups are drafted once the invoice is
 * "paid" (Req 10.2). Finally we return the updated invoice with a confirmation
 * message (Req 6.1).
 */
const handlePay: RequestHandler = async (req: Request, res: Response): Promise<void> => {
  // The `:id` route param is always present for a matched pay route.
  const invoiceId = req.params.id as string;

  // Optional Mark-as-Paid context supplied by the modal: a payment date and an
  // optional note. Both are validated defensively; invalid input degrades to
  // sensible defaults rather than blocking the transition, since the payment
  // has already happened in reality by the time the user clicks this button.
  const body = (req.body ?? {}) as { paymentDate?: unknown; note?: unknown };
  let paidAt = new Date().toISOString();
  if (typeof body.paymentDate === 'string' && body.paymentDate.trim().length > 0) {
    const parsed = new Date(body.paymentDate);
    if (!Number.isNaN(parsed.getTime())) {
      paidAt = parsed.toISOString();
    }
  }
  let paymentNote: string | null = null;
  if (typeof body.note === 'string') {
    const trimmed = body.note.trim();
    if (trimmed.length > 0) {
      if (trimmed.length > 2000) {
        res.status(400).json({
          error: 'Payment note must be at most 2000 characters.',
          field: 'note',
        });
        return;
      }
      paymentNote = trimmed;
    }
  }

  // 1. Atomically transition sent/overdue -> paid (Req 6.1). RLS scopes this to
  //    the caller, so an unowned invoice yields no row (Req 6.5).
  const transition = await req.supabase
    .from(INVOICES_TABLE)
    .update({ status: 'paid', paid_at: paidAt, payment_note: paymentNote })
    .eq('id', invoiceId)
    .in('status', PAYABLE_STATUSES)
    .select(PAY_INVOICE_COLUMNS)
    .maybeSingle();

  if (transition.error) {
    sendServerError(res);
    return;
  }

  const paid = transition.data as Record<string, unknown> | null;

  if (!paid) {
    // No transition happened: read the current row (RLS-scoped) to explain why
    // while leaving the status unchanged.
    const current = await req.supabase
      .from(INVOICES_TABLE)
      .select('id, status')
      .eq('id', invoiceId)
      .maybeSingle();

    if (current.error) {
      sendServerError(res);
      return;
    }

    const row = current.data as { status: string } | null;

    if (!row) {
      // Unowned or nonexistent — indistinguishable under RLS (Req 6.5).
      res.status(403).json({ error: 'You are not authorized to modify this invoice.' });
      return;
    }

    if (row.status === 'paid') {
      // Idempotent no-op: report already-paid and leave unchanged (Req 6.4).
      res.status(409).json({
        error: 'This invoice is already marked paid.',
        status: 'paid',
      });
      return;
    }

    if (row.status === 'draft') {
      // A draft has not been sent and cannot be paid (Req 6.6).
      res.status(409).json({
        error: 'A draft invoice cannot be marked paid.',
        status: 'draft',
      });
      return;
    }

    // Defensive: any other unexpected status is rejected without change.
    res.status(409).json({
      error: `Invoice cannot be marked paid because its status is "${row.status}".`,
      status: row.status,
    });
    return;
  }

  // 2. Record exactly one payment-received activity event (Req 6.3), carrying
  //    the payment date and optional note for the invoice timeline. user_id is
  //    supplied explicitly to satisfy the RLS with-check on insert.
  const event = await req.supabase.from(ACTIVITY_EVENTS_TABLE).insert({
    user_id: req.userId,
    invoice_id: invoiceId,
    type: 'payment_received',
    metadata: { paid_at: paidAt, note: paymentNote },
  });

  if (event.error) {
    sendServerError(res);
    return;
  }

  // 3. Halt the chase cycle: discard any pending-approval follow-up for this
  //    invoice (Req 10.3). The conditional predicate touches only follow-ups
  //    still awaiting review, leaving already-sent/discarded follow-ups
  //    unchanged; RLS scopes the write to the caller. Further drafting stops
  //    because the draft worker skips non-overdue/paid invoices (Req 10.2).
  const discard = await req.supabase
    .from(FOLLOW_UPS_TABLE)
    .update({ status: DISCARDED_STATUS })
    .eq('invoice_id', invoiceId)
    .eq('status', PENDING_APPROVAL_STATUS);

  if (discard.error) {
    sendServerError(res);
    return;
  }

  res.status(200).json({ invoice: paid, message: 'Invoice has been marked paid.' });
};

/** Options for {@link createInvoicesRouter}. */
export interface InvoicesRouterOptions {
  /**
   * Auth middleware applied to every route. Defaults to the process-wide
   * {@link requireAuth}. Tests inject a stub that attaches `req.userId` and a
   * fake `req.supabase`.
   */
  authMiddleware?: RequestHandler;
  /**
   * Email_Service used by the send endpoint. Defaults to a lazily-constructed
   * Resend-backed service built from `RESEND_API_KEY`. Tests inject a fake so
   * no network call is made.
   */
  emailService?: EmailService;
  /**
   * Sender address for outgoing invoice emails. Defaults to
   * {@link DEFAULT_FROM_EMAIL}.
   */
  fromEmail?: string;
}

/**
 * Builds the Invoices API router. Every route is guarded by the provided auth
 * middleware (defaults to {@link requireAuth}), which attaches `req.userId`
 * and the RLS-scoped `req.supabase` client the handlers rely on.
 */
export function createInvoicesRouter(options: InvoicesRouterOptions = {}): Router {
  const auth = options.authMiddleware ?? requireAuth;
  const fromEmail = options.fromEmail ?? DEFAULT_FROM_EMAIL;

  // The real Resend service is built lazily and memoized so that (a) importing
  // this router never requires a populated environment, and (b) it is only
  // constructed once, on the first real send. Tests inject `emailService`.
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

  const handleSend = createSendHandler({ getEmailService, fromEmail });

  const router = Router();

  router.post('/invoices', auth, handleCreate);
  router.get('/invoices', auth, handleList);
  router.get('/invoices/:id', auth, handleGet);
  router.get('/invoices/:id/pdf', auth, handleGetPdf);
  router.get('/invoices/:id/history', auth, handleHistory);
  router.get('/invoices/:id/timeline', auth, handleTimeline);
  router.post('/invoices/:id/send', auth, handleSend);
  router.post('/invoices/:id/pay', auth, handlePay);
  router.delete('/invoices/:id', auth, handleDelete);

  return router;
}
