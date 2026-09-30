# Database

PostgreSQL on Supabase. Schema = `supabase/migrations/*.sql` (ordered, never edited once
applied). TypeScript types in `src/lib/supabase/types.ts` are generated
(`npm run db:types`).

## Migrations

| File                                                  | Contents                                                                                                                                                                                                                          |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20260929100100_foundation.sql`                       | enums, `set_updated_at()`, `profiles`, sign-up trigger, `is_admin()`                                                                                                                                                              |
| `20260929100200_content_reference.sql`                | levels, subjects, skill dimensions, activity types, media assets                                                                                                                                                                  |
| `20260929100300_language_content.sql`                 | phonics patterns and sounds, words, sight words, sentences, stories                                                                                                                                                               |
| `20260929100400_curriculum.sql`                       | units, skills, lessons, activities, questions, assessments, achievements                                                                                                                                                          |
| `20260929100500_family_and_progress.sql`              | children, learner history, derived progress                                                                                                                                                                                       |
| `20260929100600_rls_and_grants.sql`                   | RLS policies, grants, `is_my_child()`, `archive_child()`                                                                                                                                                                          |
| `20260930100100_parent_profiles_and_family_rules.sql` | time zone validation, sign-up time zone, published-level check, 12-child limit                                                                                                                                                    |
| `20260930100200_seed_levels.sql`                      | the five learning levels (KG1–Grade 2), so a fresh database works without a content import                                                                                                                                        |
| `20261001100100_learning_engine.sql`                  | Phase 3 engine: skill/lesson/question fields, lesson prerequisites, feedback messages, engine rules, learning sessions, activity/subject/level progress, review queue, attempt scores, hidden answers, `lesson_catalog` view      |
| `20261002100100_phonics_engine.sql`                   | Phase 4 phonics: phoneme inventory, phonics stages, pattern fields (stage, position, letter case/name, image), sound phonemes, pattern relations, word segments, word shape/decodable, skill stage, content review flags          |
| `20261003100100_progress_integrity.sql`               | Audit fixes (ADR-028): one first try per question per lesson run / assessment sitting (unique indexes), `activity_attempts.correct_answer` hidden from parents, content link tables readable only when their content is published |

## Conventions

- `uuid` primary keys (`gen_random_uuid()`); progress history uses **device-generated**
  UUIDs so offline events are idempotent.
- Content tables have `status content_status` (`draft | published | archived`) and a stable
  natural key (`code`, or `normalized_word + sense` for words, `text` for sentences) used by
  the importer. Content referenced by history is archived, never deleted.
- `created_at` everywhere; `updated_at` maintained by `set_updated_at()` on mutable tables.
- Check constraints encode small enumerations and ranges; lookup tables
  (`activity_types`, `skill_dimensions`, `word_categories`) hold extensible ones.
- Every migration grants explicitly (hosted Supabase grants new tables to `anon`/`authenticated`).

## Tables

### Identity and family

| Table      | Purpose                                                                                                                                                                                                                                                                       |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `profiles` | One per auth user; `role` (`parent`/`admin`), display name, locale, validated IANA time zone (from the browser at sign-up). Created by trigger on `auth.users`.                                                                                                               |
| `children` | Child profiles (`parent_id`, name, avatar key, optional DOB, `grade_level_id` chosen by parent, `current_level_id` learned at, `daily_minutes` ∈ {10,15,20,30,45}, `placement_score`, `learning_preferences`, soft delete `deleted_at`). Age is derived from DOB, not stored. |

### Reference content

| Table                          | Purpose                                                                                                                                                                                               |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `levels`                       | KG1…GRADE2 and future levels: ages, difficulty, vocabulary/sight-word targets, max sentence length, phonics/reading/writing scope, assessment difficulty.                                             |
| `subjects`                     | Content categories: PHONICS, READING, VOCABULARY, SPELLING, WRITING, LISTENING, SENTENCE_BUILDING, GAMES, ASSESSMENT (the Phase 2 categories LETTERS, BLENDING, SIGHT_WORDS, SENTENCES are archived). |
| `skill_dimensions`             | What a skill measures, for assessment breakdowns (letter recognition … writing).                                                                                                                      |
| `activity_types`               | Renderable question/activity types; `is_scored`.                                                                                                                                                      |
| `audio_assets`, `image_assets` | Media in Supabase Storage; audio has `tts_text` fallback.                                                                                                                                             |

### Language content

| Table                                                      | Purpose                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `phonics_patterns`                                         | Letters, digraphs, blends, magic e (`a_e`), vowel teams, r-controlled, endings, suffixes… (`code`, `pattern`, `pattern_type`, level, stage, `position`, difficulty, explanations, mastery threshold; letters also `uppercase`, `letter_name` and its `say_as` — the NAME, kept apart from the SOUND).                           |
| `phonics_pattern_sounds`                                   | One row per pronunciation of a pattern (TH voiceless/voiced, EA long/short, OW, OO, ED ×3, …) with IPA, label, `say_as` for TTS and **`phonemes`** (ARPAbet codes, checked against `phonemes`). Exactly one primary.                                                                                                            |
| `phonemes`                                                 | The 39 speech sounds (ARPAbet code, IPA, child label such as `sh`, `say_as`, consonant / vowel / r-coloured vowel, voiced, example word). Graphemes (letters) and phonemes (sounds) are kept apart everywhere (ADR-024).                                                                                                        |
| `phonics_stages`                                           | The teaching progression LETTERS → LETTER_SOUNDS → … → ADVANCED, with child-facing names and emoji; patterns and skills point to a stage.                                                                                                                                                                                       |
| `phonics_pattern_relations`                                | Pattern ↔ pattern: `prerequisite`, `related`, `contrast` (sh/ch), `same_sound` (ai/ay/a_e). Readable only when both patterns are published.                                                                                                                                                                                     |
| `word_segments`                                            | A word as the graphemes a reader decodes, in order (ship = sh·i·p), each with its pattern, sound and phonemes (empty = silent). Derived by the importer or authored (CSV `segments`); readable only for published words. `words` also carries `phonics_shape` (CVC, CCVC…, from phonemes), `decodable` and `segments_source`.   |
| `content_flags`                                            | Questionable content found by the importer (a doubtful split, a word that doesn't use its lesson's pattern, a duplicate pattern) for admin review. Replaced on each import; admins only.                                                                                                                                        |
| `word_categories`                                          | Animals, Food, … Function Words.                                                                                                                                                                                                                                                                                                |
| `words`                                                    | The word bank (thousands of rows expected): level, difficulty, category, syllables, pronunciation, definitions (adult and child), part of speech, sight word, `is_irregular` + `spelling_note`, example sentence, plural, inflections, tags, emoji/image/audio, generated `search` tsvector. Unique `(normalized_word, sense)`. |
| `word_phonics_patterns`                                    | Word ↔ pattern, with the specific sound and `is_example`.                                                                                                                                                                                                                                                                       |
| `word_relations`                                           | Related words (related/synonym/antonym/family/rhyme).                                                                                                                                                                                                                                                                           |
| `sight_words`                                              | Level-specific sight-word lists.                                                                                                                                                                                                                                                                                                |
| `sentences`, `sentence_words`, `sentence_phonics_patterns` | Sentence bank with vocabulary and phonics dependencies, grammar complexity.                                                                                                                                                                                                                                                     |
| `stories`                                                  | Original or licensed passages (`pages` JSON); a non-original story must carry a license.                                                                                                                                                                                                                                        |

### Curriculum

| Table                             | Purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `units`                           | Level × subject grouping.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `skills`                          | The unit of mastery; dimension, optional phonics pattern and phonics stage, mastery threshold, importance (1–5), difficulty (1–10), `is_active` (inactive skills stay readable but leave recommendations and totals). Level and subject come from the unit.                                                                                                                                                                                                                 |
| `skill_prerequisites`             | Skill ordering (e.g. CVC blending requires letter sounds).                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `lessons`                         | Belong to a skill; title/description, difficulty, estimated minutes, sequence (`sort_order`), version, status, optional `thumbnail_image_id`, `intro_speech` and optional `intro_audio_id`.                                                                                                                                                                                                                                                                                 |
| `lesson_prerequisites`            | Lessons to complete first (any level). Combined with the skill's prerequisites.                                                                                                                                                                                                                                                                                                                                                                                             |
| `activities`                      | Belong to a lesson; `activity_type`, stage (explanation → review), instructions, `config` (strict per-type schema; the database checks `maxTries` ∈ 1–3).                                                                                                                                                                                                                                                                                                                   |
| `questions`                       | Self-describing: `question_type`, prompt/prompt_speech, `content` JSON (the answer options live here), `answer` JSON (null = unscored), `explanation`, optional `audio_id`/`image_id`, `metadata`, links to word/sentence/pattern/story, **`skill_id` (required)**, difficulty, sequence, version. `activity_id` is null for assessment-only questions. A scored question cannot be published without an answer (trigger). **`answer` is not readable by signed-in users.** |
| `feedback_messages`               | What the player says: kind (`CORRECT`, `INCORRECT`, `TRY_AGAIN`, `ALMOST_CORRECT`, `COMPLETED`), text, speech, emoji; `{answer}` placeholder.                                                                                                                                                                                                                                                                                                                               |
| `learning_rules`                  | Engine rule overrides by code (`mastery`, `prerequisites`, `review`, `player`, `scoring`); validated against `src/lib/learning/rules.ts`, merged over its defaults.                                                                                                                                                                                                                                                                                                         |
| `lesson_catalog` (view)           | LEVEL → SUBJECT → UNIT → SKILL → LESSON flattened (published rows only), `security_invoker` so the caller's RLS applies.                                                                                                                                                                                                                                                                                                                                                    |
| `assessments`, `assessment_items` | Assessments reuse questions; items carry the stage (placement stage or skill-check area). `assessments.config` holds scoring rules.                                                                                                                                                                                                                                                                                                                                         |
| `achievements`                    | Badge definitions with data criteria.                                                                                                                                                                                                                                                                                                                                                                                                                                       |

### Learner history (append-only) and derived progress

| Table                                       | Kind    | Purpose                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activity_attempts`                         | history | Every answer: child, question (+version, type), skill, activity, lesson, word, lesson run, learning session, assessment attempt, attempt number, response, snapshot of correct answer, server-computed `is_correct` and `score` (100 first try / 50 after feedback / 0), error type, response time, device time, receive time. Covers phonics, reading, spelling and assessment answers in one table (ADR-006). |
| `lesson_runs`                               | history | One completed play-through; server-computed score/stars; duration; learning session.                                                                                                                                                                                                                                                                                                                            |
| `learning_sessions`                         | derived | One stretch of learning on a device (device-generated id carried by every event): started/ended, duration, lessons and activities completed, attempts, correct, score. Totals recomputed from the events.                                                                                                                                                                                                       |
| `assessment_attempts`, `assessment_results` | history | Assessment sittings (device-generated id, created by the first synced answer) and immutable results computed by the server from first tries: overall, per area (`dimension_scores`: percent + secure), per skill, suggested level for placement. Reassessment adds rows; nothing is overwritten.                                                                                                                |
| `reward_events`                             | history | Points/stars ledger, unique per source.                                                                                                                                                                                                                                                                                                                                                                         |
| `child_achievements`                        | history | Badges earned.                                                                                                                                                                                                                                                                                                                                                                                                  |
| `activity_progress`                         | derived | Per child × activity: status, questions answered/total, attempts, correct, accuracy, best first-try score, started/last attempt/completed.                                                                                                                                                                                                                                                                      |
| `lesson_progress`                           | derived | Per child × lesson: status (`IN_PROGRESS` with answers but no finished run, `COMPLETED` with a run), runs, best/last score, stars, attempts, correct, accuracy, activities completed/total, started/last attempt/completed.                                                                                                                                                                                     |
| `subject_progress`                          | derived | Per child × level × subject: status, lessons completed/total, attempts, correct, accuracy, average best score, timestamps.                                                                                                                                                                                                                                                                                      |
| `level_progress`                            | derived | Per child × level: the same plus skills mastered/total.                                                                                                                                                                                                                                                                                                                                                         |
| `skill_mastery`                             | derived | Per child × skill: status (NOT_STARTED/LEARNING/PRACTICING/ALMOST_MASTERED/MASTERED), mastery score, accuracy, recent accuracy, attempts, correct attempts, practice days, confidence, review priority, next review, last practised/assessed.                                                                                                                                                                   |
| `review_items`                              | derived | The review queue: one open item per skill or word (`item_key`), referencing skill, word, phonics pattern and/or lesson, with priority, due date and reason (`weak_skill`, `due_review`, `recent_errors`, `missed_word`); resolved rather than deleted (ADR-022).                                                                                                                                                |
| `word_progress`                             | derived | "My Words": saved flag and source, attempt/correct counts.                                                                                                                                                                                                                                                                                                                                                      |

`activity_attempts.lesson_run_id` is intentionally not a foreign key: attempts may arrive
before their run row.

## Relationships (summary)

```
auth.users 1─1 profiles 1─* children 1─* {activity_attempts, lesson_runs, assessment_attempts,
                                           learning_sessions, activity_progress, lesson_progress,
                                           subject_progress, level_progress, skill_mastery,
                                           review_items, word_progress, child_achievements,
                                           reward_events}
levels 1─* units *─1 subjects;  units 1─* skills 1─* lessons 1─* activities 1─* questions
skills *─* skills (prerequisites);  lessons *─* lessons (prerequisites)
skills *─1 phonics_patterns;  skills *─1 skill_dimensions
phonics_patterns 1─* phonics_pattern_sounds (phonemes → phonemes);  words *─* phonics_patterns (with sound)
phonics_patterns *─* phonics_patterns (relations);  phonics_patterns, skills *─1 phonics_stages
words 1─* word_segments *─1 phonics_patterns / phonics_pattern_sounds
questions *─1 {words, sentences, phonics_patterns, stories, activity_types}
assessments 1─* assessment_items *─1 questions
```

## Security (RLS)

| Data                    | anon | parent (authenticated)                                               | admin                                          | service role |
| ----------------------- | ---- | -------------------------------------------------------------------- | ---------------------------------------------- | ------------ |
| Published content       | —    | read (except `questions.answer`)                                     | read/write (except reading `questions.answer`) | all          |
| Draft/archived content  | —    | —                                                                    | read/write                                     | all          |
| Own profile             | —    | read; update name/locale/time zone                                   | same                                           | all          |
| Own children            | —    | read, insert, update (listed columns), archive via `archive_child()` | no access                                      | all          |
| Own children's progress | —    | read                                                                 | no access                                      | all (writes) |
| Other families          | —    | nothing                                                              | nothing                                        | all          |

Helpers: `is_admin()`, `is_my_child(child_id)` (both `security definer`, fixed
`search_path`), `is_valid_time_zone(name)`.

Rules enforced by the database, whatever the client sends:

- `children.parent_id` has no insert/update grant; it defaults to `auth.uid()`.
- `enforce_child_rules()` (trigger): the grade and learning level must be **published**
  levels (a foreign key alone would accept a draft level id), names are trimmed, and a
  family has at most **12 active children** (`CHILD_LIMIT_REACHED`; archived children
  don't count; concurrent inserts are serialised per parent with an advisory lock).
- `validate_profile()` (trigger): the time zone must be a real IANA name
  (`INVALID_TIME_ZONE`); names are trimmed. `handle_new_user()` stores the browser's time
  zone from sign-up metadata when valid, otherwise UTC.
- `profiles.role` cannot be changed by users (no column grant).

- `enforce_publishable_question()` (trigger): a scored question cannot be published
  without an answer; `activities.config.maxTries` must be 1, 2 or 3.
- `questions.answer` has no SELECT grant for signed-in users (admins included): answers
  are read only by the server with the service role (ADR-021). The same holds for the
  answer snapshot `activity_attempts.correct_answer` (column-level grant, ADR-028).
- One first try per question per lesson run and per assessment sitting (partial unique
  indexes on `activity_attempts`); a replayed first try is refused (ADR-028).
- Content link tables (`phonics_pattern_sounds`, `word_phonics_patterns`, `word_relations`,
  `sight_words`, `sentence_words`, `sentence_phonics_patterns`, `skill_prerequisites`,
  `lesson_prerequisites`, `assessment_items`, `word_segments`, `phonics_pattern_relations`)
  are readable by families only when the rows they link are published.
- `check_phoneme_codes()` (trigger): every phoneme in `phonics_pattern_sounds.phonemes` and
  `word_segments.phonemes` must exist in `phonemes` (`UNKNOWN_PHONEME`). Graphemes are
  lowercase letters; `phonics_shape` is C/V only; a pattern cannot relate to itself.
- Phoneme and stage lists are readable by everyone signed in; relations and word segments
  follow the publication state of their patterns/words; `content_flags` is admin-only.

Tests: `supabase/tests/00{1,2,3,4,5}_*.sql` (`npm run test:db`) and the API-level
integration tests in `tests/integration` (`npm run test:integration`).

## Indexes

Chosen for the actual queries: attempts by (child, skill, time), (child, time),
(child, word), run and assessment ids; runs by (child, completed_at) and (child, lesson);
mastery by (child, review priority); open review items by (child, priority); attempts by
session and (child, lesson); sessions by (child, started_at); activity progress by
(child, lesson); words by level/difficulty, category, prefix
(`text_pattern_ops`), full-text (`search`, GIN) and tags (GIN); content children by parent
and sort order. Phonics: patterns by stage and by type; words by phonics shape; segments by
pattern (all words using a pattern); relations by related pattern; skills by stage.
