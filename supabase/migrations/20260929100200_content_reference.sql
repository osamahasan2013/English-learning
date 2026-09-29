-- Reference content: levels, subjects, skill dimensions, activity types, and media assets.
-- All of this is data, not code: adding a level or an activity type is an insert here
-- (an activity type also needs a renderer registered in src/features/activities).

create table public.levels (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9_]{2,32}$'),
  name text not null check (char_length(name) between 1 and 80),
  short_name text not null check (char_length(short_name) between 1 and 16),
  description text not null default '',
  sort_order integer not null,
  min_age smallint not null check (min_age between 2 and 18),
  max_age smallint not null check (max_age between 2 and 18),
  difficulty smallint not null check (difficulty between 1 and 10),
  vocabulary_target integer not null default 0 check (vocabulary_target >= 0),
  sight_word_target integer not null default 0 check (sight_word_target >= 0),
  max_sentence_words smallint not null default 0 check (max_sentence_words >= 0),
  phonics_scope text not null default '',
  reading_complexity text not null default '',
  writing_complexity text not null default '',
  assessment_difficulty smallint not null default 1 check (assessment_difficulty between 1 and 10),
  theme_emoji text not null default '',
  status public.content_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (min_age <= max_age)
);
create unique index levels_sort_order_key on public.levels (sort_order);
create trigger levels_set_updated_at before update on public.levels
for each row execute function public.set_updated_at();

-- Learning areas (Phonics, Vocabulary, Reading, ...). Global, not per level: a unit
-- belongs to one level and one subject.
create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9_]{2,40}$'),
  name text not null check (char_length(name) between 1 and 80),
  description text not null default '',
  emoji text not null default '',
  sort_order integer not null default 0,
  status public.content_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger subjects_set_updated_at before update on public.subjects
for each row execute function public.set_updated_at();

-- What a skill measures, for assessment breakdowns (letter recognition, blending, ...).
create table public.skill_dimensions (
  code text primary key check (code ~ '^[A-Z0-9_]{2,40}$'),
  name text not null,
  description text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

-- Renderable activity/question types. `is_scored` = produces attempts that count toward
-- mastery. The client only renders types it has a renderer for; see
-- src/features/activities/registry.ts.
create table public.activity_types (
  code text primary key check (code ~ '^[A-Z0-9_]{2,40}$'),
  name text not null,
  description text not null default '',
  is_scored boolean not null default true,
  created_at timestamptz not null default now()
);

-- Media. `storage_path` points into Supabase Storage; `tts_text` lets audio fall back to
-- speech synthesis until a recording exists (see src/lib/audio).
create table public.audio_assets (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('word', 'letter', 'phonics', 'sentence', 'instruction', 'story')),
  storage_path text unique,
  tts_text text not null default '',
  locale text not null default 'en-US',
  voice text not null default '',
  duration_ms integer check (duration_ms is null or duration_ms > 0),
  status public.content_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (storage_path is not null or tts_text <> '')
);
create trigger audio_assets_set_updated_at before update on public.audio_assets
for each row execute function public.set_updated_at();

create table public.image_assets (
  id uuid primary key default gen_random_uuid(),
  storage_path text not null unique,
  alt_text text not null check (char_length(alt_text) between 1 and 200),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  license text not null default '',
  source text not null default '',
  status public.content_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger image_assets_set_updated_at before update on public.image_assets
for each row execute function public.set_updated_at();
