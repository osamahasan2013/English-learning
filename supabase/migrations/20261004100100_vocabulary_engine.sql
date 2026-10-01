-- Phase 5: the vocabulary engine, built on the existing word bank and learning engine (no
-- separate lesson, progress, mastery or review system — vocabulary lessons are ordinary
-- lessons, word answers are ordinary attempts, word mastery uses the same algorithm).
--
--   * Categories are configurable rows with optional sub-categories (one level deep) and
--     a publication state; a word points at its most specific category.
--   * A word can suit several levels (word_levels); words.level_id stays the level that
--     introduces it, and is always one of them.
--   * Example sentences are curated rows of the sentence bank, linked per word
--     (word_sentences) — the future Sentence Engine reads the same rows.
--   * Word families (-at: cat, bat, hat) are rows linked to the phonics pattern of their
--     vowel; membership is derived by the importer from the words' grapheme splits.
--   * More relation types: plural, verb form, adjective form.
--   * Media: uploaded files live in Supabase Storage (buckets content-images and
--     content-audio, validated type and size); image_assets records each upload's type
--     and size.
--   * Per-child word progress gains mastery (status, score, accuracy, review schedule) and
--     a per-area breakdown (recognition, listening, meaning, reading, spelling, usage).
--   * Weak words become review items (reason weak_word).
--   * set_word_saved / note_word_seen let a family save a word to My Words for their
--     own child only.

-- ---------------------------------------------------------------------------------------
-- Categories

alter table public.word_categories
  add column parent_id uuid references public.word_categories (id),
  add column description text not null default '',
  add column status public.content_status not null default 'published',
  add column updated_at timestamptz not null default now(),
  add constraint word_categories_not_own_parent check (parent_id is null or parent_id <> id);
create index word_categories_parent_idx on public.word_categories (parent_id);
create trigger word_categories_set_updated_at before update on public.word_categories
for each row execute function public.set_updated_at();

-- Sub-categories are one level deep: a category with a parent cannot be a parent itself.
create or replace function public.enforce_word_category_depth()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.parent_id is not null and (
    exists (select 1 from public.word_categories c where c.id = new.parent_id and c.parent_id is not null)
    or exists (select 1 from public.word_categories c where c.parent_id = new.id)
  ) then
    raise exception 'CATEGORY_TOO_DEEP' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger word_categories_depth before insert or update of parent_id on public.word_categories
for each row execute function public.enforce_word_category_depth();

-- ---------------------------------------------------------------------------------------
-- Levels (many-to-many)

create table public.word_levels (
  word_id uuid not null references public.words (id) on delete cascade,
  level_id uuid not null references public.levels (id),
  -- The level that introduces the word (= words.level_id).
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (word_id, level_id)
);
create index word_levels_level_idx on public.word_levels (level_id, word_id);
create unique index word_levels_one_primary on public.word_levels (word_id) where is_primary;

insert into public.word_levels (word_id, level_id, is_primary)
select id, level_id, true from public.words
on conflict do nothing;

-- words.level_id is always one of the word's levels, and the primary one.
create or replace function public.sync_word_primary_level()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.word_levels set is_primary = false
  where word_id = new.id and is_primary and level_id <> new.level_id;
  insert into public.word_levels (word_id, level_id, is_primary)
  values (new.id, new.level_id, true)
  on conflict (word_id, level_id) do update set is_primary = true;
  return new;
end;
$$;
create trigger words_sync_primary_level after insert or update of level_id on public.words
for each row execute function public.sync_word_primary_level();

-- ---------------------------------------------------------------------------------------
-- Example sentences (curated rows of the sentence bank)

create table public.word_sentences (
  word_id uuid not null references public.words (id) on delete cascade,
  sentence_id uuid not null references public.sentences (id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (word_id, sentence_id)
);
create index word_sentences_sentence_idx on public.word_sentences (sentence_id);

-- ---------------------------------------------------------------------------------------
-- Word families

create table public.word_families (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9_]{2,40}$'),
  -- The shared ending, as written: "at" for cat/bat/hat.
  rime text not null check (rime ~ '^[a-z]{1,6}$'),
  title text not null check (char_length(title) between 1 and 80),
  level_id uuid not null references public.levels (id),
  -- The phonics pattern of the family's vowel sound (short a for -at), so families can be
  -- found from the phonics engine and offered once that sound is taught.
  vowel_pattern_id uuid references public.phonics_patterns (id),
  emoji text not null default '',
  sort_order integer not null default 0,
  status public.content_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index word_families_level_idx on public.word_families (level_id, sort_order);
create index word_families_vowel_idx on public.word_families (vowel_pattern_id);
create trigger word_families_set_updated_at before update on public.word_families
for each row execute function public.set_updated_at();

create table public.word_family_members (
  family_id uuid not null references public.word_families (id) on delete cascade,
  word_id uuid not null references public.words (id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  primary key (family_id, word_id)
);
create index word_family_members_word_idx on public.word_family_members (word_id);

-- ---------------------------------------------------------------------------------------
-- Relations

alter table public.word_relations drop constraint word_relations_relation_type_check;
alter table public.word_relations add constraint word_relations_relation_type_check check (relation_type in (
  'related', 'synonym', 'antonym', 'family', 'rhyme', 'plural', 'verb_form', 'adjective_form'
));
create index word_relations_related_idx on public.word_relations (related_word_id);

-- ---------------------------------------------------------------------------------------
-- Media: what was uploaded, validated again by the database.

alter table public.image_assets
  add column mime_type text check (mime_type is null or mime_type in ('image/png', 'image/jpeg', 'image/webp')),
  add column byte_size integer check (byte_size is null or byte_size between 1 and 1048576);

-- Uploads go to public, type- and size-limited buckets (pictures; word recordings); only
-- admins may write to them.
-- (Skipped where Supabase Storage is not installed, e.g. the Docker-free local stack.)
do $$
begin
  if to_regclass('storage.buckets') is null or to_regclass('storage.objects') is null then
    return;
  end if;
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values
    ('content-images', 'content-images', true, 1048576, array['image/png', 'image/jpeg', 'image/webp']),
    ('content-audio', 'content-audio', true, 2097152, array['audio/mpeg', 'audio/mp4', 'audio/ogg', 'audio/wav'])
  on conflict (id) do update set
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
  execute 'drop policy if exists content_images_admin_insert on storage.objects';
  execute 'drop policy if exists content_images_admin_update on storage.objects';
  execute 'drop policy if exists content_images_admin_delete on storage.objects';
  execute $p$create policy content_images_admin_insert on storage.objects for insert to authenticated
    with check (bucket_id in ('content-images', 'content-audio') and (select public.is_admin()))$p$;
  execute $p$create policy content_images_admin_update on storage.objects for update to authenticated
    using (bucket_id in ('content-images', 'content-audio') and (select public.is_admin()))
    with check (bucket_id in ('content-images', 'content-audio') and (select public.is_admin()))$p$;
  execute $p$create policy content_images_admin_delete on storage.objects for delete to authenticated
    using (bucket_id in ('content-images', 'content-audio') and (select public.is_admin()))$p$;
end
$$;

-- ---------------------------------------------------------------------------------------
-- Word progress (My Words) and per-area progress: derived, written by the server only.

alter table public.word_progress
  add column first_seen_at timestamptz,
  add column saved_at timestamptz,
  add column last_reviewed_at timestamptz,
  add column status public.mastery_status not null default 'NOT_STARTED',
  add column mastery_score numeric(5, 2) not null default 0 check (mastery_score between 0 and 100),
  add column accuracy numeric(5, 2) not null default 0 check (accuracy between 0 and 100),
  add column practice_days integer not null default 0 check (practice_days >= 0),
  add column review_priority numeric(6, 2) not null default 0,
  add column next_review_at timestamptz;
update public.word_progress set first_seen_at = created_at where first_seen_at is null;
update public.word_progress set saved_at = created_at where is_saved and saved_at is null;
create index word_progress_review_idx on public.word_progress (child_id, review_priority desc);
create index word_progress_status_idx on public.word_progress (child_id, status);
create index word_progress_recent_idx on public.word_progress (child_id, last_practiced_at desc);

create table public.word_area_progress (
  child_id uuid not null references public.children (id) on delete cascade,
  word_id uuid not null references public.words (id),
  area text not null check (area in ('recognition', 'listening', 'meaning', 'reading', 'spelling', 'usage')),
  attempts_count integer not null default 0 check (attempts_count >= 0),
  correct_count integer not null default 0 check (correct_count between 0 and attempts_count),
  accuracy numeric(5, 2) not null default 0 check (accuracy between 0 and 100),
  last_practiced_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (child_id, word_id, area)
);
create index word_area_progress_child_area_idx on public.word_area_progress (child_id, area);

-- Weak words come back for review like weak skills.
alter table public.review_items drop constraint review_items_reason_check;
alter table public.review_items add constraint review_items_reason_check check (reason in (
  'weak_skill', 'due_review', 'recent_errors', 'missed_word', 'weak_word'
));

-- ---------------------------------------------------------------------------------------
-- My Words: the only family-written part of word progress. The child must be the caller's
-- own (is_my_child) and the word published; everything else in the row stays derived.

create or replace function public.set_word_saved(p_child_id uuid, p_word_id uuid, p_saved boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_child_id is null or not public.is_my_child(p_child_id) then
    raise exception 'CHILD_NOT_FOUND' using errcode = '42501';
  end if;
  if not exists (select 1 from public.words w where w.id = p_word_id and w.status = 'published') then
    raise exception 'WORD_NOT_FOUND' using errcode = '23503';
  end if;
  insert into public.word_progress (child_id, word_id, is_saved, saved_source, saved_at, first_seen_at)
  values (p_child_id, p_word_id, p_saved, 'manual', case when p_saved then now() end, now())
  on conflict (child_id, word_id) do update set
    is_saved = excluded.is_saved,
    saved_source = 'manual',
    saved_at = case when excluded.is_saved then coalesce(public.word_progress.saved_at, now()) end,
    first_seen_at = coalesce(public.word_progress.first_seen_at, now()),
    updated_at = now();
end;
$$;

create or replace function public.note_word_seen(p_child_id uuid, p_word_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_child_id is null or not public.is_my_child(p_child_id) then
    raise exception 'CHILD_NOT_FOUND' using errcode = '42501';
  end if;
  if not exists (select 1 from public.words w where w.id = p_word_id and w.status = 'published') then
    raise exception 'WORD_NOT_FOUND' using errcode = '23503';
  end if;
  insert into public.word_progress (child_id, word_id, first_seen_at)
  values (p_child_id, p_word_id, now())
  on conflict (child_id, word_id) do update set
    first_seen_at = coalesce(public.word_progress.first_seen_at, now());
end;
$$;

-- ---------------------------------------------------------------------------------------
-- Indexes for vocabulary search (server-side filtering and pagination).

create index words_pos_idx on public.words (part_of_speech);
create index words_status_word_idx on public.words (status, normalized_word);
create index word_segments_word_pattern_idx on public.word_segments (pattern_id, word_id);

-- ---------------------------------------------------------------------------------------
-- Security

revoke all on public.word_levels, public.word_sentences, public.word_families,
  public.word_family_members, public.word_area_progress
  from anon, authenticated;
grant all on public.word_levels, public.word_sentences, public.word_families,
  public.word_family_members, public.word_area_progress
  to service_role;
revoke all on function public.enforce_word_category_depth() from public, anon, authenticated;
revoke all on function public.sync_word_primary_level() from public, anon, authenticated;
revoke all on function public.set_word_saved(uuid, uuid, boolean) from public, anon;
revoke all on function public.note_word_seen(uuid, uuid) from public, anon;
grant execute on function public.set_word_saved(uuid, uuid, boolean) to authenticated;
grant execute on function public.note_word_seen(uuid, uuid) to authenticated;

-- Categories: families see published ones only (they could already read all; drafts are
-- now hidden).
drop policy word_categories_read on public.word_categories;
create policy word_categories_read on public.word_categories for select to authenticated
  using ((select public.is_admin()) or status = 'published');

-- Link tables follow the publication state of what they link.
alter table public.word_levels enable row level security;
create policy word_levels_read on public.word_levels for select to authenticated
  using (
    (select public.is_admin())
    or exists (select 1 from public.words w where w.id = word_id and w.status = 'published')
  );

alter table public.word_sentences enable row level security;
create policy word_sentences_read on public.word_sentences for select to authenticated
  using (
    (select public.is_admin())
    or (
      exists (select 1 from public.words w where w.id = word_id and w.status = 'published')
      and exists (select 1 from public.sentences s where s.id = sentence_id and s.status = 'published')
    )
  );

alter table public.word_families enable row level security;
create policy word_families_read on public.word_families for select to authenticated
  using ((select public.is_admin()) or status = 'published');

alter table public.word_family_members enable row level security;
create policy word_family_members_read on public.word_family_members for select to authenticated
  using (
    (select public.is_admin())
    or (
      exists (select 1 from public.word_families f where f.id = family_id and f.status = 'published')
      and exists (select 1 from public.words w where w.id = word_id and w.status = 'published')
    )
  );

do $$
declare
  t text;
begin
  foreach t in array array['word_levels', 'word_sentences', 'word_families', 'word_family_members']
  loop
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))',
      t || '_admin_write', t
    );
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end
$$;

-- Per-area progress: read-only for the owning parent, like all progress.
alter table public.word_area_progress enable row level security;
create policy word_area_progress_parent_read on public.word_area_progress for select to authenticated
  using ((select public.is_my_child(child_id)));
grant select on public.word_area_progress to authenticated;

-- Published words per category, counted in the database (category screens never load the
-- word list to count it). security_invoker: the caller's RLS applies.
create view public.word_category_stats with (security_invoker = true) as
select category_id, count(*)::integer as published_words
from public.words
where status = 'published' and category_id is not null
group by category_id;
revoke all on public.word_category_stats from anon, authenticated;
grant select on public.word_category_stats to authenticated;
