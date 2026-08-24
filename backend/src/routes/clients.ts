/**
 * Clients API router — Requirement 2 (Client Management).
 *
 * Endpoints (all require a valid Supabase JWT via {@link requireAuth}):
 *
 *   POST   /clients       Create a client owned by the authenticated user.
 *   GET    /clients       List the authenticated user's clients (empty if none).
 *   GET    /clients/:id    Fetch a single owned client (not-available if not owned).
 *   PUT    /clients/:id    Update an owned client (not-authorized if not owned).
 *   GET    /clients/:id/history  All invoices for an owned client with current
 *                                statuses (not-available if not owned).
 *
 * Ownership is enforced by Row Level Security: every query runs on the
 * request-scoped `req.supabase` client whose JWT resolves `auth.uid()` to the
 * caller. A row the user does not own is invisible to reads and unaffected by
 * writes, so:
 *
 *   - GET /clients/:id of a missing/unowned client returns 404 "not available"
 *     (existence is never disclosed — Req 2 read isolation).
 *   - PUT /clients/:id of a missing/unowned client affects zero rows, which we
 *     map to 403 "not authorized" (Req 2.11) while leaving all records intact.
 *
 * Input is validated with the shared {@link validateClient} pure function;
 * validation failures return 400 with a body identifying the offending field
 * (Req 2.3–2.5, 2.10) and perform no database write.
 *
 * The router accepts an injectable auth middleware so it can be unit-tested
 * with a fake Supabase client and without a live auth service.
 */

import { Router, type Request, type RequestHandler, type Response } from 'express';

import { validateClient, type ClientValidationFailure } from '../lib/clientValidation.js';
import { computeClientStats, EMPTY_CLIENT_STATS, type ClientStats } from '../lib/clientStats.js';
import { requireAuth } from '../middleware/auth.js';

/** The table backing client records. */
const CLIENTS_TABLE = 'clients';

/** The table backing invoice records (read for client history/stats). */
const INVOICES_TABLE = 'invoices';

/** Columns returned to API callers (never leaks internal-only columns). */
const CLIENT_COLUMNS = 'id, user_id, name, email, company, notes, created_at, updated_at';

/**
 * Invoice columns returned by the client-history endpoint. Mirrors the invoice
 * list projection: enough to identify each invoice and expose its current
 * status (Req 11.3), without leaking internal-only columns.
 */
const INVOICE_HISTORY_COLUMNS =
  'id, user_id, client_id, invoice_number, amount, description, due_date, status, created_at';

/**
 * Invoice columns needed to compute per-client stats (Clients section
 * upgrade): status/amount/created_at for the aggregation, plus client_id to
 * group rows by client when enriching the list view.
 */
const INVOICE_STATS_COLUMNS = 'client_id, status, amount, created_at';

/** Shape of a client row as stored/returned by Supabase. */
interface ClientRow {
  id: string;
  user_id: string;
  name: string;
  email: string;
  company: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** A client row enriched with its invoice statistics (Clients section upgrade). */
interface ClientWithStats extends ClientRow {
  stats: ClientStats;
}

/** Shape of an invoice row as returned by the client-history endpoint. */
interface InvoiceHistoryRow {
  id: string;
  user_id: string;
  client_id: string;
  invoice_number: number;
  amount: string | number;
  description: string;
  due_date: string;
  status: string;
  created_at: string;
}

/** Minimal invoice row shape used to compute per-client stats. */
interface InvoiceStatsRow {
  client_id: string;
  status: string;
  amount: string | number;
  created_at: string;
}

/** Options for {@link createClientsRouter}. */
export interface ClientsRouterOptions {
  /**
   * Auth middleware applied to every route. Defaults to the process-wide
   * {@link requireAuth}. Tests inject a stub that attaches `req.userId` and a
   * fake `req.supabase`.
   */
  authMiddleware?: RequestHandler;
}

/** Serializes a validation failure into the 400 response body. */
function validationErrorBody(failure: ClientValidationFailure): {
  error: string;
  field: string;
  code: string;
} {
  return { error: failure.message, field: failure.field, code: failure.code };
}

/** Sends the standard "client not available" 404 (read of missing/unowned). */
function sendNotAvailable(res: Response): void {
  res.status(404).json({ error: 'Client not available.' });
}

/** Sends the standard "not authorized" 403 (write to a client not owned). */
function sendNotAuthorized(res: Response): void {
  res.status(403).json({ error: 'You are not authorized to modify this client.' });
}

/** Sends a generic 500 when the database layer reports an unexpected error. */
function sendServerError(res: Response): void {
  res.status(500).json({ error: 'An unexpected error occurred.' });
}

/**
 * POST /clients — create a client owned by the authenticated user (Req 2.1,
 * 2.2, 2.3, 2.4, 2.5). The inserted row's `user_id` is the caller's id, which
 * RLS's `with check (user_id = auth.uid())` requires.
 */
const handleCreate: RequestHandler = async (req: Request, res: Response): Promise<void> => {
  const validation = validateClient(req.body ?? {});
  if (!validation.ok) {
    res.status(400).json(validationErrorBody(validation));
    return;
  }

  const { name, email, company } = validation.value;
  const notes = typeof req.body.notes === 'string' ? req.body.notes.trim() || null : null;
  const { data, error } = await req.supabase
    .from(CLIENTS_TABLE)
    .insert({ user_id: req.userId, name, email, company, notes })
    .select(CLIENT_COLUMNS)
    .single();

  if (error || !data) {
    sendServerError(res);
    return;
  }

  res.status(201).json({ client: data as ClientRow });
};

/**
 * GET /clients — list every client owned by the caller, newest first
 * (Req 2.6 empty list, 2.7 all owned), each enriched with invoice statistics
 * (total invoices, outstanding amount, overdue amount/count, last invoice
 * date — Clients section upgrade) so the list view can show useful per-client
 * context without a follow-up request per card. RLS scopes both reads to the
 * caller, so an owner with no clients receives an empty array.
 */
const handleList: RequestHandler = async (req: Request, res: Response): Promise<void> => {
  const [clientsResult, invoicesResult] = await Promise.all([
    req.supabase.from(CLIENTS_TABLE).select(CLIENT_COLUMNS).order('created_at', { ascending: false }),
    req.supabase.from(INVOICES_TABLE).select(INVOICE_STATS_COLUMNS),
  ]);

  if (clientsResult.error || invoicesResult.error) {
    sendServerError(res);
    return;
  }

  const clients = (clientsResult.data ?? []) as ClientRow[];
  const invoices = (invoicesResult.data ?? []) as InvoiceStatsRow[];

  const invoicesByClient = new Map<string, InvoiceStatsRow[]>();
  for (const invoice of invoices) {
    const bucket = invoicesByClient.get(invoice.client_id);
    if (bucket) {
      bucket.push(invoice);
    } else {
      invoicesByClient.set(invoice.client_id, [invoice]);
    }
  }

  const enriched: ClientWithStats[] = clients.map((client) => {
    const clientInvoices = invoicesByClient.get(client.id) ?? [];
    return {
      ...client,
      stats: computeClientStats(
        clientInvoices.map((inv) => ({
          status: inv.status,
          amount: Number(inv.amount),
          created_at: inv.created_at,
        })),
      ),
    };
  });

  res.status(200).json({ clients: enriched });
};

/**
 * GET /clients/:id — fetch a single owned client (Req 2.8 selecting an owned
 * client). A missing or unowned id yields no row under RLS and is reported as
 * "not available" without disclosing whether the record exists.
 */
const handleGet: RequestHandler = async (req: Request, res: Response): Promise<void> => {
  const { data, error } = await req.supabase
    .from(CLIENTS_TABLE)
    .select(CLIENT_COLUMNS)
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

  res.status(200).json({ client: data as ClientRow });
};

/**
 * GET /clients/:id/detail — a single-request bundle for the Client Detail page
 * (Clients section upgrade): the owned client's fields, its aggregated stats
 * (total billed, total paid, outstanding amount, invoice count, etc.), and the
 * full list of its invoices (status, amount, due date), newest first.
 *
 * Ownership is confirmed first by reading the client under RLS: a missing or
 * unowned id yields no row and is reported as "not available" without
 * disclosing whether the record exists (mirrors {@link handleGet} /
 * {@link handleHistory}). A client with no invoices yields empty-state stats
 * ({@link EMPTY_CLIENT_STATS}) and an empty invoice list rather than an error.
 */
const handleDetail: RequestHandler = async (req: Request, res: Response): Promise<void> => {
  const clientId = req.params.id;

  const { data: client, error: clientError } = await req.supabase
    .from(CLIENTS_TABLE)
    .select(CLIENT_COLUMNS)
    .eq('id', clientId)
    .maybeSingle();

  if (clientError) {
    sendServerError(res);
    return;
  }
  if (!client) {
    sendNotAvailable(res);
    return;
  }

  const { data, error } = await req.supabase
    .from(INVOICES_TABLE)
    .select(INVOICE_HISTORY_COLUMNS)
    .eq('client_id', clientId)
    .order('invoice_number', { ascending: false });

  if (error) {
    sendServerError(res);
    return;
  }

  const invoices = (data ?? []) as InvoiceHistoryRow[];
  const stats =
    invoices.length === 0
      ? EMPTY_CLIENT_STATS
      : computeClientStats(
          invoices.map((inv) => ({
            status: inv.status,
            amount: Number(inv.amount),
            created_at: inv.created_at,
          })),
        );

  res.status(200).json({
    client: client as ClientRow,
    stats,
    invoices,
  });
};

/**
 * GET /clients/:id/history — return every invoice associated with an owned
 * client together with each invoice's current status (Req 11.3).
 *
 * Ownership is confirmed first by reading the client under RLS: a missing or
 * unowned id yields no row and is reported as "not available" without any
 * invoice records or existence disclosure (Req 11.6). Only after ownership is
 * established do we read the client's invoices — themselves RLS-scoped to the
 * caller — and return them newest-first. A client with no invoices yields an
 * empty list.
 */
const handleHistory: RequestHandler = async (req: Request, res: Response): Promise<void> => {
  const clientId = req.params.id;

  // 1. Confirm ownership (Req 11.6). RLS hides unowned/missing rows.
  const { data: client, error: clientError } = await req.supabase
    .from(CLIENTS_TABLE)
    .select('id')
    .eq('id', clientId)
    .maybeSingle();

  if (clientError) {
    sendServerError(res);
    return;
  }
  if (!client) {
    sendNotAvailable(res);
    return;
  }

  // 2. Return all invoices for the client with their current statuses (Req 11.3).
  const { data, error } = await req.supabase
    .from(INVOICES_TABLE)
    .select(INVOICE_HISTORY_COLUMNS)
    .eq('client_id', clientId)
    .order('invoice_number', { ascending: false });

  if (error) {
    sendServerError(res);
    return;
  }

  res.status(200).json({ invoices: (data ?? []) as InvoiceHistoryRow[] });
};

/**
 * PUT /clients/:id — update an owned client with full validation (Req 2.9,
 * 2.10, 2.11). Validation runs first so an invalid payload is rejected before
 * any write, preserving the stored record (Req 2.10). Under RLS an update to a
 * client the caller does not own affects zero rows; we detect the empty result
 * and return "not authorized" (Req 2.11), again leaving records unchanged.
 */
const handleUpdate: RequestHandler = async (req: Request, res: Response): Promise<void> => {
  const validation = validateClient(req.body ?? {});
  if (!validation.ok) {
    res.status(400).json(validationErrorBody(validation));
    return;
  }

  const { name, email, company } = validation.value;
  const notes = typeof req.body.notes === 'string' ? req.body.notes.trim() || null : null;
  const { data, error } = await req.supabase
    .from(CLIENTS_TABLE)
    .update({ name, email, company, notes })
    .eq('id', req.params.id)
    .select(CLIENT_COLUMNS)
    .maybeSingle();

  if (error) {
    sendServerError(res);
    return;
  }
  if (!data) {
    // Zero rows updated: the client is missing or owned by someone else.
    sendNotAuthorized(res);
    return;
  }

  res.status(200).json({ client: data as ClientRow });
};

/**
 * POST /clients/import — bulk-create clients from a CSV-style array.
 *
 * Accepts `{ clients: Array<{ name, email, company? }> }`. Each entry is
 * validated individually. Entries that pass validation are inserted; entries
 * that fail are reported back with their row index and error. Duplicate emails
 * (same email already owned by the user) are skipped and reported.
 *
 * Returns `{ imported: number, errors: Array<{ row, message }> }`.
 */
const handleImport: RequestHandler = async (req: Request, res: Response): Promise<void> => {
  const body = req.body ?? {};
  const clientsInput = body.clients;

  if (!Array.isArray(clientsInput) || clientsInput.length === 0) {
    res.status(400).json({ error: 'A non-empty "clients" array is required.', field: 'clients' });
    return;
  }

  if (clientsInput.length > 500) {
    res.status(400).json({ error: 'Cannot import more than 500 clients at once.', field: 'clients' });
    return;
  }

  const errors: Array<{ row: number; message: string }> = [];
  const validClients: Array<{ name: string; email: string; company: string | null; row: number }> = [];

  for (let i = 0; i < clientsInput.length; i++) {
    const validation = validateClient(clientsInput[i] ?? {});
    if (!validation.ok) {
      errors.push({ row: i + 1, message: `${validation.field}: ${validation.message}` });
    } else {
      validClients.push({ ...validation.value, row: i + 1 });
    }
  }

  if (validClients.length === 0) {
    res.status(200).json({ imported: 0, errors });
    return;
  }

  // Check for duplicate emails within the import batch
  const seen = new Map<string, number>();
  const deduped: typeof validClients = [];
  for (const client of validClients) {
    const lowerEmail = client.email.toLowerCase();
    if (seen.has(lowerEmail)) {
      errors.push({ row: client.row, message: `Duplicate email in import (same as row ${seen.get(lowerEmail)}).` });
    } else {
      seen.set(lowerEmail, client.row);
      deduped.push(client);
    }
  }

  // Check for emails already owned by this user
  const { data: existing } = await req.supabase
    .from(CLIENTS_TABLE)
    .select('email')
    .in('email', deduped.map((c) => c.email));

  const existingEmails = new Set((existing ?? []).map((r: { email: string }) => r.email.toLowerCase()));
  const toInsert: Array<{ user_id: string; name: string; email: string; company: string | null }> = [];

  for (const client of deduped) {
    if (existingEmails.has(client.email.toLowerCase())) {
      errors.push({ row: client.row, message: `Client with email "${client.email}" already exists.` });
    } else {
      toInsert.push({ user_id: req.userId, name: client.name, email: client.email, company: client.company });
    }
  }

  if (toInsert.length === 0) {
    res.status(200).json({ imported: 0, errors });
    return;
  }

  const { data: inserted, error: insertError } = await req.supabase
    .from(CLIENTS_TABLE)
    .insert(toInsert)
    .select('id');

  if (insertError) {
    sendServerError(res);
    return;
  }

  res.status(200).json({ imported: (inserted ?? []).length, errors });
};

/**
 * Builds the Clients API router. Every route is guarded by the provided auth
 * middleware (defaults to {@link requireAuth}), which attaches `req.userId`
 * and the RLS-scoped `req.supabase` client the handlers rely on.
 */
export function createClientsRouter(options: ClientsRouterOptions = {}): Router {
  const auth = options.authMiddleware ?? requireAuth;
  const router = Router();

  router.post('/clients/import', auth, handleImport);
  router.post('/clients', auth, handleCreate);
  router.get('/clients', auth, handleList);
  router.get('/clients/:id', auth, handleGet);
  router.get('/clients/:id/detail', auth, handleDetail);
  router.get('/clients/:id/history', auth, handleHistory);
  router.put('/clients/:id', auth, handleUpdate);

  return router;
}
