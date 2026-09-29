-- Progress history is append-only by id: the same device-generated id can only be stored
-- once, which is what makes offline sync idempotent.
begin;

insert into auth.users (id, email, aud, role, instance_id) values
  ('a1000000-0000-4000-8000-000000000001', 'p@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
insert into public.levels (id, code, name, short_name, sort_order, min_age, max_age, difficulty, status)
values ('d1000000-0000-4000-8000-000000000001', 'TESTLVL', 'L', 'L', 903, 4, 5, 1, 'published');
insert into public.children (id, parent_id, name, grade_level_id, current_level_id)
values ('e1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'C', 'd1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001');

insert into public.reward_events (child_id, source_type, source_id, points, stars)
values ('e1000000-0000-4000-8000-000000000001', 'lesson_run', 'f1000000-0000-4000-8000-000000000001', 10, 2)
on conflict (child_id, source_type, source_id) do nothing;
insert into public.reward_events (child_id, source_type, source_id, points, stars)
values ('e1000000-0000-4000-8000-000000000001', 'lesson_run', 'f1000000-0000-4000-8000-000000000001', 10, 2)
on conflict (child_id, source_type, source_id) do nothing;

do $$ begin
  assert (select count(*) from public.reward_events where child_id = 'e1000000-0000-4000-8000-000000000001') = 1,
    'a rewarding source pays out once';
  begin
    insert into public.children (parent_id, name, grade_level_id, current_level_id, daily_minutes)
    values ('a1000000-0000-4000-8000-000000000001', 'X', 'd1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001', 7);
    raise exception 'daily_minutes must be one of the allowed settings';
  exception when check_violation then null;
  end;
  begin
    insert into public.children (parent_id, name, grade_level_id, current_level_id)
    values ('a1000000-0000-4000-8000-000000000001', '   ', 'd1000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000001');
    raise exception 'blank child names must be rejected';
  exception when check_violation then null;
  end;
end $$;

rollback;
\echo '002_progress_constraints: all assertions passed'
