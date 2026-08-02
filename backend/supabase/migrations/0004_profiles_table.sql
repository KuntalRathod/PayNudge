-- Migration: 0004_profiles_table
-- Creates a `profiles` table to store user settings like business_name.
-- The business_name is used by the AI draft worker to sign follow-up emails
-- instead of placeholder text like "[Your Name]".
--
-- On sign-up, a trigger automatically creates a profile row with `business_name`
-- defaulting to the email prefix (everything before the '@').

create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  business_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS: users can only read/update their own profile.
alter table public.profiles enable row level security;

create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update
  using (auth.uid() = id);

create policy "Users can insert own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

-- Trigger function: auto-create a profile on user sign-up with the email prefix
-- as the default business_name.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, business_name)
  values (new.id, split_part(new.email, '@', 1));
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
