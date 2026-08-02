-- Migration: 0005_expand_activity_timeline_and_invoice_fields
-- Widens activity_events.type to support the full Invoice Activity Timeline
-- feature (Created, Sent, Became Overdue, Follow-up drafted, Follow-up sent,
-- Follow-up discarded, Marked as Paid), and adds the fields needed for the
-- "Mark as Paid" flow (payment date + optional note) and follow-up numbering
-- (1st, 2nd, 3rd... follow-up per invoice).
--
-- Applied directly to the live project via the Supabase MCP server; mirrored
-- here so the migration history in the repo matches the database.

-- Widen activity_events.type to cover the full invoice activity timeline.
alter table public.activity_events drop constraint activity_events_type_check;
alter table public.activity_events add constraint activity_events_type_check
  check (type in (
    'invoice_created',
    'invoice_sent',
    'invoice_became_overdue',
    'follow_up_drafted',
    'follow_up_sent',
    'follow_up_discarded',
    'payment_received'
  ));

-- Mark-as-paid context: payment date + optional note (Feature: Mark as Paid flow).
alter table public.invoices add column paid_at timestamptz;
alter table public.invoices add column payment_note text
  check (payment_note is null or char_length(payment_note) <= 2000);

-- Follow-up sequence number (1st, 2nd, 3rd...) per invoice.
alter table public.follow_ups add column follow_up_number integer;

-- Backfill follow_up_number for existing rows, ordered by draft time.
with numbered as (
  select id, row_number() over (partition by invoice_id order by drafted_at asc, created_at asc) as rn
  from public.follow_ups
)
update public.follow_ups f
set follow_up_number = n.rn
from numbered n
where f.id = n.id;
