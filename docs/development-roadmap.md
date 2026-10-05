# Development roadmap

Status after Phase 6 (spelling engine). ✅ done · 🟡 partial · ⬜ not started.

## Milestone 1 — vertical slice ✅

Parent login → create child → select grade → child dashboard → phonics lesson from the
database → audio → interactive practice (8 activity types) → score → progress saved →
parent dashboard reads real data. Verified by `tests/e2e/vertical-slice.spec.ts`.

Definition of done:

| Item                                | Status | Evidence                                                       |
| ----------------------------------- | ------ | -------------------------------------------------------------- |
| Authentication works                | ✅     | e2e register/login; `(auth)/actions.ts`                        |
| Child creation, grade selection     | ✅     | e2e; `parent/child-actions.ts`                                 |
| Child dashboard                     | ✅     | `/child/home` with path, today's plan, stars                   |
| Phonics lesson loads from database  | ✅     | `lesson-loader.ts`; lessons imported from `content/`           |
| Audio works                         | ✅     | `lib/audio` (TTS, recorded-asset ready); unit tests            |
| ≥ 3 activity types                  | ✅     | 8 renderers                                                    |
| Answers evaluated, score calculated | ✅     | client + server re-evaluation; unit tests                      |
| Progress persisted                  | ✅     | outbox → `/api/sync` → history + derived tables; e2e checks DB |
| Parent dashboard reads real data    | ✅     | e2e                                                            |
| RLS protects family data            | ✅     | `supabase/tests/001…sql`; e2e isolation test                   |
| Tests cover critical logic          | ✅     | 125 unit/component tests, 2 SQL test files, 5 e2e tests        |
| Production build succeeds           | ✅     | `npm run build`                                                |
| PWA shell works                     | ✅     | e2e `pwa.spec.ts` (installable manifest, SW, offline reopen)   |

## Phase 1 — project foundation ✅ (audited and completed 2026-09-29)

| Item                            | Where                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| TypeScript (strict), app + SW   | `tsconfig.json`, `tsconfig.sw.json`, `npm run typecheck` (runs `next typegen` first) |
| Lint (warnings fail)            | `eslint.config.mjs`, `npm run lint`                                                  |
| Formatting                      | Prettier + Tailwind plugin, `.prettierignore`, `npm run format[:check]`              |
| Tests                           | Vitest (unit/component), SQL tests, Playwright                                       |
| CI                              | `.github/workflows/ci.yml` (typecheck, lint, format, tests, build)                   |
| Environment handling            | `src/lib/env.ts` (lazy), setup screen, `.env.example`                                |
| Supabase clients                | browser / server / service-role in `src/lib/supabase`                                |
| Migrations                      | `supabase/migrations`, types via `npm run db:types`                                  |
| Design system and primitives    | tokens in `globals.css`; `src/components/ui`                                         |
| App shell and responsive layout | `AppShell`, child layout, skip link                                                  |
| Error / loading / empty states  | `error.tsx` per area, `loading.tsx`, `EmptyState`                                    |
| PWA                             | manifest, icons, Serwist service worker, `offline.html` fallback                     |

## Phase 3 — learning engine ✅ (completed 2026-10-01)

The project plan's Phase 3 (the reusable, data-driven learning engine — not the full phonics
programme) maps to row 4 below and parts of rows 8, 9, 11, 12 and 13:

| Area                         | Where                                                                                                                                  |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Hierarchy and content models | migrations `…100400`, `20261001100100`; `lesson_catalog` view; subjects/levels as data                                                 |
| Activity system              | 12 scored types + intro, typed content and config schemas, registry, 6 new renderers                                                   |
| Answers                      | server-only `questions.answer`, digest answer keys, server re-evaluation (ADR-021)                                                     |
| Progress                     | attempts with scores; activity, lesson, skill, subject and level progress; learning sessions                                           |
| Mastery and review           | configurable bands, repeated evidence, review queue (ADR-022), prerequisites with preview                                              |
| Services                     | `getNextLesson`, `getRecommendedLessons`, `getWeakSkills`, `getReviewItems`, `getLessonReadiness`                                      |
| Lesson player                | intro → activities → summary, back/next/exit, configurable feedback, resume after closing                                              |
| Dashboards                   | child: level, recommended lesson, subjects, recent lessons, skills; parent: activities, average score, learning time, subject progress |
| Tests                        | unit, SQL (`004_learning_engine.sql`), integration (`learning-engine.test.ts`), e2e (`learning-engine.spec.ts`)                        |

## Phase 4 — phonics engine ✅

Built on the Phase 3 engine (no separate mastery, progress or assessment system):

| Area               | Where                                                                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Phonics model      | migration `20261002100100`; phonemes, stages, pattern sounds as phonemes, relations, word segments, review flags (ADR-024, ADR-026)                                |
| Word decomposition | `src/lib/learning/phonics.ts` (graphemes → phonemes, CVC shape, decodable), authored overrides in the words CSV                                                    |
| Activity types     | `BLEND_SOUNDS`, `SEGMENT_WORD`, `FIND_PATTERN` + 13 phonics templates over existing types                                                                          |
| Lessons            | blueprints `letter_sound`, `cvc_blending`, `phonics_pattern` (ADR-025); 26 letters, 5 short vowels, digraphs → suffixes                                            |
| Assessment         | Phonics Check (12 areas) in the lesson player; server scoring per area; mastery + `last_assessed_at` (ADR-027)                                                     |
| Screens            | `/child/phonics` (Letters, Sounds, Blend, Read Words, Practice, Mastery; stars), parent/admin pattern search, dashboard percentages                                |
| Audio              | Listen / Slow / Again everywhere, visible no-sound fallback                                                                                                        |
| Tests              | unit (`phonics`, `phonics-engine`, content files), SQL `005_phonics_engine.sql`, integration `phonics.test.ts`, e2e `phonics.spec.ts` on phone, tablet and desktop |

## Phase 5 — vocabulary engine ✅

Built on the Phase 3 engine and the Phase 4 phonics data (no separate mastery, progress,
review or activity system):

| Area       | Where                                                                                                                                                                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Word model | migration `20261004100100`: sub-categories, word levels, example sentences, families, relation types, media checks + buckets, word mastery and areas (ADR-029–032); `20261005100100`: admin read policy on the content buckets (upload fix) |
| Activities | `vocabulary_set` blueprint + 14 vocabulary templates over existing types; rule-based distractors (`src/lib/content/vocabulary.ts`, ADR-030)                                                                                                 |
| Progress   | word mastery (`computeMastery`, vocabulary rules), per-area progress, auto-save, weak/missed/saved review items (`src/lib/learning/vocabulary.ts`)                                                                                          |
| Screens    | `/child/words` (My Words, New Words, Practice, Categories, Word Explorer), word practice in the lesson player, `/parent/words`, dashboard card, `/admin/words/:id`                                                                          |
| Search     | `searchWords`: start of word, category (+ sub-categories), level, difficulty, phonics pattern, shape, part of speech — in the database, paginated                                                                                           |
| Import     | CSV `levels`, `subcategory`, `examples`, `synonyms`, `antonyms`, `inflections`, `image`, `audio`; `content/vocabulary.json` families; example-sentence checks                                                                               |
| Seed       | 393 words, 27 categories, 393 example sentences, 13 families, 21 vocabulary lessons (407 questions) across KG1–Grade 2                                                                                                                      |
| Tests      | unit `vocabulary.test.ts`, content files, SQL `006_vocabulary_engine.sql` + `007_content_storage.sql`, integration `vocabulary.test.ts`, e2e `vocabulary.spec.ts` on phone, tablet and desktop                                              |

## Phase 6 — spelling engine ✅

Built on the Phase 3 engine, the Phase 4 phonics data and the Phase 5 word bank (no
separate lesson, activity, attempt, progress, mastery, review or assessment system):

| Area          | Where                                                                                                                                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model         | migration `20261006100100`: spelling types, spelling targets (the spelling view of a bank word), attempt hints / analysis / error pattern, spelling progress, spelling + pattern review (ADR-033–035) |
| Checker       | `src/lib/learning/spelling.ts`: normalisation without autocorrect, letter diff, 10 error categories from the grapheme split, sentence dictation checks, hints, spelling mastery and review            |
| Activities    | 9 spelling activities on `SPELLING` / `WORD_BUILDER` / `MISSING_LETTER` / `SEGMENT_WORD` + the new `SENTENCE_DICTATION`; `spelling_set` blueprint; 10 spelling templates                              |
| Input         | keyboard, child on-screen keyboard, letter tiles, drag and drop — per activity or by the level's spelling rules; dictation replay limits and slow replay; progressive hints                           |
| Feedback      | the mistake named per category (`feedback_messages.error_category`), the child's letters marked ✓ / ✗ / + / \_, the word shown only after the last try                                                |
| Import / seed | `content/spelling/spelling-words.csv` (136 targets, KG1–Grade 2), Created / Updated / Skipped / Invalid / Duplicates report, 23 spelling lessons (456 questions), 18 high-frequency words added       |
| Screens       | `/child/spelling` (Learn, Practice, Dictation, My Words, Review), `/parent/spelling`, a dashboard card                                                                                                |
| Tests         | unit `spelling.test.ts` (+ content files), SQL `008_spelling_engine.sql`, integration `spelling.test.ts`, e2e `spelling.spec.ts` on phone, tablet and desktop                                         |

## Phase 7 — reading engine ✅

Built on the story table, the Phase 5 word bank, the Phase 4 phonics data and the Phase 3
engine (no separate reading lesson, progress, mastery or review system; ADR-037, ADR-038):

| Area          | Where                                                                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Model         | migration `20261008100100`: reading skill and content types, skill tagging, story reading metadata and analysis, story ↔ word / pattern / skill links, reading sessions, reading review                |
| Logic         | `src/lib/learning/reading.ts`: sentences, words, inflections, decodability, difficulty, level fit, session summaries (no speed), comprehension per skill, recommendations, help-word review            |
| Activities    | `READ_PASSAGE` (guided reading), `SELECT_ALL`, `ORDER_EVENTS`; `READING` for choice / true-false / word meaning with look-back; `MATCH`                                                                |
| Lessons       | `reading` blueprint: get ready → words → phonics → read → questions → tricky words → read again                                                                                                        |
| Import / seed | `content/stories.json` (16 texts, 55 questions, every level), 16 reading lessons, 118 high-frequency words; failures on broken references, duplicates and level-inappropriate skills; flags for review |
| Screens       | `/child/reading`, `/child/reading/words`, `/parent/reading`, dashboard card, `/admin/reading[/:code]` (analysis, preview, publish)                                                                     |
| Tests         | unit `reading.test.ts`, `reading-ui.test.tsx` (+ content files), SQL `009_reading_engine.sql`, integration `reading.test.ts`, e2e `reading.spec.ts` on phone, tablet and desktop                       |

## Phase 8 — writing engine ✅

Built on the lesson player, the Phase 3 engine, the word bank, the phonics data and the
story library (no separate writing lesson, attempt, progress, mastery or review system;
ADR-039 – ADR-042; [writing-engine.md](writing-engine.md)):

| Area          | Where                                                                                                                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model         | migration `20261009100100`: writing skill types + skill tagging, handwriting glyphs, rubric templates, `writing_analysis`, letter review, content flags                                                                                           |
| Logic         | `tracing.ts` (direction-aware coverage, precision, balance, alignment, order / direction / start), `writing.ts` (mechanics, copy, completion, edit, rubric, story, letter review), `writing-key.ts`                                               |
| Activities    | 15 writing activity types on `TRACING`, `SENTENCE_WRITING`, `GUIDED_WRITING`, `STORY_ORDER_WRITING`, `EDIT_AND_CORRECT` and reused `SPELLING` / `WORD_BUILDER` / `MISSING_LETTER` / `SENTENCE_BUILDER`                                            |
| Import / seed | `content/writing.json` (25 skills, 69 glyphs, 13 rubrics), 25 writing lessons on every level; glyph, rubric and writing-question validation; templates `trace_letter`, `copy_word`, `picture_word`, `write_sound`, `copy_sentence`                |
| Screens       | `/child/writing`, `/parent/writing` + dashboard card, `/admin/writing[/glyphs/:code]` (preview, publish, thresholds, try-it pad)                                                                                                                  |
| Tests         | unit `writing.test.ts`, `writing-ui.test.tsx` (+ content files: every shipped writing question right and wrong, device = server), SQL `010_writing_engine.sql`, integration `writing.test.ts`, e2e `writing.spec.ts` on phone, tablet and desktop |

## Phase 8.1 — audio reliability ✅

Hardening of the one audio service before Phase 9 (ADR-043, [audio-engine.md](audio-engine.md)):
request ids with stale-callback protection, waiting for the speech engine to let go before
speaking (WebKit / Android process `cancel()` late), one retry for a lost utterance, start /
end watchdogs, one playback state for `useAudio`, owner-scoped stop, on-device voices first,
long text split, iOS unlock on the first tap, tolerant token parsing, content-free
diagnostics; Stop, Start again and Read it again fixed. Tests: `audio-service.test.tsx`,
`audio-ui.test.tsx`, `pronunciation.test.ts`, e2e `audio.spec.ts` with an instrumented engine.
Still to do: confirm on real iOS Safari and Android devices.

## Phase 8.2 — audio pedagogical quality

Audio intents and per-level pacing (ADR-044, [audio-engine.md](audio-engine.md)): `audio`
learning rules (Normal / Slow per level as rate + pieces + pauses, phonics gaps),
`src/lib/audio/pacing.ts`, sounds and letter names as separate pieces, story pieces with
highlighting, blends from the grapheme split, recorded-audio model (migration
`20261010100100`: content keys, versions, kinds, letter-name recordings), the grown-ups'
audio check page with a timing log. Tests: `audio-pacing.test.ts`, the pacing block of
`audio-service.test.tsx`, `pronunciation.test.ts`, SQL `011_recorded_audio.sql`, e2e
`audio.spec.ts`. Still to do: the listening test on a real iPhone, Android phone and desktop
browser; recordings.

## Phase 8.3 — audio accuracy

Letter names, sounds and high-frequency words given to the voice in their surest form
(ADR-045, [audio-engine.md](audio-engine.md)): letter names as engine-native capitals from
the A–Z table (inline; alone "G."), single sounds in context and runs split, function
words kept with their word, citation form for a word alone, no raw letters in speech
(content fixed, importer and tests reject them, runtime guard), `explainSpeech`, the audio
check grouped by meaning with PASS / FAIL results, dev-only `audio.request` logs, recording
priorities (`npm run audio:priorities`). Tests: `audio-accuracy.test.ts` (plus updated
pacing, service, pronunciation and e2e audio tests). Real iPhone (iOS 18.7, Safari): all
tests PASS at KG1 and Grade 1 after two fixes from the first run (/s/ as `sah`, a slower
KG1 Normal). Still to do: the listening test on an Android phone and a desktop browser;
recordings.

## Phases

| #   | Phase                       | Status | Notes / next steps                                                                                                                                                                                                                                                        |
| --- | --------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Project foundation          | ✅     | Next 16, TS, Tailwind, lint, tests, docs                                                                                                                                                                                                                                  |
| 2   | Database and authentication | ✅     | Schema, RLS, email/password auth, password reset, parent profile (name, time zone), levels seeded by migration, DB-enforced family rules                                                                                                                                  |
| 3   | Multi-child system          | ✅     | Create/edit/archive (max 12), switcher, child mode + grown-up gate, forged child ids rejected                                                                                                                                                                             |
| 4   | Learning/content engine     | ✅     | Hierarchy, typed questions and activity config, registry (13 renderers), importer, templates, answer keys, engine services (Phase 3)                                                                                                                                      |
| 5   | Phonics                     | ✅     | Phase 4: phoneme model, word splits, 3 new activity types, blueprints, Phonics screen, Phonics Check. Next: recorded audio, more lessons per pattern, decodable readers                                                                                                   |
| 6   | Vocabulary                  | ✅     | Phase 5: word model, Word Explorer, My Words, 14 vocabulary activities, word mastery + review, search, parent progress. Next: illustrated pictures, recorded audio, more sets                                                                                             |
| 7   | Spelling                    | ✅     | Phase 6: spelling targets, checker + error analysis, 9 activities, input methods, dictation, hints, spelling mastery and pattern review, parent report. Next: recorded dictation audio, more lessons, speech input (future)                                               |
| 8   | Reading                     | ✅     | Phase 7: reading taxonomy, texts with decodability analysis, guided reading, 3 new activity types, reading lessons, sessions + help-word review, parent report, admin preview. Next: recorded story audio, more texts, illustrations                                      |
| 9   | Writing                     | ✅     | Phase 8: 25 writing skills, glyph-based handwriting (trace / copy / write, undo, typed alternative, order and direction), typed writing (copy, complete, rubrics, story writing, editing), 25 lessons, parent report, admin glyphs. Next: more glyph sets, teacher review |
| 10  | Assessment                  | 🟡     | Phonics Check playable and scored per area; placement config + scoring logic. Next: placement UI, reassessment timeline                                                                                                                                                   |
| 11  | Adaptive learning           | 🟡     | Mastery bands, prerequisites, review queue, next lesson and recommendations, daily plan. Next: mixed review sessions across skills, SRS                                                                                                                                   |
| 12  | Parent dashboard            | 🟡     | Stats, activities, average score, learning time, subject progress, skills, recommendations, badges. Next: monthly view, words list                                                                                                                                        |
| 13  | Games and rewards           | 🟡     | Stars, points, badges, streaks; MATCH, SORT, DRAG_DROP renderers. Next: MEMORY_MATCH, PHONICS_CLASSIFICATION                                                                                                                                                              |
| 14  | PWA/offline/sync            | 🟡     | Outbox, idempotent sync, SW. Next: fully client-side offline lesson loader from IndexedDB; background sync                                                                                                                                                                |
| 15  | Admin CMS                   | 🟡     | Guarded area, overview, word search. Next: reusable Zod-driven edit forms, CSV upload in UI, media upload with type/size validation                                                                                                                                       |
| 16  | Testing and optimisation    | 🟡     | CI for static checks and build. Next: DB + e2e tests in CI (Supabase CLI), axe accessibility checks, Lighthouse budget                                                                                                                                                    |

## Known limitations

- No recorded audio exists yet. Phonics sounds use speech synthesis checked to say the
  sound and never letter names (ADR-036, [audio.md](audio.md)). Consonants come out with
  a short "uh" (`suh`). /æ/ /ɛ/ /ɪ/ /ʊ/ /aʊ/ /ks/ /ɪd/ cannot be synthesised and are named
  by keyword ("the sound at the start of apple"), which weakens blending by ear. Voice
  quality depends on the device. Renderings were verified with espeak-ng only.
- Drag-and-drop works with a mouse; on touch screens tiles are tapped into place (drag on
  touch is on the Phase 13 list).
- Answer keys stop answers being read from the page, but small option sets can always be
  tried one by one on a modified client; the server's re-evaluation is what protects
  progress (ADR-021).
- Writing: handwriting is matched against a model letter with a tolerance, not recognised
  (a letter containing the target, such as o for c, passes); stroke order and direction are
  measured and shown but enforced only where a level asks. Open writing is checked by
  deterministic rubrics that do not understand meaning; spelling there is only suggested
  for words close to a known word, and run-together words are a tip (the word list cannot
  split unknown words reliably). Parents see the child's own words next to the checks.
  Glyphs are ball-and-stick print drawn for the app; no cursive. There is no AI grading and
  no teacher review queue yet (parents read the writing in the report).
- SPELLING and LISTENING are defined subjects without units of their own yet (spelling
  and listening activities sit inside phonics, reading and vocabulary lessons).
- A word can be practised only when some lesson asks about it: 307 of the 393 words have
  questions today; the others say "coming soon" in the Word Explorer.
- Picture upload needs Supabase Storage (hosted only; the Docker-free local stack has
  none), and no word has an uploaded picture or recording yet — emoji and speech
  synthesis are used. The Phase 5 storage policies gave admins no SELECT on the content
  buckets, so every upload (an upsert) was refused by RLS; this was missed because the
  upload had never been run on hosted (only the bucket and policy setup was checked).
  Fixed by `20261005100100` and verified on hosted at the database level (admin
  upload/read/overwrite allowed; parents and anonymous visitors refused), then end to end
  on production (2026-10-02) with a temporary admin: a PNG uploaded through
  `/admin/words/:id` was stored, recorded, linked, served by its public URL and shown on
  the page; a re-upload reused the same file and record; a fake PNG, a file over 1 MB and
  anonymous or parent uploads were refused. The test picture was removed afterwards.
  Hosted has no admin account (see `docs/development.md` to make one).
- Saving to My Words needs a connection (answers are still offline-first).
- Spelling: the spoken word of a listening / dictation question is on the device (speech
  synthesis needs its text), so instant feedback and the mistake panel are computed there
  from it; stored progress always comes from the server's own check against the real
  answer. Hints opened are reported by the device (they can only lower the child's own
  spelling mastery). The dictation replay limit applies per try. Speech input is not
  implemented. The error categories are transparent rules, not a diagnosis.
- The rate limiter is per server instance.
- Placement ("Find My Level") has data and logic but no UI yet; parents set the level
  manually. The Phonics Check is playable.
- Word splits are rule-based: four words are flagged for review on purpose; unusual
  spellings need an authored `segments` value.
- Phonics lessons are one per pattern (a blueprint); extra practice comes from the review
  queue and replays rather than more lessons.
- Pictures are emoji (render slightly differently per platform); `image_assets` is ready
  for illustrated images.

- Reading: nothing listens to the child read, so there is no words-per-minute, accuracy or
  pronunciation figure; fluency is shown as re-reads, listens and help taps only.
  Sentence highlighting follows the speech sequence (one sentence per utterance); word
  highlighting is word-by-word Slow reading, because browser word-boundary events are
  unreliable. A recorded whole-text clip plays without highlighting. Inflected forms are
  matched to their base word and share its decodability. Short written answers are not
  offered. There are 16 texts; illustrations are emoji until images are uploaded.

## Future extensions (not in scope yet)

British English, Arabic parent interface, professional audio, AI pronunciation and reading
feedback, more grades and languages, teacher accounts and classrooms, homework, printable
worksheets, notifications, email/PDF reports.
