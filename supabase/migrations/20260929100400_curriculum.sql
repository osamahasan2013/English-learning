-- Curriculum hierarchy: LEVEL → SUBJECT → UNIT → SKILL → LESSON → ACTIVITY → QUESTION,
-- plus assessments (which reuse questions) and achievement definitions.
--
-- Questions are self-describing: `question_type` picks the renderer, `content` holds the
-- type-specific display data and `answer` the answer specification, both validated by
-- the Zod schemas in src/lib/content/question-schemas.ts on import and on load. This
-- replaces a separate `answers` table (see docs/decisions.md, ADR-004).

create table public.units (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9-]{2,80}$'),
  level_id uuid not null references public.levels (id),
  subject_id uuid not null references public.subjects (id),
  title text not null check (char_length(title) between 1 and 120),
  description text not null default '',
  emoji text not null default '',
  sort_order integer not null default 0,
  status public.content_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index units_level_subject_idx on public.units (level_id, subject_id, sort_order);
create trigger units_set_updated_at before update on public.units
for each row execute function public.set_updated_at();

create table public.skills (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9-]{2,80}$'),
  unit_id uuid not null references public.units (id),
  dimension_code text not null references public.skill_dimensions (code),
  title text not null check (char_length(title) between 1 and 120),
  child_title text not null default '',
  description text not null default '',
  phonics_pattern_id uuid references public.phonics_patterns (id),
  mastery_threshold smallint not null default 90 check (mastery_threshold between 50 and 100),
  -- 1..5; weights review priority so core skills resurface sooner.
  importance smallint not null default 3 check (importance between 1 and 5),
  sort_order integer not null default 0,
  status public.content_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index skills_unit_idx on public.skills (unit_id, sort_order);
create index skills_pattern_idx on public.skills (phonics_pattern_id);
create trigger skills_set_updated_at before update on public.skills
for each row execute function public.set_updated_at();

create table public.skill_prerequisites (
  skill_id uuid not null references public.skills (id) on delete cascade,
  prerequisite_skill_id uuid not null references public.skills (id) on delete cascade,
  primary key (skill_id, prerequisite_skill_id),
  check (skill_id <> prerequisite_skill_id)
);

create table public.lessons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9-]{2,80}$'),
  skill_id uuid not null references public.skills (id),
  title text not null check (char_length(title) between 1 and 120),
  child_title text not null default '',
  description text not null default '',
  emoji text not null default '',
  sort_order integer not null default 0,
  estimated_minutes smallint not null default 5 check (estimated_minutes between 1 and 60),
  version integer not null default 1 check (version > 0),
  status public.content_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index lessons_skill_idx on public.lessons (skill_id, sort_order);
create trigger lessons_set_updated_at before update on public.lessons
for each row execute function public.set_updated_at();

create table public.activities (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9-]{2,100}$'),
  lesson_id uuid not null references public.lessons (id),
  activity_type text not null references public.activity_types (code),
  -- Explanation → Demonstration → Guided → Independent → Review (docs/curriculum.md).
  stage text not null check (stage in ('explanation', 'demonstration', 'guided_practice', 'independent_practice', 'review')),
  title text not null check (char_length(title) between 1 and 120),
  instructions text not null default '',
  instructions_speech text not null default '',
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  sort_order integer not null default 0,
  version integer not null default 1 check (version > 0),
  status public.content_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index activities_lesson_idx on public.activities (lesson_id, sort_order);
create trigger activities_set_updated_at before update on public.activities
for each row execute function public.set_updated_at();

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9-]{2,120}$'),
  -- Null for questions that exist only inside assessments.
  activity_id uuid references public.activities (id),
  skill_id uuid not null references public.skills (id),
  question_type text not null references public.activity_types (code),
  prompt text not null default '' check (char_length(prompt) <= 300),
  prompt_speech text not null default '' check (char_length(prompt_speech) <= 300),
  content jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object'),
  -- Null only for unscored types (INTRO). See src/lib/learning/evaluate.ts.
  answer jsonb check (answer is null or jsonb_typeof(answer) = 'object'),
  word_id uuid references public.words (id),
  sentence_id uuid references public.sentences (id),
  phonics_pattern_id uuid references public.phonics_patterns (id),
  story_id uuid references public.stories (id),
  difficulty smallint not null default 1 check (difficulty between 1 and 10),
  sort_order integer not null default 0,
  version integer not null default 1 check (version > 0),
  status public.content_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index questions_activity_idx on public.questions (activity_id, sort_order);
create index questions_skill_idx on public.questions (skill_id);
create index questions_word_idx on public.questions (word_id);
create index questions_story_idx on public.questions (story_id);
create trigger questions_set_updated_at before update on public.questions
for each row execute function public.set_updated_at();

create table public.assessments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9-]{2,80}$'),
  title text not null check (char_length(title) between 1 and 120),
  description text not null default '',
  assessment_type text not null check (assessment_type in ('placement', 'level_check', 'skill_check')),
  level_id uuid references public.levels (id),
  -- Scoring rules, e.g. stage pass thresholds and the level each stage maps to
  -- (see src/lib/learning/placement.ts).
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  version integer not null default 1 check (version > 0),
  status public.content_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger assessments_set_updated_at before update on public.assessments
for each row execute function public.set_updated_at();

create table public.assessment_items (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.assessments (id) on delete cascade,
  question_id uuid not null references public.questions (id),
  -- Placement stages run in order (letters → sounds → CVC → ...); a stage is only
  -- reached if the previous one was passed.
  stage smallint not null default 1 check (stage between 1 and 20),
  stage_label text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (assessment_id, question_id)
);
create index assessment_items_assessment_idx on public.assessment_items (assessment_id, stage, sort_order);

-- Achievement definitions. `criteria` = {"type": "lessons_completed" | "stars_earned" |
-- "streak_days" | "words_learned", "threshold": n}; evaluated by
-- src/lib/learning/achievements.ts.
create table public.achievements (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9-]{2,80}$'),
  title text not null,
  description text not null default '',
  emoji text not null default '',
  criteria jsonb not null check (jsonb_typeof(criteria) = 'object'),
  sort_order integer not null default 0,
  status public.content_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger achievements_set_updated_at before update on public.achievements
for each row execute function public.set_updated_at();
