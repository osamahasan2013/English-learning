-- Phase 6: the spelling engine, built on the word bank, the phonics data and the learning
-- engine. It adds no lesson, activity, attempt, mastery, review or assessment system of its
-- own: spelling lessons are ordinary lessons, spelling answers are ordinary attempts, spelling
-- skills are ordinary skills and spelling review items live in the ordinary review queue.
--
--   * spelling_types: an extensible list (CVC, DIGRAPH, VOWEL_TEAM, HIGH_FREQUENCY, ...).
--   * spelling_words: which words of the word bank are spelling targets, with the spelling
--     view of them (spelling level and skill, focus pattern, type, difficulty, the irregular
--     part, hints, common errors, a dictation sentence, an optional recording). The word
--     itself — text, grapheme split, phonemes, syllables, meaning — stays in words /
--     word_segments and is never copied. Not every vocabulary word is a spelling target.
--   * activity_attempts gains what a spelling answer needs on top of the shared columns:
--     hints used, the server's spelling analysis (normalised answer, letter diff, error
--     category) and the phonics pattern the mistake was in (ship → sip: SH).
--   * spelling_progress: per child × word spelling mastery (the mastery algorithm with the
--     spelling rule set), kept apart from vocabulary word mastery (word_progress).
--   * Review queue: spelling items per word (spelling:<word id>) and per phonics pattern a
--     child keeps misspelling (pattern:<pattern id>).
--   * feedback_messages can be specific to an error category ("Two letters make that sound").

-- ---------------------------------------------------------------------------------------
-- Spelling types (lookup, like activity_types)

create table public.spelling_types (
  code text primary key check (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  name text not null check (char_length(name) between 1 and 80),
  child_name text not null default '' check (char_length(child_name) <= 80),
  description text not null default '' check (char_length(description) <= 400),
  emoji text not null default '',
  sort_order integer not null default 0,
  status public.content_status not null default 'published',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger spelling_types_set_updated_at before update on public.spelling_types
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------
-- Spelling targets (the spelling view of a word)

create table public.spelling_words (
  id uuid primary key default gen_random_uuid(),
  word_id uuid not null unique references public.words (id),
  -- The level at which the word is a spelling target (may be later than the level that
  -- introduces it as vocabulary: "elephant" is heard in KG1, spelled in Grade 2).
  level_id uuid not null references public.levels (id),
  skill_id uuid references public.skills (id),
  spelling_type_code text not null references public.spelling_types (code),
  -- The phonics pattern the word practises when spelled (SH for ship).
  phonics_pattern_id uuid references public.phonics_patterns (id),
  difficulty smallint not null check (difficulty between 1 and 10),
  is_high_frequency boolean not null default false,
  -- The spelling cannot be built from the sound-spellings taught so far. Modelled as a
  -- regular word plus its irregular part: the grapheme(s) that break the rule ("ai" in
  -- said) and their positions in the word's grapheme split.
  is_irregular boolean not null default false,
  irregular_part text not null default '' check (irregular_part ~ '^[a-z]{0,8}$'),
  irregular_positions smallint[] not null default '{}',
  -- Progressive hints authored for this word (the templates add generated ones).
  hints jsonb not null default '[]'::jsonb check (jsonb_typeof(hints) = 'array'),
  -- Typical misspellings, for authoring and parent explanations: [{"spelling":"sip"}].
  common_errors jsonb not null default '[]'::jsonb check (jsonb_typeof(common_errors) = 'array'),
  -- A dictation / "use it" sentence (a row of the sentence bank); default the word's example.
  sentence_id uuid references public.sentences (id),
  -- A recording for dictation; default the word's own recording, then speech synthesis.
  audio_asset_id uuid references public.audio_assets (id),
  tags text[] not null default '{}',
  sort_order integer not null default 0,
  status public.content_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (is_irregular or irregular_part = '')
);
create index spelling_words_level_type_idx on public.spelling_words (level_id, spelling_type_code, sort_order);
create index spelling_words_skill_idx on public.spelling_words (skill_id);
create index spelling_words_pattern_idx on public.spelling_words (phonics_pattern_id);
create index spelling_words_status_level_idx on public.spelling_words (status, level_id, difficulty);
create trigger spelling_words_set_updated_at before update on public.spelling_words
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------
-- Spelling answers: ordinary attempts with a few more facts. All server-written.

alter table public.activity_attempts
  -- Hints the child opened before this answer (reported by the device; never affects
  -- correctness, but a hinted answer is not independent spelling evidence).
  add column hints_used smallint not null default 0 check (hints_used between 0 and 5),
  -- Computed by the server from the stored answer: { normalized, exact, distance, ops,
  -- category, focus, words? }. The child's own text stays in `response`, unchanged.
  add column spelling_analysis jsonb check (spelling_analysis is null or jsonb_typeof(spelling_analysis) = 'object'),
  -- The phonics pattern the mistake was in (ship → sip: SH), for pattern review.
  add column error_pattern_id uuid references public.phonics_patterns (id);
create index activity_attempts_child_error_pattern_idx
  on public.activity_attempts (child_id, error_pattern_id, attempted_at desc)
  where error_pattern_id is not null;
create index activity_attempts_child_spelling_idx
  on public.activity_attempts (child_id, attempted_at desc)
  where spelling_analysis is not null;

-- ---------------------------------------------------------------------------------------
-- Spelling progress: derived, written by the server only.

create table public.spelling_progress (
  child_id uuid not null references public.children (id) on delete cascade,
  word_id uuid not null references public.words (id),
  attempts_count integer not null default 0 check (attempts_count >= 0),
  -- Right on the first try without a hint.
  correct_count integer not null default 0 check (correct_count between 0 and attempts_count),
  -- Right on the first try with a hint (not counted as independent spelling).
  hinted_count integer not null default 0 check (hinted_count between 0 and attempts_count),
  accuracy numeric(5, 2) not null default 0 check (accuracy between 0 and 100),
  status public.mastery_status not null default 'NOT_STARTED',
  mastery_score numeric(5, 2) not null default 0 check (mastery_score between 0 and 100),
  practice_days integer not null default 0 check (practice_days >= 0),
  review_priority numeric(6, 2) not null default 0,
  next_review_at timestamptz,
  first_practiced_at timestamptz,
  last_practiced_at timestamptz,
  last_error_type text check (last_error_type is null or char_length(last_error_type) <= 40),
  -- Error category → count over all first tries.
  error_counts jsonb not null default '{}'::jsonb check (jsonb_typeof(error_counts) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (child_id, word_id)
);
create index spelling_progress_status_idx on public.spelling_progress (child_id, status);
create index spelling_progress_review_idx on public.spelling_progress (child_id, review_priority desc);
create index spelling_progress_recent_idx on public.spelling_progress (child_id, last_practiced_at desc);

-- ---------------------------------------------------------------------------------------
-- Review queue: spelling items and pattern items.

alter table public.review_items drop constraint review_items_item_key_check;
alter table public.review_items add constraint review_items_item_key_check
  check (item_key ~ '^(skill|word|pattern|lesson|spelling):[0-9a-f-]{36}$');
alter table public.review_items drop constraint review_items_reason_check;
alter table public.review_items add constraint review_items_reason_check check (reason in (
  'weak_skill', 'due_review', 'recent_errors', 'missed_word', 'weak_word',
  'missed_spelling', 'weak_spelling', 'spelling_pattern'
));

-- Doubtful spelling targets are flagged for admin review like other content (ADR-026).
alter table public.content_flags drop constraint content_flags_entity_check;
alter table public.content_flags add constraint content_flags_entity_check
  check (entity in ('word', 'phonics_pattern', 'question', 'lesson', 'sentence', 'spelling_word'));

-- ---------------------------------------------------------------------------------------
-- Feedback for a specific spelling error category.

alter table public.feedback_messages
  add column error_category text check (error_category is null or error_category ~ '^[A-Z_]{2,40}$');
create index feedback_messages_error_idx on public.feedback_messages (error_category) where error_category is not null;

-- ---------------------------------------------------------------------------------------
-- Analytics, counted in the database. security_invoker: the caller's RLS (and column
-- grants) on activity_attempts apply, so a parent only ever counts their own children.

create view public.spelling_error_counts with (security_invoker = true) as
select child_id, error_type, count(*)::integer as attempts, max(attempted_at) as last_attempt_at
from public.activity_attempts
where spelling_analysis is not null and error_type is not null and attempt_number = 1
group by child_id, error_type;

create view public.spelling_pattern_errors with (security_invoker = true) as
select child_id, error_pattern_id, count(*)::integer as attempts, max(attempted_at) as last_attempt_at
from public.activity_attempts
where error_pattern_id is not null and attempt_number = 1
group by child_id, error_pattern_id;

-- ---------------------------------------------------------------------------------------
-- Security

revoke all on public.spelling_types, public.spelling_words, public.spelling_progress from anon, authenticated;
grant all on public.spelling_types, public.spelling_words, public.spelling_progress to service_role;
revoke all on public.spelling_error_counts, public.spelling_pattern_errors from anon, authenticated;
grant select on public.spelling_error_counts, public.spelling_pattern_errors to authenticated;

-- The new attempt columns are readable by the owning parent like the rest of the row
-- (the answer snapshot correct_answer stays hidden, ADR-028).
grant select (hints_used, spelling_analysis, error_pattern_id) on public.activity_attempts to authenticated;

alter table public.spelling_types enable row level security;
create policy spelling_types_read on public.spelling_types for select to authenticated
  using ((select public.is_admin()) or status = 'published');
create policy spelling_types_admin_write on public.spelling_types for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
grant select, insert, update, delete on public.spelling_types to authenticated;

-- A spelling target is visible to families only when it and its word are published.
alter table public.spelling_words enable row level security;
create policy spelling_words_read on public.spelling_words for select to authenticated
  using (
    (select public.is_admin())
    or (
      status = 'published'
      and exists (select 1 from public.words w where w.id = word_id and w.status = 'published')
    )
  );
create policy spelling_words_admin_write on public.spelling_words for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
grant select, insert, update, delete on public.spelling_words to authenticated;

-- Spelling progress: read-only for the owning parent, like all progress.
alter table public.spelling_progress enable row level security;
create policy spelling_progress_parent_read on public.spelling_progress for select to authenticated
  using ((select public.is_my_child(child_id)));
grant select on public.spelling_progress to authenticated;
