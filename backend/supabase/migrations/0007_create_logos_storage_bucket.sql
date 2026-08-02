-- Migration: 0007_create_logos_storage_bucket
-- Creates a public Supabase Storage bucket for user-uploaded company logos
-- (Settings: Company Logo upload). RLS on `storage.objects` restricts writes
-- to a user's own folder (object path prefixed with their user id), while
-- reads are public so a logo URL can be embedded directly in generated
-- invoice PDFs and follow-up emails without a signed URL.
--
-- Applied directly to the live project via the Supabase MCP server; mirrored
-- here so the migration history in the repo matches the database.

insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do nothing;

create policy "Public read access to logos"
  on storage.objects for select
  using (bucket_id = 'logos');

create policy "Users can upload their own logo"
  on storage.objects for insert
  with check (
    bucket_id = 'logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can update their own logo"
  on storage.objects for update
  using (
    bucket_id = 'logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Users can delete their own logo"
  on storage.objects for delete
  using (
    bucket_id = 'logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
