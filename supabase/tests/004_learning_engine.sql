-- Phase 3 learning engine: hidden answers, publish guards, the flattened catalog and the
-- new progress tables' RLS. Rolled back at the end, like every file here.
begin;

insert into auth.users (id, email, aud, role, instance_id) values
  ('a4000000-0000-4000-8000-000000000001', 'engine-a@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('b4000000-0000-4000-8000-000000000002', 'engine-b@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('c4000000-0000-4000-8000-000000000003', 'engine-admin@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
update public.profiles set role = 'admin' where id = 'c4000000-0000-4000-8000-000000000003';

-- A tiny published hierarchy plus a draft lesson.
insert into public.levels (id, code, name, short_name, sort_order, min_age, max_age, difficulty, status)
values ('d4000000-0000-4000-8000-000000000001', 'ENGLVL', 'Engine level', 'EL', 904, 4, 5, 1, 'published');
insert into public.subjects (id, code, name, status) values ('d4000000-0000-4000-8000-000000000002', 'ENGSUBJ', 'Engine subject', 'published');
insert into public.units (id, code, level_id, subject_id, title, status)
values ('d4000000-0000-4000-8000-000000000003', 'eng-unit', 'd4000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000002', 'U', 'published');
insert into public.skills (id, code, unit_id, dimension_code, title, status)
select 'd4000000-0000-4000-8000-000000000004', 'eng-skill', 'd4000000-0000-4000-8000-000000000003', code, 'S', 'published'
from public.skill_dimensions limit 1;
insert into public.lessons (id, code, skill_id, title, status) values
  ('d4000000-0000-4000-8000-000000000005', 'eng-lesson', 'd4000000-0000-4000-8000-000000000004', 'Published lesson', 'published'),
  ('d4000000-0000-4000-8000-000000000006', 'eng-draft', 'd4000000-0000-4000-8000-000000000004', 'Draft lesson', 'draft');
insert into public.activity_types (code, name, is_scored) values ('ENG_SCORED', 'Scored', true), ('ENG_INTRO', 'Intro', false)
on conflict (code) do nothing;
insert into public.activities (id, code, lesson_id, activity_type, stage, title, status)
values ('d4000000-0000-4000-8000-000000000007', 'eng-activity', 'd4000000-0000-4000-8000-000000000005', 'ENG_SCORED', 'guided_practice', 'A', 'published');
insert into public.questions (id, code, activity_id, skill_id, question_type, content, answer, status)
values ('d4000000-0000-4000-8000-000000000008', 'eng-question', 'd4000000-0000-4000-8000-000000000007', 'd4000000-0000-4000-8000-000000000004',
        'ENG_SCORED', '{"options":[]}', '{"accepted":["secret-answer"]}', 'published');

insert into public.feedback_messages (code, kind, text, status) values
  ('eng-fb-pub', 'CORRECT', 'Yes!', 'published'),
  ('eng-fb-draft', 'CORRECT', 'Draft!', 'draft');
insert into public.learning_rules (code, config) values ('player', '{"maxTries": 2}')
on conflict (code) do nothing;
insert into public.children (id, parent_id, name, grade_level_id, current_level_id) values
  ('e4000000-0000-4000-8000-00000000000a', 'a4000000-0000-4000-8000-000000000001', 'Engine A', 'd4000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000001'),
  ('e4000000-0000-4000-8000-00000000000b', 'b4000000-0000-4000-8000-000000000002', 'Engine B', 'd4000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000001');
insert into public.learning_sessions (id, child_id, started_at, ended_at, duration_seconds) values
  ('f4000000-0000-4000-8000-00000000000a', 'e4000000-0000-4000-8000-00000000000a', now(), now(), 60),
  ('f4000000-0000-4000-8000-00000000000b', 'e4000000-0000-4000-8000-00000000000b', now(), now(), 60);
insert into public.activity_progress (child_id, activity_id, lesson_id, status) values
  ('e4000000-0000-4000-8000-00000000000a', 'd4000000-0000-4000-8000-000000000007', 'd4000000-0000-4000-8000-000000000005', 'COMPLETED'),
  ('e4000000-0000-4000-8000-00000000000b', 'd4000000-0000-4000-8000-000000000007', 'd4000000-0000-4000-8000-000000000005', 'IN_PROGRESS');
insert into public.subject_progress (child_id, level_id, subject_id) values
  ('e4000000-0000-4000-8000-00000000000a', 'd4000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000002'),
  ('e4000000-0000-4000-8000-00000000000b', 'd4000000-0000-4000-8000-000000000001', 'd4000000-0000-4000-8000-000000000002');
insert into public.level_progress (child_id, level_id) values
  ('e4000000-0000-4000-8000-00000000000a', 'd4000000-0000-4000-8000-000000000001'),
  ('e4000000-0000-4000-8000-00000000000b', 'd4000000-0000-4000-8000-000000000001');
insert into public.review_items (child_id, item_key, skill_id, due_at, reason) values
  ('e4000000-0000-4000-8000-00000000000a', 'skill:d4000000-0000-4000-8000-000000000004', 'd4000000-0000-4000-8000-000000000004', now(), 'weak_skill'),
  ('e4000000-0000-4000-8000-00000000000b', 'skill:d4000000-0000-4000-8000-000000000004', 'd4000000-0000-4000-8000-000000000004', now(), 'weak_skill');

-- ------------------------------------------------------------ constraints (as owner)
do $$ begin
  -- A scored question cannot be published without an answer.
  begin
    insert into public.questions (code, activity_id, skill_id, question_type, status)
    values ('eng-no-answer', 'd4000000-0000-4000-8000-000000000007', 'd4000000-0000-4000-8000-000000000004', 'ENG_SCORED', 'published');
    raise exception 'publishing a scored question without an answer must fail';
  exception when check_violation then null;
  end;
  -- ...but a draft may be saved unfinished, and unscored questions need no answer.
  insert into public.questions (code, activity_id, skill_id, question_type, status)
  values ('eng-draft-q', 'd4000000-0000-4000-8000-000000000007', 'd4000000-0000-4000-8000-000000000004', 'ENG_SCORED', 'draft');
  insert into public.questions (code, activity_id, skill_id, question_type, status)
  values ('eng-intro-q', 'd4000000-0000-4000-8000-000000000007', 'd4000000-0000-4000-8000-000000000004', 'ENG_INTRO', 'published');
  begin
    update public.questions set status = 'published' where code = 'eng-draft-q';
    raise exception 'publishing an unanswered draft must fail';
  exception when check_violation then null;
  end;

  -- Activity configuration: maxTries must be 1, 2 or 3.
  begin
    update public.activities set config = '{"maxTries": 9}' where code = 'eng-activity';
    raise exception 'maxTries 9 must be rejected';
  exception when check_violation then null;
  end;
  begin
    update public.activities set config = '{"maxTries": "two"}' where code = 'eng-activity';
    raise exception 'a non-number maxTries must be rejected';
  exception when check_violation then null;
  end;
  update public.activities set config = '{"maxTries": 3}' where code = 'eng-activity';

  -- Review items name what to review; sessions cannot end before they start.
  begin
    insert into public.review_items (child_id, item_key, due_at, reason)
    values ('e4000000-0000-4000-8000-00000000000a', 'skill:d4000000-0000-4000-8000-000000000009', now(), 'weak_skill');
    raise exception 'a review item must reference something';
  exception when check_violation then null;
  end;
  begin
    insert into public.learning_sessions (id, child_id, started_at, ended_at, duration_seconds)
    values (gen_random_uuid(), 'e4000000-0000-4000-8000-00000000000a', now(), now() - interval '1 minute', 0);
    raise exception 'a session cannot end before it starts';
  exception when check_violation then null;
  end;
  begin
    insert into public.lesson_prerequisites (lesson_id, prerequisite_lesson_id)
    values ('d4000000-0000-4000-8000-000000000005', 'd4000000-0000-4000-8000-000000000005');
    raise exception 'a lesson cannot require itself';
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

-- ---------------------------------------------------------------- parent A
do $$ begin perform pg_temp.act_as('a4000000-0000-4000-8000-000000000001'); end $$;
do $$ begin
  -- Content without its answer is readable...
  assert (select content ->> 'options' from public.questions where code = 'eng-question') = '[]',
    'question content is readable';
  -- ...the answer is not.
  begin
    perform answer from public.questions where code = 'eng-question';
    raise exception 'questions.answer must not be readable by signed-in users';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.questions limit 1;
    raise exception 'select * must not expose questions.answer';
  exception when insufficient_privilege then null;
  end;

  -- The flattened catalog follows RLS: published only.
  assert exists (select 1 from public.lesson_catalog where lesson_code = 'eng-lesson'), 'published lesson in catalog';
  assert not exists (select 1 from public.lesson_catalog where lesson_code = 'eng-draft'), 'draft lesson hidden from catalog';
  assert (select subject_code from public.lesson_catalog where lesson_code = 'eng-lesson') = 'ENGSUBJ',
    'catalog carries level/subject/unit/skill';

  -- New progress tables: only the family's own child.
  assert (select count(*) from public.learning_sessions where id::text like 'f4000000%') = 1, 'sessions isolated';
  assert (select count(*) from public.activity_progress where activity_id = 'd4000000-0000-4000-8000-000000000007') = 1,
    'activity progress isolated';
  assert (select status from public.activity_progress where activity_id = 'd4000000-0000-4000-8000-000000000007') = 'COMPLETED',
    'parent A sees their own child''s row';
  assert (select count(*) from public.subject_progress where subject_id = 'd4000000-0000-4000-8000-000000000002') = 1,
    'subject progress isolated';
  assert (select count(*) from public.level_progress where level_id = 'd4000000-0000-4000-8000-000000000001') = 1,
    'level progress isolated';
  assert (select count(*) from public.review_items where skill_id = 'd4000000-0000-4000-8000-000000000004') = 1,
    'review queue isolated';
  assert exists (select 1 from public.feedback_messages where code = 'eng-fb-pub'), 'published feedback readable';
  assert not exists (select 1 from public.feedback_messages where code = 'eng-fb-draft'), 'draft feedback hidden';
  assert exists (select 1 from public.learning_rules where code = 'player'), 'engine rules readable';

  -- Progress is written by the server only.
  begin
    insert into public.activity_progress (child_id, activity_id, lesson_id)
    values ('e4000000-0000-4000-8000-00000000000a', 'd4000000-0000-4000-8000-000000000007', 'd4000000-0000-4000-8000-000000000005');
    raise exception 'parents must not write activity progress';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.learning_sessions set duration_seconds = 9999 where id = 'f4000000-0000-4000-8000-00000000000a';
    raise exception 'parents must not edit learning sessions';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.review_items (child_id, item_key, skill_id, due_at, reason)
    values ('e4000000-0000-4000-8000-00000000000a', 'skill:d4000000-0000-4000-8000-000000000004', 'd4000000-0000-4000-8000-000000000004', now(), 'weak_skill');
    raise exception 'parents must not write the review queue';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.learning_rules (code, config) values ('mastery', '{}');
    raise exception 'parents must not change engine rules';
  exception when insufficient_privilege or check_violation then null;
  end;
end $$;
reset role;

-- ---------------------------------------------------------------- admin
do $$ begin perform pg_temp.act_as('c4000000-0000-4000-8000-000000000003'); end $$;
do $$ begin
  -- Admins see drafts in the base tables but have no special access to families...
  assert exists (select 1 from public.lessons where code = 'eng-draft'), 'admins see draft lessons';
  assert (select count(*) from public.learning_sessions where id::text like 'f4000000%') = 0, 'admins do not see family sessions';
  -- ...and even they read answers only through the service role (content tooling).
  begin
    perform answer from public.questions where code = 'eng-question';
    raise exception 'answers are service-role only';
  exception when insufficient_privilege then null;
  end;
  -- Admins may tune the engine rules.
  insert into public.learning_rules (code, config) values ('review', '{"minAttempts": 5}')
  on conflict (code) do update set config = excluded.config;
end $$;
reset role;

-- ---------------------------------------------------------------- anonymous
set local role anon;
do $$ begin
  begin
    perform 1 from public.lesson_catalog limit 1;
    raise exception 'anonymous visitors must not read the catalog';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

rollback;
\echo '004_learning_engine: all assertions passed'
