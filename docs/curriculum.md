# Curriculum and learning model

The curriculum is configurable data. It does not claim to follow any single school
system; levels, scope and order can be changed by editing `content/` and re-importing.

## Levels

| Level   | Ages | Focus                                                                           |
| ------- | ---- | ------------------------------------------------------------------------------- |
| KG1     | 3–4  | Letter shapes and main sounds, listening, picture words                         |
| KG2     | 4–5  | Short vowels, blending CVC words, first sight words, short sentences            |
| KG3     | 5–6  | Consonant digraphs (sh, ch, th, wh, ck, ng), tricky words, simple paragraphs    |
| Grade 1 | 6–7  | Vowel teams (ee, ea, ai/ay, oa, ow, …), longer sentences and stories            |
| Grade 2 | 7–8  | R-controlled vowels, endings (-ing, -ed, -s/-es), suffixes, multisyllabic words |

Each concept follows **explanation → demonstration → guided practice → independent
practice → feedback → review**, recorded as the activity `stage`.

## Subjects

Content categories, not separate apps: **Phonics** (letters, sounds, blending, patterns),
**Reading** (sight words, word reading, sentences and stories), **Vocabulary**,
**Spelling**, **Writing** (letter formation, writing words, finishing sentences),
**Listening**, **Sentence Building**, **Games** (matching, sorting, fill-the-gap practice)
and **Assessment** (short check-ups). A unit belongs to one level and one subject.

## Seed content

Original, age-appropriate content covering KG1–Grade 2:

- 39 phonemes and a 14-stage phonics progression: Letters → Letter sounds → Beginning
  sounds → Ending sounds → Short vowels → CVC → Blending and segmenting → Digraphs →
  Consonant blends → Long vowels (magic e) → Vowel teams → R-controlled → Word endings →
  Advanced patterns.
- 71 phonics patterns with 89 modelled sounds: 26 letters (upper and lower case, American
  letter name, main sound), 7 digraphs (ch, sh, th, ph, wh, ck, ng), 8 consonant blends,
  4 magic-e patterns, 10 vowel teams (ai, ay, ee, ea, oa, ow, oo, ou, oi, oy), 6
  r-controlled (ar, er, ir, or, ur, air), 4 endings (ing, ed, s, es) and 6 suffixes (tion,
  sion, ment, ness, ful, less); 45 pattern relations (prerequisite, contrast, same sound).
- 305 words, each split into graphemes and phonemes (1,045 segments; 143 CVC words, 286
  decodable), 25 sight words, 21 sentences, 4 original stories.
- 75 lessons / 533 activities / 706 lesson questions across 20 units, the "Find My Level"
  placement (8 stages) and the **Phonics Check** (12 areas, 24 questions).

| Level   | Phonics (Phase 4)                                                                                                                                           | Other units                                        |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| KG1     | One lesson per letter a–z (name, sound, beginning sound, picture sort, find the letter); upper/lower case, letter names, beginning sounds                   | Trace letters                                      |
| KG2     | Short a, i, o, u, e CVC lessons (blend, segment, middle sound, build, read, spell); segmenting; ending sounds; word families                                | Word games, sight words, sentence order, CVC check |
| KG3     | Digraphs sh, ch (+ sh/ch sort), th (two sounds), ph, wh; magic e with a, i, o                                                                               | Tricky words                                       |
| Grade 1 | ck, ng; consonant blends; vowel teams ee, ea (two sounds), ai/ay, oa, ow (two sounds), oo (two sounds), ou, oi/oy; ar, or, er/ir/ur, air; -ing, -ed, -s/-es | Read and match                                     |
| Grade 2 | -tion/-sion, suffixes (-ment, -ness, -ful, -less), multisyllable words                                                                                      | Story time                                         |

**Multiple pronunciations are modelled explicitly**, never flattened into one rule: TH
(thumb/this), EA (leaf/bread), OW (snow/cow), OO (moon/book), -ED (jumped/played/painted),
-S (cats/dogs), SION, and vowels/C/G/S/Y for single letters. Lessons include "which sound
do you hear?" questions for them. Irregular words (said, was, they, have, the, thumb,
shoe…) are flagged `is_irregular` with a `spelling_note` that explains the exception.

## Authoring content

Files in `content/`:

| File                                                 | Contains                                                                          |
| ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| `reference.json`                                     | levels, subjects, skill dimensions, activity types, word categories, achievements |
| `phonics.json`                                       | phonemes, phonics stages, patterns with their sounds (as phonemes) and relations  |
| `words/*.csv`                                        | the word bank (same format as bulk imports, below)                                |
| `sight-words.json`, `sentences.json`, `stories.json` | lists by level                                                                    |
| `curriculum/*.json`                                  | one file per level: units → skills → lessons → activities → questions             |
| `assessments.json`                                   | assessments by stage                                                              |

Run `npm run content:import -- --dry-run` to validate, then `npm run content:import`.
`npm test` also validates every shipped file without a database.

**Validation and review.** Errors stop an item from being imported: an empty or duplicate
pattern, an unknown level, stage or phoneme, a letter without its upper case or name, a
sound without phonemes, a relation to an unknown pattern, a lesson whose example word does
not really use the lesson's pattern (the word's split must contain it — "ship" for SH, not
"mishap"), a missing word. Doubtful content is imported but flagged for review in
`content_flags` (shown on `/admin/phonics`): a split the importer is unsure about (e.g. a
word containing "ar" that is not linked to AR, like "careless"), duplicate pattern text.

### Phonics lesson blueprints

A lesson can be written as one `blueprint` instead of a list of activities; the importer
expands it (`src/lib/content/lesson-blueprints.ts`), so every pattern gets the same
teaching structure and a fix to the structure fixes every lesson:

| Blueprint         | Structure                                                                                                                                                             | Parameters                                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `letter_sound`    | meet the letter (name + sound) → big and small → which letter makes this sound? → first (or last) sound → find the letter → missing letter → quick check              | `pattern`, `letter`, `words[3]`, `distractors`, `distractorLetters`, `distractorWords`, `soundPosition`    |
| `cvc_blending`    | hear → blend it (tap sounds, slow blend, choose the word) → count the sounds → middle sound → build → read → spell                                                    | `pattern`, `vowel`, `words[5]`, `distractorWords`, `otherVowels`                                           |
| `phonics_pattern` | Hear it → See it (find the letters) → Practise → Sort (pattern vs contrast) → [Two sounds] → Read → Spell (missing letters) → Write → Use it (sentence) → Quick check | `pattern`, `grapheme`, `words[6+]`, `contrast{pattern, grapheme, words}`, `sentence`, `soundSort`, `split` |

### Question templates

Questions can be written in full (`type`, `content`, `answer`) or as templates the importer
expands from the word bank, so pictures, meanings and sounds come from one place:

| Template                 | Produces                                                     | Parameters                                                     |
| ------------------------ | ------------------------------------------------------------ | -------------------------------------------------------------- |
| `pattern_intro`          | INTRO card for a pattern with its sounds and examples        | `pattern`, `examples`, optional `body`, `speech`               |
| `word_intro`             | INTRO card for a word                                        | `word`, optional `body`                                        |
| `listen_pick_picture`    | Hear a word, tap its picture                                 | `word`, `distractors`                                          |
| `listen_pick_word`       | Hear a word, tap it written                                  | `word`, `distractors`                                          |
| `pick_starting_sound`    | Which picture starts with this sound?                        | `pattern`, `word`, `distractors`                               |
| `find_letter`            | Find a letter among look-alikes                              | `pattern`, `distractors`, `case`                               |
| `pick_word_with_pattern` | Which word has this pattern/sound?                           | `pattern`, `word`, `distractors`, optional `sound`, `pictures` |
| `pick_pattern_sound`     | Which sound does the pattern make in this word?              | `pattern`, `word`                                              |
| `missing_pattern`        | Fill the gap                                                 | `word`, `missing`, `choices`                                   |
| `build_word`             | Build from sound tiles (blending)                            | `word`, optional `chunks`, `extra`, `demonstrate`              |
| `order_sentence`         | Put words in order                                           | `sentence`, optional `emoji`                                   |
| `spell_word`             | Type the word you hear                                       | `word`                                                         |
| `letter_intro`           | Letter card: upper/lower case, NAME and SOUND buttons        | `pattern`, `examples`                                          |
| `match_upper_lower`      | Match big and small letters                                  | `patterns`                                                     |
| `letter_for_sound`       | Hear a sound, tap the letter(s) that make it                 | `pattern`, `distractors` (pattern codes)                       |
| `sound_at_position`      | Beginning / middle / end sound of a word                     | `word`, `position`, `choices`                                  |
| `blend_word`             | BLEND_SOUNDS from the word's grapheme split                  | `word`, `distractors`, optional `pattern`, `pictures`          |
| `segment_word`           | SEGMENT_WORD: count the sounds, tap the phonemes             | `word`, optional `extraSounds`, `pattern`                      |
| `find_pattern`           | FIND_PATTERN: tap the letters that make the sound            | `pattern`, `word`                                              |
| `read_word`              | Read a written word (no audio), tap its picture              | `word`, `distractors`, optional `pattern`                      |
| `sort_by_pattern`        | Sort words into pattern groups (sh / ch)                     | `groups[{pattern, words}]`                                     |
| `sort_by_sound`          | Sort words by which sound a pattern makes (EA: leaf / bread) | `pattern`, `words`                                             |
| `match_pattern_word`     | Match patterns to words                                      | `pairs`                                                        |
| `match_sound_letter`     | Match sounds to letters                                      | `patterns`                                                     |

Question/activity codes default to `<lesson>-a<n>-q<n>`; give explicit `code`s if you
reorder questions and want history to stay attached to the same question.

### Bulk word import (CSV)

Required columns: `word, level, category, difficulty, phonics_pattern, definition,
example_sentence, sight_word`. Optional: `emoji, part_of_speech, child_definition,
syllables, pronunciation, irregular, spelling_note, plural, tags, related, sense, status`.
`phonics_pattern` is `CODE[:SOUND][*]` separated by `;` (e.g. `TH:TH_VOICED*;EE`; `*` =
featured example). Lists (`tags`, `related`) use `;`. Optional `segments` overrides the
automatic grapheme split, one token per grapheme: `g` (its pattern and linked sound),
`g=SOUND_CODE`, `g=` (silent) or `g=[PHONEMES]` — e.g. `sh oe=[UW]` for "shoe",
`qu=Q ee n` for "queen".

```
npm run content:import -- --words path/to/words.csv [--dry-run]
```

The report lists **added, updated, skipped (unchanged), invalid, duplicate** (and
**archived** for curriculum files), with line-level errors. The exit code is non-zero when
anything is invalid.

## Mastery model

Computed from the latest **30 first-try answers** for a skill (retries after feedback are
practice, not evidence). All numbers are learning rules (`src/lib/learning/rules.ts`),
overridable in the `learning_rules` table:

- `accuracy` = 60% recent (last 10) + 40% window; **evidence** = min(1, answers / 10);
  `mastery score` = 100 × accuracy × evidence. One right answer scores 10, not 100.
- Status bands by score: **NOT_STARTED** no answers · **LEARNING** 1–39 (or 0 with
  answers) · **PRACTICING** 40–69 · **ALMOST_MASTERED** 70–89 · **MASTERED** 90+.
- **MASTERED** also needs practice on at least 2 different days (otherwise ALMOST) and the
  skill's own threshold (`skills.mastery_threshold`) when that is stricter.
- Stored per child and skill: mastery score, attempts, correct attempts, accuracy, recent
  accuracy, last practised, last assessed, status.
- Next review: LEARNING 1 day, PRACTICING 2, ALMOST 4, MASTERED 7; 1 day after a mistake.
- Review priority (0–100) = (0.6 × (100 − score) + 8 × recent mistakes + up to 20 for being
  overdue) × (0.8 + 0.1 × importance).

Because it is recomputed from history, a skill that slips drops back down.

## Prerequisites

A skill prerequisite is ready from **PRACTICING**; a lesson prerequisite once completed.
Skills from a level below the child's current level are assumed known until practice
shows otherwise (a child placed in KG3 is not sent back to KG1). A lesson that is not ready
is still open: the child is offered the prerequisite first, a **sneak peek** (first 3
steps; answers count as practice, the lesson is not marked completed) or the whole lesson.

## Recommendations and review

- **Next lesson**: the first unfinished lesson on the level path (unit → skill → lesson
  order) whose prerequisites are ready. **Recommended**: continue a started lesson, then
  the next lesson (its missing prerequisite first), then due review items.
- **Review queue** (`review_items`): every practised skill is scheduled at its next review
  date; weak skills (≥ 4 answers, score < 70) and skills with ≥ 2 recent mistakes are due
  now; a word missed on its latest first try (last 14 days) is due now until answered
  right. Each item names the skill, word, pattern and/or lesson, a priority, a due date and
  a reason.
- **Weak skill**: ≥ 4 answers and score < 70 → "Practice ⟨skill⟩" for the parent, and
  prioritised in the child's daily plan.
- **Strong skill**: MASTERED or ALMOST_MASTERED.
- **Daily plan**: the parent's daily minutes (10/15/20/30/45). Up to 2 review items get
  ~30% of the time (≥ 5 min) when something is weak or due; the rest goes to the next new
  lessons. Order: one new lesson, reviews, more new lessons. V1 review replays the skill's
  first lesson; dedicated mixed review sessions come with Phase 11.

## Feedback

After each answer: **Correct**, **Try again** (tries left), **Almost correct** (a near
miss: right letters in the wrong order, most pairs or blanks right, tracing close to the
target), then **Incorrect** with the answer and the question's explanation; **Completed**
at the end. The words are rows in `feedback_messages` (rotated; `{answer}` filled in).

## Scoring and rewards

Each answer scores 100 (right first time), 50 (right after feedback) or 0. Lesson score =
first-try percentage; stars: ≥ 90% → 3, ≥ 70% → 2, otherwise 1 for finishing.
Points: 10 per first-try correct answer + 5 per star; 20 per badge. Badges are data
(`achievements.criteria`: lessons completed, stars, streak days, words learned).
"Words learned" = answered correctly on the first try at least twice.

## Phonics Check

A skill check (`assessments.code = phonics-check`, type `skill_check`) with twelve areas —
letter recognition, letter sounds, beginning sounds, ending sounds, short vowels, CVC
words, blending, segmenting, digraphs, patterns, word reading, spelling — two questions
each, every question attached to the skill it measures. The child takes it from Phonics →
Practice ("Sound Check") in the ordinary player with one try per question. The server
scores the stored first tries per area (secure at ≥ `areaPassPercent`, default 75%) and
per skill (`src/lib/learning/assessment-scoring.ts`); the answers also count toward skill
mastery like any other answers. The child sees stars; the parent sees the overall and
per-area percentages on the dashboard. Retaking it adds a new result.

## Placement ("Find My Level")

Stages in order: letters → sounds → CVC → blending → digraphs → sight words → sentences →
reading. The child continues while passing; the suggested level is the one mapped to the
last passed stage (`src/lib/learning/placement.ts`, config in `assessments.config`). The
UI must say "suggested level" — this is a transparent rule, not a validated instrument.
Parents can always override the level on the child's profile.
