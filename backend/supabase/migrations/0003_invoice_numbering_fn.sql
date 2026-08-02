-- Migration: 0003_invoice_numbering_fn
-- Adds the atomic per-user invoice-numbering function used by the invoice
-- create routine (Requirements 3.2, 3.3, 3.4).
--
-- Supabase / PostgREST cannot express an `INSERT ... SELECT` through the query
-- builder, so the design's atomic numbering statement lives here as a Postgres
-- function invoked via `supabase.rpc('create_invoice_with_number', ...)`.
--
-- The body is the statement from design.md ("Per-User Sequential Invoice
-- Numbering"): the next number is `coalesce(max(invoice_number), 0) + 1`
-- computed in the same statement, scoped to the calling user. The
-- `unique (user_id, invoice_number)` constraint (migration 0001) remains the
-- hard backstop: two concurrent creations that compute the same number cause
-- one to fail with a unique-violation (SQLSTATE 23505), which the application
-- catches and retries with jittered backoff.
--
-- SECURITY INVOKER (the default) means the function executes with the caller's
-- privileges, so Row Level Security applies and `auth.uid()` resolves to the
-- request's authenticated user. `user_id` is taken from `auth.uid()` rather
-- than a parameter so a caller can never create an invoice for another user;
-- the resulting row also satisfies the `invoices_owner` RLS WITH CHECK policy.

create or replace function public.create_invoice_with_number(
  p_client_id  uuid,
  p_amount     numeric,
  p_description text,
  p_due_date   date
) returns public.invoices
language sql
as $$
  insert into public.invoices
    (user_id, client_id, invoice_number, amount, description, due_date, status)
  select
    auth.uid(),
    p_client_id,
    coalesce(max(invoice_number), 0) + 1,
    p_amount,
    p_description,
    p_due_date,
    'draft'
  from public.invoices
  where user_id = auth.uid()
  returning *;
$$;
