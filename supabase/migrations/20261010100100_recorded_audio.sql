-- Phase 8.2: recorded educational audio as a first-class source (docs/audio-engine.md).
--
-- audio_assets already holds recordings (kind, storage path, locale, voice/speaker,
-- duration, status) and is linked from what it records: phonemes, pattern sounds, words,
-- sentences, spelling words, stories, questions and lesson intros. This adds what a
-- professional recording set needs, without a second table:
--   * content_key  a stable name for what the clip says ("phoneme:SH", "letter_name:g",
--                  "word:gate", "blend:gate"), so a re-recorded take replaces the old one;
--   * version      the take (a new version can be published while the old one is kept);
--   * metadata     anything else about the recording (studio, notes, level), never used
--                  to decide what is played;
--   * kinds        letter_name, phoneme, blending, segmenting and dictation next to the
--                  existing word / letter / phonics / sentence / instruction / story;
--   * a recording of a letter's NAME on letter patterns ("jee"), separate from the
--     pattern's SOUND recording (phonics_patterns.audio_asset_id), so a letter name and
--     a sound can never share a clip.
-- Nothing is required: without a recording, speech synthesis is used as before.

alter table public.audio_assets
  add column content_key text check (content_key is null or content_key ~ '^[a-z_]+:[A-Za-z0-9 _|-]{1,80}$'),
  add column version integer not null default 1 check (version >= 1),
  add column metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object');

create unique index audio_assets_content_key_version_key
  on public.audio_assets (content_key, version)
  where content_key is not null;

alter table public.audio_assets drop constraint audio_assets_kind_check;
alter table public.audio_assets add constraint audio_assets_kind_check check (kind in (
  'word', 'letter', 'phonics', 'sentence', 'instruction', 'story',
  'letter_name', 'phoneme', 'blending', 'segmenting', 'dictation'
));

alter table public.phonics_patterns
  add column letter_name_audio_asset_id uuid references public.audio_assets (id) on delete set null;

create index phonics_patterns_letter_name_audio_idx
  on public.phonics_patterns (letter_name_audio_asset_id)
  where letter_name_audio_asset_id is not null;

comment on column public.audio_assets.content_key is
  'What the clip says, e.g. phoneme:SH, letter_name:g, word:gate (unique per version).';
comment on column public.phonics_patterns.letter_name_audio_asset_id is
  'A recording of the letter''s NAME (letters only); audio_asset_id is the pattern''s SOUND.';

-- Grants: both tables already grant to authenticated at table level (RLS decides rows),
-- so the new columns are covered; anon has no access (20260929100600_rls_and_grants.sql).
