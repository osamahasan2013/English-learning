-- Phase 2 hardening: validated parent profiles, time zone captured at sign-up, and
-- family rules enforced in the database (not just in the app), because parents can call
-- the REST API directly with their own session.

-- ---------------------------------------------------------------------------------------
-- Time zones. Streaks and "today" are computed in the family's time zone, so it must be a
-- real IANA name.
create or replace function public.is_valid_time_zone(p_name text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = p_name);
$$;

create or replace function public.validate_profile()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.display_name := btrim(new.display_name);
  if not public.is_valid_time_zone(new.timezone) then
    raise exception 'INVALID_TIME_ZONE' using errcode = '22023', detail = 'Unknown time zone';
  end if;
  return new;
end;
$$;

create trigger profiles_validate
before insert or update of display_name, timezone on public.profiles
for each row execute function public.validate_profile();

-- Sign-up: also take the browser's time zone from the sign-up metadata when it is valid.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_time_zone text := new.raw_user_meta_data ->> 'timezone';
begin
  insert into public.profiles (id, display_name, timezone)
  values (
    new.id,
    left(btrim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 80),
    case when requested_time_zone is not null and public.is_valid_time_zone(requested_time_zone)
      then requested_time_zone else 'UTC' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------
-- Children.

-- A family may have at most this many active child profiles (abuse guard; generous for
-- real families). The advisory lock serialises concurrent inserts for one parent.
create or replace function public.enforce_child_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  max_children constant integer := 12;
  active_count integer;
begin
  -- Levels must be published: a foreign key alone would accept a draft level id sent
  -- straight to the API.
  if not exists (select 1 from public.levels where id = new.grade_level_id and status = 'published')
     or not exists (select 1 from public.levels where id = new.current_level_id and status = 'published') then
    raise exception 'LEVEL_NOT_AVAILABLE' using errcode = '23514';
  end if;

  new.name := btrim(new.name);

  if tg_op = 'INSERT' then
    perform pg_advisory_xact_lock(hashtextextended(new.parent_id::text, 0));
    select count(*) into active_count
    from public.children
    where parent_id = new.parent_id and deleted_at is null;
    if active_count >= max_children then
      raise exception 'CHILD_LIMIT_REACHED' using errcode = '23514', detail = format('A family can have up to %s children', max_children);
    end if;
  end if;
  return new;
end;
$$;

create trigger children_enforce_rules
before insert or update of grade_level_id, current_level_id, name on public.children
for each row execute function public.enforce_child_rules();

revoke all on function public.is_valid_time_zone(text) from public, anon;
revoke all on function public.validate_profile() from public, anon, authenticated;
revoke all on function public.enforce_child_rules() from public, anon, authenticated;
-- validate_profile() runs as the parent updating their profile, so they need this (a
-- read-only lookup of time zone names).
grant execute on function public.is_valid_time_zone(text) to authenticated, service_role;
