/**
 * Feature-local types and helpers for the client management UI (task 15.2).
 *
 * These mirror the backend Clients API contract (see `backend/src/routes/clients.ts`)
 * and are kept local to `app/clients/` to avoid collisions with other concurrent
 * frontend tasks. They cover:
 *   - the `Client` row shape returned by the API,
 *   - the create/update request payload,
 *   - the structured validation-error body (`{ error, field, code }`) the backend
 *     returns on a 400 so the UI can highlight the offending field (Req 2.1).
 */

/** A client row as returned by the backend (`{ client }` / `{ clients }`). */
export interface Client {
  id: string;
  user_id: string;
  name: string;
  email: string;
  company: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Aggregated invoice statistics for a client (Clients section upgrade),
 * mirroring the backend's `ClientStats` shape (`lib/clientStats.ts`).
 */
export interface ClientStats {
  invoiceCount: number;
  totalBilled: number;
  totalPaid: number;
  outstandingAmount: number;
  overdueAmount: number;
  overdueCount: number;
  lastInvoiceDate: string | null;
}

/** A client row enriched with its invoice stats, as returned by `GET /clients`. */
export interface ClientWithStats extends Client {
  stats: ClientStats;
}

/** Response body for `GET /clients` (Clients section upgrade: enriched with stats). */
export interface ClientListResponse {
  clients: ClientWithStats[];
}

/** Response body for `POST /clients`, `GET /clients/:id`, `PUT /clients/:id`. */
export interface ClientResponse {
  client: Client;
}

/** An invoice row as returned by `GET /clients/:id/detail`. */
export interface ClientDetailInvoice {
  id: string;
  invoice_number: number;
  amount: string | number;
  description: string;
  due_date: string;
  status: string;
  created_at: string;
}

/** Response body for `GET /clients/:id/detail` (Client Detail page). */
export interface ClientDetailResponse {
  client: Client;
  stats: ClientStats;
  invoices: ClientDetailInvoice[];
}

/** Request payload for creating or updating a client. */
export interface ClientPayload {
  name: string;
  email: string;
  company: string | null;
}

/** Fields the backend can flag as invalid, matching `ClientField` server-side. */
export type ClientField = 'name' | 'email' | 'company';

/**
 * Structured 400 body returned by the backend on validation failure.
 * `field` identifies which input to highlight; `error` is the human message.
 */
export interface ClientValidationErrorBody {
  error: string;
  field: ClientField;
  code: string;
}

/** Inclusive maximum length for a client name (mirrors backend Req 2.1/2.4). */
export const NAME_MAX_LENGTH = 200;
/** Inclusive maximum length for a client company (mirrors backend Req 2.2/2.4). */
export const COMPANY_MAX_LENGTH = 200;

/**
 * Narrows an unknown API error payload to a {@link ClientValidationErrorBody}.
 *
 * The shared API client collapses non-OK responses into `{ ok:false, error }`
 * where `error` is a string message. To recover the offending `field` for
 * inline highlighting we re-parse: the backend sends `{ error, field, code }`,
 * but only the `error` string survives in `ApiResult`. Callers therefore pass
 * the raw message plus the status; when the status is 400 we treat it as a
 * field error and best-effort map the message back to a field.
 */
export function fieldFromMessage(message: string): ClientField | null {
  const lower = message.toLowerCase();
  if (lower.includes('name')) return 'name';
  if (lower.includes('email')) return 'email';
  if (lower.includes('company')) return 'company';
  return null;
}
