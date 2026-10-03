# Architecture decisions

Each entry: context, decision, consequences. Add a new entry (don't rewrite old ones) when a
decision changes, stating what changed, why, impact and migration needs.

## ADR-001 — Separate app in its own folder of the existing repository (superseded by ADR-020)

**Context.** The repository holds the Precast Elements Monitoring System; the owner asked
for a new, separate app. This session can only push to this repository.
**Decision.** Build the app self-contained in `english-learning/` (own `package.json`,
lockfile, Supabase migrations, docs). It shares no code or database with the precast app.
**Consequences.** It can be moved to its own repository at any time with history
(`git subtree split --prefix english-learning`). Deploy with the project root set to
`english-learning/`. Working product name "Word Garden" is a placeholder (`src/lib/app-info.ts`).

## ADR-002 — Next.js App Router + Supabase

Server Components read through the parent's RLS-scoped client; mutations are Server Actions
or one Route Handler (`/api/sync`). Serwist runs via its CLI under Turbopack, and
`proxy.ts` refreshes the Supabase session.

## ADR-003 — Content as data, imported from files

**Decision.** The curriculum is authored as JSON/CSV in `content/` and upserted by natural
key (`npm run content:import`). The admin CMS (Phase 15) will call the same importer.
**Why.** Reviewable diffs, CI validation (`tests/unit/content-files.test.ts`),
reproducible environments, and bulk editing today without waiting for CMS forms.
**Consequences.** Imports never delete; removed lessons/activities/questions are archived
so history stays valid.

## ADR-004 — Self-describing questions (JSON content + answer) instead of an `answers` table

**Decision.** `questions.content` and `questions.answer` are JSON, validated per
`question_type` by Zod on import and on load.
**Why.** Activity types differ widely (choices, gaps, tile orders, sentence orders);
generic JSON with strict per-type schemas keeps one renderer contract and lets new types be
added without schema migrations.
**Consequences.** Answers are readable by signed-in users (needed for instant, offline
feedback). Correctness is never trusted from the device — the server re-evaluates.

## ADR-005 — Server writes progress with the service role after an RLS ownership check

**Decision.** Parents have SELECT-only access to progress tables. `/api/sync` verifies the
child through the parent's RLS client, then `progress-writer.ts` writes with the service
role, re-evaluating answers and deriving scores.
**Why.** Scores, stars and mastery must not be forgeable by a client calling the REST API
directly, and mastery rules stay in tested TypeScript.
**Consequences.** `SUPABASE_SERVICE_ROLE_KEY` is required on the server. The key is used in
exactly one module.

## ADR-006 — One `activity_attempts` table for all answer kinds

Instead of separate reading/spelling/writing attempt tables, one immutable table with
`question_type`, `error_type`, `word_id`, `lesson_run_id`, `assessment_attempt_id`. Views
or specialised tables can be added when a modality needs extra columns (e.g. writing stroke
metrics, read-aloud word timings).

## ADR-007 — Derived progress tables; `skill_mastery` doubles as the review queue (review queue superseded by ADR-022)

History is append-only; `lesson_progress`, `skill_mastery`, `word_progress` are caches
recomputed from it after each sync. The review queue is `skill_mastery` ordered by
`review_priority` / `next_review_at` rather than a separate table. Any cache can be rebuilt.

## ADR-008 — Offline-first outbox with device-generated ids

Every event is written to IndexedDB (Dexie) before sending; the server stores each id once
(`on conflict do nothing`). Only confirmed events are removed; rejected ones are kept as
failed and shown to the parent. Conflict policy: union of all devices' history.

## ADR-009 — In-memory rate limiting for `/api/sync`

Good enough for a single instance; move to a shared store (e.g. Redis/Upstash) before
horizontal scaling.

## ADR-010 — Rule-based adaptive learning in V1

Transparent rules (docs/curriculum.md) that parents can be told about; no ML. The mastery
function takes plain attempt lists, so it can be replaced without schema changes.

## ADR-011 — Browser speech synthesis behind an audio service

`src/lib/audio` plays recorded assets when present, otherwise TTS. Isolated phoneme sounds
use `say_as` approximations. Recordings can replace TTS item by item. _(Refined by
ADR-036: sounds are tokens resolved by a pronunciation resolver.)_

## ADR-012 — Child mode on the parent's session

Children do not have accounts. A parent hands the device over by choosing a child; an
httpOnly cookie remembers which child, re-verified server-side each request. A grown-up
gate (multiplication question) keeps children in the child area — a usability barrier, not
a security boundary. Keeps COPPA-sensitive data minimal: no child credentials, optional DOB,
first name/nickname only.

## ADR-013 — Emoji as V1 pictures

Zero bytes, offline, no licensing. `image_assets`/`words.image_asset_id` are ready for
illustrations; renderers will prefer an image when present.

## ADR-014 — Docker-free local stack for development and CI

Docker images could not be pulled in the authoring environment. `scripts/local-stack/`
runs PostgreSQL, the Supabase auth server (GoTrue) and PostgREST behind a small gateway,
applying the same migrations. `npx supabase start` remains the preferred path where Docker
is available; both run the same migrations and tests.

## ADR-015 — Own UI primitives instead of a component library

**Context.** The brief suggests shadcn/ui "where appropriate". **Decision.** Keep a small
set of hand-written, token-themed primitives (`src/components/ui`) and native elements
(`<dialog>` for the grown-up gate). **Why.** The child UI needs unusually large targets and
custom feedback; the parent UI needs only a handful of controls; no Radix/cva dependency is
justified yet. **Revisit** when the admin CMS needs complex widgets (combobox, data table,
dialogs with focus management) — adopt shadcn/ui components individually then.

## ADR-016 — Lazy configuration and a static offline fallback

**Configuration.** `src/lib/env.ts` used to validate at import time, which made
`next build` fail without Supabase credentials (so CI could not build and a fresh deploy
crashed). It now validates on first use; an unconfigured build renders a "not set up yet"
screen naming the missing variables, and `/api/sync` returns 503 (devices keep their
data). Impact: none for configured deployments; no migration.

**Offline fallback.** A first attempt served the Next.js `/offline` route as the service
worker fallback; served under another URL it failed to hydrate (React error #418) and could
render blank. The fallback is now `public/offline.html`, plain HTML with inline styles and
no app JavaScript. Impact: the page doesn't use the Tailwind build; keep its few colours in
sync with `globals.css` by hand.

## ADR-017 — CI scope

`.github/workflows/ci.yml` (originally `english-learning.yml`, see ADR-020) runs
typecheck, lint (warnings fail), format check, unit/component tests and a production build
**without credentials**. SQL and e2e tests need a Supabase backend; they run locally
for now and move to CI with the Supabase CLI in Phase 16.

## ADR-018 — Family rules and levels live in the database

**Context.** Parents hold a session that can call the REST API directly, so rules checked
only in Server Actions can be bypassed. **Decision.** Migration
`20260930100100_parent_profiles_and_family_rules.sql` enforces them in Postgres: published
levels only, at most 12 active children per family, valid IANA time zones, trimmed names.
The app keeps its own (friendlier) validation in `src/lib/validation`, and maps the
database's error codes (`CHILD_LIMIT_REACHED`, `LEVEL_NOT_AVAILABLE`, `INVALID_TIME_ZONE`)
to messages. The five learning levels are seeded by migration
(`20260930100200_seed_levels.sql`) because the app cannot onboard a family without them;
all other content stays in `content/` and the importer, which treats the seeded levels as
unchanged. **Impact:** a fresh database works without a content import (verified).

## ADR-019 — Password reset and relative auth redirects

Password reset uses Supabase's recovery email → `/auth/confirm` (recovery session) →
`/update-password`. Requests always answer "if an account exists…" to avoid revealing
accounts. `/auth/confirm` redirects with relative `Location` headers: an absolute URL
built from `request.url` pointed at `localhost` while the browser used `127.0.0.1`, which
dropped the session cookie (found by the e2e test; the same would happen behind a proxy
with a different internal host).

## ADR-020 — Own repository

**What changed.** The app moved out of the Precast Elements Monitoring System (PEMS)
repository into this repository, `English-learning`, with its full commit history
(`git subtree split`), and the folder was removed from the PEMS repository.
**Why.** The owner asked for a completely separate app. As a folder inside the PEMS
repository, it was type-checked by the PEMS build (whose `tsconfig` includes every `.ts`
file in the repository) and broke the PEMS Vercel preview deployments. PEMS production was
never affected.
**Impact.** The app lives at the repository root; CI moved to `.github/workflows/ci.yml`
without path filters; deploy with the repository root as the project root. It shares no
code, database, Supabase project or deployment with PEMS.

## ADR-021 — Answers stay on the server; the device gets digest answer keys

**Context.** Offline-first feedback (ADR-008) meant each lesson payload carried the correct
answers, and `questions.answer` was readable by every signed-in user. The Phase 3 brief:
do not expose correct answers to the client before submission; evaluate on the server
where possible.
**Decision.** Signed-in users (admins included) have no SELECT on `questions.answer`. The
lesson loader reads answers with the service role — only for the published question ids
the parent's RLS query returned — and ships an _answer key_: salted SHA-256 digests of the
answer's canonical forms (one per accepted value or sequence, one per pair, one per
position for near-miss detection; tracing ships its public coverage threshold). The
device verifies a response offline by hashing it the same way; after the last try it
recovers the answer to show only by testing what is on screen. `evaluate.ts` and
`answer-key.ts` share the canonical forms, and a unit test checks every shipped question
gives the same verdict both ways. The server still re-evaluates every stored answer
against the real answer.
**Consequences.** No plaintext answer in the page, the lesson cache or the REST API.
Small option sets can still be brute-forced on a modified client (four options = four
tries); that only affects the child's own instant feedback, never stored progress. The
lesson loader is a second, narrowly scoped user of the service-role client. Content
tooling reads answers with the service role (the importer already did).

## ADR-022 — Explicit review queue and a progress model per hierarchy level

**Decision.** Replace "`skill_mastery` doubles as the review queue" (ADR-007) with a
`review_items` table: one open item per skill or word, with priority, due date and reason,
resolved rather than deleted. Add derived `activity_progress`, `subject_progress`,
`level_progress` and `learning_sessions`, and give `lesson_progress` a status, answer
counts and accuracy. All of them are recomputed from append-only history by the progress
writer, like the existing caches. Sessions are identified by a device-generated id
carried on every event (a new one after 30 minutes idle); the server never lets one child's
session id collect another child's events.
**Why.** The Phase 3 brief asks for progress at every level of the hierarchy, a session
model and a review queue that can reference words and patterns as well as skills — and a
queue table is what later spaced-repetition work will extend.
**Consequences.** More derived rows per sync (bounded by the lessons touched); every cache
can still be rebuilt from history.

## ADR-023 — Engine rules and feedback words are data

**Decision.** Mastery bands and evidence, prerequisite readiness, review, player
(`maxTries`, session timeout) and scoring numbers live in `src/lib/learning/rules.ts` as
Zod-validated defaults that the `learning_rules` table can override per rule set; an
invalid override is ignored and logged. Feedback words are `feedback_messages` rows. The
subject list became the nine content categories of the brief (PHONICS … ASSESSMENT); the
Phase 2 subjects LETTERS, BLENDING, SIGHT_WORDS and SENTENCES were folded into PHONICS,
READING and SENTENCE_BUILDING and archived (units were re-pointed by the importer).
**Why.** The brief requires configurable thresholds and feedback without strings in
components, and subjects as content categories.
**Consequences.** Changing a band is a data change, reviewed like content. The defaults
stay in code so a fresh database works without any rule rows.

## ADR-024 — Graphemes and phonemes are separate data; words carry their split

**Decision.** Sounds are an inventory of 39 ARPAbet phonemes (`phonemes`); each pattern
pronunciation is a phoneme sequence; every word is stored as grapheme segments with their
phonemes (`word_segments`). The importer derives the split with a small, conservative rule
set (`src/lib/learning/phonics.ts`: longest match, digraphs always one unit, other
multi-letter patterns only when the word is linked to them, magic e, double consonants,
final y) and an author can override it (CSV `segments`). The letter NAME ("bee") and the
letter SOUND (/b/) are separate fields.
**Why.** Phonics activities need to know what a child hears, not only what is written:
ship has three sounds, box has four, the e in cake is silent, th has two sounds. Counting
letters or matching substrings gives wrong questions ("mishap" is not an sh word).
**Consequences.** Every activity that talks about sounds (blend, segment, beginning /
middle / end sound, find the letters) is generated from the split; a wrong split is fixed
once in the word bank. ARPAbet is American English; British English would need another
inventory or per-locale pronunciations.

## ADR-025 — Phonics lessons are blueprints expanded at import

**Decision.** A phonics lesson may be one `blueprint` line (`letter_sound`,
`cvc_blending`, `phonics_pattern`) that the importer expands into ordinary activities and
questions (`src/lib/content/lesson-blueprints.ts`). The result is stored exactly like a
hand-written lesson.
**Why.** The brief asks for a reusable, data-driven lesson structure (hear → see →
practise → identify → read → spell → sentence → check) across ~50 patterns. Writing each
by hand repeats the structure fifty times and lets lessons drift apart.
**Consequences.** The structure is code, reviewed like code; the content (pattern, words,
contrast, sentence) is data. Question codes are positional, so changing a blueprint's
activity order re-keys questions — history stays attached to the old (archived) rows.

## ADR-026 — Doubtful content is flagged for review, not guessed or rejected

**Decision.** The importer rejects content that is certainly wrong (unknown phoneme,
a lesson word that does not use the lesson's pattern) and records content that may be
wrong in `content_flags` (admin-only, replaced per import), shown on `/admin/phonics`.
**Why.** English spelling has many exceptions ("careless" contains "ar" but not /ar/).
A strict importer would block good content; a silent one would teach wrong sounds.
**Consequences.** The shipped content has four intentional flags as review examples
(alligator, careless, cherry, giraffe).

## ADR-027 — Skill checks reuse the lesson player and the attempt history

**Decision.** The Phonics Check is an ordinary `assessments` row. Its payload is built by
the lesson loader (digest answer keys, one try per question) and played by the lesson
player. Answers are ordinary `activity_attempts` with an `assessment_attempt_id`; the
sitting row is created by the server from the first synced answer (device-generated id,
checked to belong to the same child and assessment), and an `assessment_run` event makes
the server score it per area into `assessment_results`.
**Why.** The brief requires the assessment to use the existing assessment and progress
architecture; one answer pipeline keeps offline sync, idempotency, server re-evaluation
and mastery identical for lessons and checks.
**Consequences.** Check answers count toward skill mastery (they are real evidence);
placement ("Find My Level") can use the same player later with its own scoring.

## ADR-028 — The server credits only real evidence (audit fixes)

**Decision.** From the Phase 1–4 audit:

- A lesson run is scored only from first tries at that published lesson's own scored
  questions, and only when at least half of them were answered (`scoreRun`,
  `RUN_MIN_COVERAGE`).
- The progress writer refuses answers to draft or archived questions (or questions in
  unpublished activities or lessons), tries beyond `maxTries` (1 in an assessment), a
  second first try at a question in the same run or sitting (also a unique index), and
  answers to lesson-less (assessment) questions outside a sitting.
- `activity_attempts.correct_answer` is not readable by signed-in users (column grant).
- Content link tables are readable by families only when what they link is published.
- `safeNextPath` resolves the path like a browser and refuses control characters and
  backslashes (`/\t/evil.example` would otherwise become `//evil.example`).
- Grown-up pages and actions refuse to run in child mode (`requireParentMode`).
- Mastery breaks timestamp ties by attempt id and counts practice days in the family's
  time zone.
  **Why.** Each was reproduced: one right answer to a KG1 question could mark a Grade 2
  lesson COMPLETED with 3 stars; a parent could read any correct answer after one attempt;
  a login link could redirect off-site; a child could open parent settings from the
  installed app.
  **Consequences.** A modified client can no longer inflate progress or read answers;
  genuine offline runs are unaffected (they answer every question). Existing duplicate first
  tries were re-marked as retries by the migration, keeping history.

## ADR-029 — Vocabulary is content and word-level views of the learning engine

**Decision.** Phase 5 adds no lesson, progress, mastery, review or assessment system of
its own. Vocabulary lessons are ordinary lessons expanded from a `vocabulary_set`
blueprint; word questions are ordinary questions with a `word_id` and a
`metadata.wordArea` (recognition, listening, meaning, reading, spelling, usage); word
answers are ordinary attempts. Word mastery is the skill mastery algorithm
(`computeMastery`) with one word-sized setting (`vocabulary.fullEvidenceAttempts`, 6),
stored in `word_progress` with a per-area breakdown in `word_area_progress`, both
recomputed from history by the progress writer. Weak (`weak_word`), missed and saved,
due words are rows of the existing review queue. Word practice (Word Explorer, My Words)
replays published lesson questions about the chosen words in the ordinary lesson player
with no lesson run.
**Why.** The brief requires reusing the Phase 3/4 architecture; one answer pipeline keeps
offline sync, server re-evaluation, idempotency and parent reporting identical.
**Consequences.** A word can only be practised once some lesson asks about it (the seed
content covers the vocabulary sets and phonics words; the Explorer says so otherwise).
Practice answers make the source lesson `IN_PROGRESS` but never `COMPLETED`.

## ADR-030 — Distractors are chosen by rules at import time

**Decision.** Vocabulary templates choose wrong options from the published word bank by
deterministic rules (`src/lib/content/vocabulary.ts`): never the word, its synonyms or a
word with the same picture; only words a child at that level knows (+1 level at most);
other categories for KG1–KG3 and the same category later (harder), look-alike spellings
for recognition, another part of speech for "which sentence makes sense?". The chosen
options are stored in the question, like authored ones. When the bank cannot supply
suitable distractors the question is reported invalid instead of using random words.
**Why.** Random unrelated words make questions trivially easy or unfair; choosing at
import keeps answers server-side (digest answer keys) and re-imports reproducible.
**Consequences.** Adding words can change distractors on the next import (questions get
a new version); authors can still list `distractors` explicitly.

## ADR-031 — Media lives in Supabase Storage, validated from its bytes

**Decision.** Word pictures and recordings are files in public, type- and size-limited
buckets (`content-images`: PNG/JPEG/WebP ≤ 1 MB; `content-audio`: MP3/MP4/OGG/WAV
≤ 2 MB), writable by admins only. An upload is validated on the server from the file's
first bytes (real type, pixel size 32–4096, alt text) before it is stored under a
content-addressed path; `image_assets` records type and size with database checks.
Pages fall back to the word's emoji and to speech synthesis.
**Why.** No binaries in Postgres; never trust a file name or a browser-declared type.
**Consequences.** The Docker-free local stack has no Storage, so uploads are verified by
unit tests and only work against hosted Supabase.
**Correction (20261005100100).** The first policy set gave admins INSERT/UPDATE/DELETE
but no SELECT on the content buckets. Storage needs SELECT for an upsert (and for any
write that returns or matches rows), so every admin upload failed with an RLS error. It
was not caught because no upload had been run on hosted. Admins now also have SELECT,
limited to the two content buckets; parents and anonymous visitors still cannot write or
list them (`supabase/tests/007_content_storage.sql`, run against hosted). Verified end
to end on production on 2026-10-02 (upload through the admin page, public URL, rendering,
re-upload without duplicates, refused anonymous/parent/invalid/oversized uploads).

## ADR-032 — My Words is written through ownership-checked database functions

**Decision.** Saving or removing a word and recording "first seen" go through
`set_word_saved` / `note_word_seen` (`security definer`): they check `is_my_child` and
that the word is published, and touch only the saved/seen columns. All other word
progress stays server-derived. Automatic saving (first right answer) never overrides a
family's own choice (`saved_source = 'manual'`).
**Why.** A child's own choice is not derived from history, but families must still never
write progress figures or another family's rows.
**Consequences.** Saving needs a connection (it is not an outbox event); answers still go
through the offline outbox.

## ADR-033 — Spelling is the spelling view of the word bank on the learning engine

**Decision.** Phase 6 adds no lesson, activity, attempt, progress, mastery, review or
assessment system. A spelling target is a `spelling_words` row pointing at a word of the
bank (one per word) with only spelling facts (spelling level, skill, type, focus pattern,
difficulty, irregular part, hints, common errors, a dictation sentence); the text, split,
phonemes and meaning stay in `words` / `word_segments`. Spelling lessons are ordinary
lessons expanded from a `spelling_set` blueprint; spelling skills are ordinary skills;
answers are ordinary attempts with three extra columns (`hints_used`,
`spelling_analysis`, `error_pattern_id`) and the category in `error_type`. Spelling
mastery is the mastery algorithm with a spelling rule set, stored in `spelling_progress`
next to (never instead of) vocabulary `word_progress`; only answers right without a hint
count as independent. Review items are ordinary `review_items`: `spelling:<word>` and,
for a phonics pattern misspelled again and again, `pattern:<pattern>` pointing at the
pattern's phonics lesson (no separate phonics mastery). For spelling targets the word's
vocabulary review ignores spelling answers so one miss is not queued twice.
**Why.** The brief requires reusing the existing infrastructure, a separate spelling
mastery that does not overwrite vocabulary mastery, and phonics-aware review.
**Consequences.** Not every vocabulary word is spelled; the importer refuses spelling rows
for words that are not in the bank. A saved word can still have its own vocabulary
review besides a spelling review (different practice).

## ADR-034 — Spelling mistakes are classified by fixed rules from the grapheme split

**Decision.** `analyzeSpelling` normalises only case, surrounding and repeated spaces
(no autocorrect, the raw text is kept), aligns the answer with the word (insert, delete,
substitute, adjacent swap) and assigns one category by an ordered rule list using the
word's grapheme split and pattern types: transposition, irregular part, doubled letter,
same sounds by the taught spellings (a small sound-alike key), far off, then the kind of
grapheme every change falls in (ending, digraph, blend, vowel), then the kind of change.
The pattern of a digraph / blend / vowel / ending mistake is stored for review. Sentence
dictation compares words (LCS) and checks capitals and end marks only where the level's
rules ask. The device runs the same function for instant feedback (against the spoken
word it already has); the server's analysis of the stored answer is authoritative.
**Why.** Deterministic, explainable to parents, testable, and free of external services.
**Consequences.** Categories are heuristics: an answer can fit two descriptions and gets
the first in the list. Irregular words need their irregular part authored.

## ADR-035 — Spelling input, hints and dictation limits are per-level rules

**Decision.** Input method (keyboard, child keyboard, letter tiles, drag and drop), hints
per question, dictation replays and slow replay, sentence dictation and punctuation
checks come from `rules.spelling.levels[level]` (defaults in code, overridable in
`learning_rules`), resolved by the lesson loader into `step.spelling`; an activity's config
wins. The blueprint reads the same rules at import for structure (sentence dictation).
Hints are generated at import into the question (authored hints first). The child
keyboard is plain buttons (no form submit, no links; Backspace does not navigate) and also
accepts a physical keyboard.
**Why.** The brief asks for progression configurable per level and not hard-coded in
React; young children cannot type on a device keyboard.
**Consequences.** Changing a level's input or limits is a data change; changing which
activities a level's lessons contain needs a re-import.

## ADR-036 — Phonics sounds are speech tokens, resolved in one place

**Context.** The pre-Phase-7 audit found phonics sounds stored as text for speech
synthesis (`sss`, `fff`, `hh`, `shh`, `th, as in thin`, `aa`, `ih`, `ay`), copied into
question content at import. Checked with espeak-ng (the engine behind Chrome and Firefox
on Linux), voices read these as letter names ("ess ess ess", "tee aitch") or as the wrong
vowel (`ay` → "eye", `ih` → "eye", `eh` → /eɪ/). Children were being taught wrong sounds.

**Decision.** Content stores tokens: `{/S/}` for a sound (a phoneme sequence) and `{@s}`
for a letter name. One pure resolver (`src/lib/audio/pronunciation.ts`) turns a token into
a recorded clip, else a rendering checked to produce the sound, graded `pure` or
`approximate` (consonant + "uh"), else a keyword ("the sound at the start of apple") for
sounds no voice can produce from text, else nothing. The table is data (`phonemes`,
`phonics_pattern_sounds`, letter names, `audio_assets`), served by the child layout and
carried in lesson payloads. The importer and the content tests reject speech containing
bare letter groups. The audio service plays one thing at a time and cancels sequences.

**Consequences.** No phonics sound is spoken as letters. Recordings replace synthesis per
sound without a re-import. Consonants remain approximate (with "uh") and five vowel sounds
are keyword-only until recordings exist; blending by ear is weaker for those. Old cached
lessons without a sound table do not speak their tokens (silence, not wrong sounds).
A keyword is never one of the words on screen in a scored question (several keywords per
sound; the player passes the visible words), so the fallback cannot give the answer away.

## ADR-037 — Reading is texts plus the learning engine; reading itself is never scored

**Context.** Phase 7 asks for a reading progression with fluency and read-aloud, without
parallel reading lesson / progress / mastery / attempt / review systems and without fake
features. The app cannot hear the child: there is no speech recognition and no reliable
way to know whether a child read a text or just looked at it.

**Decision.** A reading text is a `stories` row (extended with reading metadata and the
importer's analysis) linked to word-bank words (`story_words`), never a copy of them.
Reading lessons are ordinary lessons built by the `reading` blueprint; comprehension
answers are ordinary attempts on curriculum skills tagged with a reading skill, so mastery
is ordinary `skill_mastery`. Reading a text is recorded in `reading_sessions` (a new table
only because `activity_attempts.is_correct` is required and a reading is not an answer):
time on text (capped), listens, re-reads, help words, a self-check. No words per minute,
accuracy or pronunciation score is computed or shown, and read-aloud is Listen / read /
self-check only. Words tapped repeatedly become ordinary review items (`reading:<word>`).

**Consequences.** Parents see honest reading behaviour (re-reads, help taps, the child's
own check) next to comprehension mastery. Fluency and accuracy skills exist in the
taxonomy for tagging texts but no mastery is claimed for them. Adding speech-based
measures later means adding evidence, not replacing these tables.

## ADR-038 — Reading skills and text kinds are data, checked against the level at import

**Context.** Skills such as inference or summarising must not appear in KG1/KG2, and new
text kinds (e.g. letters, recipes) should not need schema changes.

**Decision.** `reading_skill_types` (with strand and `min_level_rank`) and
`reading_content_types` (with `min_level_rank`) are imported from `reference.json`. The
importer refuses a text, question or curriculum skill that uses a reading skill or text
kind above its level, and checks each text against configurable per-level limits
(`rules.reading.levels`: paragraphs, sentences, words per sentence, decodability, question
count). Text difficulty 1–10 comes from weighted statistics (`rules.reading.difficulty`);
authors keep their own difficulty and a large disagreement is flagged.

**Consequences.** Level appropriateness is enforced before content reaches a child.
Changing a level's limits or the difficulty weights is a `learning_rules` override, not a
code change. A text kind or skill is added as a row.
