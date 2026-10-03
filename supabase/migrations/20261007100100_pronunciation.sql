-- Pronunciation: phonics sounds are spoken as SOUNDS, never as letter names.
--
-- say_as used to hold strings such as "sss", "th, as in thin" or "aa", which speech
-- engines read as letter names ("ess ess ess", "tee aitch") or as the wrong vowel. Now:
--   * say_as is a speech-synthesis rendering checked to produce the sound ("suh", "ee",
--     "shun"), or empty when no rendering exists;
--   * tts_quality says how good that rendering is: 'pure' (the sound alone),
--     'approximate' (the sound plus a short "uh" — voices cannot say an isolated
--     consonant) or 'keyword' (no rendering: the app names a word that has the sound,
--     "the sound at the start of apple", instead of inventing a wrong one);
--   * phonemes gain a recorded clip (audio_asset_id), which always wins.
-- Questions carry sound tokens ({/S/}) resolved against these rows at play time
-- (src/lib/audio/pronunciation.ts), so adding recordings needs no re-import.

alter table public.phonemes drop constraint if exists phonemes_say_as_check;
alter table public.phonemes
  add constraint phonemes_say_as_check check (char_length(say_as) <= 40),
  add column tts_quality text not null default 'approximate'
    check (tts_quality in ('pure', 'approximate', 'keyword')),
  add column keyword text not null default '' check (keyword = '' or keyword ~ '^[a-z]{2,20}$'),
  add column keyword_position text not null default 'first'
    check (keyword_position in ('first', 'middle', 'last')),
  add column audio_asset_id uuid references public.audio_assets (id),
  add constraint phonemes_rendering_check check (
    (tts_quality = 'keyword' and keyword <> '') or (tts_quality <> 'keyword' and say_as <> '')
  );
create index phonemes_audio_asset_idx on public.phonemes (audio_asset_id);

-- A pattern's sound may have its own rendering (multi-sound patterns: "shun", "ing",
-- "ar"); an empty say_as means "use the phonemes' own renderings".
alter table public.phonics_pattern_sounds drop constraint if exists phonics_pattern_sounds_say_as_check;
alter table public.phonics_pattern_sounds
  add constraint phonics_pattern_sounds_say_as_check check (char_length(say_as) <= 40),
  add column tts_quality text not null default 'approximate'
    check (tts_quality in ('pure', 'approximate', 'keyword')),
  add column keyword text not null default '' check (keyword = '' or keyword ~ '^[a-z]{2,20}$'),
  add column keyword_position text not null default 'first'
    check (keyword_position in ('first', 'middle', 'last')),
  add constraint phonics_pattern_sounds_rendering_check check (tts_quality <> 'keyword' or keyword <> '');

comment on column public.phonemes.say_as is
  'Speech-synthesis rendering that says the SOUND (never letters: no "sss", "th"); empty when tts_quality = keyword.';
comment on column public.phonics_pattern_sounds.say_as is
  'Own speech-synthesis rendering of this sound ("shun"); empty = built from the phonemes.';

-- phonemes and phonics_pattern_sounds keep their existing policies and grants (read for
-- signed-in users, writes for admins); the new columns are covered by the table grants.
