-- Migration: 0001_core_tables
-- Creates the core application tables for PayNudge:
--   clients, invoices, follow_ups, activity_events
-- Column definitions, CHECK constraints, foreign keys, the inline
-- invoices_user_number_unique constraint, and the base indexes shown
-- alongside each table's DDL are taken verbatim from design.md
-- (Postgres Schema section).
--
-- `users` is Supabase Auth's `auth.users`. Application tables live in
-- `public` and reference `auth.users(id)`.
--
-- Row Level Security policies are added in a later migration (Task 2.3).
-- Requirements: 2.1, 2.2, 3.1, 8.6, 9.3

-- CLIENTS
create table public.clients (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 200),
  email      text not null check (position('@' in email) > 1),
  company    text check (company is null or char_length(company) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index clients_user_id_idx on public.clients(user_id);

-- INVOICES
create table public.invoices (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  client_id      uuid not null references public.clients(id),
  invoice_number integer not null check (invoice_number >= 1),
  amount         numeric(12,2) not null check (amount >= 0.01 and amount <= 999999999.99),
  description    text not null check (char_length(description) between 1 and 2000),
  due_date       date not null,
  status         text not null default 'draft'
                   check (status in ('draft','sent','overdue','paid')),
  sent_at        timestamptz,
  draft_failure_count integer not null default 0,
  send_lock_at   timestamptz,          -- processing lock for send idempotency
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- Per-user sequential numbering: hard uniqueness backstop
  constraint invoices_user_number_unique unique (user_id, invoice_number)
);
create index invoices_user_status_idx on public.invoices(user_id, status);
create index invoices_client_idx on public.invoices(client_id);

-- FOLLOW_UPS
create table public.follow_ups (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.invoices(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  tier        text not null check (tier in ('polite','firm','final_notice')),
  content     text not null check (char_length(content) between 1 and 10000),
  status      text not null default 'pending_approval'
                check (status in ('pending_approval','approved','sent','discarded')),
  drafted_at  timestamptz not null default now(),
  sent_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index follow_ups_invoice_idx on public.follow_ups(invoice_id);
-- At-most-one pending follow-up per invoice (Req 10.4)
create unique index follow_ups_one_pending_per_invoice
  on public.follow_ups(invoice_id)
  where status = 'pending_approval';

-- ACTIVITY_EVENTS
create table public.activity_events (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  invoice_id uuid references public.invoices(id) on delete cascade,
  type       text not null check (type in ('invoice_sent','follow_up_sent','payment_received')),
  metadata   jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index activity_events_user_idx
  on public.activity_events(user_id, created_at desc, id desc);
