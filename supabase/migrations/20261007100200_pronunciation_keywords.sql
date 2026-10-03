-- A sound's keyword can list several words ("egg elephant elbow"). When the app has to
-- name a sound by a word that has it (no recording, no synthesis rendering), it picks the
-- first word that is not on screen, so a question never gives its answer away ("Which one
-- starts with the sound at the start of egg?" with egg as a choice).

alter table public.phonemes drop constraint if exists phonemes_keyword_check;
alter table public.phonemes
  add constraint phonemes_keyword_check check (keyword = '' or keyword ~ '^[a-z]{2,20}( [a-z]{2,20}){0,3}$');

alter table public.phonics_pattern_sounds drop constraint if exists phonics_pattern_sounds_keyword_check;
alter table public.phonics_pattern_sounds
  add constraint phonics_pattern_sounds_keyword_check
    check (keyword = '' or keyword ~ '^[a-z]{2,20}( [a-z]{2,20}){0,3}$');
