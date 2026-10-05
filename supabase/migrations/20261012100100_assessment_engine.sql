-- Phase 9: assessment + adaptive learning engine. docs/architecture.md → "Assessment and
-- adaptive learning", ADR-047 – ADR-049.
--
-- Extends the assessment tables that exist since Phase 1 (assessments, assessment_items,
-- assessment_attempts, assessment_results) instead of adding a second system:
--   * assessments: the seven assessment types, the domains a blueprint covers; the blueprint
--     itself stays in `config` (validated by src/lib/learning/assessment-blueprint.ts).
--   * assessment_items: the item's domain, the level it represents and its difficulty, so
--     the server can draw representative items per section.
--   * assessment_attempts (a "sitting"): status (in_progress / completed / abandoned /
--     expired), the items the SERVER selected for it, its scope (domain, unit, skills), the
--     learning epoch it belongs to, expiry and the sitting it re-assesses.
--   * assessment_results: per-domain readiness at the time, an evidence summary, partial
--     flag, reassessment comparison.
-- New derived, child-owned tables (recomputed by the server, never written by a browser):
--   * assessment_evidence: what one sitting observed per skill (items, right, skipped,
--     credit, contamination-adjusted weight) — the evidence layer between raw answers
--     (activity_attempts) and mastery (skill_mastery).
--   * instructional_readiness: per child and domain, the level to teach at, the strongest
--     secure level, the next level, confidence and the evidence behind it. Not the school
--     grade (children.grade_level_id is never changed by an assessment).
-- Review: a new reason `assessment_gap` on the existing review_items.
-- Handwriting: glyph identity metadata (confusable_codes).
-- Child lifecycle (ADR-046): both new tables reference children ON DELETE CASCADE and are
-- emptied by reset_child_learning(); supabase/tests/012 checks that stays true.

-- ---------------------------------------------------------------------------------------
-- Assessments (content)

update public.assessments set assessment_type = 'progress_check' where assessment_type = 'level_check';
alter table public.assessments drop constraint assessments_assessment_type_check;
alter table public.assessments add constraint assessments_assessment_type_check check (assessment_type in (
  'placement', 'diagnostic', 'progress_check', 'skill_check', 'reassessment', 'end_of_unit', 'review_check'
));
alter table public.assessments
  add column domains text[] not null default '{}'
    check (domains <@ array['PHONICS', 'READING', 'VOCABULARY', 'SPELLING', 'WRITING']::text[]);
comment on column public.assessments.domains is
  'Domains the blueprint measures (set by the importer from config.sections).';

alter table public.assessment_items drop constraint assessment_items_stage_check;
alter table public.assessment_items add constraint assessment_items_stage_check check (stage between 1 and 60);
alter table public.assessment_items
  add column domain text check (domain in ('PHONICS', 'READING', 'VOCABULARY', 'SPELLING', 'WRITING')),
  add column level_id uuid references public.levels (id),
  add column difficulty smallint not null default 1 check (difficulty between 1 and 10);
comment on column public.assessment_items.difficulty is
  'Item difficulty 1–10 from src/lib/learning/item-difficulty.ts (level, task demand, word features).';
create index assessment_items_level_idx on public.assessment_items (assessment_id, domain, level_id);

-- ---------------------------------------------------------------------------------------
-- Sittings

alter table public.assessment_attempts drop constraint assessment_attempts_purpose_check;
alter table public.assessment_attempts add constraint assessment_attempts_purpose_check check (purpose in (
  'placement', 'diagnostic', 'progress_check', 'skill_check', 'reassessment', 'end_of_unit', 'review_check'
));
alter table public.assessment_attempts
  add column status text not null default 'in_progress'
    check (status in ('in_progress', 'completed', 'abandoned', 'expired')),
  -- The questions the server selected for this sitting, in order. Empty only for sittings
  -- created by older app versions from a sync (all of the assessment's items allowed).
  add column item_ids uuid[] not null default '{}' check (cardinality(item_ids) <= 120),
  add column scope jsonb not null default '{}'::jsonb check (jsonb_typeof(scope) = 'object'),
  add column origin text not null default 'sync' check (origin in ('child', 'parent', 'recommendation', 'sync')),
  add column learning_epoch integer not null default 0 check (learning_epoch >= 0),
  add column expires_at timestamptz,
  add column last_activity_at timestamptz,
  add column previous_attempt_id uuid references public.assessment_attempts (id) on delete set null;
update public.assessment_attempts set status = 'completed' where completed_at is not null;
create index assessment_attempts_child_status_idx on public.assessment_attempts (child_id, status, started_at desc);
comment on column public.assessment_attempts.item_ids is
  'Questions selected by the server for this sitting; answers to any other question are refused.';

alter table public.assessment_results
  add column readiness jsonb not null default '{}'::jsonb check (jsonb_typeof(readiness) = 'object'),
  add column evidence_summary jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_summary) = 'array'),
  add column partial boolean not null default false,
  add column comparison jsonb check (comparison is null or jsonb_typeof(comparison) = 'object');

-- Assessment answers: partial credit (share of parts right) for evidence; mastery still uses
-- is_correct only.
alter table public.activity_attempts
  add column partial_credit numeric(4, 3) check (partial_credit is null or partial_credit between 0 and 1);
-- Exposure: how often a child has met a question (assessment selection, contamination).
create index activity_attempts_child_question_idx on public.activity_attempts (child_id, question_id, attempted_at);

-- ---------------------------------------------------------------------------------------
-- Evidence and readiness (derived, child-owned)

create table public.assessment_evidence (
  assessment_attempt_id uuid not null references public.assessment_attempts (id) on delete cascade,
  child_id uuid not null references public.children (id) on delete cascade,
  skill_id uuid not null references public.skills (id),
  domain text not null check (domain in ('PHONICS', 'READING', 'VOCABULARY', 'SPELLING', 'WRITING')),
  level_id uuid references public.levels (id),
  items_total smallint not null check (items_total between 0 and 120),
  items_correct smallint not null check (items_correct between 0 and items_total),
  items_skipped smallint not null default 0 check (items_skipped between 0 and items_total),
  -- Sum of partial credit over the answered items.
  credit numeric(6, 3) not null check (credit >= 0),
  -- Sum of contamination weights (an item practised many times before counts less).
  weight numeric(6, 3) not null check (weight >= 0),
  strength text not null check (strength in ('secure', 'developing', 'weak', 'insufficient')),
  observed_at timestamptz not null,
  primary key (assessment_attempt_id, skill_id)
);
create index assessment_evidence_child_skill_idx on public.assessment_evidence (child_id, skill_id, observed_at desc);
create index assessment_evidence_child_domain_idx on public.assessment_evidence (child_id, domain, observed_at desc);

create table public.instructional_readiness (
  child_id uuid not null references public.children (id) on delete cascade,
  domain text not null check (domain in ('PHONICS', 'READING', 'VOCABULARY', 'SPELLING', 'WRITING')),
  current_level_id uuid not null references public.levels (id),
  strongest_level_id uuid references public.levels (id),
  next_level_id uuid references public.levels (id),
  confidence text not null check (confidence in ('INSUFFICIENT', 'LOW', 'MEDIUM', 'HIGH')),
  -- Where the level comes from: a completed assessment, skill mastery, another domain's
  -- evidence (phonics → reading/spelling, low confidence) or the child's learning level.
  source text not null check (source in ('assessment', 'mastery', 'inferred', 'default')),
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  strengths jsonb not null default '[]'::jsonb check (jsonb_typeof(strengths) = 'array'),
  needs jsonb not null default '[]'::jsonb check (jsonb_typeof(needs) = 'array'),
  prerequisite_gaps jsonb not null default '[]'::jsonb check (jsonb_typeof(prerequisite_gaps) = 'array'),
  assessment_attempt_id uuid references public.assessment_attempts (id) on delete set null,
  learning_epoch integer not null default 0 check (learning_epoch >= 0),
  computed_at timestamptz not null default now(),
  primary key (child_id, domain)
);

-- ---------------------------------------------------------------------------------------
-- Review queue: assessment weaknesses

alter table public.review_items drop constraint review_items_reason_check;
alter table public.review_items add constraint review_items_reason_check check (reason in (
  'weak_skill', 'due_review', 'recent_errors', 'missed_word', 'weak_word',
  'missed_spelling', 'weak_spelling', 'spelling_pattern', 'reading_word', 'writing_letter',
  'assessment_gap'
));

-- ---------------------------------------------------------------------------------------
-- Handwriting: glyph identity

alter table public.handwriting_glyphs
  add column confusable_codes text[] not null default '{}' check (cardinality(confusable_codes) <= 12);
comment on column public.handwriting_glyphs.confusable_codes is
  'Glyphs this one is easily confused with (o for c, d for b): a trace that looks like one of them is refused.';

-- ---------------------------------------------------------------------------------------
-- Admin: how often each assessment item has been answered, across all children (counts
-- only — no child ids, no answers). Admins have no access to family data otherwise.

create or replace function public.assessment_item_exposure(p_assessment_id uuid)
returns table (question_id uuid, answers bigint, children bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;
  return query
    select a.question_id, count(*)::bigint, count(distinct a.child_id)::bigint
    from public.activity_attempts a
    join public.assessment_items i on i.question_id = a.question_id and i.assessment_id = p_assessment_id
    where a.attempt_number = 1
    group by a.question_id;
end;
$$;
revoke all on function public.assessment_item_exposure(uuid) from public, anon;
grant execute on function public.assessment_item_exposure(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------
-- Child lifecycle: Reset learning also empties the new child-owned tables (ADR-046).

create or replace function public.reset_child_learning(p_child_id uuid, p_parent_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_epoch integer;
begin
  -- Locks the child for the duration, so two resets (or a reset and a delete) serialise.
  perform 1 from public.children
  where id = p_child_id and parent_id = p_parent_id and deleted_at is null
  for update;
  if not found then
    raise exception 'CHILD_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- History (answers, runs, sittings, evidence, readings, rewards) and every derived cache.
  -- The SQL test 012_child_lifecycle.sql fails if a table referencing children is missing.
  delete from public.assessment_evidence where child_id = p_child_id;
  delete from public.instructional_readiness where child_id = p_child_id;
  delete from public.activity_attempts where child_id = p_child_id;
  delete from public.assessment_results where child_id = p_child_id;
  delete from public.assessment_attempts where child_id = p_child_id;
  delete from public.lesson_runs where child_id = p_child_id;
  delete from public.reading_sessions where child_id = p_child_id;
  delete from public.learning_sessions where child_id = p_child_id;
  delete from public.activity_progress where child_id = p_child_id;
  delete from public.lesson_progress where child_id = p_child_id;
  delete from public.subject_progress where child_id = p_child_id;
  delete from public.level_progress where child_id = p_child_id;
  delete from public.skill_mastery where child_id = p_child_id;
  delete from public.review_items where child_id = p_child_id;
  delete from public.word_progress where child_id = p_child_id;
  delete from public.word_area_progress where child_id = p_child_id;
  delete from public.spelling_progress where child_id = p_child_id;
  delete from public.reward_events where child_id = p_child_id;
  delete from public.child_achievements where child_id = p_child_id;

  update public.children
  set current_level_id = grade_level_id,
      placement_score = null,
      learning_epoch = learning_epoch + 1,
      learning_reset_at = now()
  where id = p_child_id
  returning learning_epoch into v_epoch;
  return v_epoch;
end;
$$;
revoke all on function public.reset_child_learning(uuid, uuid) from public, anon, authenticated;
grant execute on function public.reset_child_learning(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------------------
-- Security: parents read their own children's evidence and readiness; only the server writes.

alter table public.assessment_evidence enable row level security;
alter table public.instructional_readiness enable row level security;
create policy assessment_evidence_parent_read on public.assessment_evidence for select to authenticated
  using ((select public.is_my_child(child_id)));
create policy instructional_readiness_parent_read on public.instructional_readiness for select to authenticated
  using ((select public.is_my_child(child_id)));
revoke all on public.assessment_evidence, public.instructional_readiness from public, anon, authenticated;
grant select on public.assessment_evidence, public.instructional_readiness to authenticated;
grant all on public.assessment_evidence, public.instructional_readiness to service_role;
