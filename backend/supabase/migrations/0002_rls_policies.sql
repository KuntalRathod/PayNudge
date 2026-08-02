-- Migration: 0002_rls_policies
-- Enables Row Level Security (RLS) on all four application tables and adds
-- per-user owner policies. Every policy scopes rows to the authenticated
-- user (auth.uid()), enforcing per-user data isolation at the storage layer.
--
-- The RLS statements below are taken verbatim from design.md
-- (Row Level Security section).
--
-- Cascade note (Req 11.7): `on delete cascade` from invoices to follow_ups
-- and activity_events is already declared inline in 0001_core_tables.sql:
--   - follow_ups.invoice_id     references public.invoices(id) on delete cascade
--   - activity_events.invoice_id references public.invoices(id) on delete cascade
-- Deleting an invoice therefore cascades to its follow-ups and activity
-- events; no table redefinition is required here.
--
-- Requirements: 1.9, 1.10, 11.7

alter table public.clients        enable row level security;
alter table public.invoices       enable row level security;
alter table public.follow_ups     enable row level security;
alter table public.activity_events enable row level security;

create policy clients_owner on public.clients
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy invoices_owner on public.invoices
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy follow_ups_owner on public.follow_ups
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy activity_owner on public.activity_events
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
