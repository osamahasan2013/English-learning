-- Phase 3: the data-driven learning engine.
--
--   * Content: skill difficulty + active switch; lesson difficulty, intro audio/speech,
--     thumbnail and lesson-level prerequisites; question explanation, media and
--     metadata; configurable feedback messages and engine rules (mastery bands,
--     prerequisite and review rules) as data.
--   * Answers are no longer readable by signed-in users: the lesson loader reads them
--     with the service role and ships only salted digests to the device (ADR-021).
--   * Progress: attempts carry a score and the learning session they belong to;
--     lesson progress gains a status and answer counts; new derived caches for activity,
--     subject and level progress; learning sessions; an explicit review queue.
--   * lesson_catalog: the LEVEL → SUBJECT → UNIT → SKILL → LESSON path flattened, as a
--     security-invoker view so the caller's RLS still decides what is visible.

-- The updated_at trigger function had a mutable search_path (database advisor warning).
alter function public.set_updated_at() set search_path = '';

create type public.progress_status as enum ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED');

-- ---------------------------------------------------------------------------------------
-- Content

alter table public.skills
  add column difficulty smallint not null default 1 check (difficulty between 1 and 10),
  -- Inactive skills keep their history and stay readable but are left out of
  -- recommendations, review and progress totals.
  add column is_active boolean not null default true;

alter table public.lessons
  add column difficulty smallint not null default 1 check (difficulty between 1 and 10),
  -- Read aloud on the lesson's intro screen (browser TTS unless intro_audio_id is set).
  add column intro_speech text not null default '' check (char_length(intro_speech) <= 400),
  add column intro_audio_id uuid references public.audio_assets (id),
  add column thumbnail_image_id uuid references public.image_assets (id);

create table public.lesson_prerequisites (
  lesson_id uuid not null references public.lessons (id) on delete cascade,
  prerequisite_lesson_id uuid not null references public.lessons (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (lesson_id, prerequisite_lesson_id),
  check (lesson_id <> prerequisite_lesson_id)
);
create index lesson_prerequisites_prerequisite_idx on public.lesson_prerequisites (prerequisite_lesson_id);

alter table public.activities add constraint activities_config_max_tries check (
  case
    when not (config ? 'maxTries') then true
    when jsonb_typeof(config -> 'maxTries') <> 'number' then false
    else (config ->> 'maxTries')::numeric in (1, 2, 3)
  end
);

alter table public.questions
  -- Shown after the child answers: why the answer is right.
  add column explanation text not null default '' check (char_length(explanation) <= 300),
  add column audio_id uuid references public.audio_assets (id),
  add column image_id uuid references public.image_assets (id),
  add column metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object');

-- A scored question cannot be published without an answer specification, whoever writes
-- it (the importer validates the full shape with Zod before this point).
create or replace function public.enforce_publishable_question()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'published' and new.answer is null and exists (
    select 1 from public.activity_types where code = new.question_type and is_scored
  ) then
    raise exception 'QUESTION_NEEDS_ANSWER' using errcode = '23514',
      detail = 'A scored question must have an answer before it is published';
  end if;
  return new;
end;
$$;
create trigger questions_publishable
before insert or update of status, answer, question_type on public.questions
for each row execute function public.enforce_publishable_question();

-- Feedback the lesson player shows and speaks. Kinds are fixed by the engine; the words
-- are content.
create table public.feedback_messages (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9-]{2,80}$'),
  kind text not null check (kind in ('CORRECT', 'INCORRECT', 'TRY_AGAIN', 'ALMOST_CORRECT', 'COMPLETED')),
  text text not null check (char_length(text) between 1 and 120),
  speech text not null default '' check (char_length(speech) <= 200),
  emoji text not null default '',
  sort_order integer not null default 0,
  status public.content_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index feedback_messages_kind_idx on public.feedback_messages (kind, sort_order);
create trigger feedback_messages_set_updated_at before update on public.feedback_messages
for each row execute function public.set_updated_at();

-- Tunable engine rules ('mastery', 'prerequisites', 'review', ...). Each config is
-- validated by its Zod schema in src/lib/learning/rules.ts; missing keys fall back to the
-- defaults there.
create table public.learning_rules (
  code text primary key check (code ~ '^[a-z_]{2,40}$'),
  description text not null default '',
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger learning_rules_set_updated_at before update on public.learning_rules
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------
-- Progress history

-- A stretch of learning on one device (ended by 30 minutes of inactivity). The id is
-- generated on the device and carried by every event; the server derives the totals
-- from the attempts and lesson runs that carry it.
create table public.learning_sessions (
  id uuid primary key,
  child_id uuid not null references public.children (id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  duration_seconds integer not null check (duration_seconds between 0 and 43200),
  lessons_completed integer not null default 0 check (lessons_completed >= 0),
  activities_completed integer not null default 0 check (activities_completed >= 0),
  attempts integer not null default 0 check (attempts >= 0),
  correct_attempts integer not null default 0 check (correct_attempts >= 0),
  score numeric(5, 2) not null default 0 check (score between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ended_at >= started_at),
  check (correct_attempts <= attempts)
);
create index learning_sessions_child_idx on public.learning_sessions (child_id, started_at desc);

alter table public.activity_attempts
  -- 100 = right first time, 50 = right after feedback, 0 = wrong (src/lib/learning/scoring.ts).
  add column score numeric(5, 2) not null default 0 check (score between 0 and 100),
  add column learning_session_id uuid references public.learning_sessions (id) on delete set null;
update public.activity_attempts
set score = case when not is_correct then 0 when attempt_number = 1 then 100 else 50 end;
create index activity_attempts_session_idx on public.activity_attempts (learning_session_id)
  where learning_session_id is not null;
create index activity_attempts_child_lesson_idx on public.activity_attempts (child_id, lesson_id)
  where lesson_id is not null;

alter table public.lesson_runs
  add column learning_session_id uuid references public.learning_sessions (id) on delete set null;
create index lesson_runs_session_idx on public.lesson_runs (learning_session_id)
  where learning_session_id is not null;

-- ---------------------------------------------------------------------------------------
-- Derived progress (recomputed from history by the server; see progress-writer.ts)

alter table public.lesson_progress rename column first_completed_at to completed_at;
alter table public.lesson_progress
  add column status public.progress_status not null default 'IN_PROGRESS',
  add column started_at timestamptz,
  add column attempts integer not null default 0 check (attempts >= 0),
  add column correct_attempts integer not null default 0 check (correct_attempts >= 0),
  add column accuracy numeric(5, 2) not null default 0 check (accuracy between 0 and 100),
  add column activities_total integer not null default 0 check (activities_total >= 0),
  add column activities_completed integer not null default 0 check (activities_completed >= 0),
  add column last_attempt_at timestamptz;
update public.lesson_progress
set status = case when runs_count > 0 then 'COMPLETED'::public.progress_status else 'IN_PROGRESS' end,
    started_at = completed_at;

alter table public.skill_mastery rename column correct to correct_attempts;

create table public.activity_progress (
  child_id uuid not null references public.children (id) on delete cascade,
  activity_id uuid not null references public.activities (id),
  lesson_id uuid not null references public.lessons (id),
  status public.progress_status not null default 'IN_PROGRESS',
  questions_total integer not null default 0 check (questions_total >= 0),
  questions_answered integer not null default 0 check (questions_answered >= 0),
  attempts integer not null default 0 check (attempts >= 0),
  correct_attempts integer not null default 0 check (correct_attempts >= 0),
  accuracy numeric(5, 2) not null default 0 check (accuracy between 0 and 100),
  score numeric(5, 2) not null default 0 check (score between 0 and 100),
  started_at timestamptz,
  last_attempt_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (child_id, activity_id)
);
create index activity_progress_lesson_idx on public.activity_progress (child_id, lesson_id);

-- Progress in one subject at one level (the LEVEL → SUBJECT step of the hierarchy).
create table public.subject_progress (
  child_id uuid not null references public.children (id) on delete cascade,
  level_id uuid not null references public.levels (id),
  subject_id uuid not null references public.subjects (id),
  status public.progress_status not null default 'NOT_STARTED',
  lessons_total integer not null default 0 check (lessons_total >= 0),
  lessons_completed integer not null default 0 check (lessons_completed >= 0),
  attempts integer not null default 0 check (attempts >= 0),
  correct_attempts integer not null default 0 check (correct_attempts >= 0),
  accuracy numeric(5, 2) not null default 0 check (accuracy between 0 and 100),
  score numeric(5, 2) not null default 0 check (score between 0 and 100),
  started_at timestamptz,
  last_attempt_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (child_id, level_id, subject_id)
);

create table public.level_progress (
  child_id uuid not null references public.children (id) on delete cascade,
  level_id uuid not null references public.levels (id),
  status public.progress_status not null default 'NOT_STARTED',
  lessons_total integer not null default 0 check (lessons_total >= 0),
  lessons_completed integer not null default 0 check (lessons_completed >= 0),
  skills_total integer not null default 0 check (skills_total >= 0),
  skills_mastered integer not null default 0 check (skills_mastered >= 0),
  attempts integer not null default 0 check (attempts >= 0),
  correct_attempts integer not null default 0 check (correct_attempts >= 0),
  accuracy numeric(5, 2) not null default 0 check (accuracy between 0 and 100),
  score numeric(5, 2) not null default 0 check (score between 0 and 100),
  started_at timestamptz,
  last_attempt_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (child_id, level_id)
);

-- What to practise again, and why. One open row per item (`item_key` = 'skill:<id>' or
-- 'word:<id>'); rows are resolved, not deleted, when the item no longer needs review.
create table public.review_items (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.children (id) on delete cascade,
  item_key text not null check (item_key ~ '^(skill|word|pattern|lesson):[0-9a-f-]{36}$'),
  skill_id uuid references public.skills (id),
  word_id uuid references public.words (id),
  phonics_pattern_id uuid references public.phonics_patterns (id),
  lesson_id uuid references public.lessons (id),
  priority numeric(6, 2) not null default 0,
  due_at timestamptz not null,
  reason text not null check (reason in ('weak_skill', 'due_review', 'recent_errors', 'missed_word')),
  status text not null default 'open' check (status in ('open', 'done')),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (child_id, item_key),
  check (num_nonnulls(skill_id, word_id, phonics_pattern_id, lesson_id) > 0)
);
create index review_items_open_idx on public.review_items (child_id, priority desc) where status = 'open';

-- ---------------------------------------------------------------------------------------
-- The hierarchy, flattened. security_invoker: every base table's RLS applies to the
-- caller, so a published lesson under a draft unit is not visible to families.
create view public.lesson_catalog with (security_invoker = true) as
select
  l.id as lesson_id,
  l.code as lesson_code,
  l.title as lesson_title,
  l.child_title as lesson_child_title,
  l.description as lesson_description,
  l.emoji as lesson_emoji,
  l.difficulty as lesson_difficulty,
  l.estimated_minutes,
  l.sort_order as lesson_order,
  s.id as skill_id,
  s.code as skill_code,
  s.title as skill_title,
  s.child_title as skill_child_title,
  s.sort_order as skill_order,
  s.is_active as skill_active,
  s.importance as skill_importance,
  u.id as unit_id,
  u.title as unit_title,
  u.emoji as unit_emoji,
  u.sort_order as unit_order,
  sub.id as subject_id,
  sub.code as subject_code,
  sub.name as subject_name,
  sub.emoji as subject_emoji,
  sub.sort_order as subject_order,
  lv.id as level_id,
  lv.code as level_code,
  lv.name as level_name,
  lv.sort_order as level_order
from public.lessons l
join public.skills s on s.id = l.skill_id
join public.units u on u.id = s.unit_id
join public.subjects sub on sub.id = u.subject_id
join public.levels lv on lv.id = u.level_id
where l.status = 'published' and s.status = 'published' and u.status = 'published'
  and sub.status = 'published' and lv.status = 'published';

-- ---------------------------------------------------------------------------------------
-- Security

revoke all on public.lesson_prerequisites, public.feedback_messages, public.learning_rules,
  public.learning_sessions, public.activity_progress, public.subject_progress,
  public.level_progress, public.review_items, public.lesson_catalog
  from anon, authenticated;
grant all on public.lesson_prerequisites, public.feedback_messages, public.learning_rules,
  public.learning_sessions, public.activity_progress, public.subject_progress,
  public.level_progress, public.review_items
  to service_role;
grant select on public.lesson_catalog to authenticated, service_role;
revoke all on function public.enforce_publishable_question() from public, anon, authenticated;

-- Content with a status: published for everyone signed in, everything for admins.
alter table public.feedback_messages enable row level security;
create policy feedback_messages_read on public.feedback_messages for select to authenticated
  using (status = 'published' or (select public.is_admin()));
create policy feedback_messages_admin_write on public.feedback_messages for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
grant select, insert, update, delete on public.feedback_messages to authenticated;

-- Content without a status of its own.
do $$
declare
  t text;
begin
  foreach t in array array['lesson_prerequisites', 'learning_rules']
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

-- Progress: read-only for the owning parent; written by the server only.
do $$
declare
  t text;
begin
  foreach t in array array[
    'learning_sessions', 'activity_progress', 'subject_progress', 'level_progress', 'review_items'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select public.is_my_child(child_id)))',
      t || '_parent_read', t
    );
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end
$$;

-- Correct answers stay on the server until a child has answered: every column of
-- questions except `answer` is readable by signed-in users (admins included; content
-- tooling uses the service role). RLS still limits rows to published questions.
revoke select on public.questions from authenticated;
grant select (
  id, code, activity_id, skill_id, question_type, prompt, prompt_speech, content, word_id,
  sentence_id, phonics_pattern_id, story_id, difficulty, sort_order, version, status,
  created_at, updated_at, explanation, audio_id, image_id, metadata
) on public.questions to authenticated;
