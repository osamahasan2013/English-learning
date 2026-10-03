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
- 393 words in 27 categories (24 top-level + Farm Animals, Fruit, Vegetables), each split
  into graphemes and phonemes (1,422 segments), 20 extra word levels, 393 curated example
  sentences, 41 typed relations, 13 word families (-at, -an, -ap, -ip, -in, -ig, -op, -ot,
  -og, -ug, -et, -en, -ed; 47 members), 25 sight words, 21 sentences, 4 original stories.
- Spelling (Phase 6): 14 spelling types, 136 spelling targets across KG1–Grade 2 (every
  one a word of the bank; 18 high-frequency words were added to the bank for them), 18
  spelling skills and 23 spelling lessons (`spelling_set` blueprint, 456 questions) in one
  SPELLING unit per level, and child-friendly feedback for each spelling error category.
- 96 lessons / 784 activities / 1,113 lesson questions across 25 units — including 21
  vocabulary sets (407 questions) — the "Find My Level" placement (8 stages) and the
  **Phonics Check** (12 areas, 24 questions).

| Level   | Phonics (Phase 4)                                                                                                                                           | Other units                                                                                   |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| KG1     | One lesson per letter a–z (name, sound, beginning sound, picture sort, find the letter); upper/lower case, letter names, beginning sounds                   | Trace letters; words: animals, colors, my body, family                                        |
| KG2     | Short a, i, o, u, e CVC lessons (blend, segment, middle sound, build, read, spell); segmenting; ending sounds; word families                                | Word games, sight words, sentence order, CVC check; words: food, toys, on the go, more colors |
| KG3     | Digraphs sh, ch (+ sh/ch sort), th (two sounds), ph, wh; magic e with a, i, o                                                                               | Tricky words; words: clothes, my house, nature                                                |
| Grade 1 | ck, ng; consonant blends; vowel teams ee, ea (two sounds), ai/ay, oa, ow (two sounds), oo (two sounds), ou, oi/oy; ar, or, er/ir/ur, air; -ing, -ed, -s/-es | Read and match; words: feelings, jobs, weather, my day, describing, school                    |
| Grade 2 | -tion/-sion, suffixes (-ment, -ness, -ful, -less), multisyllable words                                                                                      | Story time; words: technology, my town, sports, places                                        |

**Multiple pronunciations are modelled explicitly**, never flattened into one rule: TH
(thumb/this), EA (leaf/bread), OW (snow/cow), OO (moon/book), -ED (jumped/played/painted),
-S (cats/dogs), SION, and vowels/C/G/S/Y for single letters. Lessons include "which sound
do you hear?" questions for them. Irregular words (said, was, they, have, the, thumb,
shoe…) are flagged `is_irregular` with a `spelling_note` that explains the exception.

## Authoring content

Files in `content/`:

| File                                                 | Contains                                                                                                                             |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `reference.json`                                     | levels, subjects, skill dimensions, activity types, word categories (with `parent` for sub-categories), achievements, rule overrides |
| `vocabulary.json`                                    | word families (rime, level, vowel pattern; members found in the word bank)                                                           |
| `phonics.json`                                       | phonemes, phonics stages, patterns with their sounds (as phonemes) and relations                                                     |
| `words/*.csv`                                        | the word bank (same format as bulk imports, below)                                                                                   |
| `spelling/*.csv`                                     | spelling targets: which words are spelled at which level, and their spelling data (below)                                            |
| `sight-words.json`, `sentences.json`, `stories.json` | lists by level                                                                                                                       |
| `curriculum/*.json`                                  | one file per level: units → skills → lessons → activities → questions                                                                |
| `assessments.json`                                   | assessments by stage                                                                                                                 |

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

### Vocabulary sets (Phase 5)

A vocabulary lesson is one `vocabulary_set` blueprint with 4–8 words (usually one
category; `"mixed": true` skips the category activities). The importer passes the level,
and the lesson grows with it:

| Level    | Activities                                                                                                  |
| -------- | ----------------------------------------------------------------------------------------------------------- |
| KG1      | meet the words → listen and find the picture (×4) → which one goes with ⟨category⟩? → odd one out           |
| KG2      | + picture → word (×2), read the word → picture, match words to pictures, which word means…?, missing letter |
| KG3      | + build the word, spell it, look-alike words (cat / cap / cut), finish the sentence                         |
| Grade 1+ | + match words to meanings, a second meaning question, which sentence makes sense?, sort by category         |

Distractors are chosen from the published word bank by rules (`src/lib/content/vocabulary.ts`):
never the word, a synonym, a word with the same picture or a word above the child's level
(+1 at most); 2 options for KG1–KG2, 3 later; other categories for the youngest children
and the same category from Grade 1 (harder); look-alike spellings for recognition; another
part of speech for "which sentence makes sense?" ("The girl is table."). A question that
cannot get suitable distractors is reported invalid — never filled with random words.

### Spelling sets (Phase 6)

A spelling lesson is one `spelling_set` blueprint with 3–8 spelling targets (words listed
in `content/spelling/*.csv`). It follows the spelling flow **Listen → Look → Segment →
Build → Spell → Check → Understand the mistake → Retry → Use it in a sentence → Mini
assessment**; check / understand / retry happen inside every spelling step (up to three
tries: the mistake is named, the child's letters are marked, hints can be opened):

| Level | Activities                                                                                                                                                                          |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| KG1   | getting ready to spell: listen & look → first sound (tap its letter) → sounds to word (choose) → build with letter tiles → check — no typing yet                                    |
| KG2   | listen & look → sound it out (WORD_TO_SOUNDS) → build → middle vowel and last sound → spell each word → sounds to word (choose) → fix the jumble (SCRAMBLED_WORD) → dictation check |
| KG3+  | missing sound (the pattern) instead of missing letter; sounds to word is written from Grade 1; sentence dictation where the level's rules say so                                    |

The check at the end is dictation with one try. `"tricky": true` (irregular and
high-frequency words) leaves out the activities built on a word's sounds and practises the
tricky part instead ("s\_\_d": ai / ay / e). Which activities a level gets, its input method
(letter tiles for KG1–KG2, the child keyboard for KG3–Grade 1, the keyboard for Grade 2),
hints per question (4 for KG1–KG3, 3 later), dictation replays (no limit → 5 → 4 → 3), sentence dictation and
whether capitals and full stops are checked (Grade 2) are spelling rules
(`src/lib/learning/rules.ts` → `spelling.levels`, overridable in `learning_rules`), not
code in the screens. An activity's config (`input`, `maxHints`, `replayLimit`,
`slowReplay`, `maxTries`) wins over the level.

Spelling templates (every word must be a spelling target):

| Template                  | Activity           | Produces                                                                                                       |
| ------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------- |
| `spelling_intro`          | (listen & look)    | INTRO: the word, its graphemes (sh · i · p), the pattern or the tricky part                                    |
| `listen_and_type`         | LISTEN_AND_TYPE    | SPELLING, mode listen: picture + word to hear, write it                                                        |
| `dictation_word`          | DICTATION          | SPELLING, mode dictation: the word only, limited replays                                                       |
| `sound_to_word`           | SOUND_TO_WORD      | hear the phonemes, then choose the word (BLEND_SOUNDS, up to KG3) or write it (SPELLING mode sounds, Grade 1+) |
| `build_the_word`          | BUILD_THE_WORD     | WORD_BUILDER from grapheme tiles plus look-alikes (sh / s / ch)                                                |
| `scrambled_word`          | SCRAMBLED_WORD     | WORD_BUILDER, mode scrambled: the word's letters mixed up                                                      |
| `spelling_missing_letter` | MISSING_LETTER     | MISSING_LETTER: one letter missing                                                                             |
| `missing_sound`           | MISSING_SOUND      | MISSING_LETTER, mode sound: the letters of one sound (or the tricky part)                                      |
| `word_to_sounds`          | WORD_TO_SOUNDS     | SEGMENT_WORD                                                                                                   |
| `sentence_dictation`      | SENTENCE_DICTATION | SENTENCE_DICTATION: hear the word's sentence, write it                                                         |

Each spelling question carries the word's split, generated progressive hints (listen again → say it slowly → how many sounds? → the tricky part / the pattern / the first letter; authored hints come before the last one; never the whole word) and letter tiles for tile input. Speech input is not implemented (a future
feature; no third-party service).

### Spelling targets (CSV)

`content/spelling/*.csv` — required `word, level, spelling_type, difficulty`; optional
`skill` (a spelling skill code), `phonics_pattern` (the focus pattern), `audio` (a
recording's storage path), `example_sentence` (for dictation; default the word's own),
`is_high_frequency`, `is_irregular`, `irregular_part` (the part that breaks the rule, as
written: `ai` in said), `hints` (`|`), `common_errors` (`;`), `tags` (`;`), `sense`, `status`.
The word must already be in the word bank — spelling data never creates or copies a word,
and not every vocabulary word is a spelling target. The importer refuses unknown words,
levels, types, patterns and skills and an irregular part that is not in the word, and
flags (for admin review) a focus pattern the word's split does not use, a type or length
outside the level's spelling progression and a sentence without the word.

```
npm run content:import -- --spelling path/to/spelling.csv [--dry-run]
```

The report lists **Created, Updated, Skipped, Invalid, Duplicates** (and Archived on a full
import of `content/`).

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
| `picture_to_word`        | A picture: tap its word                                      | `word`, optional `distractors`                                 |
| `word_to_picture`        | A written word: tap its picture                              | `word`, optional `distractors`                                 |
| `similar_word`           | Hear a word among look-alikes                                | `word`, optional `distractors`                                 |
| `meaning_to_word`        | "Which one means: something you drink?"                      | `word`, optional `distractors`                                 |
| `match_word_meaning`     | Match words to child-friendly meanings                       | `words[2–4]`                                                   |
| `match_word_picture`     | Match words to pictures                                      | `words[2–5]`                                                   |
| `word_missing_letter`    | A letter is missing (a vowel by default, from the split)     | `word`, optional `missing`                                     |
| `build_vocab_word`       | Build the word from letters plus a few extra                 | `word`                                                         |
| `complete_sentence`      | Finish the word's example sentence (DRAG_DROP)               | `word`, optional `sentence`, `distractors`                     |
| `use_in_sentence`        | Which sentence uses the word the right way?                  | `word`, optional `sentence`                                    |
| `pick_category_member`   | Which one goes with ⟨category⟩?                              | `word`, optional `distractors`                                 |
| `odd_one_out`            | Three from a category and one that does not belong           | `words[3+]`, optional `odd`                                    |
| `sort_by_category`       | Sort words into their category and another one               | `words[2+]`                                                    |

`listen_pick_picture`, `listen_pick_word` and `read_word` also choose their distractors
from the bank when none are listed. Vocabulary templates record what a question exercises
(`metadata.wordArea`: recognition, listening, meaning, reading, spelling, usage) and link
usage questions to their sentence (`sentence_id`).

Question/activity codes default to `<lesson>-a<n>-q<n>`; give explicit `code`s if you
reorder questions and want history to stay attached to the same question.

### Bulk word import (CSV)

Required columns: `word, level, category, difficulty, phonics_pattern, definition,
example_sentence, sight_word`. Optional: `emoji, part_of_speech, child_definition,
syllables, pronunciation, irregular, spelling_note, plural, tags, related, sense, status`,
and (Phase 5) `levels` (further levels, `KG3;GRADE1`), `subcategory` (must belong to
`category`), `examples` (more example sentences, separated by `|`), `synonyms`,
`antonyms` (words of the bank, `;`), `inflections` (`past=jumped;ing=jumping`; keys
plural, past, past_participle, ing, third_person, comparative, superlative — forms that
are words of the bank become plural / verb_form / adjective_form relations), `image` and
`audio` (storage paths of uploaded media). A word is letters and apostrophes only.

Example sentences become rows of the sentence bank linked to the word. They are checked
(capital letter, end punctuation, the word or one of its forms inside, at most the level's
sentence length + 3 words, since they are heard as well as read) and anything doubtful is
flagged for review; a word without a child-friendly meaning is flagged too.
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
  skill's own threshold (`skills.mastery_threshold`) when that is stricter. Days are the
  family's calendar days (the parent's time zone). Answers with the same timestamp are
  ordered by id, so the result never depends on arrival order.
- Stored per child and skill: mastery score, attempts, correct attempts, accuracy, recent
  accuracy, last practised, last assessed, status.
- Next review: LEARNING 1 day, PRACTICING 2, ALMOST 4, MASTERED 7; 1 day after a mistake.
- Review priority (0–100) = (0.6 × (100 − score) + 8 × recent mistakes + up to 20 for being
  overdue) × (0.8 + 0.1 × importance).

Because it is recomputed from history, a skill that slips drops back down.

### Word mastery

Each word uses the skill mastery model above on all first tries about that word, with a
word-sized evidence target (`vocabulary.fullEvidenceAttempts` = 6): one right answer is
LEARNING, never MASTERED, and MASTERED still needs two practice days. Answers are also
counted per area (recognition, listening, meaning, reading, spelling, usage). A word is
**weak** with ≥ 3 answers and accuracy below 70%; weak words, words missed on their latest
first try (14 days) and saved words at their review date are review items. Children see
0–3 stars per word; parents see words learned (≥ 2 first-try right answers), practised and
mastered, weak areas and categories (only with ≥ 6 answers), words to practise and recent
words.

### Spelling mastery and mistakes

Spelling a word is tracked apart from knowing it: `spelling_progress` uses the same
mastery model on the word's spelling first tries (build, type, dictation, missing
letter/sound, scrambled, sounds to word) with a spelling evidence target
(`spelling.fullEvidenceAttempts` = 4); only answers right **without a hint** count as
independent spelling, so MASTERED means spelled alone, several times, on two days. Every
wrong spelling gets one category, decided by fixed rules in this order: empty → UNKNOWN;
two letters swapped or the right letters in another order → TRANSPOSITION; only the
irregular part wrong → PHONETIC_APPROXIMATION ("sed"); one doubled / undoubled letter →
EXTRA / MISSING_LETTER; same sounds by the taught spellings ("kat", "fone", "bote") →
PHONETIC_APPROXIMATION; more than half the word changed → UNKNOWN; every change in one kind
of grapheme → WRONG_ENDING / WRONG_DIGRAPH / WRONG_BLEND (neighbouring consonants: st, fr,
mp) / WRONG_VOWEL (vowel letters, vowel teams, r-controlled vowels, magic e); otherwise
MISSING / EXTRA / SUBSTITUTED_LETTER by the kind of change, or UNKNOWN. Sentence dictation
adds WORD_ORDER, MISSING_WORD, EXTRA_WORD and PUNCTUATION.

Review: a spelling target missed on its latest spelling first try (14 days), weak (≥ 3
answers, accuracy < 70%) or practised but not mastered (at its next review date) is a
`spelling:` review item; a phonics pattern misspelled at least twice in 14 days (ship → sip,
fish → fis) is one `pattern:` item pointing at that pattern's phonics lesson, resolved
after two right spellings of words with that pattern. For spelling targets the word's
vocabulary review ignores spelling answers, so one miss is reviewed once.

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
