-- Phase 9 assessment engine: the new child-owned tables are readable by the owning parent
-- only and writable by the server only; sittings cannot be created or changed by a parent;
-- the new constraints hold; the admin exposure function is admin-only and returns counts,
-- never child ids. Rolled back at the end.
begin;

insert into auth.users (id, email, aud, role, instance_id) values
  ('a9000000-0000-4000-8000-000000000001', 'assess-a@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('b9000000-0000-4000-8000-000000000002', 'assess-b@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
insert into public.levels (id, code, name, short_name, sort_order, min_age, max_age, difficulty, status) values
  ('d9000000-0000-4000-8000-000000000001', 'T90L', 'Test level', 'TL', 951, 6, 7, 1, 'published');
insert into public.children (id, parent_id, name, grade_level_id, current_level_id) values
  ('e9000000-0000-4000-8000-00000000000a', 'a9000000-0000-4000-8000-000000000001', 'Ana', 'd9000000-0000-4000-8000-000000000001', 'd9000000-0000-4000-8000-000000000001'),
  ('e9000000-0000-4000-8000-00000000000c', 'b9000000-0000-4000-8000-000000000002', 'Cy', 'd9000000-0000-4000-8000-000000000001', 'd9000000-0000-4000-8000-000000000001');
insert into public.assessments (id, code, title, assessment_type, status, domains) values
  ('f9000000-0000-4000-8000-000000000001', 'test-p9-check', 'Test check', 'diagnostic', 'published', array['PHONICS']);
insert into public.assessment_attempts (id, child_id, assessment_id, purpose, started_at, status, origin) values
  ('c9000000-0000-4000-8000-00000000000a', 'e9000000-0000-4000-8000-00000000000a', 'f9000000-0000-4000-8000-000000000001', 'diagnostic', now(), 'completed', 'child');
insert into public.instructional_readiness (child_id, domain, current_level_id, confidence, source) values
  ('e9000000-0000-4000-8000-00000000000a', 'PHONICS', 'd9000000-0000-4000-8000-000000000001', 'LOW', 'assessment'),
  ('e9000000-0000-4000-8000-00000000000c', 'PHONICS', 'd9000000-0000-4000-8000-000000000001', 'LOW', 'assessment');

-- ------------------------------------------------------------ constraints (as owner)
do $$ begin
  begin
    insert into public.instructional_readiness (child_id, domain, current_level_id, confidence, source)
    values ('e9000000-0000-4000-8000-00000000000a', 'MATHS', 'd9000000-0000-4000-8000-000000000001', 'LOW', 'assessment');
    raise exception 'FAIL: an unknown domain was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.instructional_readiness (child_id, domain, current_level_id, confidence, source)
    values ('e9000000-0000-4000-8000-00000000000a', 'READING', 'd9000000-0000-4000-8000-000000000001', 'CERTAIN', 'assessment');
    raise exception 'FAIL: an unknown confidence was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.assessment_attempts set status = 'paused' where id = 'c9000000-0000-4000-8000-00000000000a';
    raise exception 'FAIL: an unknown sitting status was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.assessments (code, title, assessment_type) values ('test-p9-bad', 'Bad', 'quiz');
    raise exception 'FAIL: an unknown assessment type was accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.review_items (child_id, item_key, skill_id, priority, due_at, reason)
    select 'e9000000-0000-4000-8000-00000000000a', 'skill:' || s.id, s.id, 1, now(), 'made_up' from public.skills s limit 1;
    raise exception 'FAIL: an unknown review reason was accepted';
  exception when check_violation then null;
  end;
end $$;

create function pg_temp.act_as(user_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', user_id::text, true);
end $$;
grant execute on function pg_temp.act_as(uuid) to authenticated;

-- ------------------------------------------------------------ parent A
do $$ begin perform pg_temp.act_as('a9000000-0000-4000-8000-000000000001'); end $$;
do $$ begin
  if (select count(*) from public.instructional_readiness) <> 1 then
    raise exception 'FAIL: parent A does not see exactly their own child''s readiness';
  end if;
  if exists (select 1 from public.instructional_readiness where child_id = 'e9000000-0000-4000-8000-00000000000c') then
    raise exception 'FAIL: parent A sees another family''s readiness';
  end if;
  begin
    update public.instructional_readiness set confidence = 'HIGH' where child_id = 'e9000000-0000-4000-8000-00000000000a';
    raise exception 'FAIL: a parent could change readiness';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.assessment_evidence (assessment_attempt_id, child_id, skill_id, domain, items_total, items_correct, credit, weight, strength, observed_at)
    select 'c9000000-0000-4000-8000-00000000000a', 'e9000000-0000-4000-8000-00000000000a', s.id, 'PHONICS', 3, 3, 3, 3, 'secure', now() from public.skills s limit 1;
    raise exception 'FAIL: a parent could write evidence';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.assessment_attempts (id, child_id, assessment_id, started_at)
    values (gen_random_uuid(), 'e9000000-0000-4000-8000-00000000000a', 'f9000000-0000-4000-8000-000000000001', now());
    raise exception 'FAIL: a parent could start a sitting directly';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.assessment_attempts set item_ids = '{}' where id = 'c9000000-0000-4000-8000-00000000000a';
    raise exception 'FAIL: a parent could change a sitting''s items';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.assessment_item_exposure('f9000000-0000-4000-8000-000000000001');
    raise exception 'FAIL: a parent could read item exposure';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ------------------------------------------------------------ anonymous
set local role anon;
do $$ begin
  begin
    perform 1 from public.instructional_readiness;
    raise exception 'FAIL: anon could read readiness';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.assessment_evidence;
    raise exception 'FAIL: anon could read evidence';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ------------------------------------------------------------ admin
update public.profiles set role = 'admin' where id = 'b9000000-0000-4000-8000-000000000002';
do $$ begin perform pg_temp.act_as('b9000000-0000-4000-8000-000000000002'); end $$;
do $$ begin
  -- Counts only (the function's columns are question_id, answers, children).
  perform question_id, answers, children from public.assessment_item_exposure('f9000000-0000-4000-8000-000000000001');
  -- Admins still see no family data.
  if exists (select 1 from public.instructional_readiness where child_id = 'e9000000-0000-4000-8000-00000000000a') then
    raise exception 'FAIL: an admin sees another family''s readiness';
  end if;
end $$;
reset role;

select '013_assessment_engine: all assertions passed';
rollback;
