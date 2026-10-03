-- Phase 7 reading engine: reading skill and content types follow publication, stories carry
-- their reading metadata with a per-level unique title, story links (words, patterns, skills)
-- are visible only with a published story, only admins write texts, reading sessions are
-- isolated per family and written by the server only, the reading review key and reason,
-- and the data checks. Rolled back at the end.
begin;

insert into auth.users (id, email, aud, role, instance_id) values
  ('a9000000-0000-4000-8000-000000000001', 'read-a@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('b9000000-0000-4000-8000-000000000002', 'read-b@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('c9000000-0000-4000-8000-000000000003', 'read-admin@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
update public.profiles set role = 'admin' where id = 'c9000000-0000-4000-8000-000000000003';

insert into public.levels (id, code, name, short_name, sort_order, min_age, max_age, difficulty, status)
values ('d9000000-0000-4000-8000-000000000001', 'READLVL', 'Reading level', 'RL', 909, 5, 6, 1, 'published');
insert into public.reading_skill_types (code, name, min_level_rank, strand, status) values
  ('READ_TEST_SKILL', 'Test skill', 1, 'comprehension', 'published'),
  ('READ_DRAFT_SKILL', 'Draft skill', 1, 'comprehension', 'draft');
insert into public.reading_content_types (code, name, status) values ('READ_TEST_TYPE', 'Test type', 'published');
insert into public.words (id, word, normalized_word, level_id, difficulty, status) values
  ('d9000000-0000-4000-8000-000000000010', 'zop', 'zop', 'd9000000-0000-4000-8000-000000000001', 1, 'published'),
  ('d9000000-0000-4000-8000-000000000011', 'zup', 'zup', 'd9000000-0000-4000-8000-000000000001', 1, 'draft');
insert into public.stories (id, code, title, normalized_title, level_id, difficulty, pages, word_count, content_type_code, status) values
  ('d9000000-0000-4000-8000-000000000020', 'read-test-published', 'Zop', 'zop', 'd9000000-0000-4000-8000-000000000001', 1,
   '[{"text":"Zop zup."}]', 2, 'READ_TEST_TYPE', 'published'),
  ('d9000000-0000-4000-8000-000000000021', 'read-test-draft', 'Zup', 'zup', 'd9000000-0000-4000-8000-000000000001', 1,
   '[{"text":"Zup."}]', 1, 'READ_TEST_TYPE', 'draft');
insert into public.story_words (story_id, word_id, occurrences) values
  ('d9000000-0000-4000-8000-000000000020', 'd9000000-0000-4000-8000-000000000010', 1),
  ('d9000000-0000-4000-8000-000000000020', 'd9000000-0000-4000-8000-000000000011', 1),
  ('d9000000-0000-4000-8000-000000000021', 'd9000000-0000-4000-8000-000000000010', 1);
insert into public.story_reading_skills (story_id, reading_skill_code) values
  ('d9000000-0000-4000-8000-000000000020', 'READ_TEST_SKILL'),
  ('d9000000-0000-4000-8000-000000000021', 'READ_TEST_SKILL');

insert into public.children (id, parent_id, name, grade_level_id, current_level_id) values
  ('e9000000-0000-4000-8000-00000000000a', 'a9000000-0000-4000-8000-000000000001', 'Reader A', 'd9000000-0000-4000-8000-000000000001', 'd9000000-0000-4000-8000-000000000001'),
  ('e9000000-0000-4000-8000-00000000000b', 'b9000000-0000-4000-8000-000000000002', 'Reader B', 'd9000000-0000-4000-8000-000000000001', 'd9000000-0000-4000-8000-000000000001');
insert into public.reading_sessions (id, child_id, story_id, mode, started_at, duration_ms, word_count, help_word_ids) values
  ('f9000000-0000-4000-8000-000000000001', 'e9000000-0000-4000-8000-00000000000a', 'd9000000-0000-4000-8000-000000000020',
   'read_first', now(), 30000, 2, '{d9000000-0000-4000-8000-000000000010}'),
  ('f9000000-0000-4000-8000-000000000002', 'e9000000-0000-4000-8000-00000000000b', 'd9000000-0000-4000-8000-000000000020',
   'listen_first', now(), 30000, 2, '{}');

-- ------------------------------------------------------------ data checks (as owner)
do $$ begin
  begin
    insert into public.stories (code, title, normalized_title, level_id, difficulty, pages, word_count)
    values ('read-test-copy', 'ZOP', 'zop', 'd9000000-0000-4000-8000-000000000001', 1, '[{"text":"Zop."}]', 1);
    raise exception 'one text per title per level';
  exception when unique_violation then null;
  end;
  begin
    update public.stories set content_type_code = 'NO_SUCH_TYPE' where id = 'd9000000-0000-4000-8000-000000000020';
    raise exception 'the content type must exist';
  exception when foreign_key_violation then null;
  end;
  begin
    update public.stories set reading_level = 21 where id = 'd9000000-0000-4000-8000-000000000020';
    raise exception 'reading bands are 1-20';
  exception when check_violation then null;
  end;
  begin
    update public.stories set decodable_pct = 101 where id = 'd9000000-0000-4000-8000-000000000020';
    raise exception 'decodable_pct is a percentage';
  exception when check_violation then null;
  end;
  begin
    insert into public.reading_skill_types (code, name, min_level_rank, strand) values ('BAD_STRAND', 'x', 1, 'speed');
    raise exception 'strands are word, text or comprehension';
  exception when check_violation then null;
  end;
  begin
    update public.reading_sessions set mode = 'fast' where id = 'f9000000-0000-4000-8000-000000000001';
    raise exception 'reading modes are fixed';
  exception when check_violation then null;
  end;
  begin
    update public.reading_sessions set duration_ms = 4000000 where id = 'f9000000-0000-4000-8000-000000000001';
    raise exception 'a reading lasts at most an hour';
  exception when check_violation then null;
  end;
  begin
    update public.reading_sessions set self_check = 'great' where id = 'f9000000-0000-4000-8000-000000000001';
    raise exception 'self-checks are easy, ok or hard';
  exception when check_violation then null;
  end;
  begin
    update public.skills set reading_skill_code = 'NO_SUCH_SKILL' where id = (select id from public.skills limit 1);
    raise exception 'a skill can only be tagged with a known reading skill';
  exception when foreign_key_violation then null;
  end;
  -- The review queue takes reading items; content flags take stories.
  insert into public.review_items (child_id, item_key, word_id, due_at, reason)
  values ('e9000000-0000-4000-8000-00000000000a', 'reading:d9000000-0000-4000-8000-000000000010',
          'd9000000-0000-4000-8000-000000000010', now(), 'reading_word');
  begin
    insert into public.review_items (child_id, item_key, word_id, due_at, reason)
    values ('e9000000-0000-4000-8000-00000000000a', 'reading:d9000000-0000-4000-8000-000000000011',
            'd9000000-0000-4000-8000-000000000011', now(), 'read_badly');
    raise exception 'unknown review reasons are refused';
  exception when check_violation then null;
  end;
  insert into public.content_flags (entity, entity_key, rule, severity, message)
  values ('story', 'read-test-published', 'unknown_words', 'warning', 'test');
end $$;

create function pg_temp.act_as(user_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', user_id::text, true);
end $$;
grant execute on function pg_temp.act_as(uuid) to authenticated;

-- ---------------------------------------------------------------- parent A
do $$ begin perform pg_temp.act_as('a9000000-0000-4000-8000-000000000001'); end $$;
do $$ begin
  assert exists (select 1 from public.reading_skill_types where code = 'READ_TEST_SKILL'), 'published reading skills readable';
  assert not exists (select 1 from public.reading_skill_types where code = 'READ_DRAFT_SKILL'), 'draft reading skills hidden';
  assert exists (select 1 from public.reading_content_types where code = 'READ_TEST_TYPE'), 'content types readable';
  assert exists (select 1 from public.stories where code = 'read-test-published'), 'published texts readable';
  assert not exists (select 1 from public.stories where code = 'read-test-draft'), 'draft texts hidden';
  -- Links: only of published texts, and only to published words.
  assert (select count(*) from public.story_words where story_id = 'd9000000-0000-4000-8000-000000000020') = 1,
    'a published text''s links to published words only';
  assert not exists (select 1 from public.story_words where story_id = 'd9000000-0000-4000-8000-000000000021'),
    'a draft text''s word links are hidden';
  assert not exists (select 1 from public.story_reading_skills where story_id = 'd9000000-0000-4000-8000-000000000021'),
    'a draft text''s skills are hidden';
  begin
    insert into public.story_words (story_id, word_id) values ('d9000000-0000-4000-8000-000000000021', 'd9000000-0000-4000-8000-000000000011');
    raise exception 'parents must not write story links';
  exception when insufficient_privilege then null;
  end;
  update public.stories set title = 'Hacked' where id = 'd9000000-0000-4000-8000-000000000020';
  -- (RLS: the update matches no row for a parent.)

  -- Reading history: own child only, read-only.
  assert (select count(*) from public.reading_sessions) = 1, 'a parent sees only their own child''s reading';
  assert (select child_id from public.reading_sessions) = 'e9000000-0000-4000-8000-00000000000a', 'and it is theirs';
  begin
    insert into public.reading_sessions (id, child_id, story_id, mode, started_at, duration_ms, word_count)
    values (gen_random_uuid(), 'e9000000-0000-4000-8000-00000000000a', 'd9000000-0000-4000-8000-000000000020', 'read_first', now(), 1, 1);
    raise exception 'reading history is written by the server only';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.reading_sessions set rereads = 5 where id = 'f9000000-0000-4000-8000-000000000001';
    raise exception 'parents cannot change reading history';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
do $$ begin
  assert (select title from public.stories where id = 'd9000000-0000-4000-8000-000000000020') = 'Zop', 'parents cannot edit texts';
end $$;

-- ---------------------------------------------------------------- admin
do $$ begin perform pg_temp.act_as('c9000000-0000-4000-8000-000000000003'); end $$;
do $$ begin
  assert exists (select 1 from public.stories where code = 'read-test-draft'), 'admins see draft texts';
  update public.stories set status = 'published' where id = 'd9000000-0000-4000-8000-000000000021';
  assert (select status from public.stories where id = 'd9000000-0000-4000-8000-000000000021') = 'published', 'admins publish texts';
  assert not exists (select 1 from public.reading_sessions), 'admins do not read family reading history';
end $$;
reset role;

-- ---------------------------------------------------------------- anonymous
set local role anon;
do $$ begin
  begin
    perform 1 from public.reading_sessions limit 1;
    raise exception 'anonymous visitors must not read reading history';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.story_words limit 1;
    raise exception 'anonymous visitors must not read story links';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

rollback;
\echo '009_reading_engine: all assertions passed'
