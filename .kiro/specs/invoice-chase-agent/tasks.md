# Implementation Plan: PayNudge

## Overview

This plan implements the PayNudge as a TypeScript project: a Next.js (App Router) + Tailwind + shadcn/ui frontend, a Node.js + Express backend, Supabase Postgres + Supabase Auth with Row Level Security, Resend for email, and a LangGraph + Google Gemini 2.5 Flash worker for AI follow-up drafting.

The work is sequenced to validate correctness early: the database schema (unique constraints, partial unique index, RLS) and the pure logic layer (numbering, validation, tier mapping, days-overdue arithmetic, aggregation, ordering, follow-up state) are built and property-tested before the HTTP endpoints and background jobs that consume them. External services (Supabase Auth, Resend, Gemini) are mocked in property/unit tests; concurrency properties (1, 7, 23) run against a real transactional Postgres.

Property-based tests use `fast-check` with a minimum of 100 iterations and are tagged with a comment in the format `// Feature: paynudge, Property {number}: {property_text}`.

## Tasks

- [x] 1. Set up project scaffolding and tooling
  - Create the monorepo layout: `backend/` (Node.js + Express + TypeScript), `frontend/` (Next.js App Router), and a shared `backend/src/lib` for pure logic
  - Configure TypeScript, ESLint, and Prettier for both packages
  - Add a `.env.example` documenting `GOOGLE_API_KEY`, Resend API key, and Supabase URL/keys (anon + service role)
  - Implement a startup configuration module that reads and validates required environment variables and fails fast if any are missing
  - Configure Vitest as the test runner and add `fast-check` as a dev dependency
  - _Requirements: 8.7_

  - [x]* 1.1 Write smoke test for required environment variables
    - Assert startup fails when `GOOGLE_API_KEY`, Resend key, or Supabase keys are absent, and succeeds when present
    - _Requirements: 8.7_

- [x] 2. Create database schema, constraints, and RLS migrations
  - [x] 2.1 Write migration creating core tables
    - Create `clients`, `invoices`, `follow_ups`, and `activity_events` tables with all columns, `CHECK` constraints, and foreign keys per the design schema
    - Include the `invoices.send_lock_at` column and `invoices.draft_failure_count` column
    - _Requirements: 2.1, 2.2, 3.1, 8.6, 9.3_

  - [x] 2.2 Add uniqueness constraints and indexes
    - Add `unique (user_id, invoice_number)` on `invoices`
    - Add the partial unique index `follow_ups_one_pending_per_invoice` on `follow_ups(invoice_id) where status = 'pending_approval'`
    - Add supporting indexes (`clients_user_id_idx`, `invoices_user_status_idx`, `invoices_client_idx`, `follow_ups_invoice_idx`, `activity_events_user_idx`)
    - _Requirements: 3.4, 10.4_

  - [x] 2.3 Enable Row Level Security and owner policies
    - Enable RLS on all four tables and create `for all using (user_id = auth.uid()) with check (user_id = auth.uid())` policies
    - Configure `on delete cascade` from `invoices` to `follow_ups` and `activity_events`
    - _Requirements: 1.9, 1.10, 11.7_

  - [ ]* 2.4 Write integration test for RLS enforcement
    - Using two seeded users against a real Postgres, verify user B cannot read or mutate user A's clients, invoices, or follow-ups
    - _Requirements: 1.9, 1.10, 2.11, 3.9, 4.7, 6.5, 11.5, 11.6_

- [x] 3. Implement auth integration and route protection
  - [x] 3.1 Implement backend JWT verification and per-request Supabase client
    - Add Express middleware that verifies the Supabase JWT, extracts `sub` as `user_id`, and creates a request-scoped Supabase client running under the user's RLS context; reject requests without a valid token
    - _Requirements: 1.7_

  - [x] 3.2 Implement Next.js middleware route guard
    - Redirect unauthenticated users away from `/dashboard`, `/clients`, and `/invoices` to `/login`; wire Supabase Auth session management and logout on the frontend
    - _Requirements: 1.7, 1.8_

  - [x]* 3.3 Write integration tests for auth flows
    - Cover sign-up (valid, duplicate email), login (success and non-disclosing failure message), logout, and redirect-when-unauthenticated
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_

- [x] 4. Implement shared validation logic and Client CRUD
  - [x] 4.1 Implement client validation module
    - Pure functions validating name (1–200), email format, and optional company (≤200), returning either normalized values or a field-identifying error
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.10_

  - [x]* 4.2 Write property test for client validation
    - **Property 3: Client validation accepts valid input and rejects invalid input without side effects**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.9, 2.10**

  - [x] 4.3 Implement Clients API endpoints
    - `POST /clients`, `GET /clients`, `GET /clients/:id`, `PUT /clients/:id` with validation, ownership scoping via RLS, empty-list handling, and not-authorized on unowned update
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11_

  - [x]* 4.4 Write unit tests for client edge cases
    - Empty client list (2.6), selecting an owned client (2.8), and not-authorized update of an unowned client (2.11)
    - _Requirements: 2.6, 2.8, 2.11_

- [x] 5. Implement invoice numbering, creation, and retrieval
  - [x] 5.1 Implement invoice validation module
    - Pure functions validating amount (0.01–999,999,999.99, ≤2 decimals), description (1–2000, non-whitespace-only), due date (valid calendar date), and client reference
    - _Requirements: 3.1, 3.5, 3.6, 3.7_

  - [x]* 5.2 Write property test for invoice validation
    - **Property 4: Invoice validation accepts valid input and rejects invalid input without creating a record**
    - **Validates: Requirements 3.1, 3.5, 3.6, 3.7**

  - [x] 5.3 Implement atomic per-user invoice numbering with retry-on-conflict
    - Implement the `INSERT ... SELECT coalesce(max(invoice_number),0)+1 ... WHERE user_id = $1` create routine inside a transaction, catching `23505` and retrying with bounded, jittered backoff; return `503` with retry hint when exhausted
    - _Requirements: 3.2, 3.3, 3.4_

  - [ ]* 5.4 Write property test for per-user sequential numbering (real Postgres, concurrent)
    - **Property 1: Per-user sequential invoice numbering is unique and gap-tolerant**
    - Run against a real transactional Postgres issuing parallel invoice creations
    - **Validates: Requirements 3.2, 3.3, 3.4**

  - [x] 5.5 Implement invoice create and retrieval endpoints
    - `POST /invoices` (status defaults to "draft"), `GET /invoices`, `GET /invoices/:id` returning amount, description, due date, invoice number, client, and status; not-available for missing/unowned
    - _Requirements: 3.1, 3.8, 3.9_

  - [x]* 5.6 Write property test for invoice retrieval round-trip
    - **Property 5: Invoice retrieval round-trips stored fields**
    - **Validates: Requirements 3.8, 11.1**

- [x] 6. Implement invoice sending via Resend
  - [x] 6.1 Implement Email_Service wrapper with 30s timeout
    - Resend integration that resolves on confirmed delivery and rejects on delivery error or timeout, returning a delivery-failure signal
    - _Requirements: 4.1, 4.4, 4.5_

  - [x] 6.2 Implement invoice email content builder
    - Pure function composing email content including client name, invoice number, amount, description, and due date
    - _Requirements: 4.2_

  - [x]* 6.3 Write property test for invoice email content
    - **Property 6: Invoice email content includes all required fields**
    - **Validates: Requirements 4.2**

  - [x] 6.4 Implement guarded send endpoint
    - `POST /invoices/:id/send` claims a processing lock via conditional update (`... AND status = 'draft' AND send_lock_at IS NULL RETURNING *`); on confirmed delivery set status to "sent" and record an invoice-sent event; on error/timeout retain "draft" and release lock; reject non-draft (return current status) and unowned sends
    - _Requirements: 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9_

  - [ ]* 6.5 Write property test for the guarded send transition (real Postgres, concurrent)
    - **Property 7: Send action is a guarded, at-most-once transition**
    - Run concurrent send attempts against a real transactional Postgres
    - **Validates: Requirements 4.3, 4.6, 4.8, 4.9**

  - [~]* 6.6 Write unit tests for send delivery-error and timeout branches
    - Verify status stays "draft" and a delivery-failure message is returned on error and on timeout
    - _Requirements: 4.4, 4.5_

- [x] 7. Implement payment tracking
  - [x] 7.1 Implement mark-paid transition and endpoint
    - `POST /invoices/:id/pay` sets "sent"/"overdue" → "paid" and records a payment-received event; reject already-paid (unchanged), draft (unchanged), and unowned (unchanged) with appropriate messages
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x]* 7.2 Write property test for the mark-paid transition
    - **Property 11: Marking payment is a valid-status-only transition with an event**
    - **Validates: Requirements 6.1, 6.3, 6.4, 6.6**

  - [x]* 7.3 Write unit tests for payment guards
    - Concrete already-paid (6.4) and draft-cannot-be-paid (6.6) cases
    - _Requirements: 6.4, 6.6_

- [x] 8. Implement dashboard aggregation and activity feed
  - [x] 8.1 Implement outstanding-total aggregation logic
    - Pure function summing amounts of invoices in "sent" or "overdue" status, returning 0 when none
    - _Requirements: 5.1, 5.2, 5.7_

  - [x]* 8.2 Write property test for outstanding total
    - **Property 8: Outstanding total equals the sum of sent and overdue invoice amounts**
    - **Validates: Requirements 5.1, 5.2, 5.7, 6.2**

  - [x] 8.3 Implement dashboard count and activity-feed ordering logic
    - Pure functions computing overdue count, pending-follow-up count, and the activity feed capped at 20, ordered by `created_at` desc then `id` desc
    - _Requirements: 5.3, 5.4, 5.5, 5.6, 5.8_

  - [x]* 8.4 Write property test for dashboard counts
    - **Property 9: Dashboard counts match their underlying sets**
    - **Validates: Requirements 5.3, 5.4, 5.8**

  - [x]* 8.5 Write property test for activity feed ordering
    - **Property 10: Activity feed is bounded and correctly ordered**
    - **Validates: Requirements 5.5, 5.6**

  - [x] 8.6 Implement dashboard endpoint
    - `GET /dashboard` returning `outstanding_total`, `overdue_count`, `pending_follow_up_count`, and up to 20 activity events for the user
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_

  - [x]* 8.7 Write unit test for empty activity feed
    - Verify an empty feed is returned when the user owns no events
    - _Requirements: 5.6_

- [x] 9. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Implement overdue detection cron and days-overdue arithmetic
  - [x] 10.1 Implement overdue-detection transition and days-overdue logic
    - Pure functions: transition "sent" → "overdue" only when current date is strictly later than due date; leave "sent" (on/before due), "paid", and "draft" unchanged; compute Days_Overdue as whole calendar days since due date (first day after = 1), recomputed on every evaluation
    - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [x]* 10.2 Write property test for overdue transitions
    - **Property 12: Overdue detector transitions preserve status rules**
    - **Validates: Requirements 7.2, 7.3, 7.4, 7.5**

  - [x]* 10.3 Write property test for days-overdue arithmetic
    - **Property 13: Days_overdue is correct calendar-day arithmetic**
    - **Validates: Requirements 7.6, 7.7**

  - [x] 10.4 Implement daily overdue-detection cron job
    - Idempotent `runOverdueDetection()` that evaluates all invoices, applies transitions, recomputes days_overdue, and enqueues eligible overdue invoices for drafting; wire the scheduler to run at least daily
    - _Requirements: 7.1_

  - [x]* 10.5 Write smoke test for overdue-detection scheduling
    - Verify the cron is scheduled and runs at least daily
    - _Requirements: 7.1_

- [x] 11. Implement AI escalation drafting worker
  - [x] 11.1 Implement escalation-tier mapping and escalation-decision logic
    - Pure functions mapping days_overdue to tier (polite/firm/final_notice) and deciding whether to draft based on strict tier increase over the most recent non-discarded follow-up (order polite < firm < final_notice)
    - _Requirements: 8.2, 8.3, 8.4, 10.1_

  - [x]* 11.2 Write property test for escalation tier mapping
    - **Property 14: Escalation tier is a total function of days overdue**
    - **Validates: Requirements 8.2, 8.3, 8.4**

  - [x]* 11.3 Write property test for escalation decision
    - **Property 22: Escalation drafts only when the tier strictly increases**
    - **Validates: Requirements 10.1**

  - [x] 11.4 Implement Gemini draft generation and content validation
    - Call Gemini 2.5 Flash via `@google/generative-ai` using `GOOGLE_API_KEY`; build the prompt and validate that generated content includes client name, invoice amount, invoice number, and Days_Overdue
    - _Requirements: 8.5, 8.7_

  - [x] 11.5 Implement LangGraph draft worker with at-most-one-pending persistence
    - `draftFollowUp(invoiceId)` graph: load invoice/client/days_overdue → compute tier → guard → generate → validate → discard existing pending then insert new `pending_approval` follow-up in one transaction (relying on the partial unique index)
    - _Requirements: 8.1, 8.6, 10.5_

  - [x]* 11.6 Write property test for valid pending follow-up drafting
    - **Property 15: Drafting an overdue invoice produces a valid pending follow-up**
    - **Validates: Requirements 8.1, 8.5, 8.6**

  - [ ]* 11.7 Write property test for the at-most-one-pending invariant (real Postgres, concurrent)
    - **Property 23: At most one pending follow-up per invoice is preserved across all operations**
    - Run concurrent draft/escalate/approve/discard sequences against a real transactional Postgres
    - **Validates: Requirements 10.4, 10.5**

  - [x] 11.8 Implement draft-failure counting and cap
    - Increment `draft_failure_count`, record a draft-failure message, and create no pending follow-up on failure; stop automatic drafting after 3 consecutive failures; reset the counter on success
    - _Requirements: 8.8, 8.9_

  - [x]* 11.9 Write property test for draft-failure handling
    - **Property 16: Draft failures are recorded, non-blocking, and capped at three consecutive attempts**
    - **Validates: Requirements 8.8, 8.9**

- [x] 12. Implement human-in-the-loop follow-up approval flow
  - [x] 12.1 Implement follow-up state-transition logic and content-edit validation
    - Pure reducer enforcing that edit/approve/discard apply only to `pending_approval` follow-ups; validate edited content is non-empty and ≤10,000 chars
    - _Requirements: 9.3, 9.4, 9.5, 9.10, 9.11_

  - [x]* 12.2 Write property test for content-edit validation
    - **Property 19: Follow-up content edits are validated and round-trip**
    - **Validates: Requirements 9.3, 9.4**

  - [x]* 12.3 Write property test for approval-only delivery gate
    - **Property 17: Follow-up delivery is reachable only through approval**
    - **Validates: Requirements 9.1, 9.5, 9.10**

  - [x]* 12.4 Write property test for non-pending action rejection
    - **Property 21: Non-pending follow-up actions are rejected without side effects**
    - **Validates: Requirements 9.11**

  - [x] 12.5 Implement pending follow-up listing endpoint
    - `GET /follow-ups?status=pending_approval` returning follow-ups newest-drafted-first with content and associated invoice number, amount, due date, and client name
    - _Requirements: 9.2_

  - [x]* 12.6 Write property test for pending listing ordering and context
    - **Property 18: Pending follow-up listing is ordered and context-complete**
    - **Validates: Requirements 9.2**

  - [x] 12.7 Implement edit, approve, and discard endpoints with delivery
    - `PUT /follow-ups/:id/content`, `POST /follow-ups/:id/approve` (approve → deliver via Email_Service within 30s → on confirm set "sent", append history, record follow-up-sent event; on timeout retain "approved" and return delivery-failure), `POST /follow-ups/:id/discard`
    - _Requirements: 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 9.10, 9.11_

  - [x]* 12.8 Write property test for confirmed follow-up delivery
    - **Property 20: Confirmed follow-up delivery transitions to sent, appends history, and records an event**
    - **Validates: Requirements 9.7, 9.8**

  - [x]* 12.9 Write unit test for follow-up delivery timeout branch
    - Verify status stays "approved" and a delivery-failure message is returned on timeout
    - _Requirements: 9.9_

- [x] 13. Implement payment-driven chase-cycle termination
  - [x] 13.1 Wire mark-paid to halt the chase cycle
    - On transition to "paid", stop further drafting for the invoice and set any `pending_approval` follow-up for it to "discarded"
    - _Requirements: 10.2, 10.3_

  - [x]* 13.2 Write property test for payment halting the chase cycle
    - **Property 24: Payment halts the chase cycle and clears pending drafts**
    - **Validates: Requirements 10.2, 10.3**

- [x] 14. Implement history and delete endpoints
  - [x] 14.1 Implement invoice history endpoint
    - `GET /invoices/:id/history` returning invoice details, current status, and follow-up history (only "sent" follow-ups with tier and delivery timestamp, ordered earliest→latest); not-available for missing/unowned
    - _Requirements: 11.1, 11.2, 11.5_

  - [x]* 14.2 Write property test for follow-up history contents and ordering
    - **Property 25: Follow-up history contains only sent follow-ups, ordered by delivery time**
    - **Validates: Requirements 11.2**

  - [x] 14.3 Implement client history endpoint
    - `GET /clients/:id/history` returning all invoices for the client with current statuses; not-available for missing/unowned
    - _Requirements: 11.3, 11.6_

  - [x]* 14.4 Write property test for client history
    - **Property 26: Client history returns all owned invoices for that client with statuses**
    - **Validates: Requirements 11.3**

  - [x] 14.5 Implement invoice delete endpoint
    - `DELETE /invoices/:id` removing the invoice and cascade-deleting its follow-ups
    - _Requirements: 11.7_

  - [x]* 14.6 Write property test for delete cascade
    - **Property 27: Deleting an invoice cascades to its follow-ups**
    - **Validates: Requirements 11.7**

  - [x]* 14.7 Write unit test for retention across a no-op
    - Verify sent invoices and sent follow-ups are retained until the invoice is deleted
    - _Requirements: 11.4_

- [x] 15. Implement frontend views and wire to the API
  - [x] 15.1 Build auth pages (login, sign-up, logout) with Supabase Auth
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.8_

  - [x] 15.2 Build client management UI (list, create, edit)
    - _Requirements: 2.1, 2.6, 2.7, 2.8, 2.9_

  - [x] 15.3 Build invoice UI (create, list, detail, send, mark paid, delete)
    - _Requirements: 3.1, 3.8, 4.1, 6.1, 11.7_

  - [x] 15.4 Build dashboard view (outstanding total, overdue count, pending count, activity feed)
    - _Requirements: 5.1, 5.3, 5.4, 5.5_

  - [x] 15.5 Build follow-up approval UI (pending list, edit, approve, discard) and history views
    - _Requirements: 9.2, 9.3, 9.5, 9.10, 11.1, 11.3_

  - [x]* 15.6 Write integration smoke tests for key frontend flows against a mocked API
    - Cover send-invoice and approve-follow-up flows end to end with the API mocked
    - _Requirements: 4.1, 9.6_

- [x] 16. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each task references specific requirements or a design property for traceability.
- Property tests use `fast-check` (minimum 100 iterations) tagged `// Feature: paynudge, Property {number}: {property_text}`, with Supabase/Resend/Gemini mocked.
- Concurrency properties (Property 1 in 5.4, Property 7 in 6.5, Property 23 in 11.7) run against a real transactional Postgres to exercise unique constraints, the send lock, and the partial unique index.
- Checkpoints (tasks 9 and 16) ensure incremental validation.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1"] },
    { "id": 1, "tasks": ["2.2", "2.3", "4.1", "5.1", "6.2", "8.1", "8.3", "10.1", "11.1", "12.1"] },
    { "id": 2, "tasks": ["2.4", "3.1", "3.2", "4.2", "5.2", "6.3", "8.2", "8.4", "8.5", "10.2", "10.3", "11.2", "11.3", "12.2"] },
    { "id": 3, "tasks": ["3.3", "4.3", "5.3", "6.1", "11.4"] },
    { "id": 4, "tasks": ["4.4", "5.4", "5.5", "6.4", "7.1", "10.4", "11.5", "11.8"] },
    { "id": 5, "tasks": ["5.6", "6.5", "6.6", "7.2", "7.3", "8.6", "10.5", "11.6", "11.7", "11.9", "12.5"] },
    { "id": 6, "tasks": ["8.7", "12.3", "12.4", "12.6", "12.7", "14.1", "14.3", "14.5"] },
    { "id": 7, "tasks": ["12.8", "12.9", "13.1", "14.2", "14.4", "14.6", "14.7"] },
    { "id": 8, "tasks": ["13.2", "15.1", "15.2", "15.3", "15.4", "15.5"] },
    { "id": 9, "tasks": ["15.6"] }
  ]
}
```
