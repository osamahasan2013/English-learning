-- Phase 7: the reading engine, built on the story table, the word bank, the phonics data and
-- the learning engine. It adds no lesson, activity, attempt, mastery, review or assessment
-- system of its own: reading lessons are ordinary lessons (built from a story by the
-- `reading` lesson blueprint), comprehension answers are ordinary attempts on ordinary
-- skills, and difficult words go into the ordinary review queue.
--
--   * reading_skill_types / reading_content_types: extensible lists (SEQUENCING, MAIN_IDEA…;
--     SHORT_STORY, POEM, DIALOGUE…). A skill of the curriculum is tagged with the reading
--     skill it teaches (skills.reading_skill_code), so mastery stays per ordinary skill.
--   * stories gain the metadata of a reading text (type, genre, topic, reading level,
--     estimated time, image and recording, tags) and the importer's analysis of it (text
--     statistics, decodability, words outside the word bank).
--   * story_words: which word-bank words a story uses, with the decodability view of each
--     (decodable with the patterns taught so far, sight word, irregular, a target pattern,
--     a focus vocabulary word). The word itself stays in words / word_segments.
--   * story_phonics_patterns / story_reading_skills: what a story practises.
--   * reading_sessions: raw history of reading a text (time on the text, listens, re-reads,
--     words tapped for help, the child's own "how was it?"). Reading a text is not a
--     question answer (activity_attempts.is_correct is required), so it gets its own
--     append-only table. It is never scored: no words-per-minute or pronunciation claims.
--   * Review queue: words a child keeps tapping for help while reading (reading:<word id>).

-- ---------------------------------------------------------------------------------------
-- Lookups

create table public.reading_skill_types (
  code text primary key check (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  name text not null check (char_length(name) between 1 and 80),
  child_name text not null default '' check (char_length(child_name) <= 80),
  description text not null default '' check (char_length(description) <= 400),
  -- The first level (rank 1 = KG1) at which the skill may be taught; enforced by the
  -- importer so inference or summarising never appears in KG1/KG2 content.
  min_level_rank smallint not null check (min_level_rank between 1 and 10),
  -- word: recognising and decoding; text: reading connected text; comprehension.
  strand text not null check (strand in ('word', 'text', 'comprehension')),
  emoji text not null default '',
  sort_order integer not null default 0,
  status public.content_status not null default 'published',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger reading_skill_types_set_updated_at before update on public.reading_skill_types
for each row execute function public.set_updated_at();

create table public.reading_content_types (
  code text primary key check (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  name text not null check (char_length(name) between 1 and 80),
  child_name text not null default '' check (char_length(child_name) <= 80),
  description text not null default '' check (char_length(description) <= 400),
  min_level_rank smallint not null default 1 check (min_level_rank between 1 and 10),
  emoji text not null default '',
  sort_order integer not null default 0,
  status public.content_status not null default 'published',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger reading_content_types_set_updated_at before update on public.reading_content_types
for each row execute function public.set_updated_at();

alter table public.skills
  add column reading_skill_code text references public.reading_skill_types (code);
create index skills_reading_skill_idx on public.skills (reading_skill_code) where reading_skill_code is not null;

-- ---------------------------------------------------------------------------------------
-- Reading texts (stories) — extended, not duplicated

alter table public.stories
  add column content_type_code text references public.reading_content_types (code),
  add column normalized_title text not null default '' check (char_length(normalized_title) <= 120),
  add column genre text not null default '' check (char_length(genre) <= 40),
  add column topic text not null default '' check (char_length(topic) <= 60),
  -- A finer band than the level (1 = first texts of KG1 … 20 = end of Grade 2), authored.
  add column reading_level smallint check (reading_level is null or reading_level between 1 and 20),
  add column estimated_seconds integer check (estimated_seconds is null or estimated_seconds between 10 and 3600),
  add column image_asset_id uuid references public.image_assets (id),
  add column audio_asset_id uuid references public.audio_assets (id),
  add column tags text[] not null default '{}',
  -- Computed by the importer: { paragraphs, sentences, words, uniqueWords,
  -- avgSentenceLength, longestSentence, decodable, sight, irregular, unknown }.
  add column text_stats jsonb not null default '{}'::jsonb check (jsonb_typeof(text_stats) = 'object'),
  -- Share of running words decodable with the patterns taught up to the story's level, or
  -- known sight words (0–100).
  add column decodable_pct numeric(5, 2) check (decodable_pct is null or decodable_pct between 0 and 100),
  -- Words in the text that are not in the word bank (reviewed by admins; never silently
  -- added to the bank).
  add column unknown_words text[] not null default '{}';

update public.stories set normalized_title = lower(regexp_replace(trim(title), '\s+', ' ', 'g'));
-- One text per title per level: the importer reports a duplicate instead of a second copy.
create unique index stories_level_title_idx on public.stories (level_id, normalized_title)
  where normalized_title <> '';
create index stories_type_idx on public.stories (content_type_code, level_id);

create table public.story_words (
  story_id uuid not null references public.stories (id) on delete cascade,
  word_id uuid not null references public.words (id) on delete cascade,
  occurrences smallint not null default 1 check (occurrences between 1 and 500),
  -- Running-word index of the first occurrence (0-based).
  first_position smallint not null default 0 check (first_position >= 0),
  is_decodable boolean not null default false,
  is_sight boolean not null default false,
  is_irregular boolean not null default false,
  -- Uses one of the story's target phonics patterns.
  is_target_pattern boolean not null default false,
  -- A focus vocabulary word taught before reading.
  is_focus boolean not null default false,
  primary key (story_id, word_id)
);
create index story_words_word_idx on public.story_words (word_id);

create table public.story_phonics_patterns (
  story_id uuid not null references public.stories (id) on delete cascade,
  pattern_id uuid not null references public.phonics_patterns (id) on delete cascade,
  primary key (story_id, pattern_id)
);
create index story_phonics_patterns_pattern_idx on public.story_phonics_patterns (pattern_id);

create table public.story_reading_skills (
  story_id uuid not null references public.stories (id) on delete cascade,
  reading_skill_code text not null references public.reading_skill_types (code) on delete cascade,
  primary key (story_id, reading_skill_code)
);
create index story_reading_skills_skill_idx on public.story_reading_skills (reading_skill_code);

-- ---------------------------------------------------------------------------------------
-- Reading history: device-generated ids, stored once, written by the server only.

create table public.reading_sessions (
  id uuid primary key,
  child_id uuid not null references public.children (id) on delete cascade,
  story_id uuid not null references public.stories (id),
  lesson_id uuid references public.lessons (id),
  -- The lesson run the reading happened in (device id; the run may arrive later).
  lesson_run_id uuid,
  question_id uuid references public.questions (id),
  learning_session_id uuid references public.learning_sessions (id) on delete set null,
  -- listen_first: heard it read, then read it; read_first: read it, audio on request;
  -- reread: a second reading of the same text.
  mode text not null check (mode in ('listen_first', 'read_first', 'reread')),
  started_at timestamptz not null,
  -- Time the text was on screen, capped (a child who walks away is not "reading").
  duration_ms integer not null check (duration_ms between 0 and 3600000),
  -- From the story (server-side), not from the device.
  word_count integer not null check (word_count >= 0),
  listens smallint not null default 0 check (listens between 0 and 100),
  slow_listens smallint not null default 0 check (slow_listens between 0 and 100),
  rereads smallint not null default 0 check (rereads between 0 and 20),
  -- Word-bank words of this story the child tapped to hear (server-filtered to the story).
  help_word_ids uuid[] not null default '{}',
  self_check text check (self_check is null or self_check in ('easy', 'ok', 'hard')),
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (cardinality(help_word_ids) <= 100)
);
create index reading_sessions_child_idx on public.reading_sessions (child_id, started_at desc);
create index reading_sessions_child_story_idx on public.reading_sessions (child_id, story_id);
create index reading_sessions_session_idx on public.reading_sessions (learning_session_id)
  where learning_session_id is not null;

-- ---------------------------------------------------------------------------------------
-- Review queue and content flags

alter table public.review_items drop constraint review_items_item_key_check;
alter table public.review_items add constraint review_items_item_key_check
  check (item_key ~ '^(skill|word|pattern|lesson|spelling|reading):[0-9a-f-]{36}$');
alter table public.review_items drop constraint review_items_reason_check;
alter table public.review_items add constraint review_items_reason_check check (reason in (
  'weak_skill', 'due_review', 'recent_errors', 'missed_word', 'weak_word',
  'missed_spelling', 'weak_spelling', 'spelling_pattern', 'reading_word'
));

alter table public.content_flags drop constraint content_flags_entity_check;
alter table public.content_flags add constraint content_flags_entity_check
  check (entity in ('word', 'phonics_pattern', 'question', 'lesson', 'sentence', 'spelling_word', 'story'));

-- ---------------------------------------------------------------------------------------
-- Security

revoke all on public.reading_skill_types, public.reading_content_types, public.story_words,
  public.story_phonics_patterns, public.story_reading_skills, public.reading_sessions
  from anon, authenticated;
grant all on public.reading_skill_types, public.reading_content_types, public.story_words,
  public.story_phonics_patterns, public.story_reading_skills, public.reading_sessions
  to service_role;

do $$
declare
  t text;
begin
  foreach t in array array['reading_skill_types', 'reading_content_types'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select public.is_admin()) or status = ''published'')',
      t || '_read', t
    );
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()))',
      t || '_admin_write', t
    );
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end
$$;

-- A story's links are visible to families only when the story (and the linked row) is
-- published, like sentence_words.
alter table public.story_words enable row level security;
create policy story_words_read on public.story_words for select to authenticated
  using (
    (select public.is_admin())
    or (
      exists (select 1 from public.stories s where s.id = story_id and s.status = 'published')
      and exists (select 1 from public.words w where w.id = word_id and w.status = 'published')
    )
  );
create policy story_words_admin_write on public.story_words for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
grant select, insert, update, delete on public.story_words to authenticated;

alter table public.story_phonics_patterns enable row level security;
create policy story_phonics_patterns_read on public.story_phonics_patterns for select to authenticated
  using (
    (select public.is_admin())
    or (
      exists (select 1 from public.stories s where s.id = story_id and s.status = 'published')
      and exists (select 1 from public.phonics_patterns p where p.id = pattern_id and p.status = 'published')
    )
  );
create policy story_phonics_patterns_admin_write on public.story_phonics_patterns for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
grant select, insert, update, delete on public.story_phonics_patterns to authenticated;

alter table public.story_reading_skills enable row level security;
create policy story_reading_skills_read on public.story_reading_skills for select to authenticated
  using (
    (select public.is_admin())
    or exists (select 1 from public.stories s where s.id = story_id and s.status = 'published')
  );
create policy story_reading_skills_admin_write on public.story_reading_skills for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
grant select, insert, update, delete on public.story_reading_skills to authenticated;

-- Reading history: read-only for the owning parent, like all progress.
alter table public.reading_sessions enable row level security;
create policy reading_sessions_parent_read on public.reading_sessions for select to authenticated
  using ((select public.is_my_child(child_id)));
grant select on public.reading_sessions to authenticated;
