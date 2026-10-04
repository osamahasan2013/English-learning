-- Phase 8 writing engine: writing skill types and glyphs follow publication, rubrics are
-- admin-only, glyph and rubric data checks, the writing review key and reason, the writing
-- analysis column is readable for the family's own children only, and only admins write
-- writing content. Rolled back at the end.
begin;

insert into auth.users (id, email, aud, role, instance_id) values
  ('a8100000-0000-4000-8000-000000000001', 'write-a@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('b8100000-0000-4000-8000-000000000002', 'write-b@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('c8100000-0000-4000-8000-000000000003', 'write-admin@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
update public.profiles set role = 'admin' where id = 'c8100000-0000-4000-8000-000000000003';

insert into public.levels (id, code, name, short_name, sort_order, min_age, max_age, difficulty, status)
values ('d8100000-0000-4000-8000-000000000001', 'WRITELVL', 'Writing level', 'WL', 910, 5, 6, 1, 'published');
insert into public.writing_skill_types (code, name, strand, min_level_rank, max_level_rank, status) values
  ('WRITE_TEST_SKILL', 'Test skill', 'handwriting', 1, 2, 'published'),
  ('WRITE_DRAFT_SKILL', 'Draft skill', 'composition', 4, 5, 'draft');
insert into public.handwriting_glyphs (id, code, kind, character, letter_case, script, name, strokes, status) values
  ('d8100000-0000-4000-8000-000000000010', 'test-glyph-z', 'letter', 'ž', 'lower', 'testscript', 'test z',
   '[{"points":[[10,10],[90,10],[10,90],[90,90]]}]', 'published'),
  ('d8100000-0000-4000-8000-000000000011', 'test-glyph-draft', 'shape', '◇', 'none', 'testscript', 'test diamond',
   '[{"points":[[50,10],[90,50],[50,90],[10,50],[50,10]]}]', 'draft');
insert into public.writing_rubrics (code, name, min_level_rank, max_level_rank, criteria) values
  ('test-rubric', 'Test rubric', 1, 5, '[{"id":"words","dimension":"words","min":3,"critical":true,"label":"Words"}]');

insert into public.children (id, parent_id, name, grade_level_id, current_level_id) values
  ('e8100000-0000-4000-8000-00000000000a', 'a8100000-0000-4000-8000-000000000001', 'Writer A', 'd8100000-0000-4000-8000-000000000001', 'd8100000-0000-4000-8000-000000000001'),
  ('e8100000-0000-4000-8000-00000000000b', 'b8100000-0000-4000-8000-000000000002', 'Writer B', 'd8100000-0000-4000-8000-000000000001', 'd8100000-0000-4000-8000-000000000001');

-- A writing answer for each child (on any existing question), with the server's analysis.
insert into public.activity_attempts (id, child_id, question_id, question_type, skill_id, attempt_number, response, is_correct, score, response_time_ms, attempted_at, writing_analysis)
select gen_random_uuid(), c.id, q.id, q.question_type, q.skill_id, 1, '{"value":"I see a cat."}'::jsonb, true, 1, 1000, now(),
       '{"v":1,"kind":"rubric","criteria":[],"words":4,"sentences":1}'::jsonb
from (select id from public.children where id in ('e8100000-0000-4000-8000-00000000000a', 'e8100000-0000-4000-8000-00000000000b')) c
cross join (select id, question_type, skill_id from public.questions limit 1) q;

-- ------------------------------------------------------------ data checks (as owner)
do $$ begin
  begin
    insert into public.handwriting_glyphs (code, kind, character, name, strokes) values ('bad-kind', 'emoji', 'x', 'x', '[{"points":[[0,0],[1,1]]}]');
    raise exception 'glyph kinds are letter, digit or shape';
  exception when check_violation then null;
  end;
  begin
    insert into public.handwriting_glyphs (code, kind, character, name, strokes) values ('no-strokes', 'shape', 'x', 'x', '[]');
    raise exception 'a glyph needs 1-8 strokes';
  exception when check_violation then null;
  end;
  begin
    insert into public.handwriting_glyphs (code, kind, character, name, strokes) values ('obj-strokes', 'shape', 'y', 'y', '{"points":[]}');
    raise exception 'strokes are an array';
  exception when check_violation then null;
  end;
  begin
    update public.handwriting_glyphs set tolerance = 50 where code = 'test-glyph-z';
    raise exception 'tolerance is 2-40 box units';
  exception when check_violation then null;
  end;
  begin
    update public.handwriting_glyphs set completion = 0.1 where code = 'test-glyph-z';
    raise exception 'completion is 0.3-0.98';
  exception when check_violation then null;
  end;
  begin
    insert into public.handwriting_glyphs (code, kind, character, letter_case, script, name, strokes)
    values ('test-glyph-z2', 'letter', 'ž', 'lower', 'testscript', 'again', '[{"points":[[0,0],[9,9]]}]');
    raise exception 'one glyph per character, case and script';
  exception when unique_violation then null;
  end;
  begin
    insert into public.writing_skill_types (code, name, strand, min_level_rank, max_level_rank) values ('BAD_RANGE', 'x', 'word', 4, 2);
    raise exception 'a writing skill''s first level comes before its last';
  exception when check_violation then null;
  end;
  begin
    insert into public.writing_skill_types (code, name, strand, min_level_rank, max_level_rank) values ('BAD_STRAND', 'x', 'poetry', 1, 2);
    raise exception 'strands are fixed';
  exception when check_violation then null;
  end;
  begin
    insert into public.writing_rubrics (code, name, min_level_rank, max_level_rank, criteria) values ('empty-rubric', 'x', 1, 2, '[]');
    raise exception 'a rubric has 1-12 criteria';
  exception when check_violation then null;
  end;
  begin
    update public.skills set writing_skill_code = 'NO_SUCH_SKILL' where id = (select id from public.skills limit 1);
    raise exception 'a skill can only be tagged with a known writing skill';
  exception when foreign_key_violation then null;
  end;
  begin
    update public.activity_attempts set writing_analysis = '[1,2]' where child_id = 'e8100000-0000-4000-8000-00000000000a';
    raise exception 'the writing analysis is an object';
  exception when check_violation then null;
  end;
  -- The review queue takes writing items (a glyph); content flags take glyphs and rubrics.
  insert into public.review_items (child_id, item_key, glyph_id, due_at, reason)
  values ('e8100000-0000-4000-8000-00000000000a', 'writing:d8100000-0000-4000-8000-000000000010',
          'd8100000-0000-4000-8000-000000000010', now(), 'writing_letter');
  begin
    insert into public.review_items (child_id, item_key, due_at, reason)
    values ('e8100000-0000-4000-8000-00000000000a', 'writing:d8100000-0000-4000-8000-000000000011', now(), 'writing_letter');
    raise exception 'a review item names what it reviews';
  exception when check_violation then null;
  end;
  begin
    insert into public.review_items (child_id, item_key, glyph_id, due_at, reason)
    values ('e8100000-0000-4000-8000-00000000000a', 'handwriting:d8100000-0000-4000-8000-000000000011',
            'd8100000-0000-4000-8000-000000000011', now(), 'writing_letter');
    raise exception 'review keys are fixed';
  exception when check_violation then null;
  end;
  insert into public.content_flags (entity, entity_key, rule, severity, message) values
    ('glyph', 'test-glyph-z', 'glyph_check', 'warning', 'test'),
    ('writing_rubric', 'test-rubric', 'rubric_check', 'warning', 'test');
end $$;

create function pg_temp.act_as(user_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', user_id::text, true);
end $$;
grant execute on function pg_temp.act_as(uuid) to authenticated;

-- ---------------------------------------------------------------- parent A
do $$ begin perform pg_temp.act_as('a8100000-0000-4000-8000-000000000001'); end $$;
do $$ begin
  assert exists (select 1 from public.writing_skill_types where code = 'WRITE_TEST_SKILL'), 'published writing skills readable';
  assert not exists (select 1 from public.writing_skill_types where code = 'WRITE_DRAFT_SKILL'), 'draft writing skills hidden';
  assert exists (select 1 from public.handwriting_glyphs where code = 'test-glyph-z'), 'published glyphs readable (the tracing guide)';
  assert not exists (select 1 from public.handwriting_glyphs where code = 'test-glyph-draft'), 'draft glyphs hidden';
  assert not exists (select 1 from public.writing_rubrics), 'rubrics are evaluation configuration: admins only';
  -- Own child's writing only.
  assert (select count(*) from public.activity_attempts where writing_analysis is not null
          and child_id in ('e8100000-0000-4000-8000-00000000000a', 'e8100000-0000-4000-8000-00000000000b')) = 1,
    'a parent sees only their own child''s writing';
  assert exists (select 1 from public.review_items where item_key like 'writing:%'), 'their child''s letter reviews';
  begin
    perform glyph_id from public.questions limit 1;
  exception when insufficient_privilege then raise exception 'questions.glyph_id must be readable';
  end;
  begin
    perform correct_answer from public.activity_attempts limit 1;
    raise exception 'stored answers (rubrics) must not be readable';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.handwriting_glyphs (code, kind, character, name, strokes) values ('parent-glyph', 'shape', 'q', 'q', '[{"points":[[0,0],[9,9]]}]');
    raise exception 'parents must not add glyphs';
  exception when insufficient_privilege then null;
  end;
  update public.handwriting_glyphs set tolerance = 40 where code = 'test-glyph-z';
  -- (RLS: the update matches no row for a parent.)
  begin
    update public.activity_attempts set writing_analysis = '{"v":1}' where child_id = 'e8100000-0000-4000-8000-00000000000a';
    raise exception 'parents cannot change the writing analysis';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$ begin
  assert (select tolerance from public.handwriting_glyphs where code = 'test-glyph-z') = 12, 'parents cannot change glyphs';
end $$;

-- ---------------------------------------------------------------- parent B
do $$ begin perform pg_temp.act_as('b8100000-0000-4000-8000-000000000002'); end $$;
do $$ begin
  assert not exists (select 1 from public.review_items where child_id = 'e8100000-0000-4000-8000-00000000000a'),
    'another family''s letter reviews are invisible';
  assert not exists (select 1 from public.activity_attempts where child_id = 'e8100000-0000-4000-8000-00000000000a'),
    'another family''s writing is invisible';
end $$;
reset role;

-- ---------------------------------------------------------------- admin
do $$ begin perform pg_temp.act_as('c8100000-0000-4000-8000-000000000003'); end $$;
do $$ begin
  assert exists (select 1 from public.handwriting_glyphs where code = 'test-glyph-draft'), 'admins see draft glyphs';
  assert exists (select 1 from public.writing_rubrics where code = 'test-rubric'), 'admins read rubrics';
  assert exists (select 1 from public.writing_skill_types where code = 'WRITE_DRAFT_SKILL'), 'admins see draft writing skills';
  update public.handwriting_glyphs set status = 'published', tolerance = 9 where code = 'test-glyph-draft';
end $$;
reset role;
do $$ begin
  assert (select tolerance from public.handwriting_glyphs where code = 'test-glyph-draft') = 9, 'admins manage glyphs';
end $$;

rollback;
\echo '010_writing_engine: all assertions passed'
