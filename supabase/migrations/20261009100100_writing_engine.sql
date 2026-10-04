-- Phase 8: the writing engine, built on the learning engine, the word bank, the phonics data
-- and the story library. It adds no lesson, activity, attempt, mastery, review or audio
-- system of its own: writing lessons are ordinary lessons, a written answer is an ordinary
-- activity_attempts row (the child's text or strokes are kept as typed/drawn in `response`),
-- mastery is ordinary skill_mastery and review items go into the ordinary queue.
--
--   * writing_skill_types: an extensible list (LETTER_FORMATION, SENTENCE_WRITING, EDITING…)
--     with the first and last level each skill belongs to. A curriculum skill is tagged with
--     the writing skill it teaches (skills.writing_skill_code), as reading skills are.
--   * handwriting_glyphs: reference handwriting for tracing and letter writing — the
--     character, its case and script, ordered strokes (point paths in a 0–100 box, the
--     first point of each stroke is its start, point order is its direction), guide lines,
--     tolerance and completion threshold. Stroke data lives here, never in components.
--     A question names the glyph it practises (questions.glyph_id).
--   * writing_rubrics: reusable, level-aware rubric definitions for open-ended writing
--     (criteria with a dimension, a weight and whether they are critical). The importer
--     copies the resolved rubric into each question's server-only answer, so evaluation is
--     a pure function of the question and the response.
--   * activity_attempts.writing_analysis: the server's evaluation of a written answer
--     (mechanics found, rubric criteria met, tracing coverage, stroke order and direction),
--     kept for the parent report and future handwriting analytics.
--   * Review queue: letters a child keeps forming wrongly (writing:<glyph id>). Words come
--     back through spelling review and weak writing skills through skill review.

-- ---------------------------------------------------------------------------------------
-- Writing skills

create table public.writing_skill_types (
  code text primary key check (code ~ '^[A-Z][A-Z0-9_]{1,39}$'),
  name text not null check (char_length(name) between 1 and 80),
  child_name text not null default '' check (char_length(child_name) <= 80),
  description text not null default '' check (char_length(description) <= 400),
  -- handwriting: tracing and forming letters; word: writing and spelling words; sentence:
  -- building and writing sentences; mechanics: capitals, spaces, punctuation; composition:
  -- guided, story, descriptive, informational and paragraph writing; editing.
  strand text not null check (strand in ('handwriting', 'word', 'sentence', 'mechanics', 'composition', 'editing')),
  -- First and last level (rank 1 = KG1 … 5 = Grade 2) the skill is taught at; the importer
  -- refuses content outside the range (no paragraph writing in KG1).
  min_level_rank smallint not null check (min_level_rank between 1 and 10),
  max_level_rank smallint not null check (max_level_rank between 1 and 10),
  emoji text not null default '',
  sort_order integer not null default 0,
  status public.content_status not null default 'published',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (min_level_rank <= max_level_rank)
);
create trigger writing_skill_types_set_updated_at before update on public.writing_skill_types
for each row execute function public.set_updated_at();

alter table public.skills
  add column writing_skill_code text references public.writing_skill_types (code);
create index skills_writing_skill_idx on public.skills (writing_skill_code) where writing_skill_code is not null;

-- ---------------------------------------------------------------------------------------
-- Handwriting reference data

create table public.handwriting_glyphs (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9-]{2,60}$'),
  -- letter (a–z, A–Z), digit, or a pre-writing shape (line, curve, circle, zigzag…).
  kind text not null check (kind in ('letter', 'digit', 'shape')),
  -- What is written: "a", "A", "3"; a shape's symbol ("|", "○").
  character text not null check (char_length(character) between 1 and 4),
  letter_case text not null default 'none' check (letter_case in ('upper', 'lower', 'none')),
  script text not null default 'latin' check (script ~ '^[a-z]{2,20}$'),
  -- Child-facing name ("small a", "big A", "a circle").
  name text not null check (char_length(name) between 1 and 40),
  -- Ordered strokes: [{ "points": [[x, y], ...] }, ...] in a 0–100 box. Validated by the
  -- importer (2–64 points per stroke, coordinates 0–100, no zero-length stroke).
  strokes jsonb not null check (
    jsonb_typeof(strokes) = 'array' and jsonb_array_length(strokes) between 1 and 8
  ),
  -- Guide lines in the same box (top, midline, baseline) and optional reference font notes.
  guide jsonb not null default '{}'::jsonb check (jsonb_typeof(guide) = 'object'),
  -- Distance (box units) within which a child's ink counts as on the stroke.
  tolerance numeric(5, 2) not null default 12 check (tolerance between 2 and 40),
  -- Share of each stroke that must be covered to complete the glyph.
  completion numeric(4, 3) not null default 0.7 check (completion between 0.3 and 0.98),
  difficulty smallint not null default 1 check (difficulty between 1 and 10),
  -- Formation family ("c" letters start like c: a, d, g, o, q) for teaching order.
  family text not null default '' check (char_length(family) <= 20),
  formation_tip text not null default '' check (char_length(formation_tip) <= 200),
  formation_speech text not null default '' check (char_length(formation_speech) <= 300),
  sort_order integer not null default 0,
  status public.content_status not null default 'published',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index handwriting_glyphs_char_idx on public.handwriting_glyphs (script, kind, letter_case, character);
create trigger handwriting_glyphs_set_updated_at before update on public.handwriting_glyphs
for each row execute function public.set_updated_at();

alter table public.questions add column glyph_id uuid references public.handwriting_glyphs (id);
create index questions_glyph_idx on public.questions (glyph_id) where glyph_id is not null;

-- ---------------------------------------------------------------------------------------
-- Rubrics for open-ended writing

create table public.writing_rubrics (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z0-9-]{2,80}$'),
  name text not null check (char_length(name) between 1 and 80),
  description text not null default '' check (char_length(description) <= 400),
  min_level_rank smallint not null check (min_level_rank between 1 and 10),
  max_level_rank smallint not null check (max_level_rank between 1 and 10),
  -- [{ "id", "dimension", "critical", "weight", "label", ... }]; validated by the importer.
  criteria jsonb not null check (jsonb_typeof(criteria) = 'array' and jsonb_array_length(criteria) between 1 and 12),
  status public.content_status not null default 'published',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (min_level_rank <= max_level_rank)
);
create trigger writing_rubrics_set_updated_at before update on public.writing_rubrics
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------------------
-- Written answers: the server's evaluation next to the original response

alter table public.activity_attempts
  add column writing_analysis jsonb check (writing_analysis is null or jsonb_typeof(writing_analysis) = 'object');
create index activity_attempts_child_writing_idx on public.activity_attempts (child_id, attempted_at desc)
  where writing_analysis is not null;

-- ---------------------------------------------------------------------------------------
-- Review queue and content flags

alter table public.review_items add column glyph_id uuid references public.handwriting_glyphs (id);
alter table public.review_items drop constraint review_items_check;
alter table public.review_items add constraint review_items_check
  check (num_nonnulls(skill_id, word_id, phonics_pattern_id, lesson_id, glyph_id) > 0);
alter table public.review_items drop constraint review_items_item_key_check;
alter table public.review_items add constraint review_items_item_key_check
  check (item_key ~ '^(skill|word|pattern|lesson|spelling|reading|writing):[0-9a-f-]{36}$');
alter table public.review_items drop constraint review_items_reason_check;
alter table public.review_items add constraint review_items_reason_check check (reason in (
  'weak_skill', 'due_review', 'recent_errors', 'missed_word', 'weak_word',
  'missed_spelling', 'weak_spelling', 'spelling_pattern', 'reading_word', 'writing_letter'
));

alter table public.content_flags drop constraint content_flags_entity_check;
alter table public.content_flags add constraint content_flags_entity_check
  check (entity in (
    'word', 'phonics_pattern', 'question', 'lesson', 'sentence', 'spelling_word', 'story',
    'glyph', 'writing_rubric'
  ));

-- ---------------------------------------------------------------------------------------
-- Security

revoke all on public.writing_skill_types, public.handwriting_glyphs, public.writing_rubrics
  from anon, authenticated;
grant all on public.writing_skill_types, public.handwriting_glyphs, public.writing_rubrics
  to service_role;

-- Skill list and glyphs: published rows readable by families (the tracing guide is drawn
-- from them); admins read and write everything.
do $$
declare
  t text;
begin
  foreach t in array array['writing_skill_types', 'handwriting_glyphs'] loop
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

-- Rubrics are evaluation configuration: admins only (the server evaluates with the copy in
-- each question's server-only answer).
alter table public.writing_rubrics enable row level security;
create policy writing_rubrics_admin on public.writing_rubrics for all to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
grant select, insert, update, delete on public.writing_rubrics to authenticated;

-- New readable columns (the column grants of questions and activity_attempts are explicit).
grant select (glyph_id) on public.questions to authenticated;
grant select (writing_analysis) on public.activity_attempts to authenticated;
