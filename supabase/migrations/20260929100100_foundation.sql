-- Foundation: shared enums, the updated_at trigger, and user profiles with roles.
--
-- Conventions (see docs/database.md):
--   * uuid primary keys (gen_random_uuid()); progress rows use client-generated uuids so
--     offline events synchronize idempotently.
--   * content tables carry a `status` (draft/published/archived) and are never hard
--     deleted once referenced by learner history — archive instead.
--   * every table has created_at; mutable tables also have updated_at maintained by
--     set_updated_at().

create type public.content_status as enum ('draft', 'published', 'archived');
create type public.app_role as enum ('parent', 'admin');
create type public.mastery_status as enum ('NOT_STARTED', 'LEARNING', 'PRACTICING', 'ALMOST_MASTERED', 'MASTERED');

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- One row per auth user. `role` separates content administration from family data;
-- it can only be changed by the service role (there is no column grant for it).
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  role public.app_role not null default 'parent',
  locale text not null default 'en-US' check (char_length(locale) <= 16),
  timezone text not null default 'UTC' check (char_length(timezone) <= 64),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- Creates the profile when a user signs up. SECURITY DEFINER because the trigger runs as
-- the auth server's role, which has no rights on public tables.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    left(coalesce(new.raw_user_meta_data ->> 'display_name', ''), 80)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Role check used by content RLS policies. SECURITY DEFINER so policies on other tables
-- can call it without the caller needing a policy on profiles for other users' rows.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;
