-- Phase 8.4: child lifecycle — permanently delete a child, and reset a child's learning.
-- docs/architecture.md → "Child lifecycle", ADR-046.
--
-- Two separate operations, each one transaction, each re-checking ownership:
--   delete_child          the child row goes; every child-owned table already references
--                         children ON DELETE CASCADE, so all of their learning data goes
--                         with it. Shared curriculum, the parent and other children are
--                         never touched.
--   reset_child_learning  the child, profile, grade and settings stay; every child-owned
--                         learning row is removed (the derived caches are recomputed from
--                         the history, so keeping the history would bring the old progress
--                         back), the learning level returns to the grade, and the child's
--                         learning epoch moves on so events recorded before the reset are
--                         refused by the sync layer instead of restoring old progress.
--
-- Both are callable by the service role only: the server action authenticates the parent,
-- verifies ownership with the parent's own RLS client, and passes the verified parent id,
-- which the function checks again. The browser cannot call them.

alter table public.children
  add column learning_epoch integer not null default 0 check (learning_epoch >= 0),
  add column learning_reset_at timestamptz;

comment on column public.children.learning_epoch is
  'Incremented by reset_child_learning(). Learning events carry the epoch they were recorded in; older ones are obsolete.';
comment on column public.children.learning_reset_at is
  'When the learning was last reset (events without an epoch are compared with this).';

create or replace function public.delete_child(p_child_id uuid, p_parent_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.children
  where id = p_child_id and parent_id = p_parent_id and deleted_at is null;
  if not found then
    raise exception 'CHILD_NOT_FOUND' using errcode = 'P0002';
  end if;
end;
$$;

-- Returns the child's new learning epoch.
create or replace function public.reset_child_learning(p_child_id uuid, p_parent_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_epoch integer;
begin
  -- Locks the child for the duration, so two resets (or a reset and a delete) serialise.
  perform 1 from public.children
  where id = p_child_id and parent_id = p_parent_id and deleted_at is null
  for update;
  if not found then
    raise exception 'CHILD_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- History (answers, runs, sittings, readings, rewards) and every derived cache. The SQL
  -- test 012_child_lifecycle.sql fails if a table referencing children is missing here
  -- without being listed as profile data.
  delete from public.activity_attempts where child_id = p_child_id;
  delete from public.assessment_results where child_id = p_child_id;
  delete from public.assessment_attempts where child_id = p_child_id;
  delete from public.lesson_runs where child_id = p_child_id;
  delete from public.reading_sessions where child_id = p_child_id;
  delete from public.learning_sessions where child_id = p_child_id;
  delete from public.activity_progress where child_id = p_child_id;
  delete from public.lesson_progress where child_id = p_child_id;
  delete from public.subject_progress where child_id = p_child_id;
  delete from public.level_progress where child_id = p_child_id;
  delete from public.skill_mastery where child_id = p_child_id;
  delete from public.review_items where child_id = p_child_id;
  delete from public.word_progress where child_id = p_child_id;
  delete from public.word_area_progress where child_id = p_child_id;
  delete from public.spelling_progress where child_id = p_child_id;
  delete from public.reward_events where child_id = p_child_id;
  delete from public.child_achievements where child_id = p_child_id;

  -- The grade stays; the learning level (adaptive state set by placement or the parent)
  -- starts again at the grade, as for a new child.
  update public.children
  set current_level_id = grade_level_id,
      placement_score = null,
      learning_epoch = learning_epoch + 1,
      learning_reset_at = now()
  where id = p_child_id
  returning learning_epoch into v_epoch;
  return v_epoch;
end;
$$;

revoke all on function public.delete_child(uuid, uuid) from public, anon, authenticated;
revoke all on function public.reset_child_learning(uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_child(uuid, uuid) to service_role;
grant execute on function public.reset_child_learning(uuid, uuid) to service_role;
