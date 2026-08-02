/**
 * Types and formatting helpers for the follow-up approval UI (task 15.5).
 *
 * These mirror the JSON shapes returned by the backend follow-ups router
 * (`GET /follow-ups`, `PUT /follow-ups/:id/content`, `POST /follow-ups/:id/approve`,
 * `POST /follow-ups/:id/discard`) so the client components stay type-safe
 * without reaching into backend code. Kept feature-local to this route.
 */

/** Escalation tiers a drafted follow-up can carry (design Escalation_Tier). */
export type EscalationTier = 'polite' | 'firm' | 'final_notice';

/**
 * Inclusive maximum length for edited follow-up content (Req 9.3, 9.4). Mirrors
 * the backend `MAX_CONTENT_LENGTH` so an over-long edit is caught before the
 * request is sent.
 */
export const MAX_CONTENT_LENGTH = 10_000;

/** Invoice/client context embedded in a pending follow-up (Req 9.2). */
export interface PendingFollowUpInvoice {
  invoice_number: number;
  amount: string | number;
  due_date: string;
  client: { name: string } | null;
}

/** A single pending-approval follow-up as returned by `GET /follow-ups` (Req 9.2). */
export interface PendingFollowUp {
  id: string;
  invoice_id: string;
  tier: EscalationTier;
  content: string;
  status: string;
  drafted_at: string;
  /** 1st, 2nd, 3rd... follow-up drafted for this invoice (Feature 3). */
  follow_up_number: number | null;
  invoice: PendingFollowUpInvoice | null;
}

/** Response body of `GET /follow-ups?status=pending_approval`. */
export interface PendingFollowUpsResponse {
  follow_ups: PendingFollowUp[];
}

/** Response body of the edit/approve/discard/regenerate endpoints. */
export interface FollowUpActionResponse {
  follow_up: {
    id: string;
    invoice_id: string;
    tier: EscalationTier;
    content: string;
    status: string;
    drafted_at?: string;
    sent_at?: string | null;
    follow_up_number?: number | null;
  };
}

/** Human-readable ordinal for a follow-up sequence number (1st, 2nd, 3rd...). */
export function ordinalLabel(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** Human-readable label for an escalation tier. */
export function tierLabel(tier: EscalationTier | string): string {
  switch (tier) {
    case 'polite':
      return 'Polite';
    case 'firm':
      return 'Firm';
    case 'final_notice':
      return 'Final notice';
    default:
      return tier;
  }
}

/** Formats a numeric/stringified amount as USD currency; falls back to raw. */
export function formatAmount(amount: string | number): string {
  const value = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(value)) {
    return String(amount);
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value);
}

/** Formats an ISO date/timestamp as a readable date; falls back to raw. */
export function formatDate(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

/** Formats an ISO timestamp as a readable date and time; falls back to raw. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}
