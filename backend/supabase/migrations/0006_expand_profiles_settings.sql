-- Migration: 0006_expand_profiles_settings
-- Expands `profiles` with the Company/Profile Settings fields: logo URL,
-- business address, payment instructions, default payment terms, email
-- signature, and a per-tier follow-up cadence (days overdue before each
-- escalation tier). These surface on generated invoices/PDFs and in AI
-- follow-up emails, and the cadence is displayed (read-only for now) in
-- Settings.
--
-- Applied directly to the live project via the Supabase MCP server; mirrored
-- here so the migration history in the repo matches the database.

alter table public.profiles add column logo_url text;
alter table public.profiles add column business_address text
  check (business_address is null or char_length(business_address) <= 2000);
alter table public.profiles add column payment_instructions text
  check (payment_instructions is null or char_length(payment_instructions) <= 4000);
alter table public.profiles add column default_payment_terms text
  check (default_payment_terms is null or char_length(default_payment_terms) <= 100);
alter table public.profiles add column email_signature text
  check (email_signature is null or char_length(email_signature) <= 2000);

-- Follow-up cadence: days-overdue thresholds for each escalation tier.
alter table public.profiles add column cadence_polite_days integer not null default 1
  check (cadence_polite_days >= 1);
alter table public.profiles add column cadence_firm_days integer not null default 7
  check (cadence_firm_days >= 1);
alter table public.profiles add column cadence_final_notice_days integer not null default 14
  check (cadence_final_notice_days >= 1);
