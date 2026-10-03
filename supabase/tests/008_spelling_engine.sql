-- Phase 6 spelling engine: spelling types and spelling targets follow publication (a target
-- of a draft word stays hidden), only admins write them, spelling progress and the spelling
-- analytics views are isolated per family, the new attempt columns are readable by the
-- owning parent while the answer snapshot stays hidden, spelling and pattern review keys,
-- and the data checks. Rolled back at the end.
begin;

insert into auth.users (id, email, aud, role, instance_id) values
  ('a8000000-0000-4000-8000-000000000001', 'spell-a@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('b8000000-0000-4000-8000-000000000002', 'spell-b@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('c8000000-0000-4000-8000-000000000003', 'spell-admin@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
update public.profiles set role = 'admin' where id = 'c8000000-0000-4000-8000-000000000003';

insert into public.levels (id, code, name, short_name, sort_order, min_age, max_age, difficulty, status)
values ('d8000000-0000-4000-8000-000000000001', 'SPELLVL', 'Spelling level', 'SL', 908, 5, 6, 1, 'published');
insert into public.subjects (id, code, name, status) values ('d8000000-0000-4000-8000-000000000002', 'SPELLSUBJ', 'Spelling subject', 'published');
insert into public.units (id, code, level_id, subject_id, title, status)
values ('d8000000-0000-4000-8000-000000000003', 'spell-unit', 'd8000000-0000-4000-8000-000000000001', 'd8000000-0000-4000-8000-000000000002', 'U', 'published');
insert into public.skills (id, code, unit_id, dimension_code, title, status)
select 'd8000000-0000-4000-8000-000000000004', 'spell-skill', 'd8000000-0000-4000-8000-000000000003', code, 'S', 'published'
from public.skill_dimensions limit 1;
insert into public.activity_types (code, name, is_scored) values ('SPELL_TEST', 'Spelling test type', true)
on conflict (code) do nothing;
insert into public.questions (id, code, skill_id, question_type, content, answer, status)
values ('d8000000-0000-4000-8000-000000000005', 'spell-question', 'd8000000-0000-4000-8000-000000000004', 'SPELL_TEST',
        '{}', '{"accepted":["zag"]}', 'draft');
insert into public.words (id, word, normalized_word, level_id, difficulty, status) values
  ('d8000000-0000-4000-8000-000000000010', 'zag', 'zag', 'd8000000-0000-4000-8000-000000000001', 1, 'published'),
  ('d8000000-0000-4000-8000-000000000011', 'zeg', 'zeg', 'd8000000-0000-4000-8000-000000000001', 1, 'draft'),
  ('d8000000-0000-4000-8000-000000000012', 'zig', 'zig', 'd8000000-0000-4000-8000-000000000001', 1, 'published');
insert into public.spelling_types (code, name, status) values
  ('SPELL_TEST_TYPE', 'Test type', 'published'),
  ('SPELL_DRAFT_TYPE', 'Draft type', 'draft');
insert into public.spelling_words (id, word_id, level_id, spelling_type_code, difficulty, status) values
  ('d8000000-0000-4000-8000-000000000020', 'd8000000-0000-4000-8000-000000000010', 'd8000000-0000-4000-8000-000000000001', 'SPELL_TEST_TYPE', 1, 'published'),
  ('d8000000-0000-4000-8000-000000000021', 'd8000000-0000-4000-8000-000000000011', 'd8000000-0000-4000-8000-000000000001', 'SPELL_TEST_TYPE', 1, 'published'),
  ('d8000000-0000-4000-8000-000000000022', 'd8000000-0000-4000-8000-000000000012', 'd8000000-0000-4000-8000-000000000001', 'SPELL_TEST_TYPE', 1, 'draft');

insert into public.children (id, parent_id, name, grade_level_id, current_level_id) values
  ('e8000000-0000-4000-8000-00000000000a', 'a8000000-0000-4000-8000-000000000001', 'Speller A', 'd8000000-0000-4000-8000-000000000001', 'd8000000-0000-4000-8000-000000000001'),
  ('e8000000-0000-4000-8000-00000000000b', 'b8000000-0000-4000-8000-000000000002', 'Speller B', 'd8000000-0000-4000-8000-000000000001', 'd8000000-0000-4000-8000-000000000001');
insert into public.spelling_progress (child_id, word_id, attempts_count, correct_count, accuracy, status) values
  ('e8000000-0000-4000-8000-00000000000a', 'd8000000-0000-4000-8000-000000000010', 2, 1, 50, 'LEARNING'),
  ('e8000000-0000-4000-8000-00000000000b', 'd8000000-0000-4000-8000-000000000010', 1, 1, 100, 'LEARNING');
insert into public.activity_attempts (id, child_id, question_id, question_type, skill_id, word_id, response, correct_answer,
  is_correct, error_type, response_time_ms, attempted_at, hints_used, spelling_analysis, error_pattern_id)
select v.id, v.child_id, 'd8000000-0000-4000-8000-000000000005', 'SPELL_TEST', 'd8000000-0000-4000-8000-000000000004',
  'd8000000-0000-4000-8000-000000000010', '{"value":"zg"}', '{"accepted":["zag"]}', false, 'WRONG_VOWEL', 1000, now(), 1,
  '{"v":1,"kind":"word","normalized":"zg","category":"WRONG_VOWEL"}', (select id from public.phonics_patterns limit 1)
from (values
  ('f8000000-0000-4000-8000-000000000001'::uuid, 'e8000000-0000-4000-8000-00000000000a'::uuid),
  ('f8000000-0000-4000-8000-000000000002'::uuid, 'e8000000-0000-4000-8000-00000000000b'::uuid)
) as v(id, child_id);

-- ------------------------------------------------------------ data checks (as owner)
do $$ begin
  begin
    insert into public.spelling_words (word_id, level_id, spelling_type_code, difficulty)
    values ('d8000000-0000-4000-8000-000000000010', 'd8000000-0000-4000-8000-000000000001', 'SPELL_TEST_TYPE', 1);
    raise exception 'a word is a spelling target at most once';
  exception when unique_violation then null;
  end;
  begin
    update public.spelling_words set irregular_part = 'a' where id = 'd8000000-0000-4000-8000-000000000020';
    raise exception 'an irregular part needs is_irregular';
  exception when check_violation then null;
  end;
  begin
    insert into public.spelling_words (word_id, level_id, spelling_type_code, difficulty)
    values ('d8000000-0000-4000-8000-000000000012', 'd8000000-0000-4000-8000-000000000001', 'NO_SUCH_TYPE', 1);
    raise exception 'the spelling type must exist';
  exception when foreign_key_violation or unique_violation then null;
  end;
  begin
    update public.activity_attempts set hints_used = 9 where id = 'f8000000-0000-4000-8000-000000000001';
    raise exception 'hints_used is 0-5';
  exception when check_violation then null;
  end;
  begin
    update public.feedback_messages set error_category = 'wrong vowel' where code = (select code from public.feedback_messages limit 1);
    raise exception 'error categories are UPPER_SNAKE codes';
  exception when check_violation then null;
  end;

  -- The review queue takes spelling items and pattern items.
  insert into public.review_items (child_id, item_key, word_id, due_at, reason)
  values ('e8000000-0000-4000-8000-00000000000a', 'spelling:d8000000-0000-4000-8000-000000000010',
          'd8000000-0000-4000-8000-000000000010', now(), 'missed_spelling');
  insert into public.review_items (child_id, item_key, phonics_pattern_id, due_at, reason)
  select 'e8000000-0000-4000-8000-00000000000a', 'pattern:' || id, id, now(), 'spelling_pattern'
  from public.phonics_patterns limit 1;
  begin
    insert into public.review_items (child_id, item_key, word_id, due_at, reason)
    values ('e8000000-0000-4000-8000-00000000000a', 'spelling:not-a-uuid', 'd8000000-0000-4000-8000-000000000010', now(), 'missed_spelling');
    raise exception 'item keys name a uuid';
  exception when check_violation then null;
  end;
  begin
    insert into public.review_items (child_id, item_key, word_id, due_at, reason)
    values ('e8000000-0000-4000-8000-00000000000a', 'spelling:d8000000-0000-4000-8000-000000000012', 'd8000000-0000-4000-8000-000000000012', now(), 'misspelt');
    raise exception 'unknown review reasons are refused';
  exception when check_violation then null;
  end;
  -- Doubtful spelling targets can be flagged for review.
  insert into public.content_flags (entity, entity_key, rule, severity, message)
  values ('spelling_word', 'zag', 'spelling_progression', 'warning', 'test');
end $$;

create function pg_temp.act_as(user_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', user_id::text, true);
end $$;
grant execute on function pg_temp.act_as(uuid) to authenticated;

-- ---------------------------------------------------------------- parent A
do $$ begin perform pg_temp.act_as('a8000000-0000-4000-8000-000000000001'); end $$;
do $$ begin
  assert exists (select 1 from public.spelling_types where code = 'SPELL_TEST_TYPE'), 'published spelling types readable';
  assert not exists (select 1 from public.spelling_types where code = 'SPELL_DRAFT_TYPE'), 'draft spelling types hidden';
  assert (select count(*) from public.spelling_words where level_id = 'd8000000-0000-4000-8000-000000000001') = 1,
    'only published targets of published words are visible';
  begin
    insert into public.spelling_words (word_id, level_id, spelling_type_code, difficulty)
    values ('d8000000-0000-4000-8000-000000000012', 'd8000000-0000-4000-8000-000000000001', 'SPELL_TEST_TYPE', 1);
    raise exception 'parents must not write spelling targets';
  exception when insufficient_privilege then null;
  end;

  -- Spelling progress: own child only, read-only.
  assert (select count(*) from public.spelling_progress) = 1, 'a parent sees only their own child''s spelling progress';
  assert (select child_id from public.spelling_progress) = 'e8000000-0000-4000-8000-00000000000a', 'and it is theirs';
  begin
    insert into public.spelling_progress (child_id, word_id) values ('e8000000-0000-4000-8000-00000000000a', 'd8000000-0000-4000-8000-000000000012');
    raise exception 'spelling progress is written by the server only';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.spelling_progress set status = 'MASTERED' where child_id = 'e8000000-0000-4000-8000-00000000000a';
    raise exception 'parents cannot change spelling progress';
  exception when insufficient_privilege then null;
  end;

  -- Attempts: the spelling analysis and hints are readable, the answer snapshot is not.
  assert (select hints_used from public.activity_attempts where id = 'f8000000-0000-4000-8000-000000000001') = 1, 'hints readable';
  assert (select spelling_analysis ->> 'category' from public.activity_attempts where id = 'f8000000-0000-4000-8000-000000000001') = 'WRONG_VOWEL',
    'the spelling analysis is readable by the owning parent';
  assert not exists (select 1 from public.activity_attempts where id = 'f8000000-0000-4000-8000-000000000002'), 'other families'' attempts hidden';
  begin
    perform correct_answer from public.activity_attempts limit 1;
    raise exception 'the answer snapshot must stay hidden';
  exception when insufficient_privilege then null;
  end;

  -- Analytics views count only the caller's own children.
  assert (select count(*) from public.spelling_error_counts) = 1, 'error counts are per family';
  assert (select child_id from public.spelling_error_counts) = 'e8000000-0000-4000-8000-00000000000a', 'own child only';
  assert (select count(*) from public.spelling_pattern_errors) = 1, 'pattern errors are per family';
end $$;
reset role;

-- ---------------------------------------------------------------- admin
do $$ begin perform pg_temp.act_as('c8000000-0000-4000-8000-000000000003'); end $$;
do $$ begin
  assert (select count(*) from public.spelling_words where level_id = 'd8000000-0000-4000-8000-000000000001') = 3,
    'admins see draft targets';
  update public.spelling_words set status = 'published' where id = 'd8000000-0000-4000-8000-000000000022';
  assert (select status from public.spelling_words where id = 'd8000000-0000-4000-8000-000000000022') = 'published',
    'admins publish spelling targets';
  assert not exists (select 1 from public.spelling_progress), 'admins do not read family progress';
end $$;
reset role;

-- ---------------------------------------------------------------- anonymous
set local role anon;
do $$ begin
  begin
    perform 1 from public.spelling_words limit 1;
    raise exception 'anonymous visitors must not read spelling targets';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.spelling_error_counts limit 1;
    raise exception 'anonymous visitors must not read spelling analytics';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

rollback;
\echo '008_spelling_engine: all assertions passed'
