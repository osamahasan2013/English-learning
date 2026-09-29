-- Language content: phonics patterns (with separately modelled pronunciations), the word
-- bank, sight-word lists, sentences, and stories.

create table public.word_categories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9_]{2,40}$'),
  name text not null,
  emoji text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- A spelling pattern taught as a unit: a single letter, digraph, vowel team, r-controlled
-- vowel, word ending, ... `code` is the stable natural key (LETTER_S and ENDING_S share
-- the text "s"). How it sounds lives in phonics_pattern_sounds, because many patterns
-- have more than one common pronunciation (TH in "thin" vs "this", OW in "snow" vs "cow").
create table public.phonics_patterns (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9_]{1,40}$'),
  pattern text not null check (pattern ~ '^[a-z]{1,8}$'),
  pattern_type text not null check (pattern_type in (
    'letter', 'consonant_digraph', 'consonant_blend', 'trigraph', 'vowel_team',
    'r_controlled', 'silent_e', 'word_ending', 'suffix', 'prefix'
  )),
  level_id uuid not null references public.levels (id),
  difficulty smallint not null check (difficulty between 1 and 10),
  explanation text not null default '',
  child_explanation text not null default '',
  mastery_threshold smallint not null default 85 check (mastery_threshold between 50 and 100),
  sort_order integer not null default 0,
  audio_asset_id uuid references public.audio_assets (id),
  status public.content_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index phonics_patterns_level_idx on public.phonics_patterns (level_id, sort_order);
create trigger phonics_patterns_set_updated_at before update on public.phonics_patterns
for each row execute function public.set_updated_at();

create table public.phonics_pattern_sounds (
  id uuid primary key default gen_random_uuid(),
  pattern_id uuid not null references public.phonics_patterns (id) on delete cascade,
  code text not null check (code ~ '^[A-Z0-9_]{1,40}$'),
  ipa text not null default '',
  label text not null check (char_length(label) between 1 and 80),
  -- What speech synthesis should say to model the sound (e.g. "shh"), since engines
  -- cannot pronounce an isolated phoneme from IPA.
  say_as text not null check (char_length(say_as) between 1 and 40),
  is_primary boolean not null default false,
  sort_order integer not null default 0,
  audio_asset_id uuid references public.audio_assets (id),
  created_at timestamptz not null default now(),
  unique (pattern_id, code)
);
create unique index phonics_pattern_sounds_one_primary on public.phonics_pattern_sounds (pattern_id) where is_primary;

create table public.words (
  id uuid primary key default gen_random_uuid(),
  word text not null check (char_length(word) between 1 and 40),
  normalized_word text not null check (normalized_word = lower(btrim(normalized_word)) and normalized_word <> ''),
  -- Distinguishes homographs ("read" now vs. past). Most words have sense 1 only.
  sense smallint not null default 1 check (sense between 1 and 9),
  level_id uuid not null references public.levels (id),
  difficulty smallint not null check (difficulty between 1 and 10),
  category_id uuid references public.word_categories (id),
  syllable_count smallint not null default 1 check (syllable_count between 1 and 8),
  pronunciation text not null default '',
  tts_text text not null default '',
  definition text not null default '',
  child_definition text not null default '',
  part_of_speech text not null default 'noun' check (part_of_speech in (
    'noun', 'verb', 'adjective', 'adverb', 'pronoun', 'preposition', 'conjunction',
    'determiner', 'interjection', 'number', 'other'
  )),
  is_sight_word boolean not null default false,
  -- Set when the spelling does not follow the phonics taught so far ("said", "was");
  -- spelling_note explains it to the parent/child instead of pretending it is regular.
  is_irregular boolean not null default false,
  spelling_note text not null default '',
  example_sentence text not null default '',
  plural text not null default '',
  inflections jsonb not null default '{}'::jsonb check (jsonb_typeof(inflections) = 'object'),
  tags text[] not null default '{}',
  emoji text not null default '',
  image_asset_id uuid references public.image_assets (id),
  audio_asset_id uuid references public.audio_assets (id),
  status public.content_status not null default 'draft',
  search tsvector generated always as (
    setweight(to_tsvector('simple', coalesce(word, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(child_definition, '') || ' ' || coalesce(definition, '')), 'B')
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (normalized_word, sense)
);
create index words_level_idx on public.words (level_id, difficulty);
create index words_category_idx on public.words (category_id);
create index words_prefix_idx on public.words (normalized_word text_pattern_ops);
create index words_search_idx on public.words using gin (search);
create index words_tags_idx on public.words using gin (tags);
create trigger words_set_updated_at before update on public.words
for each row execute function public.set_updated_at();

create table public.word_phonics_patterns (
  word_id uuid not null references public.words (id) on delete cascade,
  pattern_id uuid not null references public.phonics_patterns (id) on delete cascade,
  sound_id uuid references public.phonics_pattern_sounds (id) on delete set null,
  -- Featured as a teaching example on the pattern's card.
  is_example boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (word_id, pattern_id)
);
create index word_phonics_patterns_pattern_idx on public.word_phonics_patterns (pattern_id);

create table public.word_relations (
  word_id uuid not null references public.words (id) on delete cascade,
  related_word_id uuid not null references public.words (id) on delete cascade,
  relation_type text not null default 'related' check (relation_type in ('related', 'synonym', 'antonym', 'family', 'rhyme')),
  created_at timestamptz not null default now(),
  primary key (word_id, related_word_id, relation_type),
  check (word_id <> related_word_id)
);

create table public.sight_words (
  id uuid primary key default gen_random_uuid(),
  word_id uuid not null references public.words (id),
  level_id uuid not null references public.levels (id),
  list_name text not null default 'core' check (char_length(list_name) between 1 and 40),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (level_id, word_id)
);

create table public.sentences (
  id uuid primary key default gen_random_uuid(),
  text text not null unique check (char_length(text) between 2 and 300),
  level_id uuid not null references public.levels (id),
  difficulty smallint not null check (difficulty between 1 and 10),
  grammar_complexity smallint not null default 1 check (grammar_complexity between 1 and 5),
  word_count smallint not null check (word_count between 1 and 60),
  tts_text text not null default '',
  emoji text not null default '',
  image_asset_id uuid references public.image_assets (id),
  audio_asset_id uuid references public.audio_assets (id),
  status public.content_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sentences_level_idx on public.sentences (level_id, difficulty);
create trigger sentences_set_updated_at before update on public.sentences
for each row execute function public.set_updated_at();

-- Vocabulary a sentence depends on, so a sentence is only offered once its words are known.
create table public.sentence_words (
  sentence_id uuid not null references public.sentences (id) on delete cascade,
  word_id uuid not null references public.words (id) on delete cascade,
  primary key (sentence_id, word_id)
);
create index sentence_words_word_idx on public.sentence_words (word_id);

create table public.sentence_phonics_patterns (
  sentence_id uuid not null references public.sentences (id) on delete cascade,
  pattern_id uuid not null references public.phonics_patterns (id) on delete cascade,
  primary key (sentence_id, pattern_id)
);
create index sentence_phonics_patterns_pattern_idx on public.sentence_phonics_patterns (pattern_id);

-- Original (or licensed) reading passages. `pages` is an ordered array of
-- {"text": string, "emoji"?: string}. Comprehension questions are ordinary questions with
-- story_id set.
create table public.stories (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9-]{2,80}$'),
  title text not null check (char_length(title) between 1 and 120),
  level_id uuid not null references public.levels (id),
  difficulty smallint not null check (difficulty between 1 and 10),
  summary text not null default '',
  cover_emoji text not null default '',
  pages jsonb not null check (jsonb_typeof(pages) = 'array' and jsonb_array_length(pages) > 0),
  word_count integer not null check (word_count > 0),
  is_original boolean not null default true,
  license text not null default '',
  version integer not null default 1 check (version > 0),
  status public.content_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (is_original or license <> '')
);
create index stories_level_idx on public.stories (level_id, difficulty);
create trigger stories_set_updated_at before update on public.stories
for each row execute function public.set_updated_at();
