# Writing engine (Phase 8)

Writing from KG1 to Grade 2: tracing and forming letters, writing letters for sounds,
copying and writing words, building, copying, finishing and writing sentences, capital
letters, spaces and end marks, guided writing, story sequence writing, short paragraphs,
editing and revising.

The writing engine is **not a separate system**. Writing lessons are ordinary lessons in
units of the `WRITING` subject; a written answer is an ordinary `activity_attempts` row (the
child's strokes or text kept as written in `response`); mastery is ordinary
`skill_mastery`; review items go into the ordinary queue; audio goes through
`src/lib/audio`; answers go through the offline outbox and the `/api/sync` route like any
other answer. What is new is reference data (writing skills, handwriting glyphs, rubric
templates), the evaluators, five question types and their renderers (ADR-039 – ADR-042).

## Pieces

| Piece                | Where                                                                                                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Schema               | `supabase/migrations/20261009100100_writing_engine.sql`                                                                                                            |
| Content              | `content/writing.json` (writing skills, 69 glyphs, 13 rubric templates); writing units in `content/curriculum/*.json`                                              |
| Handwriting (pure)   | `src/lib/learning/tracing.ts` — stroke schemas, simplification, `evaluateTrace`, glyph validation                                                                  |
| Typed writing (pure) | `src/lib/learning/writing.ts` — text helpers, mechanics, copy / completion / edit / rubric / story evaluation, letter review                                       |
| Question evaluation  | `src/lib/learning/writing-evaluation.ts` — level settings, handwriting verdict, `evaluateWritingQuestion` (used by `evaluate.ts`)                                  |
| Device keys          | `src/lib/learning/writing-key.ts` — digest-only answer keys for writing (used by `answer-key.ts`)                                                                  |
| Content checks       | `src/lib/content/writing-content.ts` — file schema, `glyphProblems`, rubric compilation                                                                            |
| Templates            | `trace_letter`, `copy_word`, `picture_word`, `write_sound`, `copy_sentence` in `src/lib/content/templates.ts`                                                      |
| Renderers            | `src/features/activities/renderers/{tracing,glyph-view,sentence-writing,guided-writing,story-writing,edit-correct,writing-parts}.tsx`; `spelling.tsx` (word modes) |
| Player feedback      | `src/features/lesson-player/writing-feedback.tsx` (the checklist after an answer)                                                                                  |
| Server               | `src/lib/server/{glyphs,writing-context,writing}.ts`; `lesson-loader.ts` (glyph + settings on the step); `progress-writer.ts` (evaluation, letter review)          |
| Report               | `src/lib/learning/writing-report.ts` (pure), `src/components/parent/writing-report.tsx`                                                                            |
| Screens              | `/child/writing`, `/parent/writing` (+ dashboard card), `/admin/writing`, `/admin/writing/glyphs/[code]`                                                           |

## Data model

- `writing_skill_types` — the 25 writing skills (LETTER_TRACING … REVISING) with a strand
  (handwriting, word, sentence, mechanics, composition, editing) and the first and last
  level they are taught at. `skills.writing_skill_code` tags a curriculum skill with the
  writing skill it teaches; the importer refuses a tag outside the level range (no
  paragraph writing in KG1). Twenty of the 25 tag a curriculum skill today; LETTER_TO_SOUND
  (taught by the phonics letter skills), WORD_BUILDING and SENTENCE_BUILDING (activities
  inside the word and sentence writing skills), WORD_SPACING and PUNCTUATION (rubric and
  mechanics dimensions in every typed answer) have no skill of their own yet, so the
  parent report leaves them out instead of showing them as "not started".
- `handwriting_glyphs` — reference handwriting: character, kind (letter / digit / shape),
  case, script, child-facing name, **ordered strokes** (`[{ points: [[x, y], …] }]` in a
  0–100 box; the first point is where the stroke starts, point order is its direction),
  guide lines (top, midline, baseline), tolerance (box units), completion threshold,
  difficulty, formation family, a formation tip and the words said while the model is drawn.
  Stroke data lives here and in `content/writing.json`, never in a component.
  `questions.glyph_id` names the glyph a handwriting question practises.
- `writing_rubrics` — rubric templates (criteria with a dimension, `critical`, a weight,
  a label and a hint). Admin-only. The importer compiles the template plus the question's
  own keywords into the question's **server-only** answer (`questions.answer`), so a
  stored answer is judged by the question alone.
- `activity_attempts.writing_analysis` — what the server's checks found (criteria met,
  words, sentences, mechanics, spelling suggestions, tracing coverage / precision / order /
  direction / start). It never contains an answer or a keyword.
- `review_items.glyph_id`, item key `writing:<glyph id>`, reason `writing_letter`.
- Content flags take `glyph` and `writing_rubric`.

Rules (`learning_rules`, code `writing`; defaults in `rules.ts`):

| Level  | Capital  | End mark | Spaces   | Spelling | Trace tolerance × | Write tolerance × | Completion × | Stroke order | Min words / sentence |
| ------ | -------- | -------- | -------- | -------- | ----------------- | ----------------- | ------------ | ------------ | -------------------- |
| KG1    | off      | off      | off      | hint     | 1.4               | 1.4               | 0.85         | hint         | 1                    |
| KG2    | hint     | hint     | hint     | hint     | 1.25              | 1.35              | 0.9          | hint         | 2                    |
| KG3    | required | required | hint     | hint     | 1.1               | 1.3               | 0.95         | hint         | 3                    |
| GRADE1 | required | required | required | hint     | 1                 | 1.25              | 1            | hint         | 3                    |
| GRADE2 | required | required | required | required | 1                 | 1.2               | 1            | hint         | 4                    |

`minPrecision` 0.7, `almostMargin` 0.15, letter review: 2 misses in the last 4 first tries
bring a letter back; 2 right first tries in a row resolve it.

## Question types and activity types

Activity types pick the activity configuration; questions use these question types
(existing types are reused where they already do the job):

| Activity type         | Question type                                            | What the child does                                                    |
| --------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------- |
| `TRACING`             | `TRACING` (mode `trace`)                                 | go over the faint letter or shape, from the green dot                  |
| `LETTER_WRITING`      | `TRACING` (`copy` / `write`)                             | write the letter beside a model, or from memory after hearing its name |
| `SOUND_TO_LETTER`     | `TRACING` (`write`, by sound) or `SPELLING` (`grapheme`) | hear a sound, write the letter(s)                                      |
| `WORD_COPY`           | `SPELLING` (`copy`)                                      | copy a word shown on screen                                            |
| `IMAGE_TO_WORD`       | `SPELLING` (`picture`)                                   | write the word for a picture (heard only on request)                   |
| `WORD_BUILD`          | `WORD_BUILDER`                                           | build a word from tiles                                                |
| `MISSING_LETTER`      | `MISSING_LETTER`                                         | choose the missing letter                                              |
| `SENTENCE_BUILD`      | `SENTENCE_BUILDER`                                       | put word tiles in order (tap or drag; capital and full stop on tiles)  |
| `SENTENCE_COPY`       | `SENTENCE_WRITING` (`copy`)                              | copy a sentence                                                        |
| `SENTENCE_COMPLETION` | `SENTENCE_WRITING` (`complete`)                          | write the missing word                                                 |
| `SENTENCE_WRITING`    | `SENTENCE_WRITING` (`free`)                              | write an own sentence about a picture (rubric)                         |
| `GUIDED_WRITING`      | `GUIDED_WRITING` (`frames` / `free`)                     | finish sentence frames, or write freely with a word bank (rubric)      |
| `PARAGRAPH_WRITING`   | `GUIDED_WRITING` (`paragraph`)                           | topic sentence, details, ending in labelled boxes (rubric)             |
| `STORY_ORDER_WRITING` | `STORY_ORDER_WRITING`                                    | order story pictures, write a sentence for each (order + rubric)       |
| `EDIT_AND_CORRECT`    | `EDIT_AND_CORRECT`                                       | fix the mistakes in a sentence                                         |

Typed word writing is `SPELLING`, so a written word is also word and spelling evidence
(My Words, spelling mastery and spelling review) — no parallel word system. Sound-to-letter
uses the phonics pattern's sound token (`{/SH/}`); the letters are the answer, never the
speech. Letter names are letter tokens (`{@a}`), separate from sounds.

## Handwriting (tracing.ts)

The child's strokes are recorded by pointer events (finger, mouse, pen) in the glyph's
0–100 box, simplified on the device to integer points (at most 12 strokes × 80 points), and
sent as the answer `{ strokes }`. Nothing about correctness comes from the device: the old
`{ coverage }` answer is rejected by the server.

`evaluateTrace(reference, strokes, settings)`:

1. **Align** (write and copy modes): the child's letter is moved and scaled onto the
   reference box, so a small letter in a corner is still the letter. Thin letters (l, a
   line) are scaled by their length only. Tracing mode is not aligned (the letter is under
   the finger).
2. **Coverage**: each reference stroke is sampled every 2 units with its direction; a
   sample is covered by ink within the tolerance that **runs the same way** (|cos| ≥ 0.5,
   either way round). A line crossing a stroke does not cover it — without this an X
   "covers" an o. Dots (i, j) are covered by any ink near them.
3. **Precision**: the share of the child's ink near the letter and running along it.
4. **Balance**: the centre of mass of the (aligned) ink must sit within 0.7 × tolerance of
   the letter's, which catches mirrored and flipped letters that overlap almost
   everywhere (b/d, p/q, n/u).
5. **Order, direction, start**: the child stroke that covers each reference stroke best,
   whether those come in order, whether each runs the right way (start nearer the start),
   and whether the first stroke starts within 2 × tolerance of the green dot.

Complete = coverage ≥ completion, every stroke ≥ 60 % covered, precision ≥ `minPrecision`,
balanced, and — only where the level sets `strokeOrder: required` — order, direction and
start right. "Almost" = within `almostMargin` of the completion. The issues found
(missing part, off the letter, wrong shape, start, order, direction) become the criteria of
the checklist.

Calibration against the shipped glyphs (unit tests): every glyph traced along its strokes
with a wobble passes at every level, in trace and write mode; a letter written small and
off-centre passes in write mode; o drawn as l, a as x, A as O, b as d, n as u, E as F, p as
q and 6 as 9 are rejected when written from memory; scribbles, a corner mark and no ink are
rejected.

Limits, stated plainly: this is shape matching against a model with a tolerance, **not
handwriting recognition**. A letter that contains the target (o drawn for c) passes; very
sloppy writing fails more often at Grades 1–2 than at KG1 (by design); stroke order is
measured and shown but only enforced where a level asks for it. There is no AI grading.

Accessible alternative: "Type it" answers with the keyboard (`{ strokes: [], typed: "a" }`);
it is judged as the letter (case-sensitive; the other case is a near miss) and recorded as
typed, so parents see that the letter was typed, not drawn.

## Typed writing (writing.ts)

- **Mechanics** (`analyzeMechanics`): sentences starting without a capital, a lone "i", a
  missing end mark, words run together or split apart (with a list of expected or known
  words) and double spaces. Each level sets each mechanic to off, a hint (shown, never
  wrong) or required (critical).
- **Copying** (`evaluateCopy`): the words must be the sentence's words; a spacing-only slip
  ("The catis big.") is a spacing issue, not a wrong word; then mechanics by level.
- **Completion**: any accepted word; a close spelling is a near miss.
- **Editing**: any accepted correction (case and marks matter); each changed word is
  classified (capital, end mark, spelling, word) and counted; a near miss is "the words are
  right, only capitals or marks are not, and something changed".
- **Open writing** (`evaluateRubric`): never compared with a stored sentence. A rubric of
  deterministic checks: words, sentences, required ideas (keyword groups — any form of an
  idea; up to 3-word phrases), sequence words, whole sentences (minimum words, not a
  repeated word), not copied, a topic sentence, an ending, boxes filled, mechanics by
  level, and spelling of known words. **Critical** criteria decide right / not yet;
  the others are tips. Spelling in open writing is never critical: only words close to a
  known word are pointed out, others are "not checked" (`met: null`). Spacing in open
  writing is a tip only, because splitting unknown words into known ones is unreliable
  ("everyone" is not "every one"); spacing can be required where the words are known
  (copying).
- **Story sequence** (`evaluateStoryWriting`): the order is critical; each picture's
  sentence must name what happens (its keyword groups, any one); then the overall rubric
  (sequence words — critical at Grade 2 — and mechanics).
- **Verdict**: correct iff every critical criterion is met; "almost" when at least half of
  two or more critical criteria are met and something was written.

These checks do not understand meaning ("Big is the dog dog." mentions a dog; the
repetition check catches some of this). That is why parents see the child's own words next
to the checks, and why the report calls them learning checks, not grades.

## Answer keys (device) and evaluation (server)

The device gets digest-only keys (ADR-021):

| Mode       | Key                                                                                                  |
| ---------- | ---------------------------------------------------------------------------------------------------- |
| `trace`    | the glyph and the resolved tracing settings (public reference data, no secret)                       |
| `copy`     | digests of the accepted sentences, of their words with spaces removed, the model's words (on screen) |
| `complete` | digests of the accepted words                                                                        |
| `edit`     | digests of the accepted corrections and of their words; the original (on screen)                     |
| `rubric`   | the criteria with every keyword group replaced by digests of its phrases; starters; level settings   |
| `story`    | digests of the accepted orders; per-event and overall criteria with digested keywords                |

`checkWritingKey` runs the same functions as the server with a digest matcher instead of
plain words, so the device and the server agree on right / almost (unit-tested for every
shipped writing question, right and wrong). The server re-evaluates every stored answer
with the real answer, the glyph from the database, the level of the question's skill
(skill → unit → level) and the published word list (spelling suggestions); the device's
verdict is never part of the event.

## Progress, mastery and review

- Answers → `activity_attempts` (with `writing_analysis`) → ordinary lesson, activity,
  subject and level progress → ordinary skill mastery (writing skills are tagged curriculum
  skills) → ordinary skill review items.
- Typed words (`SPELLING`) → word progress, spelling mastery, spelling and pattern review.
- Letters → `writing:<glyph id>` review items pointing at the newest lesson where the
  letter was practised, so the daily plan and the child's writing page bring it back.

## Offline and sync

Answers go to the IndexedDB outbox first. A stroke answer is at most 12 × 80 integer pairs
(a few kB); typed answers are at most 10 boxes × 600 characters. The sync request keeps its
512 kB limit and 200 events. Lessons cached on the device carry their glyphs and writing
settings, so writing works offline; older cached lessons without them still render (the
canvas shows guide lines only, and the server judges the strokes later).

## Screens

- **Child** `/child/writing`: letters to practise again (big tiles), the writing lessons of
  the level by skill with stars, more levels folded away, and "My writing" (the newest
  answer to the last few writing questions). The home screen has a Writing tile.
- **Player**: big canvas with guide lines, the faint letter, a green numbered start dot
  and arrow, "Show me" (the strokes drawn in order, with the formation words), Undo, Clear,
  Done, Type it; writing boxes without auto-capitalisation or autocorrect; word banks that
  say each word; the live writing checklist (capital, spaces, end mark — only what the
  level checks); after an answer the checklist of what the checks found (icons and words,
  must-haves first) and the first thing to fix is spoken.
- **Parent** `/parent/writing` and a dashboard card: writing answers and right-first-time,
  pieces of own writing and words written, writing skills of the level with mastery,
  capitals / spaces / end marks as "met of checked" (a dash when the level does not check
  them), handwriting (letters formed, typed instead of drawn, letters coming back), and
  recent writing with the child's own words, the checks and spelling suggestions.
- **Admin** `/admin/writing`: writing skills (levels, tagged curriculum skills), the glyph
  grid with flags, rubric templates (critical / level / tip), published writing questions
  by type; `/admin/writing/glyphs/[code]`: the animated model, strokes, flags,
  publish / unpublish, tolerance and completion, and a "Try it" pad that runs the tracing
  engine with each level's settings.

## Content validation (importer)

- Glyphs: schema (1–8 strokes, 2–64 points, coordinates 0–100), no zero-length stroke, no
  long jump inside a drawn path, character matches kind and case, guide lines in order,
  formation words safe for speech; flagged for review: a first stroke that starts near the
  bottom (stroke order), very loose tolerance, very low completion.
- Rubrics: criteria schema, unique ids, at least one critical criterion, level range; a
  question's rubric must exist, fit the level, and receive exactly the ideas / topic / text
  the template needs.
- Questions: the glyph must exist; sound-to-letter needs exactly one sound and no speech;
  picture-to-word needs a picture; copying needs its model; completion exactly one blank;
  story orders use the events' ids; edit answers differ from the text.
- Writing skills on curriculum skills must exist and fit the level.

## Seed content

| Level   | Lessons | What                                                                                                             |
| ------- | ------- | ---------------------------------------------------------------------------------------------------------------- |
| KG1     | 4       | lines and circles; trace a, c, t; big A, T, L (trace, copy); copy cat, dog, sun                                  |
| KG2     | 4       | write m, s, p (copy, from the sound); sounds to letters (t, s, k/c/ck); write CVC words; first sentences         |
| KG3     | 5       | writing workshop (all six steps); words with sh/ch; capitals and full stops; write a sentence; guided "My pet"   |
| Grade 1 | 6       | sentences about pictures; make it longer; story sequence (seeds); short paragraph; describe a cat; fix sentences |
| Grade 2 | 6       | paragraph "My best day"; facts about dogs; a beach story; retell the storm story; edit; revise                   |

69 glyphs (a–z, A–Z, 0–9, 7 pre-writing shapes), 13 rubric templates, 25 writing skills.

## Adding content

- A glyph: add it to `content/writing.json` (points in the 0–100 box, strokes in writing
  order, first point = start), import, check `/admin/writing/glyphs/<code>` and try it.
- A rubric: add a template to `content/writing.json`; name it in a question's answer with
  its ideas (`{ "rubric": "g1-sentence", "ideas": [["dog", "dogs", "puppy"]] }`).
- A writing lesson: add activities of the types above to a `WRITING` unit skill tagged with
  a writing skill; use the templates for letters, words and sentences.
