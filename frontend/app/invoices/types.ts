/**
 * Feature-local types for the invoice UI (task 15.3).
 *
 * These mirror the shapes returned by the Express backend's invoices/clients
 * endpoints (see backend `routes/invoices.ts` and `routes/clients.ts`). They
 * live under `app/invoices/` because they are only used by this feature; the
 * shared API client (`lib/api/client.ts`) is intentionally generic and does not
 * own domain types.
 */

/** The lifecycle status of an invoice (Req 3.8). */
export type InvoiceStatus = 'draft' | 'sent' | 'overdue' | 'paid';

/** The client embedded in an invoice detail response. */
export interface InvoiceClient {
  id: string;
  name: string;
  email: string;
  company: string | null;
}

/**
 * A row from `GET /invoices`. Amount is a Postgres `numeric`, which PostgREST
 * serializes as a string, so we accept either representation.
 */
export interface InvoiceListItem {
  id: string;
  user_id: string;
  client_id: string;
  invoice_number: number;
  amount: string | number;
  description: string;
  due_date: string;
  status: InvoiceStatus;
  created_at: string;
  paid_at?: string | null;
  payment_note?: string | null;
}

/** A single invoice from `GET /invoices/:id`, with its associated client. */
export interface InvoiceDetail extends InvoiceListItem {
  client: InvoiceClient | null;
}

/** Envelope returned by `GET /invoices`. */
export interface InvoiceListResponse {
  invoices: InvoiceListItem[];
}

/** Envelope returned by `GET /invoices/:id`, `POST /invoices`, send, and pay. */
export interface InvoiceResponse {
  invoice: InvoiceDetail;
  message?: string;
}

/** A selectable recipient from `GET /clients`. */
export interface ClientOption {
  id: string;
  name: string;
  email: string;
  company: string | null;
}

/** Envelope returned by `GET /clients`. */
export interface ClientListResponse {
  clients: ClientOption[];
}
