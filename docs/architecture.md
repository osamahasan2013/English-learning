# Architecture

## Overview

```
Browser (PWA)                                     Server (Next.js)                  Supabase
───────────────────────────────────────────       ──────────────────────────        ─────────────
Parent UI  /parent/*   ─ Server Components ──────▶ loaders (RLS client) ──────────▶ Postgres + RLS
Child UI   /child/*    ─ Lesson player (client)                                   Auth (GoTrue)
   │ answers                                      /api/sync route
   ▼                                                 1. getUser()
IndexedDB outbox (Dexie) ── flush ─────────────────▶ 2. child owned? (RLS client)
IndexedDB lesson cache                               3. progress writer (service role)
Service worker (Serwist): app shell + visited pages     re-evaluate, store once, derive
```

- **Parent area** (`/parent/*`, `/onboarding`): server-rendered pages reading through the
  parent's RLS-scoped Supabase client. Mutations (child profiles, entering child mode) are
  Server Actions that re-check the session.
- **Child area** (`/child/*`): requires a signed-in parent plus an "active child" httpOnly
  cookie, re-verified against the parent's account on every request. Leaving it requires a
  grown-up gate (a multiplication question — a usability barrier, not security). While
  that cookie names one of the parent's children, grown-up pages and actions (parent area,
  settings, password change, admin) send the child back to `/child/home`
  (`requireParentMode()`); opening a link from an auth email leaves child mode. The
  installed app starts at `/child/home` (a parent without child mode is sent on to the
  dashboard).
- **Admin area** (`/admin/*`): `profiles.role = 'admin'` only. Admins manage content and
  have no access to family data (RLS).

## Foundation

### Route map

| Route                                                                   | Access                | Purpose                                      |
| ----------------------------------------------------------------------- | --------------------- | -------------------------------------------- |
| `/`                                                                     | public                | Landing; signed-in users go to the dashboard |
| `/login`, `/register`, `/forgot-password`                               | public                | Parent authentication                        |
| `/update-password`                                                      | signed in             | New password (after a reset link, or change) |
| `/auth/confirm`                                                         | public                | Email links (`token_hash` or `code`)         |
| `/onboarding`                                                           | parent                | First child profile                          |
| `/parent/dashboard`, `/parent/children[/new\|/:id]`, `/parent/settings` | parent                | Family area                                  |
| `/parent/phonics`                                                       | parent                | Phonics pattern search (filters, pages)      |
| `/parent/words[?child=]`                                                | parent                | Vocabulary progress + word bank search       |
| `/parent/spelling[?child=&page=]`                                       | parent                | Spelling progress and error analysis         |
| `/child/home`, `/child/learn/:lessonId`, `/child/rewards`               | parent + active child | Child area                                   |
| `/child/phonics[?show=…]`, `/child/check/:code`                         | parent + active child | Phonics screen; skill checks (Sound Check)   |
| `/child/words`, `/child/words/category/:code`, `/child/words/find`      | parent + active child | Vocabulary home, categories, word search     |
| `/child/words/:wordId[/practice]`, `/child/words/mine`, `…/practice`    | parent + active child | Word Explorer, word practice, My Words       |
| `/child/spelling`, `…/practice[?review=1]`, `…/dictation`               | parent + active child | Spelling home (Learn), practice, dictation   |
| `/child/spelling/words[?page=]`, `/child/spelling/review`               | parent + active child | My spelling words, spelling review           |
| `/admin/dashboard`, `/admin/words[/:id]`, `/admin/phonics`              | admin                 | Content admin, word pictures, review flags   |
| `/api/sync`                                                             | parent (POST)         | Progress sync                                |
| `/manifest.webmanifest`, `/sw.js`, `/offline.html`                      | public                | PWA                                          |

Routes from the product brief that are not built yet (`/child/reading`,
`/child/writing`, `/parent/assessments`, `/admin/lessons`, …) are deliberately absent until
their phase: there are no placeholder pages. `src/proxy.ts` redirects signed-out visitors
away from `/parent`, `/child`, `/admin`, `/onboarding` and `/update-password` (UX only;
pages re-check).

### Authentication and sessions

- Supabase Auth, email + password (8–72 characters). Server Actions in
  `app/(auth)/actions.ts`: `signUp` (stores display name and the browser's time zone as
  sign-up metadata; `handle_new_user()` creates the profile), `signIn`, `signOut`,
  `requestPasswordReset`, `updatePassword`. Validation schemas: `src/lib/validation`.
- Sessions are cookies managed by `@supabase/ssr`; `proxy.ts` refreshes them on each
  request. Authorization decisions use `getUser()` (verified with the auth server), never
  the unverified cookie, and RLS is the boundary for every query.
- Messages don't reveal whether an email has an account (login failure, password reset
  request); rate-limit responses from Supabase become a "wait a minute" message.
- `/auth/confirm` verifies email links and redirects with a **relative** `Location`: an
  absolute URL built from `request.url` can name another host (localhost vs 127.0.0.1, or
  an internal host behind a proxy) and lose the new session cookie.
- Signing in or out clears the active-child cookie, so a shared device never carries one
  family's child selection into another account.

### Family model and authorization

- One parent account → up to 12 child profiles (`children`), each with its own grade,
  learning level, daily minutes and progress. Create/edit via Server Actions in
  `app/parent/child-actions.ts`; removal is a soft delete through `archive_child()`, which
  keeps history but hides the child and its progress.
- Switching: the dashboard switcher (`?child=`) changes which child's progress is shown;
  "Start learning as …" (`enterChildMode`) sets the httpOnly active-child cookie after an
  ownership check; the grown-up gate returns to the dashboard to pick another child.
- Ownership is verified server-side everywhere a child id arrives from the browser:
  `getOwnedChild()` (RLS lookup) for pages, actions and the active-child cookie, and the
  sync endpoint's RLS lookup before any write. A forged or foreign id finds nothing.

### Configuration

`src/lib/env.ts` validates configuration lazily. When the public Supabase settings are
missing, the app still builds and the root layout renders a "not set up yet" screen that
names the missing variables (never their values); `/api/sync` answers 503 so devices keep
their unsynced answers. `NEXT_PUBLIC_*` values are inlined at build time, so they must be
present for `npm run build`. The service-role key is read only on the server.

### Design system

- Tokens are CSS variables in `src/app/globals.css`, exposed to Tailwind v4 via
  `@theme inline` (`bg-primary`, `text-muted`, `bg-success-soft`, …). High-contrast and
  larger-text variants are `data-` attributes on `<html>` set per device
  (`components/layout/display-preferences.tsx`); reduced motion follows the OS.
- Primitives in `src/components/ui`: `Button` (+ `buttonClasses` for links), `Card`,
  `Field`/`Input`/`Select`, `Alert`, `EmptyState`, `Spinner`, `ProgressBar`. Feedback
  always pairs colour with an icon and words. Child-sized targets use `size="xl"` (≥ 80 px).
- No component library dependency: the primitives are small, accessible and themed by
  tokens (ADR-015).

### Shells and states

- Root layout: skip-to-content link, display-preference script, service worker registration.
  Every shell renders a `<main id="main">`.
- `AppShell` (`components/layout/app-shell.tsx`): parent and admin areas; navigation marks
  the current page with `aria-current` and scrolls horizontally on phones.
- The child layout is its own, simpler shell (avatar, offline badge, grown-up gate).
- Error boundaries: `app/error.tsx` (public pages), `app/parent/error.tsx` and
  `app/admin/error.tsx` (message + digest for grown-ups), `app/child/error.tsx`
  ("Something went wrong. Let's try again." only), `app/global-error.tsx` (root layout
  failure). Loading: `loading.tsx` in parent, child and admin. Empty states use
  `EmptyState` with a reason and, where possible, a next step.

## Data-driven learning engine

Hierarchy: LEVEL → SUBJECT → UNIT → SKILL → LESSON → ACTIVITY → QUESTION → ANSWER →
ATTEMPT → PROGRESS → SKILL MASTERY (see `docs/database.md`). Content is authored in
`content/` and imported; nothing about a specific lesson exists in code. The
`lesson_catalog` view flattens level → subject → unit → skill → lesson for the engine
(a security-invoker view, so RLS still decides what a family sees).

**Levels and subjects** are rows (`levels`: KG1, KG2, KG3, GRADE1, GRADE2; `subjects`:
PHONICS, READING, VOCABULARY, SPELLING, WRITING, LISTENING, SENTENCE_BUILDING, GAMES,
ASSESSMENT). A unit belongs to one level and one subject, which is how a subject is
organised within a level.

**Activity types.** A question's `question_type` picks a renderer
(`src/features/activities/registry.tsx`); there is no page per activity:

| Type                                                    | Renderer                                     | Child's response   |
| ------------------------------------------------------- | -------------------------------------------- | ------------------ |
| `INTRO`                                                 | explanation / demonstration                  | — (unscored)       |
| `MULTIPLE_CHOICE`, `LISTEN_AND_CHOOSE`, `PICTURE_MATCH` | `ChoiceRenderer`                             | an option          |
| `READING`                                               | passage (activity config) + choice           | an option          |
| `MISSING_LETTER`                                        | fill the gap in a word                       | a letter/pattern   |
| `WORD_BUILDER`                                          | sound tiles + blending demo                  | tiles in order     |
| `SENTENCE_BUILDER`                                      | word tiles                                   | tokens in order    |
| `DRAG_DROP`                                             | fill a sentence from a bank                  | one word per blank |
| `MATCH`                                                 | two columns, numbered pairs                  | pairs              |
| `SORT`                                                  | items into 2–4 groups                        | item → group pairs |
| `SPELLING`                                              | type the word you hear                       | text               |
| `WRITING`                                               | write a word / finish a sentence (word bank) | text               |
| `TRACING`                                               | trace a letter on a canvas                   | coverage 0–100     |

Tap is the primary interaction everywhere (drag works with a mouse too), with icons,
words and audio; feedback never relies on colour alone.

**Typed data, validated twice.** Question `content`/`answer` JSON is validated by
`src/lib/content/question-schemas.ts` (plus cross-field rules: a choice answer names an
option, every MATCH/SORT item is paired once, DRAG_DROP answers come from the bank...).
Activity `config` is validated by a strict per-type schema
(`src/lib/content/activity-config.ts`, e.g. `maxTries`, a READING passage, `showModel`
for tracing). The importer rejects invalid content before it is published; the lesson
loader validates again and skips (and logs) anything invalid, so a content mistake never
breaks a lesson. The database adds guards of its own: a scored question cannot be
published without an answer, `maxTries` must be 1–3.

**Answers stay on the server** (ADR-021). Signed-in users have no SELECT on
`questions.answer`. The lesson loader (`src/lib/server/lesson-loader.ts`) reads answers
with the service role for the published questions RLS returned and ships an _answer key_
instead: salted SHA-256 digests of the answer's canonical forms
(`src/lib/learning/answer-key.ts`). The device checks a response — including near
misses — offline and instantly; after the last try it recovers the answer only by
testing what is already on screen. The server re-evaluates every stored answer against
the real answer (`src/lib/learning/evaluate.ts`, sharing the same canonical forms), so a
modified client cannot forge progress.

**Engine rules are data.** Mastery bands, evidence, review, prerequisite, player and
scoring numbers have defaults in `src/lib/learning/rules.ts` and can be overridden per rule
set in `learning_rules` (validated; an invalid override is ignored and logged). Feedback
words (`CORRECT`, `INCORRECT`, `TRY_AGAIN`, `ALMOST_CORRECT`, `COMPLETED`) come from
`feedback_messages`; `{answer}` is filled in.

**Lesson player** (`src/features/lesson-player`): Intro → Activities → Summary for any
lesson. The intro shows the lesson, its subject/level and length and reads `intro_speech`
aloud; if prerequisites are not ready it offers the prerequisite first or a sneak peek
(see below). Each step has a progress indicator, immediate feedback (correct, almost,
try again, the answer with an explanation), Back (read-only review of finished steps) and
Next, and an Exit that asks first. The flow is a pure, serializable reducer
(`src/lib/learning/lesson-session.ts`); its state is saved to IndexedDB after every change,
so closing the tab or exiting never loses the child's place ("Keep going" on return). Only
first tries are scored; a step allows `maxTries` tries (default 2).

**Prerequisites** (`src/lib/learning/prerequisites.ts`) are guidance, not locks: skill
prerequisites are ready from `PRACTICING` (configurable), lesson prerequisites once
completed; skills from a level below the child's current level are assumed known until
practice shows otherwise. A lesson that is not ready shows "This one is a stretch!" with a
link to practise the prerequisite, a sneak peek (the first `previewSteps` steps; answers
count as practice, no lesson run is recorded) or the whole lesson.

**Service interface** (`src/lib/server/learning-engine.ts`): `getNextLesson(childId)`,
`getRecommendedLessons(childId)`, `getWeakSkills(childId)`, `getReviewItems(childId)` and
`getLessonReadiness(childId, lessonId)`. Each loads the child with the parent's RLS client
first, so another family's child id is simply not found. The selection rules are pure
functions in `src/lib/learning/engine.ts`: next = the first unfinished lesson on the
level path whose prerequisites are ready; recommendations = continue a started lesson,
the next lesson (after its missing prerequisite), then due review items — each with a
reason.

## Phonics engine (Phase 4)

Phonics is content and pure logic on top of the learning engine — no separate mastery,
progress or assessment system (ADR-024 – ADR-027).

- **Model.** `phonemes` (39 ARPAbet sounds) are what is said; `phonics_patterns` (letters,
  digraphs, blends, magic e, vowel teams, r-controlled, endings, suffixes) are what is
  written. Each pattern has one or more pronunciations (`phonics_pattern_sounds`, each a
  phoneme sequence: TH = TH or DH, ED = T, D or IH D), a stage in the 14-step progression
  (`phonics_stages`), a position, relations to other patterns, and — for letters — the
  upper case and the letter NAME, kept apart from its SOUND.
- **Words.** `src/lib/learning/phonics.ts` splits every word into graphemes with their
  phonemes (`word_segments`: ship = sh·i·p = SH IH P; cake = c·a·k·e with the e silent;
  box has four sounds). Consonant digraphs are always one unit; other multi-letter patterns
  only when the word is linked to them; anything doubtful becomes a `content_flags` row for
  admins instead of a guess, and a CSV `segments` column overrides the split. The split
  gives each word a shape (CVC, CCVC…) and a decodable flag.
- **Activities.** Three new types, each with Zod schemas, an evaluator branch, answer-key
  handling and a renderer: `BLEND_SOUNDS` (tap each sound, slow blend, blend, choose the
  word), `SEGMENT_WORD` (how many sounds? then tap the phoneme cards in order; the count is
  its own error type) and `FIND_PATTERN` (tap the letters that make the sound). Letter
  intros show the name and the sound on separate buttons. The other phonics activities
  (beginning/middle/end sound, sound → letter, pattern → word, sort by pattern or by
  sound, missing letters, word builder, listen and choose, read the word, spell the word)
  are templates over the existing types.
- **Lessons.** Lesson blueprints (`src/lib/content/lesson-blueprints.ts`) expand one
  data line into a full lesson at import time — `letter_sound`, `cvc_blending` and the
  eight-step `phonics_pattern` (hear → see → practise → sort → read → spell → write →
  sentence → quick check).
- **Progress.** Phonics skills use ordinary skill mastery; `src/lib/learning/phonics-progress.ts`
  turns it into stars for children (0–3 per skill, combined per stage) and percentages for
  parents, plus "Practise sh" suggestions from the review priority.
- **Assessment.** The Phonics Check is an `assessments` row whose items are grouped into
  areas (letter recognition … spelling). It runs in the lesson player
  (`loadAssessmentPayload`; one try per question); answers carry the assessment sitting id,
  and the server scores each area (`src/lib/learning/assessment-scoring.ts`), stores an
  `assessment_results` row, updates mastery from the same answers and sets
  `last_assessed_at`.
- **Screens.** `/child/phonics`: six large cards (Letters, Sounds, Blend, Read Words,
  Practice, Mastery) with a spoken instruction for each; `/parent/phonics` and
  `/admin/phonics`: server-side search with type/stage/level filters and pagination
  (`searchPhonicsPatterns`), example words loaded for the visible page only; admins also see
  the review flags.

## Vocabulary engine (Phase 5)

Vocabulary is content and word-level views of the learning engine (ADR-029 – ADR-032).

- **Model.** `words` (the bank) with configurable `word_categories` (a sub-category has
  a parent; a word points at its most specific category), `word_levels` (every level a
  word suits; `words.level_id` is the introducing one), curated example sentences
  (`word_sentences` → the sentence bank, so a future Sentence Engine reads the same rows),
  typed relations (synonym, antonym, related, family, rhyme, plural, verb form, adjective
  form), word families (`word_families` with a rime and the phonics pattern of its vowel;
  members derived from grapheme splits), and media (`image_assets`/`audio_assets` in
  Storage). Phonics comes from Phase 4: the word's split (`word_segments`) answers "which
  words practise SH?", its shape "which are CVC?".
- **Lessons and activities.** A `vocabulary_set` blueprint turns 4–8 words into a lesson
  whose structure grows with the level (see docs/curriculum.md). Fourteen activity kinds
  are templates over existing types: picture → word, word → picture, listen → choose,
  word → meaning, meaning match, picture match, missing letter, word builder, spelling,
  sentence completion (DRAG_DROP), choose the correct word, sort by category, which one
  goes with the category, odd one out and "which sentence makes sense?". Distractors are
  chosen from the bank by rules at import (`src/lib/content/vocabulary.ts`, ADR-030).
- **Word Explorer** (`/child/words/:id`): picture, the word with Listen / Slow / Again
  (a recording when one exists), meaning, example sentence, the sound strip (tap a
  grapheme, then Blend), word family and opposites, Save to My Words, and Read / Spell /
  Listen / Practice — only for areas that have questions.
- **Practice.** `loadWordPracticePayload` picks published lesson questions about the
  chosen words (most urgent first, varied by area, `vocabulary.practiceQuestions` long)
  and the ordinary player plays them with `payload.practice` set: answers carry no lesson
  run and no run is recorded. My Words practice takes the due/weak saved words first.
- **Progress.** The progress writer recomputes, per answered word: `word_progress`
  (attempts, accuracy, mastery status and score from `computeMastery` with the vocabulary
  evidence target, practice days, review priority and date, first seen, last reviewed,
  saved), `word_area_progress` and the word's review item (`missed_word`, `weak_word`, or
  `due_review` for saved words). A word is saved automatically when first answered right
  unless the family chose otherwise; saving/removing and "first seen" go through
  `set_word_saved` / `note_word_seen` (ownership-checked database functions).
- **Screens.** `/child/words` (My Words, New Words, Practice, Categories, Word Explorer;
  categories with progress bars), `/parent/words` (learned / practised / mastered, weak
  areas and categories, words to practise, recent words, and the word bank search),
  a Words card on the parent dashboard, `/admin/words` (all filters) and
  `/admin/words/:id` (details and picture upload). Searches run in the database with
  pagination (`searchWords`); category totals come from the `word_category_stats` view.

## Spelling engine (Phase 6)

Spelling reuses the word bank, the phonics data and the learning engine (ADR-033 –
ADR-035): no separate lesson, activity, attempt, mastery, review or assessment system.

- **Model.** `spelling_words` marks which words of the bank are spelling targets and holds
  only the spelling view of them: spelling level and skill, spelling type
  (`spelling_types`, an extensible list: CVC … MULTISYLLABIC), focus phonics pattern,
  difficulty, high-frequency flag, irregular flag + irregular part (and its grapheme
  positions), authored hints, common errors, a dictation sentence (a sentence-bank row) and
  an optional recording. Text, grapheme split, phonemes, syllables and meaning stay in
  `words` / `word_segments`. Spelling skills are ordinary skills in SPELLING units.
- **Checker** (`src/lib/learning/spelling.ts`, pure, deterministic, no external AI).
  `normalizeSpelling` trims, lower-cases and collapses spaces — nothing is autocorrected
  and the child's text is stored as typed. `analyzeSpelling` returns correct / exact /
  normalised text / the letter diff (insert, delete, substitute, swap) / one error category
  (MISSING_LETTER, EXTRA_LETTER, SUBSTITUTED_LETTER, TRANSPOSITION, WRONG_VOWEL,
  WRONG_DIGRAPH, WRONG_BLEND, WRONG_ENDING, PHONETIC_APPROXIMATION, UNKNOWN) and the
  grapheme and phonics pattern the mistake is in, using the word's split (ship → sip is a
  wrong digraph in SH). `analyzeSentence` adds word order, missing / extra words and
  capitals / end marks for sentence dictation.
- **Activities.** Nine spelling activities run on four renderers, recorded per question as
  `metadata.spellingActivity`: LISTEN_AND_TYPE, DICTATION and SOUND_TO_WORD (`SPELLING`,
  content `mode` listen / dictation / sounds), BUILD_THE_WORD and SCRAMBLED_WORD
  (`WORD_BUILDER`, mode build / scrambled), MISSING_LETTER and MISSING_SOUND
  (`MISSING_LETTER`, mode letter / sound), WORD_TO_SOUNDS (`SEGMENT_WORD`) and the new type
  `SENTENCE_DICTATION`. The `spelling_set` blueprint builds a spelling lesson: listen & look
  → segment → build → missing letter/sound → spell (check → mistake explained → retry, up
  to three tries) → sounds to word / scrambled → sentence dictation → one-try check.
- **Input and settings.** Each typing step gets `step.spelling` from the lesson loader:
  input method (KEYBOARD, ON_SCREEN_KEYBOARD — the child keyboard, LETTER_TILES, DRAG_DROP),
  hints allowed and dictation replays / slow replay — from the activity config, else the
  level's spelling rules (`rules.spelling.levels`, overridable in `learning_rules`). React
  components only render what they are given. Speech input is not implemented (future).
- **Feedback.** Before answering, the player offers progressive hints (listen again → say it slowly → how many sounds? → the tricky part / the pattern / the first letter; generated at import, authored hints before the last) and reports how many were opened (`hintsUsed`). After a wrong
  answer it names the mistake with the error category's `feedback_messages` row (which may name the pattern: "Remember: SH makes one sound.") and marks
  the child's letters ✓ / ✗ / + / _ (never by colour alone); the right word is shown only
  once it is revealed. The device's analysis uses the spoken word the question carries;
  the server stores its own from the real answer.
- **Progress.** The writer stores `hints_used`, `spelling_analysis` and `error_pattern_id`
  on the attempt and the category in `error_type`, then recomputes `spelling_progress`
  (mastery algorithm, spelling evidence target, only answers right without a hint count as
  independent) for answered spelling targets, their review item (`spelling:<word>`:
  `missed_spelling`, `weak_spelling`, `due_review`) and the review item of each phonics
  pattern misspelled at least twice in 14 days (`pattern:<pattern>`, `spelling_pattern`,
  sent to the pattern's phonics lesson and offering the spelling targets with that pattern for practice, resolved after two right spellings). For spelling
  targets the vocabulary queue ignores spelling answers, so one miss makes one item;
  vocabulary word mastery is not changed by the spelling model.
- **Screens.** `/child/spelling` (Learn: the level's spelling lessons with stars, words mastered, word families to practise; Practice (`?review=1`, `?pattern=`, `?family=`);
  Dictation; My spelling words; Review — words and sounds), `/parent/spelling` (words
  spelled / mastered, first-try accuracy, hinted answers, mistake kinds with meanings,
  phonics patterns behind mistakes, improvement per week and average answer time, recommended practice, spelling types, word families, words to practise, the
  latest answers as written, paginated) and a Spelling card on the dashboard. Counts come
  from the `spelling_error_counts` / `spelling_pattern_errors` views (security invoker).

## Progress pipeline

1. The child answers. The player writes an `attempt` event (device-generated UUID, the
   lesson run id and the learning session id) to the IndexedDB outbox **before** showing
   feedback, then checks the response against the answer key. At the end it writes a
   `lesson_run` event (not for a sneak peek). In a skill check the answers carry
   `assessmentId` + `assessmentAttemptId` instead of a run, and the end writes an
   `assessment_run` event.
2. `SyncProvider` flushes the outbox on load, on reconnect, when the app returns to the
   foreground, after each answer and every 30 s while anything is pending.
3. `POST /api/sync` authenticates, rate-limits, validates (Zod), confirms the child belongs
   to the parent via RLS, then calls `processSyncBatch` (`src/lib/server/progress-writer.ts`).
4. The writer makes sure each named learning session exists for this child (a session id
   belonging to another child is never shared — the event is detached from it), refuses
   answers to unpublished questions, tries beyond the question's `maxTries`, replayed first
   tries and lesson-less questions outside an assessment sitting, re-evaluates
   every answer (the device never sends correctness), stores attempts with a per-answer
   score (100 first try / 50 after feedback / 0) and runs with `on conflict (id) do
nothing`, scores a run only from first tries at that (published) lesson's own questions
   and only when at least half of them were answered (ADR-028), then recomputes from history:
   activity progress → lesson progress → skill mastery and the review queue → My Words →
   spelling progress and spelling / pattern review items → subject and level progress →
   session totals → rewards and achievements. Every step is
   idempotent, so retries and duplicates converge.
5. The device removes only events the server confirmed (`stored`/`duplicate`). Rejected
   events are kept as `failed` with a reason and shown in parent Settings, where they can be
   retried.

Progress levels (all derived, all per child): activity (`activity_progress`), lesson
(`lesson_progress`), skill (`skill_mastery`), subject within a level (`subject_progress`),
level (`level_progress`), each with a `NOT_STARTED` / `IN_PROGRESS` / `COMPLETED` status,
answer counts, accuracy, score and timestamps. Learning sessions (`learning_sessions`)
group activity on a device, ending after 30 minutes without an answer
(`src/lib/learning/learning-session.ts`).

Conflict policy: history is append-only, so there are no write conflicts — the union of all
devices' events is the truth. Derived tables are recomputed from that union. Device
timestamps are clamped to [now − 60 days, now + 5 min].

## Adaptive learning (V1, rule-based)

- `src/lib/learning/mastery.ts` — per skill, from the latest 30 first tries: accuracy
  (weighted to the latest 10) × evidence (min(1, attempts / 10)) = mastery score; status by
  configurable bands NOT_STARTED 0 · LEARNING 1–39 · PRACTICING 40–69 · ALMOST_MASTERED
  70–89 · MASTERED 90+ (MASTERED also needs practice on two days); review schedule.
- `src/lib/learning/review-queue.ts` — the review queue (`review_items`): every practised
  skill is scheduled; weak skills, recent mistakes and missed words are due now; items are
  resolved when no longer needed.
- `src/lib/learning/engine.ts`, `recommendations.ts` — next lesson, recommendations, weak
  and strong skills, "Practice X" messages.
- `src/lib/learning/daily-plan.ts` — today's plan from the parent's daily minutes, weak and
  due skills first.
- `src/lib/learning/scoring.ts` — raw score, percentage, accuracy, per-answer score,
  stars/points, time.

## Audio

`src/lib/audio/audio-service.ts` is the only audio entry point: plays a recorded asset if
one exists, otherwise speaks with browser speech synthesis (en-US, rate 0.85; "Slow" 0.55),
preferring natural voices. It never throws; without audio the app still works because all
text is shown. Replacing TTS with recordings means filling `audio_assets` — no component
changes. Phonics sounds use `phonics_pattern_sounds.say_as` / `phonemes.say_as` as a TTS
approximation until recordings exist (`phonics_patterns.audio_asset_id` takes a recording).
Word recordings are `audio_assets` files in the `content-audio` bucket (public URL); the
Word Explorer passes them to the service and falls back to speech synthesis. Every spoken
item has **Listen**, **Slow** and **Again** (`AudioControls`); when a device
cannot speak, the controls and the lesson player show a visible "no sound" note, and
nothing waits for audio, so a lesson can always be finished.

## Offline / PWA

- Manifest (`src/app/manifest.ts`), icons in `public/icons` (generated by
  `scripts/icons/generate.mjs`).
- Service worker (`src/sw.ts`, built by `serwist build`): precaches the static bundle and
  keeps network-first copies of visited pages (14 days, 80 entries). A page never opened
  on the device, requested offline, gets `public/offline.html` — plain HTML with no app
  JavaScript, because a Next.js page served under another URL fails to hydrate (ADR-016).
  Only registered in production builds.
- `OfflineNavigation` turns in-app link taps into full loads while offline so the worker
  can answer from saved pages; `useOffline` covers dropped connections during Server
  Actions and navigations.
- Lesson payloads are also cached in IndexedDB (`lessons` store) for a future fully
  client-side offline loader.
- Signing out deletes saved pages and cached lessons from the device but keeps unsynced
  answers (they can only be accepted for a child of the parent who signs in next).

## Security

- RLS on every table (`supabase/migrations/20260929100600_rls_and_grants.sql`), explicit
  grants, column-level grants for user-editable columns, no user write access to progress.
- Service-role key is server-only (`getServerEnv()` throws in the browser) and used by two
  modules: the progress writer (after the sync route's ownership check) and the lesson
  loader (only to turn published answers into digest-only answer keys; ADR-021).
- Correct answers are never readable by signed-in users (`questions.answer` has no SELECT
  grant) and never sent to the browser in plain text.
- Server Actions and the sync route re-check `getUser()`; redirects are same-site only.
- Uploaded pictures are validated from their bytes (type, size, dimensions, alt text) and
  stored by admins only in a type- and size-limited Storage bucket (ADR-031).
- Security headers in `next.config.ts`. Rate limiting on `/api/sync` (in-memory, per
  instance — see ADR-009).
- Structured logs without personal data (`src/lib/logging.ts`).

## Error handling

See "Shells and states" above. Children never see technical details; grown-ups see the
message and a digest that matches the server log line. An offline indicator is shown in
both the parent and child areas.
