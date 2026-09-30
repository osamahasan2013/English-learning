-- Phase 4 phonics engine: phoneme/stage lists, pattern relations and word segments that
-- follow publication state, admin-only review flags, phoneme and grapheme constraints,
-- and assessment results isolated per family. Rolled back at the end.
begin;

insert into auth.users (id, email, aud, role, instance_id) values
  ('a5000000-0000-4000-8000-000000000001', 'phonics-a@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('b5000000-0000-4000-8000-000000000002', 'phonics-b@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('c5000000-0000-4000-8000-000000000003', 'phonics-admin@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
update public.profiles set role = 'admin' where id = 'c5000000-0000-4000-8000-000000000003';

insert into public.levels (id, code, name, short_name, sort_order, min_age, max_age, difficulty, status)
values ('d5000000-0000-4000-8000-000000000001', 'PHXLVL', 'Phonics test level', 'PX', 905, 4, 5, 1, 'published');
insert into public.phonemes (code, ipa, say_as, label, kind, voiced)
values ('ZZQ', '/zq/', 'zq', '/zq/', 'consonant', true)
on conflict (code) do nothing;
insert into public.phonics_stages (code, name, child_name) values ('PHX_STAGE', 'Test stage', 'Test')
on conflict (code) do nothing;
insert into public.phonics_patterns (id, code, pattern, pattern_type, level_id, difficulty, stage_code, status) values
  ('d5000000-0000-4000-8000-000000000002', 'PHX_PUB', 'zq', 'consonant_digraph', 'd5000000-0000-4000-8000-000000000001', 1, 'PHX_STAGE', 'published'),
  ('d5000000-0000-4000-8000-000000000003', 'PHX_DRAFT', 'qz', 'consonant_digraph', 'd5000000-0000-4000-8000-000000000001', 1, 'PHX_STAGE', 'draft'),
  ('d5000000-0000-4000-8000-000000000004', 'PHX_PUB2', 'zz', 'consonant_digraph', 'd5000000-0000-4000-8000-000000000001', 1, 'PHX_STAGE', 'published');
insert into public.phonics_pattern_relations (pattern_id, related_pattern_id, relation_type) values
  ('d5000000-0000-4000-8000-000000000002', 'd5000000-0000-4000-8000-000000000004', 'contrast'),
  ('d5000000-0000-4000-8000-000000000002', 'd5000000-0000-4000-8000-000000000003', 'related');
insert into public.words (id, word, normalized_word, level_id, difficulty, phonics_shape, status) values
  ('d5000000-0000-4000-8000-000000000005', 'zqat', 'zqat', 'd5000000-0000-4000-8000-000000000001', 1, 'CVC', 'published'),
  ('d5000000-0000-4000-8000-000000000006', 'qzat', 'qzat', 'd5000000-0000-4000-8000-000000000001', 1, 'CVC', 'draft');
insert into public.word_segments (word_id, position, grapheme, pattern_id, phonemes) values
  ('d5000000-0000-4000-8000-000000000005', 0, 'zq', 'd5000000-0000-4000-8000-000000000002', '{ZZQ}'),
  ('d5000000-0000-4000-8000-000000000005', 1, 'a', null, '{AE}'),
  ('d5000000-0000-4000-8000-000000000005', 2, 't', null, '{T}'),
  ('d5000000-0000-4000-8000-000000000006', 0, 'qz', 'd5000000-0000-4000-8000-000000000003', '{ZZQ}');
insert into public.content_flags (entity, entity_key, rule, message)
values ('word', 'phx-test', 'decomposition', 'check the split');

-- Two families, each with a Phonics Check result.
insert into public.children (id, parent_id, name, grade_level_id, current_level_id) values
  ('e5000000-0000-4000-8000-00000000000a', 'a5000000-0000-4000-8000-000000000001', 'Phonics A', 'd5000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000001'),
  ('e5000000-0000-4000-8000-00000000000b', 'b5000000-0000-4000-8000-000000000002', 'Phonics B', 'd5000000-0000-4000-8000-000000000001', 'd5000000-0000-4000-8000-000000000001');
insert into public.assessments (id, code, title, assessment_type, status)
values ('d5000000-0000-4000-8000-000000000007', 'phx-check', 'Test check', 'skill_check', 'published');
insert into public.assessment_attempts (id, child_id, assessment_id, purpose, started_at) values
  ('f5000000-0000-4000-8000-00000000000a', 'e5000000-0000-4000-8000-00000000000a', 'd5000000-0000-4000-8000-000000000007', 'skill_check', now()),
  ('f5000000-0000-4000-8000-00000000000b', 'e5000000-0000-4000-8000-00000000000b', 'd5000000-0000-4000-8000-000000000007', 'skill_check', now());
insert into public.assessment_results (assessment_attempt_id, child_id, overall_score, dimension_scores) values
  ('f5000000-0000-4000-8000-00000000000a', 'e5000000-0000-4000-8000-00000000000a', 80, '{"Letters": {"percent": 100}}'),
  ('f5000000-0000-4000-8000-00000000000b', 'e5000000-0000-4000-8000-00000000000b', 40, '{"Letters": {"percent": 50}}');

-- ------------------------------------------------------------ constraints (as owner)
do $$ begin
  begin
    insert into public.word_segments (word_id, position, grapheme, phonemes)
    values ('d5000000-0000-4000-8000-000000000005', 3, 's', '{NOPE}');
    raise exception 'an unknown phoneme code must be rejected';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.word_segments (word_id, position, grapheme, phonemes)
    values ('d5000000-0000-4000-8000-000000000005', 3, 'S!', '{S}');
    raise exception 'a grapheme must be lowercase letters';
  exception when check_violation then null;
  end;
  begin
    update public.phonics_pattern_sounds set phonemes = '{NOPE}'
    where pattern_id = (select id from public.phonics_patterns where code = 'SH');
    if found then raise exception 'a pattern sound with an unknown phoneme must be rejected'; end if;
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.phonics_pattern_relations (pattern_id, related_pattern_id, relation_type)
    values ('d5000000-0000-4000-8000-000000000002', 'd5000000-0000-4000-8000-000000000002', 'related');
    raise exception 'a pattern cannot relate to itself';
  exception when check_violation then null;
  end;
  begin
    update public.words set phonics_shape = 'CXC' where id = 'd5000000-0000-4000-8000-000000000005';
    raise exception 'a phonics shape is C and V only';
  exception when check_violation then null;
  end;
  begin
    update public.phonics_patterns set position = 'somewhere' where code = 'PHX_PUB';
    raise exception 'position must be any/initial/medial/final';
  exception when check_violation then null;
  end;
  begin
    update public.phonics_patterns set stage_code = 'NO_SUCH_STAGE' where code = 'PHX_PUB';
    raise exception 'a pattern stage must exist';
  exception when foreign_key_violation then null;
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
do $$ begin perform pg_temp.act_as('a5000000-0000-4000-8000-000000000001'); end $$;
do $$ begin
  assert exists (select 1 from public.phonemes where code = 'SH'), 'phonemes readable';
  assert exists (select 1 from public.phonics_stages where code = 'PHX_STAGE'), 'stages readable';
  assert exists (select 1 from public.phonics_patterns where code = 'PHX_PUB'), 'published pattern readable';
  assert not exists (select 1 from public.phonics_patterns where code = 'PHX_DRAFT'), 'draft pattern hidden';
  -- A relation is visible only when both ends are published.
  assert (select count(*) from public.phonics_pattern_relations
          where pattern_id = 'd5000000-0000-4000-8000-000000000002') = 1, 'relation to a draft is hidden';
  -- Segments follow their word.
  assert (select count(*) from public.word_segments where word_id = 'd5000000-0000-4000-8000-000000000005') = 3,
    'published word segments readable';
  assert not exists (select 1 from public.word_segments where word_id = 'd5000000-0000-4000-8000-000000000006'),
    'draft word segments hidden';
  assert not exists (select 1 from public.content_flags), 'review flags are admin-only';
  -- Assessment results: own child only.
  assert (select count(*) from public.assessment_results where assessment_attempt_id::text like 'f5000000%') = 1,
    'assessment results isolated';
  assert (select overall_score from public.assessment_results where assessment_attempt_id::text like 'f5000000%') = 80,
    'parent A sees their own child''s result';
  assert (select count(*) from public.assessment_attempts where id::text like 'f5000000%') = 1,
    'assessment attempts isolated';

  begin
    insert into public.phonemes (code, ipa, say_as, label, kind, voiced) values ('QQQ', '/q/', 'q', '/q/', 'consonant', false);
    raise exception 'parents must not write phonemes';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.word_segments (word_id, position, grapheme, phonemes)
    values ('d5000000-0000-4000-8000-000000000005', 5, 's', '{S}');
    raise exception 'parents must not write word segments';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.content_flags (entity, entity_key, rule, message) values ('word', 'x', 'y', 'z');
    raise exception 'parents must not write review flags';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.assessment_results (assessment_attempt_id, child_id, overall_score)
    values ('f5000000-0000-4000-8000-00000000000a', 'e5000000-0000-4000-8000-00000000000a', 100);
    raise exception 'parents must not write assessment results';
  exception when insufficient_privilege or unique_violation then null;
  end;
  begin
    update public.assessment_results set overall_score = 100
    where assessment_attempt_id = 'f5000000-0000-4000-8000-00000000000a';
    if found then raise exception 'parents must not change assessment results'; end if;
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ---------------------------------------------------------------- admin
do $$ begin perform pg_temp.act_as('c5000000-0000-4000-8000-000000000003'); end $$;
do $$ begin
  assert exists (select 1 from public.phonics_patterns where code = 'PHX_DRAFT'), 'admins see draft patterns';
  assert (select count(*) from public.phonics_pattern_relations
          where pattern_id = 'd5000000-0000-4000-8000-000000000002') = 2, 'admins see all relations';
  assert exists (select 1 from public.word_segments where word_id = 'd5000000-0000-4000-8000-000000000006'),
    'admins see draft segments';
  assert exists (select 1 from public.content_flags where entity_key = 'phx-test'), 'admins see review flags';
  assert not exists (select 1 from public.assessment_results where assessment_attempt_id::text like 'f5000000%'),
    'admins do not see family assessment results';
  insert into public.phonics_stages (code, name, child_name) values ('PHX_ADMIN', 'Admin stage', 'A');
  delete from public.content_flags where entity_key = 'phx-test';
end $$;
reset role;

-- ---------------------------------------------------------------- anonymous
set local role anon;
do $$ begin
  begin
    perform 1 from public.phonemes limit 1;
    raise exception 'anonymous visitors must not read phonemes';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.word_segments limit 1;
    raise exception 'anonymous visitors must not read word segments';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

rollback;
\echo '005_phonics_engine: all assertions passed'
