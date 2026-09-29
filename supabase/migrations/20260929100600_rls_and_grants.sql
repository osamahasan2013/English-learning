-- Row Level Security and privileges.
--
-- Model (docs/database.md → "Security"):
--   * Content: every signed-in user may read published content; only admins may read
--     drafts or write. Anonymous visitors read nothing.
--   * Family data: a parent reads and manages only their own, non-deleted children and
--     those children's progress. Admins get no special access to family data.
--   * Progress history and derived progress are written only by the server with the
--     service role (after it has verified the parent-child relationship), so the
--     authenticated role has SELECT only on those tables.
--
-- Hosted Supabase grants every new public table to anon/authenticated by default, so
-- this migration revokes everything first and then grants exactly what is needed.

create or replace function public.is_my_child(p_child_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.children
    where id = p_child_id and parent_id = (select auth.uid()) and deleted_at is null
  );
$$;

-- Soft-deletes a child. A function rather than a plain UPDATE because the row would no
-- longer satisfy the SELECT policy afterwards, which RLS rejects for a returning update.
create or replace function public.archive_child(p_child_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.children
  set deleted_at = now()
  where id = p_child_id and parent_id = (select auth.uid()) and deleted_at is null;
  if not found then
    raise exception 'CHILD_NOT_FOUND' using errcode = 'P0002';
  end if;
end;
$$;

alter table public.children alter column parent_id set default auth.uid();

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
grant all on all tables in schema public to service_role;
grant execute on all functions in schema public to service_role;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_my_child(uuid) to authenticated;
grant execute on function public.archive_child(uuid) to authenticated;
-- Trigger functions run as the table owner; set_updated_at needs no grant.

-- ---------------------------------------------------------------------------------------
-- Content tables with a status column: published rows for everyone signed in; admins
-- see and write everything.
do $$
declare
  t text;
begin
  foreach t in array array[
    'levels', 'subjects', 'audio_assets', 'image_assets', 'phonics_patterns', 'words',
    'sentences', 'stories', 'units', 'skills', 'lessons', 'activities', 'questions',
    'assessments', 'achievements'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (status = ''published'' or (select public.is_admin()))',
      t || '_read', t
    );
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))',
      t || '_admin_write', t
    );
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end
$$;

-- Content reference/join tables without a status of their own (their parent rows carry
-- the publication state).
do $$
declare
  t text;
begin
  foreach t in array array[
    'skill_dimensions', 'activity_types', 'word_categories', 'phonics_pattern_sounds',
    'word_phonics_patterns', 'word_relations', 'sight_words', 'sentence_words',
    'sentence_phonics_patterns', 'skill_prerequisites', 'assessment_items'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))',
      t || '_admin_write', t
    );
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------------------
-- Profiles: a user reads and edits only their own. `role` has no update grant.
alter table public.profiles enable row level security;
create policy profiles_self_read on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_self_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
grant select on public.profiles to authenticated;
grant update (display_name, locale, timezone) on public.profiles to authenticated;

-- Children: parents create, read and edit only their own, non-deleted children.
alter table public.children enable row level security;
create policy children_parent_read on public.children for select to authenticated
  using (parent_id = (select auth.uid()) and deleted_at is null);
create policy children_parent_insert on public.children for insert to authenticated
  with check (parent_id = (select auth.uid()) and deleted_at is null);
create policy children_parent_update on public.children for update to authenticated
  using (parent_id = (select auth.uid()) and deleted_at is null)
  with check (parent_id = (select auth.uid()) and deleted_at is null);
grant select on public.children to authenticated;
grant insert (name, avatar, date_of_birth, grade_level_id, current_level_id, daily_minutes, learning_preferences)
  on public.children to authenticated;
grant update (name, avatar, date_of_birth, grade_level_id, current_level_id, daily_minutes, learning_preferences)
  on public.children to authenticated;

-- Progress: read-only for the owning parent; written by the server only.
do $$
declare
  t text;
begin
  foreach t in array array[
    'lesson_runs', 'assessment_attempts', 'activity_attempts', 'assessment_results',
    'lesson_progress', 'skill_mastery', 'word_progress', 'child_achievements', 'reward_events'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select public.is_my_child(child_id)))',
      t || '_parent_read', t
    );
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end
$$;
