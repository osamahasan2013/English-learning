-- Family data: child profiles and everything learned, isolated per child.
--
-- Write model (docs/architecture.md → "Progress pipeline"):
--   * activity_attempts, lesson_runs, assessment_attempts, assessment_results and
--     reward_events are immutable, append-only history. Their ids are generated on the
--     device, so an offline event retried many times is stored exactly once
--     (insert ... on conflict (id) do nothing).
--   * lesson_progress, skill_mastery and word_progress are derived caches recomputed
--     from that history by the server after each sync; they can always be rebuilt.
--   * Only the server (service role) writes progress. Parents can read their own
--     children's progress through RLS but cannot write it directly.

create table public.children (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  avatar text not null default 'fox' check (avatar ~ '^[a-z0-9-]{1,32}$'),
  date_of_birth date check (date_of_birth is null or date_of_birth > date '2000-01-01'),
  -- The school grade the parent selected, and the level the child actually learns at
  -- (they differ after a placement assessment or a parent override).
  grade_level_id uuid not null references public.levels (id),
  current_level_id uuid not null references public.levels (id),
  placement_score numeric(5, 2) check (placement_score is null or placement_score between 0 and 100),
  daily_minutes smallint not null default 15 check (daily_minutes in (10, 15, 20, 30, 45)),
  learning_preferences jsonb not null default '{}'::jsonb check (jsonb_typeof(learning_preferences) = 'object'),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index children_parent_idx on public.children (parent_id) where deleted_at is null;
create trigger children_set_updated_at before update on public.children
for each row execute function public.set_updated_at();

-- One play-through of a lesson. score/star values are computed by the server from the
-- run's first-try attempts, never taken from the client.
create table public.lesson_runs (
  id uuid primary key,
  child_id uuid not null references public.children (id) on delete cascade,
  lesson_id uuid not null references public.lessons (id),
  lesson_version integer not null default 1,
  started_at timestamptz not null,
  completed_at timestamptz not null,
  duration_seconds integer not null check (duration_seconds between 0 and 7200),
  total_questions integer not null check (total_questions >= 0),
  correct_count integer not null check (correct_count >= 0),
  score_percent numeric(5, 2) not null check (score_percent between 0 and 100),
  stars smallint not null check (stars between 0 and 3),
  received_at timestamptz not null default now(),
  check (completed_at >= started_at),
  check (correct_count <= total_questions)
);
create index lesson_runs_child_completed_idx on public.lesson_runs (child_id, completed_at desc);
create index lesson_runs_child_lesson_idx on public.lesson_runs (child_id, lesson_id);

create table public.assessment_attempts (
  id uuid primary key,
  child_id uuid not null references public.children (id) on delete cascade,
  assessment_id uuid not null references public.assessments (id),
  assessment_version integer not null default 1,
  purpose text not null default 'placement' check (purpose in ('placement', 'reassessment', 'skill_check')),
  started_at timestamptz not null,
  completed_at timestamptz,
  received_at timestamptz not null default now()
);
create index assessment_attempts_child_idx on public.assessment_attempts (child_id, started_at desc);

-- Every answer a child gives, in lessons and assessments alike. Carries snapshots of the
-- question version and correct answer so history stays understandable after content edits.
create table public.activity_attempts (
  id uuid primary key,
  child_id uuid not null references public.children (id) on delete cascade,
  question_id uuid not null references public.questions (id),
  question_version integer not null default 1,
  question_type text not null references public.activity_types (code),
  skill_id uuid not null references public.skills (id),
  activity_id uuid references public.activities (id),
  lesson_id uuid references public.lessons (id),
  word_id uuid references public.words (id),
  lesson_run_id uuid,
  assessment_attempt_id uuid references public.assessment_attempts (id) on delete cascade,
  -- 1 = first try (counts toward scores and mastery); 2+ = retries after feedback.
  attempt_number smallint not null default 1 check (attempt_number between 1 and 5),
  response jsonb not null check (jsonb_typeof(response) = 'object'),
  correct_answer jsonb,
  is_correct boolean not null,
  error_type text check (error_type is null or char_length(error_type) <= 40),
  response_time_ms integer not null check (response_time_ms between 0 and 3600000),
  attempted_at timestamptz not null,
  received_at timestamptz not null default now()
);
create index activity_attempts_child_skill_idx on public.activity_attempts (child_id, skill_id, attempted_at desc);
create index activity_attempts_child_time_idx on public.activity_attempts (child_id, attempted_at desc);
create index activity_attempts_child_word_idx on public.activity_attempts (child_id, word_id) where word_id is not null;
create index activity_attempts_run_idx on public.activity_attempts (lesson_run_id) where lesson_run_id is not null;
create index activity_attempts_assessment_idx on public.activity_attempts (assessment_attempt_id) where assessment_attempt_id is not null;

create table public.assessment_results (
  id uuid primary key default gen_random_uuid(),
  assessment_attempt_id uuid not null unique references public.assessment_attempts (id) on delete cascade,
  child_id uuid not null references public.children (id) on delete cascade,
  overall_score numeric(5, 2) not null check (overall_score between 0 and 100),
  dimension_scores jsonb not null default '{}'::jsonb,
  skill_scores jsonb not null default '{}'::jsonb,
  suggested_level_id uuid references public.levels (id),
  created_at timestamptz not null default now()
);
create index assessment_results_child_idx on public.assessment_results (child_id, created_at desc);

create table public.lesson_progress (
  child_id uuid not null references public.children (id) on delete cascade,
  lesson_id uuid not null references public.lessons (id),
  runs_count integer not null default 0,
  best_score numeric(5, 2) not null default 0,
  last_score numeric(5, 2) not null default 0,
  best_stars smallint not null default 0,
  first_completed_at timestamptz,
  last_completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (child_id, lesson_id)
);

create table public.skill_mastery (
  child_id uuid not null references public.children (id) on delete cascade,
  skill_id uuid not null references public.skills (id),
  status public.mastery_status not null default 'NOT_STARTED',
  mastery_score numeric(5, 2) not null default 0 check (mastery_score between 0 and 100),
  accuracy numeric(5, 2) not null default 0 check (accuracy between 0 and 100),
  recent_accuracy numeric(5, 2) not null default 0 check (recent_accuracy between 0 and 100),
  attempts integer not null default 0,
  correct integer not null default 0,
  practice_days integer not null default 0,
  confidence numeric(4, 3) not null default 0 check (confidence between 0 and 1),
  review_priority numeric(6, 2) not null default 0,
  next_review_at timestamptz,
  last_practiced_at timestamptz,
  last_assessed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (child_id, skill_id)
);
create index skill_mastery_review_idx on public.skill_mastery (child_id, review_priority desc);

-- "My Words": words the child met, practised, or saved.
create table public.word_progress (
  child_id uuid not null references public.children (id) on delete cascade,
  word_id uuid not null references public.words (id),
  is_saved boolean not null default false,
  saved_source text check (saved_source is null or saved_source in ('auto', 'manual')),
  attempts_count integer not null default 0,
  correct_count integer not null default 0,
  last_practiced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (child_id, word_id)
);
create index word_progress_saved_idx on public.word_progress (child_id) where is_saved;

create table public.child_achievements (
  child_id uuid not null references public.children (id) on delete cascade,
  achievement_id uuid not null references public.achievements (id),
  earned_at timestamptz not null default now(),
  primary key (child_id, achievement_id)
);

-- Points/stars ledger. One row per rewarding source, so a retried sync never pays twice.
create table public.reward_events (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.children (id) on delete cascade,
  source_type text not null check (source_type in ('lesson_run', 'achievement', 'assessment')),
  source_id uuid not null,
  points integer not null default 0 check (points >= 0),
  stars integer not null default 0 check (stars >= 0),
  created_at timestamptz not null default now(),
  unique (child_id, source_type, source_id)
);
create index reward_events_child_idx on public.reward_events (child_id, created_at desc);
