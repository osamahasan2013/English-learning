-- Phase 4: the phonics engine, built on the Phase 3 learning engine (no separate lesson,
-- progress or mastery system — phonics lessons are ordinary lessons, phonics skills are
-- ordinary skills).
--
--   * Graphemes and phonemes are separate things: `phonemes` is the sound inventory
--     (ARPAbet codes, IPA, a speakable approximation); a pattern's pronunciation
--     (`phonics_pattern_sounds.phonemes`) is a SEQUENCE of phonemes, and a pattern can have
--     several pronunciations (TH /θ/ and /ð/, OW /oʊ/ and /aʊ/, ED /t/ /d/ /ɪd/).
--   * Phonics stages (Letters → Sounds → … → Advanced patterns) order the progression.
--   * Patterns gain position, letter name (kept apart from the letter's sound),
--     uppercase form, image, and relations (prerequisite, related, contrast, same sound).
--   * Words are decomposed into grapheme segments, each linked to the pattern and
--     pronunciation it uses, with its phoneme sequence (empty for a silent letter), so
--     blending, segmenting and phoneme-level analytics work from data.
--   * content_flags holds questionable content found by the importer, for admin review.

create table public.phonemes (
  code text primary key check (code ~ '^[A-Z]{1,3}$'),
  ipa text not null check (char_length(ipa) between 1 and 12),
  -- What speech synthesis should say to model the sound in isolation.
  say_as text not null check (char_length(say_as) between 1 and 40),
  -- How the sound is shown to a child, between slashes (/sh/, /ee/): a spelling of the
  -- sound, never presented as the letters of a word.
  label text not null check (char_length(label) between 1 and 8),
  kind text not null check (kind in ('consonant', 'vowel', 'r_colored_vowel')),
  voiced boolean not null,
  example_word text not null default '',
  description text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.phonics_stages (
  code text primary key check (code ~ '^[A-Z0-9_]{2,40}$'),
  name text not null check (char_length(name) between 1 and 80),
  child_name text not null default '',
  description text not null default '',
  emoji text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- Validates that every element of a phoneme array is a known phoneme.
create or replace function public.check_phoneme_codes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  unknown text;
begin
  select p into unknown
  from unnest(new.phonemes) as p
  where not exists (select 1 from public.phonemes ph where ph.code = p)
  limit 1;
  if unknown is not null then
    raise exception 'UNKNOWN_PHONEME' using errcode = '23503', detail = unknown;
  end if;
  return new;
end;
$$;

alter table public.phonics_patterns drop constraint phonics_patterns_pattern_check;
alter table public.phonics_patterns
  -- Letters, and "_" for split vowel-consonant-e patterns such as a_e (cake).
  add constraint phonics_patterns_pattern_check check (pattern ~ '^[a-z][a-z_]{0,7}$'),
  add column stage_code text references public.phonics_stages (code),
  -- Where the pattern usually appears: ck and ng at the end, wh at the start, ...
  add column position text not null default 'any' check (position in ('any', 'initial', 'medial', 'final')),
  -- Letters only: the capital form and the letter's NAME, which is not its sound.
  add column uppercase text check (uppercase is null or uppercase ~ '^[A-Z]{1,2}$'),
  add column letter_name text not null default '' check (char_length(letter_name) <= 20),
  add column letter_name_say_as text not null default '' check (char_length(letter_name_say_as) <= 40),
  add column image_asset_id uuid references public.image_assets (id);
create index phonics_patterns_stage_idx on public.phonics_patterns (stage_code, sort_order);
create index phonics_patterns_type_idx on public.phonics_patterns (pattern_type, level_id);

alter table public.phonics_pattern_sounds
  add column phonemes text[] not null default '{}';
create trigger phonics_pattern_sounds_phonemes before insert or update of phonemes on public.phonics_pattern_sounds
for each row execute function public.check_phoneme_codes();

create table public.phonics_pattern_relations (
  pattern_id uuid not null references public.phonics_patterns (id) on delete cascade,
  related_pattern_id uuid not null references public.phonics_patterns (id) on delete cascade,
  relation_type text not null check (relation_type in ('prerequisite', 'related', 'contrast', 'same_sound')),
  created_at timestamptz not null default now(),
  primary key (pattern_id, related_pattern_id, relation_type),
  check (pattern_id <> related_pattern_id)
);
create index phonics_pattern_relations_related_idx on public.phonics_pattern_relations (related_pattern_id);

-- A word split into the graphemes a reader decodes, in order: ship = sh · i · p,
-- cake = c · a · k · e (the e silent, the a long). Derived by the importer from the
-- word's pattern links, or authored where the automatic split would be wrong.
create table public.word_segments (
  word_id uuid not null references public.words (id) on delete cascade,
  position smallint not null check (position between 0 and 30),
  grapheme text not null check (grapheme ~ '^[a-z'']{1,6}$'),
  pattern_id uuid references public.phonics_patterns (id),
  sound_id uuid references public.phonics_pattern_sounds (id) on delete set null,
  -- The phoneme sequence this grapheme stands for here; empty = silent.
  phonemes text[] not null default '{}',
  primary key (word_id, position)
);
create index word_segments_pattern_idx on public.word_segments (pattern_id);
create index word_segments_sound_idx on public.word_segments (sound_id);
create trigger word_segments_phonemes before insert or update of phonemes on public.word_segments
for each row execute function public.check_phoneme_codes();

alter table public.words
  -- Consonant/vowel shape of the phoneme sequence: CVC, CCVC, CVCC, ...
  add column phonics_shape text not null default '' check (phonics_shape ~ '^[CV]{0,12}$'),
  -- Every segment maps to a known pattern and sound, and the word is not irregular.
  add column decodable boolean not null default false,
  add column segments_source text not null default 'auto' check (segments_source in ('auto', 'authored'));
create index words_shape_idx on public.words (phonics_shape) where phonics_shape <> '';

alter table public.skills
  add column phonics_stage_code text references public.phonics_stages (code);
create index skills_phonics_stage_idx on public.skills (phonics_stage_code) where phonics_stage_code is not null;

-- Questionable content found on import (an example word without its pattern, a word the
-- automatic split could not decode, ...). Admins review; nothing is auto-corrected.
create table public.content_flags (
  id uuid primary key default gen_random_uuid(),
  entity text not null check (entity in ('word', 'phonics_pattern', 'question', 'lesson', 'sentence')),
  entity_key text not null check (char_length(entity_key) between 1 and 160),
  rule text not null check (rule ~ '^[a-z_]{2,60}$'),
  severity text not null default 'warning' check (severity in ('warning', 'error')),
  message text not null check (char_length(message) between 1 and 400),
  created_at timestamptz not null default now(),
  unique (entity, entity_key, rule)
);

-- ---------------------------------------------------------------------------------------
-- Security

revoke all on public.phonemes, public.phonics_stages, public.phonics_pattern_relations,
  public.word_segments, public.content_flags
  from anon, authenticated;
grant all on public.phonemes, public.phonics_stages, public.phonics_pattern_relations,
  public.word_segments, public.content_flags
  to service_role;
revoke all on function public.check_phoneme_codes() from public, anon, authenticated;

-- Phoneme and stage lists: readable by everyone signed in, written by admins.
do $$
declare
  t text;
begin
  foreach t in array array['phonemes', 'phonics_stages']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (true)', t || '_read', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))',
      t || '_admin_write', t
    );
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end
$$;

-- Relations and word segments follow the publication state of what they belong to, so
-- a draft pattern or word is not revealed through them.
alter table public.phonics_pattern_relations enable row level security;
create policy phonics_pattern_relations_read on public.phonics_pattern_relations for select to authenticated
  using (
    (select public.is_admin())
    or (
      exists (select 1 from public.phonics_patterns p where p.id = pattern_id and p.status = 'published')
      and exists (select 1 from public.phonics_patterns p where p.id = related_pattern_id and p.status = 'published')
    )
  );
create policy phonics_pattern_relations_admin_write on public.phonics_pattern_relations for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
grant select, insert, update, delete on public.phonics_pattern_relations to authenticated;

alter table public.word_segments enable row level security;
create policy word_segments_read on public.word_segments for select to authenticated
  using (
    (select public.is_admin())
    or exists (select 1 from public.words w where w.id = word_id and w.status = 'published')
  );
create policy word_segments_admin_write on public.word_segments for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
grant select, insert, update, delete on public.word_segments to authenticated;

-- Review flags: admins only.
alter table public.content_flags enable row level security;
create policy content_flags_admin on public.content_flags for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
grant select, insert, update, delete on public.content_flags to authenticated;
