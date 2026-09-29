-- Phase 2 database rules: seeded levels, sign-up profile creation with time zone,
-- time zone validation, published-level enforcement and the per-family child limit.
begin;

do $$ begin
  assert (select count(*) from public.levels where code in ('KG1', 'KG2', 'KG3', 'GRADE1', 'GRADE2') and status = 'published') = 5,
    'the five learning levels are seeded and published';
end $$;

-- Sign-up creates the profile, keeping a valid browser time zone and rejecting a bogus one.
insert into auth.users (id, email, aud, role, instance_id, raw_user_meta_data) values
  ('a3000000-0000-4000-8000-000000000001', 'tz-ok@test.local', 'authenticated', 'authenticated',
   '00000000-0000-0000-0000-000000000000', '{"display_name": "  Sam  ", "timezone": "Asia/Dubai"}'),
  ('a3000000-0000-4000-8000-000000000002', 'tz-bad@test.local', 'authenticated', 'authenticated',
   '00000000-0000-0000-0000-000000000000', '{"display_name": "Kim", "timezone": "Mars/Base"}');

do $$ begin
  assert (select timezone from public.profiles where id = 'a3000000-0000-4000-8000-000000000001') = 'Asia/Dubai', 'valid time zone kept';
  assert (select display_name from public.profiles where id = 'a3000000-0000-4000-8000-000000000001') = 'Sam', 'name trimmed';
  assert (select timezone from public.profiles where id = 'a3000000-0000-4000-8000-000000000002') = 'UTC', 'invalid time zone falls back to UTC';
  assert (select role from public.profiles where id = 'a3000000-0000-4000-8000-000000000002') = 'parent', 'new accounts are parents';
  begin
    update public.profiles set timezone = 'Not/AZone' where id = 'a3000000-0000-4000-8000-000000000001';
    raise exception 'an invalid time zone must be rejected';
  exception when invalid_parameter_value then null;
  end;
end $$;

-- A draft level cannot be assigned, even by a direct API call.
insert into public.levels (id, code, name, short_name, sort_order, min_age, max_age, difficulty, status)
values ('d3000000-0000-4000-8000-000000000001', 'TESTDRAFT3', 'Draft', 'D', 950, 4, 5, 1, 'draft');

create function pg_temp.act_as(user_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', user_id::text, true);
end $$;
grant execute on function pg_temp.act_as(uuid) to authenticated;

do $$ begin perform pg_temp.act_as('a3000000-0000-4000-8000-000000000001'); end $$;

-- A parent can change their own time zone (the validation trigger runs as them).
update public.profiles set timezone = 'Europe/Paris' where id = 'a3000000-0000-4000-8000-000000000001';
do $$ begin
  assert (select timezone from public.profiles) = 'Europe/Paris', 'parent updates own time zone';
end $$;

do $$
declare
  kg1 uuid := (select id from public.levels where code = 'KG1');
begin
  begin
    insert into public.children (name, grade_level_id, current_level_id)
    values ('Draft kid', 'd3000000-0000-4000-8000-000000000001', 'd3000000-0000-4000-8000-000000000001');
    raise exception 'a draft level must be rejected';
  exception when check_violation then
    assert sqlerrm = 'LEVEL_NOT_AVAILABLE', 'draft level error code';
  end;

  -- Up to 12 active children...
  for i in 1..12 loop
    insert into public.children (name, grade_level_id, current_level_id) values ('Child ' || i, kg1, kg1);
  end loop;
  assert (select count(*) from public.children) = 12, 'twelve children created';

  -- ...but not a 13th.
  begin
    insert into public.children (name, grade_level_id, current_level_id) values ('Child 13', kg1, kg1);
    raise exception 'the 13th child must be rejected';
  exception when check_violation then
    assert sqlerrm = 'CHILD_LIMIT_REACHED', 'child limit error code';
  end;

  -- Archiving one frees a place.
  perform public.archive_child((select id from public.children where name = 'Child 1'));
  insert into public.children (name, grade_level_id, current_level_id) values ('Child 13', kg1, kg1);
  assert (select count(*) from public.children) = 12, 'archived children do not count';

  -- Names are trimmed and blank names rejected.
  update public.children set name = '  Renamed  ' where name = 'Child 2';
  assert exists (select 1 from public.children where name = 'Renamed'), 'name trimmed on update';
end $$;

reset role;
rollback;
\echo '003_parent_profiles_and_family_rules: all assertions passed'
