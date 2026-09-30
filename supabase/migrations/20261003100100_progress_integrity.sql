-- Progress integrity and answer privacy (audit fixes; see docs/decisions.md ADR-028).
--
-- 1. One first try per question per lesson run / assessment sitting. The progress writer
--    rejects a second one (src/lib/server/progress-writer.ts); these indexes make that a
--    database rule too. Any existing duplicates keep their earliest answer as the first
--    try; later ones become retries (attempt 2), so history is kept but not double-counted.
-- 2. Parents can no longer read activity_attempts.correct_answer (ADR-021: correct answers
--    never reach the browser in plain text).
-- 3. Content link tables are readable only when the content they link is published
--    (or by admins), like word_segments and phonics_pattern_relations already are.

-- 1. -----------------------------------------------------------------------------------

with ranked as (
  select id,
    row_number() over (
      partition by child_id, question_id, lesson_run_id order by attempted_at, received_at, id
    ) as n
  from public.activity_attempts
  where attempt_number = 1 and lesson_run_id is not null
)
update public.activity_attempts a set attempt_number = 2
from ranked r where a.id = r.id and r.n > 1;

with ranked as (
  select id,
    row_number() over (
      partition by child_id, question_id, assessment_attempt_id order by attempted_at, received_at, id
    ) as n
  from public.activity_attempts
  where attempt_number = 1 and assessment_attempt_id is not null
)
update public.activity_attempts a set attempt_number = 2
from ranked r where a.id = r.id and r.n > 1;

create unique index activity_attempts_one_first_try_per_run
  on public.activity_attempts (child_id, question_id, lesson_run_id)
  where attempt_number = 1 and lesson_run_id is not null;

create unique index activity_attempts_one_first_try_per_sitting
  on public.activity_attempts (child_id, question_id, assessment_attempt_id)
  where attempt_number = 1 and assessment_attempt_id is not null;

-- 2. -----------------------------------------------------------------------------------

revoke select on public.activity_attempts from authenticated;
grant select (
  id, child_id, question_id, question_version, question_type, skill_id, activity_id,
  lesson_id, word_id, lesson_run_id, assessment_attempt_id, attempt_number, response,
  is_correct, error_type, response_time_ms, attempted_at, received_at, score,
  learning_session_id
) on public.activity_attempts to authenticated;

-- 3. -----------------------------------------------------------------------------------

drop policy phonics_pattern_sounds_read on public.phonics_pattern_sounds;
create policy phonics_pattern_sounds_read on public.phonics_pattern_sounds for select to authenticated
  using (
    (select public.is_admin())
    or exists (select 1 from public.phonics_patterns p where p.id = pattern_id and p.status = 'published')
  );

drop policy word_phonics_patterns_read on public.word_phonics_patterns;
create policy word_phonics_patterns_read on public.word_phonics_patterns for select to authenticated
  using (
    (select public.is_admin())
    or (
      exists (select 1 from public.words w where w.id = word_id and w.status = 'published')
      and exists (select 1 from public.phonics_patterns p where p.id = pattern_id and p.status = 'published')
    )
  );

drop policy word_relations_read on public.word_relations;
create policy word_relations_read on public.word_relations for select to authenticated
  using (
    (select public.is_admin())
    or (
      exists (select 1 from public.words w where w.id = word_id and w.status = 'published')
      and exists (select 1 from public.words w where w.id = related_word_id and w.status = 'published')
    )
  );

drop policy sight_words_read on public.sight_words;
create policy sight_words_read on public.sight_words for select to authenticated
  using (
    (select public.is_admin())
    or exists (select 1 from public.words w where w.id = word_id and w.status = 'published')
  );

drop policy sentence_words_read on public.sentence_words;
create policy sentence_words_read on public.sentence_words for select to authenticated
  using (
    (select public.is_admin())
    or (
      exists (select 1 from public.sentences s where s.id = sentence_id and s.status = 'published')
      and exists (select 1 from public.words w where w.id = word_id and w.status = 'published')
    )
  );

drop policy sentence_phonics_patterns_read on public.sentence_phonics_patterns;
create policy sentence_phonics_patterns_read on public.sentence_phonics_patterns for select to authenticated
  using (
    (select public.is_admin())
    or (
      exists (select 1 from public.sentences s where s.id = sentence_id and s.status = 'published')
      and exists (select 1 from public.phonics_patterns p where p.id = pattern_id and p.status = 'published')
    )
  );

drop policy skill_prerequisites_read on public.skill_prerequisites;
create policy skill_prerequisites_read on public.skill_prerequisites for select to authenticated
  using (
    (select public.is_admin())
    or (
      exists (select 1 from public.skills s where s.id = skill_id and s.status = 'published')
      and exists (select 1 from public.skills s where s.id = prerequisite_skill_id and s.status = 'published')
    )
  );

drop policy lesson_prerequisites_read on public.lesson_prerequisites;
create policy lesson_prerequisites_read on public.lesson_prerequisites for select to authenticated
  using (
    (select public.is_admin())
    or (
      exists (select 1 from public.lessons l where l.id = lesson_id and l.status = 'published')
      and exists (select 1 from public.lessons l where l.id = prerequisite_lesson_id and l.status = 'published')
    )
  );

drop policy assessment_items_read on public.assessment_items;
create policy assessment_items_read on public.assessment_items for select to authenticated
  using (
    (select public.is_admin())
    or (
      exists (select 1 from public.assessments a where a.id = assessment_id and a.status = 'published')
      and exists (select 1 from public.questions q where q.id = question_id and q.status = 'published')
    )
  );
