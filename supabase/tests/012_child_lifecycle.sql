-- Phase 8.4 child lifecycle: delete_child() and reset_child_learning() are server-only,
-- check the parent, remove exactly the child-owned data, keep the profile and grade on a
-- reset, never touch another child or shared curriculum, and stay complete as tables are
-- added. Rolled back at the end.
begin;

insert into auth.users (id, email, aud, role, instance_id) values
  ('a8400000-0000-4000-8000-000000000001', 'lifecycle-a@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('b8400000-0000-4000-8000-000000000002', 'lifecycle-b@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');

insert into public.levels (id, code, name, short_name, sort_order, min_age, max_age, difficulty, status) values
  ('d8400000-0000-4000-8000-000000000001', 'T84G', 'Test grade', 'TG', 941, 6, 7, 1, 'published'),
  ('d8400000-0000-4000-8000-000000000002', 'T84L', 'Test learning level', 'TL', 942, 5, 6, 1, 'published');

-- Parent A: Ana (grade TG, learning at TL after a placement) and Ben. Parent B: Cy.
insert into public.children (id, parent_id, name, grade_level_id, current_level_id, placement_score) values
  ('e8400000-0000-4000-8000-00000000000a', 'a8400000-0000-4000-8000-000000000001', 'Ana', 'd8400000-0000-4000-8000-000000000001', 'd8400000-0000-4000-8000-000000000002', 72),
  ('e8400000-0000-4000-8000-00000000000b', 'a8400000-0000-4000-8000-000000000001', 'Ben', 'd8400000-0000-4000-8000-000000000001', 'd8400000-0000-4000-8000-000000000001', null),
  ('e8400000-0000-4000-8000-00000000000c', 'b8400000-0000-4000-8000-000000000002', 'Cy', 'd8400000-0000-4000-8000-000000000001', 'd8400000-0000-4000-8000-000000000001', null);
insert into public.reward_events (child_id, source_type, source_id, points, stars)
select c, 'lesson_run', gen_random_uuid(), 10, 1
from unnest(array['e8400000-0000-4000-8000-00000000000a', 'e8400000-0000-4000-8000-00000000000b', 'e8400000-0000-4000-8000-00000000000c']::uuid[]) c;
insert into public.learning_sessions (id, child_id, started_at, ended_at, duration_seconds)
select gen_random_uuid(), c, now() - interval '1 hour', now(), 3600
from unnest(array['e8400000-0000-4000-8000-00000000000a', 'e8400000-0000-4000-8000-00000000000b', 'e8400000-0000-4000-8000-00000000000c']::uuid[]) c;

create temp table curriculum_before as
select (select count(*) from public.lessons) lessons, (select count(*) from public.questions) questions,
       (select count(*) from public.words) words, (select count(*) from public.skills) skills,
       (select count(*) from public.achievements) achievements, (select count(*) from public.levels) levels;

create function pg_temp.act_as(user_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', user_id::text, true);
end $$;
grant execute on function pg_temp.act_as(uuid) to authenticated;

-- ------------------------------------------------------------ completeness (as owner)
-- Every table that references children cascades on delete (Delete Child removes it) and is
-- emptied by reset_child_learning (Reset removes it). A new child-owned table must be
-- added to the reset function or this fails.
do $$
declare
  definition text := pg_get_functiondef('public.reset_child_learning(uuid, uuid)'::regprocedure);
  r record;
begin
  for r in
    select c.conrelid::regclass::text as tbl, c.confdeltype
    from pg_constraint c
    where c.contype = 'f' and c.confrelid = 'public.children'::regclass
  loop
    if r.confdeltype <> 'c' then
      raise exception 'FAIL: % references children without ON DELETE CASCADE', r.tbl;
    end if;
    if position(format('delete from public.%s where child_id', r.tbl) in definition) = 0 then
      raise exception 'FAIL: reset_child_learning() does not reset %', r.tbl;
    end if;
  end loop;
end $$;

-- ------------------------------------------------------------ the browser cannot call them
set local role anon;
do $$ begin
  begin
    perform public.delete_child('e8400000-0000-4000-8000-00000000000c', 'b8400000-0000-4000-8000-000000000002');
    raise exception 'FAIL: anon could call delete_child';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

do $$ begin perform pg_temp.act_as('a8400000-0000-4000-8000-000000000001'); end $$;
do $$ begin
  begin
    perform public.reset_child_learning('e8400000-0000-4000-8000-00000000000a', 'a8400000-0000-4000-8000-000000000001');
    raise exception 'FAIL: a signed-in parent could call reset_child_learning directly';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.delete_child('e8400000-0000-4000-8000-00000000000a', 'a8400000-0000-4000-8000-000000000001');
    raise exception 'FAIL: a signed-in parent could call delete_child directly';
  exception when insufficient_privilege then null;
  end;
  -- Nor can a parent change the epoch to dodge the stale-event check.
  begin
    update public.children set learning_epoch = 99 where id = 'e8400000-0000-4000-8000-00000000000a';
    raise exception 'FAIL: a parent could change learning_epoch';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ------------------------------------------------------------ as the server (service role)
set local role service_role;

-- Ownership is checked again in the database: parent B cannot reset or delete Ana.
do $$ begin
  begin
    perform public.reset_child_learning('e8400000-0000-4000-8000-00000000000a', 'b8400000-0000-4000-8000-000000000002');
    raise exception 'FAIL: parent B reset parent A''s child';
  exception when no_data_found then null;
  end;
  begin
    perform public.delete_child('e8400000-0000-4000-8000-00000000000a', 'b8400000-0000-4000-8000-000000000002');
    raise exception 'FAIL: parent B deleted parent A''s child';
  exception when no_data_found then null;
  end;
  begin
    perform public.reset_child_learning(gen_random_uuid(), 'a8400000-0000-4000-8000-000000000001');
    raise exception 'FAIL: an unknown child id was accepted';
  exception when no_data_found then null;
  end;
end $$;

-- Reset Ana: her learning goes, she, her grade and her parent stay; Ben and Cy are untouched.
do $$
declare
  epoch1 integer;
  epoch2 integer;
  ana record;
begin
  epoch1 := public.reset_child_learning('e8400000-0000-4000-8000-00000000000a', 'a8400000-0000-4000-8000-000000000001');
  if epoch1 <> 1 then raise exception 'FAIL: epoch after the first reset is %', epoch1; end if;
  select * into ana from public.children where id = 'e8400000-0000-4000-8000-00000000000a';
  if ana.name <> 'Ana' or ana.parent_id <> 'a8400000-0000-4000-8000-000000000001' then
    raise exception 'FAIL: the child profile changed';
  end if;
  if ana.grade_level_id <> 'd8400000-0000-4000-8000-000000000001' then raise exception 'FAIL: the grade changed'; end if;
  if ana.current_level_id <> ana.grade_level_id or ana.placement_score is not null then
    raise exception 'FAIL: the learning level did not start again at the grade';
  end if;
  if ana.learning_reset_at is null then raise exception 'FAIL: learning_reset_at not set'; end if;
  if exists (select 1 from public.reward_events where child_id = ana.id)
     or exists (select 1 from public.learning_sessions where child_id = ana.id) then
    raise exception 'FAIL: Ana''s learning data was not reset';
  end if;
  if (select count(*) from public.reward_events where child_id in ('e8400000-0000-4000-8000-00000000000b', 'e8400000-0000-4000-8000-00000000000c')) <> 2
     or (select count(*) from public.learning_sessions where child_id in ('e8400000-0000-4000-8000-00000000000b', 'e8400000-0000-4000-8000-00000000000c')) <> 2 then
    raise exception 'FAIL: another child''s data changed';
  end if;
  -- Again: safe, nothing duplicated, the epoch simply moves on.
  epoch2 := public.reset_child_learning('e8400000-0000-4000-8000-00000000000a', 'a8400000-0000-4000-8000-000000000001');
  if epoch2 <> 2 then raise exception 'FAIL: epoch after the second reset is %', epoch2; end if;
  if (select count(*) from public.children where id = 'e8400000-0000-4000-8000-00000000000a') <> 1 then
    raise exception 'FAIL: a second reset changed the child';
  end if;
end $$;

-- Delete Ben: he and his data go; Ana, Cy, both parents and the curriculum stay.
do $$ begin
  perform public.delete_child('e8400000-0000-4000-8000-00000000000b', 'a8400000-0000-4000-8000-000000000001');
  if exists (select 1 from public.children where id = 'e8400000-0000-4000-8000-00000000000b') then
    raise exception 'FAIL: Ben still exists';
  end if;
  if exists (select 1 from public.reward_events where child_id = 'e8400000-0000-4000-8000-00000000000b')
     or exists (select 1 from public.learning_sessions where child_id = 'e8400000-0000-4000-8000-00000000000b') then
    raise exception 'FAIL: Ben''s data was not deleted';
  end if;
  if (select count(*) from public.children where id in ('e8400000-0000-4000-8000-00000000000a', 'e8400000-0000-4000-8000-00000000000c')) <> 2 then
    raise exception 'FAIL: another child was deleted';
  end if;
  if (select count(*) from public.profiles where id in ('a8400000-0000-4000-8000-000000000001', 'b8400000-0000-4000-8000-000000000002')) <> 2
     or (select count(*) from auth.users where id = 'a8400000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'FAIL: a parent account was touched';
  end if;
  if (select count(*) from public.reward_events where child_id = 'e8400000-0000-4000-8000-00000000000c') <> 1 then
    raise exception 'FAIL: the other family''s child lost data';
  end if;
  -- Deleting again fails safely.
  begin
    perform public.delete_child('e8400000-0000-4000-8000-00000000000b', 'a8400000-0000-4000-8000-000000000001');
    raise exception 'FAIL: deleting a deleted child succeeded';
  exception when no_data_found then null;
  end;
end $$;
reset role;

do $$ begin
  if (select row(lessons, questions, words, skills, achievements, levels) from curriculum_before)
     is distinct from row((select count(*) from public.lessons), (select count(*) from public.questions),
       (select count(*) from public.words), (select count(*) from public.skills),
       (select count(*) from public.achievements), (select count(*) from public.levels)) then
    raise exception 'FAIL: shared curriculum changed';
  end if;
end $$;

select '012_child_lifecycle: all assertions passed';
rollback;
