-- Phase 5 vocabulary engine: configurable categories (one level of sub-categories), words
-- in several levels, curated example sentences, word families, relation types, media
-- limits, My Words written only through the ownership-checked functions, per-area word
-- progress isolated per family. Rolled back at the end.
begin;

insert into auth.users (id, email, aud, role, instance_id) values
  ('a6000000-0000-4000-8000-000000000001', 'vocab-a@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('b6000000-0000-4000-8000-000000000002', 'vocab-b@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
  ('c6000000-0000-4000-8000-000000000003', 'vocab-admin@test.local', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
update public.profiles set role = 'admin' where id = 'c6000000-0000-4000-8000-000000000003';

insert into public.levels (id, code, name, short_name, sort_order, min_age, max_age, difficulty, status) values
  ('d6000000-0000-4000-8000-000000000001', 'VOCLVL1', 'Vocab level 1', 'V1', 906, 4, 5, 1, 'published'),
  ('d6000000-0000-4000-8000-000000000002', 'VOCLVL2', 'Vocab level 2', 'V2', 907, 5, 6, 2, 'published');
insert into public.word_categories (id, code, name, status) values
  ('d6000000-0000-4000-8000-000000000010', 'VOC_PETS', 'Test pets', 'published'),
  ('d6000000-0000-4000-8000-000000000011', 'VOC_DRAFT', 'Draft category', 'draft');
insert into public.word_categories (id, code, name, parent_id, status)
values ('d6000000-0000-4000-8000-000000000012', 'VOC_SMALL_PETS', 'Small pets', 'd6000000-0000-4000-8000-000000000010', 'published');
insert into public.words (id, word, normalized_word, level_id, difficulty, category_id, status) values
  ('d6000000-0000-4000-8000-000000000020', 'zog', 'zog', 'd6000000-0000-4000-8000-000000000001', 1, 'd6000000-0000-4000-8000-000000000012', 'published'),
  ('d6000000-0000-4000-8000-000000000021', 'zogs', 'zogs', 'd6000000-0000-4000-8000-000000000001', 1, 'd6000000-0000-4000-8000-000000000010', 'published'),
  ('d6000000-0000-4000-8000-000000000022', 'zug', 'zug', 'd6000000-0000-4000-8000-000000000001', 1, 'd6000000-0000-4000-8000-000000000010', 'draft');
insert into public.word_levels (word_id, level_id) values
  ('d6000000-0000-4000-8000-000000000020', 'd6000000-0000-4000-8000-000000000002');
insert into public.word_relations (word_id, related_word_id, relation_type) values
  ('d6000000-0000-4000-8000-000000000020', 'd6000000-0000-4000-8000-000000000021', 'plural');
insert into public.sentences (id, text, level_id, difficulty, word_count, status) values
  ('d6000000-0000-4000-8000-000000000030', 'The zog naps.', 'd6000000-0000-4000-8000-000000000001', 1, 3, 'published'),
  ('d6000000-0000-4000-8000-000000000031', 'A zog hops.', 'd6000000-0000-4000-8000-000000000001', 1, 3, 'draft');
insert into public.word_sentences (word_id, sentence_id, sort_order) values
  ('d6000000-0000-4000-8000-000000000020', 'd6000000-0000-4000-8000-000000000030', 0),
  ('d6000000-0000-4000-8000-000000000020', 'd6000000-0000-4000-8000-000000000031', 1);
insert into public.word_families (id, code, rime, title, level_id, status) values
  ('d6000000-0000-4000-8000-000000000040', 'VOC_OG', 'og', 'The -og family', 'd6000000-0000-4000-8000-000000000001', 'published'),
  ('d6000000-0000-4000-8000-000000000041', 'VOC_UG', 'ug', 'The -ug family', 'd6000000-0000-4000-8000-000000000001', 'draft');
insert into public.word_family_members (family_id, word_id) values
  ('d6000000-0000-4000-8000-000000000040', 'd6000000-0000-4000-8000-000000000020'),
  ('d6000000-0000-4000-8000-000000000040', 'd6000000-0000-4000-8000-000000000022'),
  ('d6000000-0000-4000-8000-000000000041', 'd6000000-0000-4000-8000-000000000020');

insert into public.children (id, parent_id, name, grade_level_id, current_level_id) values
  ('e6000000-0000-4000-8000-00000000000a', 'a6000000-0000-4000-8000-000000000001', 'Vocab A', 'd6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000001'),
  ('e6000000-0000-4000-8000-00000000000b', 'b6000000-0000-4000-8000-000000000002', 'Vocab B', 'd6000000-0000-4000-8000-000000000001', 'd6000000-0000-4000-8000-000000000001');
insert into public.word_area_progress (child_id, word_id, area, attempts_count, correct_count, accuracy) values
  ('e6000000-0000-4000-8000-00000000000a', 'd6000000-0000-4000-8000-000000000020', 'spelling', 4, 1, 25),
  ('e6000000-0000-4000-8000-00000000000b', 'd6000000-0000-4000-8000-000000000020', 'listening', 2, 2, 100);

-- ------------------------------------------------------------ constraints (as owner)
do $$ begin
  -- words.level_id is always a word level, and the primary one.
  assert (select count(*) from public.word_levels where word_id = 'd6000000-0000-4000-8000-000000000020') = 2,
    'a word can suit several levels';
  assert (select level_id from public.word_levels where word_id = 'd6000000-0000-4000-8000-000000000020' and is_primary)
    = 'd6000000-0000-4000-8000-000000000001', 'the introducing level is primary';
  update public.words set level_id = 'd6000000-0000-4000-8000-000000000002' where id = 'd6000000-0000-4000-8000-000000000020';
  assert (select level_id from public.word_levels where word_id = 'd6000000-0000-4000-8000-000000000020' and is_primary)
    = 'd6000000-0000-4000-8000-000000000002', 'changing the level moves the primary level';
  assert (select count(*) from public.word_levels where word_id = 'd6000000-0000-4000-8000-000000000020' and is_primary) = 1,
    'exactly one primary level';

  begin
    insert into public.word_categories (code, name, parent_id)
    values ('VOC_TOO_DEEP', 'Too deep', 'd6000000-0000-4000-8000-000000000012');
    raise exception 'sub-categories are one level deep';
  exception when check_violation then null;
  end;
  begin
    insert into public.word_relations (word_id, related_word_id, relation_type)
    values ('d6000000-0000-4000-8000-000000000021', 'd6000000-0000-4000-8000-000000000020', 'cousin');
    raise exception 'unknown relation types are rejected';
  exception when check_violation then null;
  end;
  begin
    insert into public.image_assets (storage_path, alt_text, mime_type, byte_size)
    values ('words/x.svg', 'An svg', 'image/svg+xml', 100);
    raise exception 'only png, jpeg and webp pictures';
  exception when check_violation then null;
  end;
  begin
    insert into public.image_assets (storage_path, alt_text, mime_type, byte_size)
    values ('words/big.png', 'Too big', 'image/png', 5000000);
    raise exception 'pictures are at most 1 MB';
  exception when check_violation then null;
  end;
  begin
    insert into public.word_area_progress (child_id, word_id, area) values
      ('e6000000-0000-4000-8000-00000000000a', 'd6000000-0000-4000-8000-000000000020', 'dancing');
    raise exception 'unknown word areas are rejected';
  exception when check_violation then null;
  end;
  -- Weak words are review items.
  insert into public.review_items (child_id, item_key, word_id, due_at, reason)
  values ('e6000000-0000-4000-8000-00000000000a', 'word:d6000000-0000-4000-8000-000000000020',
          'd6000000-0000-4000-8000-000000000020', now(), 'weak_word');
end $$;

create function pg_temp.act_as(user_id uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', user_id::text, true);
end $$;
grant execute on function pg_temp.act_as(uuid) to authenticated;

-- ---------------------------------------------------------------- parent A
do $$ begin perform pg_temp.act_as('a6000000-0000-4000-8000-000000000001'); end $$;
do $$ begin
  assert exists (select 1 from public.word_categories where code = 'VOC_SMALL_PETS'), 'published categories readable';
  assert not exists (select 1 from public.word_categories where code = 'VOC_DRAFT'), 'draft categories hidden';
  assert (select count(*) from public.word_levels where word_id = 'd6000000-0000-4000-8000-000000000020') = 2,
    'word levels readable';
  assert not exists (select 1 from public.word_levels where word_id = 'd6000000-0000-4000-8000-000000000022'),
    'levels of a draft word hidden';
  assert (select count(*) from public.word_sentences where word_id = 'd6000000-0000-4000-8000-000000000020') = 1,
    'a draft example sentence is hidden';
  assert exists (select 1 from public.word_families where code = 'VOC_OG'), 'published family readable';
  assert not exists (select 1 from public.word_families where code = 'VOC_UG'), 'draft family hidden';
  assert (select count(*) from public.word_family_members where family_id = 'd6000000-0000-4000-8000-000000000040') = 1,
    'draft words are not shown as family members';
  assert (select published_words from public.word_category_stats where category_id = 'd6000000-0000-4000-8000-000000000010') = 1,
    'category counts include published words only';

  -- My Words: own child, published word.
  perform public.set_word_saved('e6000000-0000-4000-8000-00000000000a', 'd6000000-0000-4000-8000-000000000020', true);
  assert (select is_saved and saved_source = 'manual' and saved_at is not null and first_seen_at is not null
          from public.word_progress
          where child_id = 'e6000000-0000-4000-8000-00000000000a' and word_id = 'd6000000-0000-4000-8000-000000000020'),
    'a parent saves a word for their own child';
  perform public.set_word_saved('e6000000-0000-4000-8000-00000000000a', 'd6000000-0000-4000-8000-000000000020', false);
  assert (select not is_saved and saved_at is null from public.word_progress
          where child_id = 'e6000000-0000-4000-8000-00000000000a' and word_id = 'd6000000-0000-4000-8000-000000000020'),
    'and removes it';
  perform public.note_word_seen('e6000000-0000-4000-8000-00000000000a', 'd6000000-0000-4000-8000-000000000021');
  assert exists (select 1 from public.word_progress
                 where child_id = 'e6000000-0000-4000-8000-00000000000a' and word_id = 'd6000000-0000-4000-8000-000000000021'
                   and first_seen_at is not null and not is_saved), 'first seen is recorded';

  begin
    perform public.set_word_saved('e6000000-0000-4000-8000-00000000000b', 'd6000000-0000-4000-8000-000000000020', true);
    raise exception 'another family''s child must be refused';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.note_word_seen('e6000000-0000-4000-8000-00000000000b', 'd6000000-0000-4000-8000-000000000020');
    raise exception 'another family''s child must be refused (seen)';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.set_word_saved('e6000000-0000-4000-8000-00000000000a', 'd6000000-0000-4000-8000-000000000022', true);
    raise exception 'a draft word cannot be saved';
  exception when foreign_key_violation then null;
  end;
  begin
    update public.word_progress set status = 'MASTERED' where child_id = 'e6000000-0000-4000-8000-00000000000a';
    if found then raise exception 'parents must not write word progress directly'; end if;
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.word_area_progress (child_id, word_id, area)
    values ('e6000000-0000-4000-8000-00000000000a', 'd6000000-0000-4000-8000-000000000021', 'usage');
    raise exception 'parents must not write area progress';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.word_families (code, rime, title, level_id)
    values ('VOC_X', 'ix', 'x', 'd6000000-0000-4000-8000-000000000001');
    raise exception 'parents must not write families';
  exception when insufficient_privilege or check_violation then null;
  end;

  -- Area progress and the review queue: own child only.
  assert (select count(*) from public.word_area_progress where word_id = 'd6000000-0000-4000-8000-000000000020') = 1,
    'area progress isolated';
  assert (select area from public.word_area_progress where word_id = 'd6000000-0000-4000-8000-000000000020') = 'spelling',
    'parent A sees their own child''s areas';
  assert not exists (select 1 from public.word_progress where child_id = 'e6000000-0000-4000-8000-00000000000b'),
    'word progress isolated';
end $$;
reset role;

-- ---------------------------------------------------------------- parent B
do $$ begin perform pg_temp.act_as('b6000000-0000-4000-8000-000000000002'); end $$;
do $$ begin
  assert not exists (select 1 from public.word_progress where child_id = 'e6000000-0000-4000-8000-00000000000a'),
    'parent B cannot read child A''s words';
  assert not exists (select 1 from public.review_items where child_id = 'e6000000-0000-4000-8000-00000000000a'),
    'parent B cannot read child A''s review items';
end $$;
reset role;

-- ---------------------------------------------------------------- admin
do $$ begin perform pg_temp.act_as('c6000000-0000-4000-8000-000000000003'); end $$;
do $$ begin
  assert exists (select 1 from public.word_categories where code = 'VOC_DRAFT'), 'admins see draft categories';
  assert exists (select 1 from public.word_families where code = 'VOC_UG'), 'admins see draft families';
  assert (select count(*) from public.word_sentences where word_id = 'd6000000-0000-4000-8000-000000000020') = 2,
    'admins see draft examples';
  assert not exists (select 1 from public.word_area_progress), 'admins do not see family progress';
  insert into public.word_levels (word_id, level_id)
  values ('d6000000-0000-4000-8000-000000000021', 'd6000000-0000-4000-8000-000000000002');
  begin
    perform public.set_word_saved('e6000000-0000-4000-8000-00000000000a', 'd6000000-0000-4000-8000-000000000020', true);
    raise exception 'admins cannot save words for a family''s child';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- ---------------------------------------------------------------- anonymous
set local role anon;
do $$ begin
  begin
    perform 1 from public.word_levels limit 1;
    raise exception 'anonymous visitors must not read word levels';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.word_category_stats limit 1;
    raise exception 'anonymous visitors must not read category stats';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.set_word_saved('e6000000-0000-4000-8000-00000000000a', 'd6000000-0000-4000-8000-000000000020', true);
    raise exception 'anonymous visitors must not save words';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

rollback;
\echo '006_vocabulary_engine: all assertions passed'
