# Database

PostgreSQL on Supabase. Schema = `supabase/migrations/*.sql` (ordered, never edited once
applied). TypeScript types in `src/lib/supabase/types.ts` are generated
(`npm run db:types`).

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
| Table | Purpose |
|---|---|
| `profiles` | One per auth user; `role` (`parent`/`admin`), display name, locale, time zone. Created by trigger on `auth.users`. |
| `children` | Child profiles (`parent_id`, name, avatar key, optional DOB, `grade_level_id` chosen by parent, `current_level_id` learned at, `daily_minutes` ∈ {10,15,20,30,45}, `placement_score`, `learning_preferences`, soft delete `deleted_at`). Age is derived from DOB, not stored. |

### Reference content
| Table | Purpose |
|---|---|
| `levels` | KG1…GRADE2 and future levels: ages, difficulty, vocabulary/sight-word targets, max sentence length, phonics/reading/writing scope, assessment difficulty. |
| `subjects` | Learning areas (Letters & Sounds, Phonics, Blending, Sight Words, Vocabulary, Spelling, Sentences, Reading, Listening, Writing). |
| `skill_dimensions` | What a skill measures, for assessment breakdowns (letter recognition … writing). |
| `activity_types` | Renderable question/activity types; `is_scored`. |
| `audio_assets`, `image_assets` | Media in Supabase Storage; audio has `tts_text` fallback. |

### Language content
| Table | Purpose |
|---|---|
| `phonics_patterns` | Letters, digraphs, vowel teams, r-controlled, endings, suffixes… (`code`, `pattern`, `pattern_type`, level, difficulty, explanations, mastery threshold). |
| `phonics_pattern_sounds` | One row per pronunciation of a pattern (TH voiceless/voiced, EA long/short, OW, OO, ED ×3, …) with IPA, label and `say_as` for TTS. Exactly one primary. |
| `word_categories` | Animals, Food, … Function Words. |
| `words` | The word bank (thousands of rows expected): level, difficulty, category, syllables, pronunciation, definitions (adult and child), part of speech, sight word, `is_irregular` + `spelling_note`, example sentence, plural, inflections, tags, emoji/image/audio, generated `search` tsvector. Unique `(normalized_word, sense)`. |
| `word_phonics_patterns` | Word ↔ pattern, with the specific sound and `is_example`. |
| `word_relations` | Related words (related/synonym/antonym/family/rhyme). |
| `sight_words` | Level-specific sight-word lists. |
| `sentences`, `sentence_words`, `sentence_phonics_patterns` | Sentence bank with vocabulary and phonics dependencies, grammar complexity. |
| `stories` | Original or licensed passages (`pages` JSON); a non-original story must carry a license. |

### Curriculum
| Table | Purpose |
|---|---|
| `units` | Level × subject grouping. |
| `skills` | The unit of mastery; dimension, optional phonics pattern, mastery threshold, importance (1–5). |
| `skill_prerequisites` | Skill ordering. |
| `lessons` | Belong to a skill; version. |
| `activities` | Belong to a lesson; `activity_type`, stage (explanation → review), instructions, config. |
| `questions` | Self-describing: `question_type`, prompt/prompt_speech, `content` JSON, `answer` JSON (null = unscored), links to word/sentence/pattern/story, **`skill_id` (required)**, version. `activity_id` is null for assessment-only questions. Story comprehension questions set `story_id`. |
| `assessments`, `assessment_items` | Assessments reuse questions; items carry the placement stage. `assessments.config` holds scoring rules. |
| `achievements` | Badge definitions with data criteria. |

### Learner history (append-only) and derived progress
| Table | Kind | Purpose |
|---|---|---|
| `activity_attempts` | history | Every answer: child, question (+version, type), skill, activity, lesson, word, lesson run, assessment attempt, attempt number, response, snapshot of correct answer, server-computed `is_correct`, error type, response time, device time, receive time. Covers phonics, reading, spelling and assessment answers in one table (ADR-006). |
| `lesson_runs` | history | One completed play-through; server-computed score/stars; duration. |
| `assessment_attempts`, `assessment_results` | history | Assessment sittings and immutable results (overall, by dimension and skill, suggested level). Reassessment adds rows; nothing is overwritten. |
| `reward_events` | history | Points/stars ledger, unique per source. |
| `child_achievements` | history | Badges earned. |
| `lesson_progress` | derived | Per child × lesson: runs, best/last score, stars. |
| `skill_mastery` | derived | Per child × skill: status, mastery score, accuracy, recent accuracy, attempts, practice days, confidence, review priority, next review, last practised/assessed. Also serves as the review queue (ADR-007). |
| `word_progress` | derived | "My Words": saved flag and source, attempt/correct counts. |

`activity_attempts.lesson_run_id` is intentionally not a foreign key: attempts may arrive
before their run row.

## Relationships (summary)

```
auth.users 1─1 profiles 1─* children 1─* {activity_attempts, lesson_runs, assessment_attempts,
                                           lesson_progress, skill_mastery, word_progress,
                                           child_achievements, reward_events}
levels 1─* units *─1 subjects;  units 1─* skills 1─* lessons 1─* activities 1─* questions
skills *─* skills (prerequisites);  skills *─1 phonics_patterns;  skills *─1 skill_dimensions
phonics_patterns 1─* phonics_pattern_sounds;  words *─* phonics_patterns (with sound)
questions *─1 {words, sentences, phonics_patterns, stories, activity_types}
assessments 1─* assessment_items *─1 questions
```

## Security (RLS)

| Data | anon | parent (authenticated) | admin | service role |
|---|---|---|---|---|
| Published content | — | read | read/write | all |
| Draft/archived content | — | — | read/write | all |
| Own profile | — | read; update name/locale/time zone | same | all |
| Own children | — | read, insert, update (listed columns), archive via `archive_child()` | no access | all |
| Own children's progress | — | read | no access | all (writes) |
| Other families | — | nothing | nothing | all |

Helpers: `is_admin()`, `is_my_child(child_id)` (both `security definer`, fixed
`search_path`). Tests: `supabase/tests/001_rls_family_isolation.sql`,
`002_progress_constraints.sql` (`npm run test:db`).

## Indexes

Chosen for the actual queries: attempts by (child, skill, time), (child, time),
(child, word), run and assessment ids; runs by (child, completed_at) and (child, lesson);
mastery by (child, review priority); words by level/difficulty, category, prefix
(`text_pattern_ops`), full-text (`search`, GIN) and tags (GIN); content children by parent
and sort order.
