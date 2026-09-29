# Curriculum and learning model

The curriculum is configurable data. It does not claim to follow any single school
system; levels, scope and order can be changed by editing `content/` and re-importing.

## Levels

| Level | Ages | Focus |
|---|---|---|
| KG1 | 3–4 | Letter shapes and main sounds, listening, picture words |
| KG2 | 4–5 | Short vowels, blending CVC words, first sight words, short sentences |
| KG3 | 5–6 | Consonant digraphs (sh, ch, th, wh, ck, ng), tricky words, simple paragraphs |
| Grade 1 | 6–7 | Vowel teams (ee, ea, ai/ay, oa, ow, …), longer sentences and stories |
| Grade 2 | 7–8 | R-controlled vowels, endings (-ing, -ed, -s/-es), suffixes, multisyllabic words |

Each concept follows **explanation → demonstration → guided practice → independent
practice → feedback → review**, recorded as the activity `stage`.

## Seed content (this milestone)

Original, age-appropriate content covering KG1–Grade 2:

- 58 phonics patterns (26 letters, 7 digraphs, 10 vowel teams, 5 r-controlled, 10
  endings/suffixes) with 76 modelled sounds.
- 193 words, 25 sight words, 21 sentences, 4 original stories.
- 27 lessons / 133 activities / 304 questions across 9 units, plus the "Find My Level"
  placement assessment (8 stages; the UI is a later milestone).

**Multiple pronunciations are modelled explicitly**, never flattened into one rule: TH
(thumb/this), EA (leaf/bread), OW (snow/cow), OO (moon/book), -ED (jumped/played/painted),
-S (cats/dogs), SION, and vowels/C/G/S/Y for single letters. Lessons include "which sound
do you hear?" questions for them. Irregular words (said, was, they, have, the, thumb,
shoe…) are flagged `is_irregular` with a `spelling_note` that explains the exception.

## Authoring content

Files in `content/`:

| File | Contains |
|---|---|
| `reference.json` | levels, subjects, skill dimensions, activity types, word categories, achievements |
| `phonics.json` | patterns and their sounds |
| `words/*.csv` | the word bank (same format as bulk imports, below) |
| `sight-words.json`, `sentences.json`, `stories.json` | lists by level |
| `curriculum/*.json` | one file per level: units → skills → lessons → activities → questions |
| `assessments.json` | assessments by stage |

Run `npm run content:import -- --dry-run` to validate, then `npm run content:import`.
`npm test` also validates every shipped file without a database.

### Question templates

Questions can be written in full (`type`, `content`, `answer`) or as templates the importer
expands from the word bank, so pictures, meanings and sounds come from one place:

| Template | Produces | Parameters |
|---|---|---|
| `pattern_intro` | INTRO card for a pattern with its sounds and examples | `pattern`, `examples`, optional `body`, `speech` |
| `word_intro` | INTRO card for a word | `word`, optional `body` |
| `listen_pick_picture` | Hear a word, tap its picture | `word`, `distractors` |
| `listen_pick_word` | Hear a word, tap it written | `word`, `distractors` |
| `pick_starting_sound` | Which picture starts with this sound? | `pattern`, `word`, `distractors` |
| `find_letter` | Find a letter among look-alikes | `pattern`, `distractors`, `case` |
| `pick_word_with_pattern` | Which word has this pattern/sound? | `pattern`, `word`, `distractors`, optional `sound`, `pictures` |
| `pick_pattern_sound` | Which sound does the pattern make in this word? | `pattern`, `word` |
| `missing_pattern` | Fill the gap | `word`, `missing`, `choices` |
| `build_word` | Build from sound tiles (blending) | `word`, optional `chunks`, `extra`, `demonstrate` |
| `order_sentence` | Put words in order | `sentence`, optional `emoji` |
| `spell_word` | Type the word you hear | `word` |

Question/activity codes default to `<lesson>-a<n>-q<n>`; give explicit `code`s if you
reorder questions and want history to stay attached to the same question.

### Bulk word import (CSV)

Required columns: `word, level, category, difficulty, phonics_pattern, definition,
example_sentence, sight_word`. Optional: `emoji, part_of_speech, child_definition,
syllables, pronunciation, irregular, spelling_note, plural, tags, related, sense, status`.
`phonics_pattern` is `CODE[:SOUND][*]` separated by `;` (e.g. `TH:TH_VOICED*;EE`; `*` =
featured example). Lists (`tags`, `related`) use `;`.

```
npm run content:import -- --words path/to/words.csv [--dry-run]
```

The report lists **added, updated, skipped (unchanged), invalid, duplicate** (and
**archived** for curriculum files), with line-level errors. The exit code is non-zero when
anything is invalid.

## Mastery model (V1)

Computed from the latest **30 first-try answers** for a skill (retries after feedback are
practice, not evidence):

- `recent accuracy` = last 10; `mastery score` = 60% recent + 40% window accuracy.
- **MASTERED**: score ≥ the skill's threshold (default 90), ≥ 12 answers, on ≥ 2 different
  days. One good session is never enough.
- **ALMOST_MASTERED**: score ≥ 80 and ≥ 8 answers. **PRACTICING**: ≥ 60 and ≥ 4.
  **LEARNING**: otherwise. **NOT_STARTED**: no answers.
- Next review: LEARNING 1 day, PRACTICING 2, ALMOST 4, MASTERED 7; 1 day after a mistake.
- Review priority (0–100) = (0.6 × (100 − score) + 8 × recent mistakes + up to 20 for being
  overdue) × (0.8 + 0.1 × importance).

Because it is recomputed from history, a skill that slips drops back down.

## Recommendations and review

- **Weak skill**: ≥ 4 answers and score < 70 → "Practice ⟨skill⟩" for the parent, and
  prioritised in the child's daily plan.
- **Strong skill**: MASTERED or ALMOST_MASTERED.
- **Daily plan**: the parent's daily minutes (10/15/20/30/45). Up to 2 review items get
  ~30% of the time (≥ 5 min) when something is weak or due; the rest goes to the next new
  lessons. Order: one new lesson, reviews, more new lessons. V1 review replays the skill's
  first lesson; dedicated mixed review sessions come with Phase 11.

## Scoring and rewards

First-try score per lesson; stars: ≥ 90% → 3, ≥ 70% → 2, otherwise 1 for finishing.
Points: 10 per first-try correct answer + 5 per star; 20 per badge. Badges are data
(`achievements.criteria`: lessons completed, stars, streak days, words learned).
"Words learned" = answered correctly on the first try at least twice.

## Placement ("Find My Level")

Stages in order: letters → sounds → CVC → blending → digraphs → sight words → sentences →
reading. The child continues while passing; the suggested level is the one mapped to the
last passed stage (`src/lib/learning/placement.ts`, config in `assessments.config`). The
UI must say "suggested level" — this is a transparent rule, not a validated instrument.
Parents can always override the level on the child's profile.
