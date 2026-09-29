-- RLS and privilege tests. Run with `npm run test:db` (see scripts/db/run-sql-tests.sh).
-- Everything happens inside a transaction that is rolled back, so it is safe to run
-- against a database that already has data. Plain DO-block assertions (no pgTAP needed).
begin;

-- Two families and one admin.
insert into auth.users (id, email, aud, role, instance_id) values
  ('a0000000-0000-4000-8000-000000000001', 'parent-a@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('b0000000-0000-4000-8000-000000000002', 'parent-b@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('c0000000-0000-4000-8000-000000000003', 'admin@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
update public.profiles set role = 'admin' where id = 'c0000000-0000-4000-8000-000000000003';

-- Content fixtures: one published and one draft level.
insert into public.levels (id, code, name, short_name, sort_order, min_age, max_age, difficulty, status) values
  ('d0000000-0000-4000-8000-000000000001', 'TESTPUB', 'Test published', 'TP', 901, 4, 5, 1, 'published'),
  ('d0000000-0000-4000-8000-000000000002', 'TESTDRAFT', 'Test draft', 'TD', 902, 4, 5, 1, 'draft');

-- Each family's child (created as superuser to set up the fixture).
insert into public.children (id, parent_id, name, grade_level_id, current_level_id) values
  ('e0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-000000000001', 'Child A', 'd0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001'),
  ('e0000000-0000-4000-8000-00000000000b', 'b0000000-0000-4000-8000-000000000002', 'Child B', 'd0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001');
insert into public.reward_events (child_id, source_type, source_id, points, stars) values
  ('e0000000-0000-4000-8000-00000000000a', 'lesson_run', gen_random_uuid(), 10, 1),
  ('e0000000-0000-4000-8000-00000000000b', 'lesson_run', gen_random_uuid(), 10, 1);

create function pg_temp.act_as(user_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', user_id::text, true);
end $$;
grant execute on function pg_temp.act_as(uuid) to authenticated;

-- ---------------------------------------------------------------- parent A
do $$ begin perform pg_temp.act_as('a0000000-0000-4000-8000-000000000001'); end $$;

do $$ begin
  assert (select count(*) from public.children) = 1, 'parent A must see exactly one child';
  assert (select name from public.children) = 'Child A', 'parent A must see only their own child';
  assert (select count(*) from public.reward_events) = 1, 'progress is isolated by child';
  assert (select count(*) from public.profiles) = 1, 'a parent sees only their own profile';
  assert not exists (select 1 from public.levels where code = 'TESTDRAFT'), 'draft content is hidden from parents';
  assert exists (select 1 from public.levels where code = 'TESTPUB'), 'published content is visible';
  assert public.is_my_child('e0000000-0000-4000-8000-00000000000a'), 'is_my_child true for own child';
  assert not public.is_my_child('e0000000-0000-4000-8000-00000000000b'), 'is_my_child false for another family';
end $$;

-- Updating another family's child silently affects nothing.
update public.children set name = 'Hacked' where id = 'e0000000-0000-4000-8000-00000000000b';

-- Creating a child for another parent is rejected.
do $$ begin
  begin
    insert into public.children (parent_id, name, grade_level_id, current_level_id)
    values ('b0000000-0000-4000-8000-000000000002', 'Sneaky', 'd0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001');
    raise exception 'inserting a child for another parent must fail';
  exception when insufficient_privilege then null; -- no column grant on parent_id
  end;
end $$;

-- Creating one's own child works (parent_id defaults to the caller).
insert into public.children (name, grade_level_id, current_level_id)
values ('Second A', 'd0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001');

do $$ begin
  -- Parents cannot write progress directly (only the server can).
  begin
    insert into public.reward_events (child_id, source_type, source_id, points, stars)
    values ('e0000000-0000-4000-8000-00000000000a', 'lesson_run', gen_random_uuid(), 1000, 3);
    raise exception 'parents must not write reward_events';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.skill_mastery set status = 'MASTERED';
    raise exception 'parents must not write skill_mastery';
  exception when insufficient_privilege then null;
  end;
  -- Parents cannot promote themselves to admin.
  begin
    update public.profiles set role = 'admin';
    raise exception 'role must not be updatable by users';
  exception when insufficient_privilege then null;
  end;
  -- Parents cannot edit content.
  begin
    update public.levels set name = 'Edited' where code = 'TESTPUB';
    if found then raise exception 'parents must not edit content'; end if;
  end;
end $$;

-- Archiving another family's child fails; archiving one's own works and hides it.
do $$ begin
  begin
    perform public.archive_child('e0000000-0000-4000-8000-00000000000b');
    raise exception 'archiving another family''s child must fail';
  exception when no_data_found then null;
  end;
  perform public.archive_child('e0000000-0000-4000-8000-00000000000a');
  assert not exists (select 1 from public.children where id = 'e0000000-0000-4000-8000-00000000000a'), 'archived child is hidden';
  assert (select count(*) from public.reward_events) = 0, 'an archived child''s progress is hidden';
end $$;

-- ---------------------------------------------------------------- admin
do $$ begin perform pg_temp.act_as('c0000000-0000-4000-8000-000000000003'); end $$;
do $$ begin
  assert exists (select 1 from public.levels where code = 'TESTDRAFT'), 'admins see drafts';
  assert (select count(*) from public.children) = 0, 'admins get no access to family data';
  assert (select count(*) from public.reward_events) = 0, 'admins get no access to progress';
end $$;
update public.levels set name = 'Edited by admin' where code = 'TESTDRAFT';
do $$ begin
  assert (select name from public.levels where code = 'TESTDRAFT') = 'Edited by admin', 'admins can edit content';
end $$;

-- ---------------------------------------------------------------- anonymous
reset role;
set local role anon;
do $$ begin
  begin
    perform 1 from public.levels;
    raise exception 'anonymous visitors must not read content';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.children;
    raise exception 'anonymous visitors must not read children';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ---------------------------------------------------------------- superuser checks
reset role;
do $$ begin
  assert (select name from public.children where id = 'e0000000-0000-4000-8000-00000000000b') = 'Child B', 'cross-family update had no effect';
end $$;

rollback;
\echo '001_rls_family_isolation: all assertions passed'
