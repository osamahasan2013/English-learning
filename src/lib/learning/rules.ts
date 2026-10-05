import { z } from "zod";

// The engine's tunable numbers. Defaults live here; an admin can override any of them
// per rule set in the `learning_rules` table (code = mastery | prerequisites | review |
// player | scoring | vocabulary | spelling |
// reading | writing), which the server merges over these defaults. Every value is
// documented in docs/curriculum.md so parent-facing explanations can quote it.

const statuses = ["NOT_STARTED", "LEARNING", "PRACTICING", "ALMOST_MASTERED", "MASTERED"] as const;
const days = z.number().min(0).max(60);

export const masteryRulesSchema = z.object({
  // Mastery score (0–100) → status. NOT_STARTED = no attempts; a started skill is at
  // least LEARNING (1–39), then PRACTICING (40–69), ALMOST_MASTERED (70–89), MASTERED (90+).
  bands: z
    .object({
      practicing: z.number().min(1).max(100),
      almostMastered: z.number().min(1).max(100),
      mastered: z.number().min(1).max(100),
    })
    .refine((b) => b.practicing < b.almostMastered && b.almostMastered < b.mastered, {
      message: "bands must increase: practicing < almostMastered < mastered",
    }),
  // Accuracy is judged on the latest windowSize first tries, the latest recentSize of
  // them weighted by recentWeight.
  windowSize: z.number().int().min(5).max(100),
  recentSize: z.number().int().min(1).max(50),
  recentWeight: z.number().min(0).max(1),
  // Repeated evidence: the score is scaled by min(1, attempts / fullEvidenceAttempts), so
  // one or two right answers can never look like mastery.
  fullEvidenceAttempts: z.number().int().min(1).max(100),
  // MASTERED also needs practice on at least this many different days.
  masteredMinPracticeDays: z.number().int().min(1).max(30),
  confidenceAttempts: z.number().int().min(1).max(200),
  reviewIntervalDays: z.object(
    Object.fromEntries(statuses.map((s) => [s, days])) as Record<(typeof statuses)[number], typeof days>,
  ),
  // After a wrong latest answer the skill comes back this soon, whatever its status.
  afterMistakeReviewDays: days,
});

export const prerequisiteRulesSchema = z.object({
  // A prerequisite skill counts as ready from this status on.
  minStatus: z.enum(statuses),
  // Lessons with unmet prerequisites can still be previewed: this many steps.
  previewSteps: z.number().int().min(1).max(20),
});

export const reviewRulesSchema = z.object({
  // A skill needs this much evidence before it is called weak.
  minAttempts: z.number().int().min(1).max(50),
  weakBelowScore: z.number().min(1).max(100),
  // Words missed on a first try within this many days come back for review.
  missedWordLookbackDays: z.number().int().min(1).max(90),
  maxOpenItems: z.number().int().min(1).max(100),
});

export const playerRulesSchema = z.object({
  // Tries per question before the answer is shown (an activity can override: maxTries).
  maxTries: z.number().int().min(1).max(3),
  // A learning session ends after this much inactivity.
  sessionTimeoutMinutes: z.number().int().min(5).max(240),
});

export const scoringRulesSchema = z.object({
  threeStarPercent: z.number().min(1).max(100),
  twoStarPercent: z.number().min(1).max(100),
  pointsPerCorrect: z.number().int().min(0).max(100),
  pointsPerStar: z.number().int().min(0).max(100),
  // Score of one answer: right first time / right after feedback / wrong.
  firstTryScore: z.number().min(0).max(100),
  retryScore: z.number().min(0).max(100),
});

// Words use the skill mastery algorithm (mastery.ts) with these word-sized settings: a
// single word is answered far less often than a whole skill.
export const vocabularyRulesSchema = z.object({
  // Evidence for one word: the score is scaled by min(1, first tries / this).
  fullEvidenceAttempts: z.number().int().min(1).max(50),
  // A word with at least minAttempts first tries and accuracy below this is weak and
  // comes back for review (the review queue's weak_word reason).
  minAttempts: z.number().int().min(1).max(50),
  weakBelowAccuracy: z.number().min(1).max(100),
  // Saved words (My Words) that have been practised are scheduled for review.
  reviewSavedWords: z.boolean(),
  // Questions in one word-practice session.
  practiceQuestions: z.number().int().min(2).max(20),
});

// Spelling (Phase 6): word spelling mastery, review, and the progression per level — which
// input method a child uses, how many hints and dictation replays they get, whether sentence
// dictation checks capitals and full stops. Read by the lesson loader and the progress
// writer; React components only display what they are given.
export const INPUT_METHODS = ["KEYBOARD", "ON_SCREEN_KEYBOARD", "LETTER_TILES", "DRAG_DROP"] as const;
export type InputMethod = (typeof INPUT_METHODS)[number];

export const spellingLevelRulesSchema = z.object({
  // Spelling types taught at this level (codes of spelling_types).
  spellingTypes: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/)).min(1),
  // Default input for typing activities (an activity's config.input wins).
  inputMethod: z.enum(INPUT_METHODS),
  maxWordLength: z.number().int().min(1).max(20),
  // Hints a child can open per question (0 = none).
  maxHints: z.number().int().min(0).max(4),
  // Dictation: plays of the word allowed (null = no limit) and the "Slow" button.
  dictationReplayLimit: z.number().int().min(1).max(10).nullable(),
  slowReplay: z.boolean(),
  sentenceDictation: z.boolean(),
  // Sentence dictation also asks for a capital letter and an end mark.
  sentencePunctuation: z.boolean(),
});

export const spellingRulesSchema = z.object({
  // Evidence for one word's spelling: the score is scaled by min(1, first tries / this).
  fullEvidenceAttempts: z.number().int().min(1).max(50),
  // A word with at least minAttempts spelling first tries and accuracy below this is weak.
  minAttempts: z.number().int().min(1).max(50),
  weakBelowAccuracy: z.number().min(1).max(100),
  // Only answers right without a hint count as independent spelling for word mastery.
  requireIndependent: z.boolean(),
  // A phonics pattern misspelled this often within the lookback becomes a review item.
  patternErrorsForReview: z.number().int().min(1).max(20),
  patternLookbackDays: z.number().int().min(1).max(90),
  // Questions in one spelling practice or dictation session.
  practiceQuestions: z.number().int().min(2).max(20),
  // Used for a level without its own settings.
  defaultLevel: z.string(),
  levels: z.record(z.string().regex(/^[A-Z0-9_]{1,40}$/), spellingLevelRulesSchema),
});

// Reading (Phase 7): what a text at each level may look like (checked by the importer),
// how its difficulty is scored, how guided reading starts, which words tapped for help come
// back for review, and when a text is suggested again. Comprehension mastery is ordinary
// skill mastery (the `mastery` rules); nothing here scores reading itself.
export const READING_MODES = ["listen_first", "read_first"] as const;
export type ReadingMode = (typeof READING_MODES)[number];

const difficultyFactor = (max: number) =>
  z
    .object({
      weight: z.number().min(0).max(10),
      from: z.number().min(0).max(max),
      full: z.number().min(1).max(max),
    })
    .refine((f) => f.from < f.full, { message: "from must be below full" });

export const readingLevelRulesSchema = z.object({
  maxParagraphs: z.number().int().min(1).max(20),
  maxSentences: z.number().int().min(1).max(80),
  // Words per sentence (a longer one is reported as an error by the importer).
  maxSentenceWords: z.number().int().min(1).max(40),
  // Below this share of decodable or sight words the importer flags the text for review.
  minDecodablePct: z.number().min(0).max(100),
  // Guided reading at this level starts by listening (KG) or by reading (later).
  defaultMode: z.enum(READING_MODES),
  // Highlight each word as it is read (the youngest) or each sentence.
  highlight: z.enum(["word", "sentence"]),
  // Comprehension questions per text the importer expects (warning outside the range).
  minQuestions: z.number().int().min(0).max(20),
  maxQuestions: z.number().int().min(0).max(20),
});

export const readingRulesSchema = z.object({
  defaultLevel: z.string(),
  levels: z.record(z.string().regex(/^[A-Z0-9_]{1,40}$/), readingLevelRulesSchema),
  // Difficulty 1–10 from the text's statistics: each factor is scaled 0–1 between its
  // `from` value (easiest) and its `full` value (hardest) and weighted; the weights are
  // normalised, so they need not sum to 1.
  difficulty: z.object({
    avgSentenceWords: difficultyFactor(40),
    avgWordLetters: difficultyFactor(15),
    totalWords: difficultyFactor(2000),
    nonDecodablePct: difficultyFactor(100),
  }),
  // Time on a text counts up to this much (a child who walks away is not reading).
  maxCountedSeconds: z.number().int().min(30).max(3600),
  // A word tapped for help in at least this many of the child's last `helpLookbackSessions`
  // readings that contain it comes back for review (reading:<word id>), until the child
  // answers a question about it right on the first try or reads it without help again.
  helpTapsForReview: z.number().int().min(1).max(10),
  helpLookbackSessions: z.number().int().min(1).max(20),
  // A text is suggested again when its comprehension first tries fell below this (percent).
  rereadBelowPercent: z.number().min(0).max(100),
});

// Writing (Phase 8): how strictly each level is held to the mechanics of writing (capital
// letters, spaces between words, end marks, spelling of known words), how forgiving
// tracing and letter writing are, and when a letter comes back for review. "off": not
// mentioned; "hint": pointed out, never marks an answer wrong; "required": part of what
// makes the answer right. Mastery is ordinary skill mastery (the `mastery` rules).
export const WRITING_MECHANICS = ["capitalization", "punctuation", "spacing", "spelling"] as const;
export type WritingMechanic = (typeof WRITING_MECHANICS)[number];
export const MECHANIC_MODES = ["off", "hint", "required"] as const;
export type MechanicMode = (typeof MECHANIC_MODES)[number];

export const writingLevelRulesSchema = z.object({
  mechanics: z.object(
    Object.fromEntries(WRITING_MECHANICS.map((m) => [m, z.enum(MECHANIC_MODES)])) as Record<
      WritingMechanic,
      z.ZodEnum<["off", "hint", "required"]>
    >,
  ),
  // Tracing tolerance is the glyph's own, multiplied by this (younger hands get more room).
  traceToleranceScale: z.number().min(0.5).max(3),
  // Writing a letter from memory or from a model (no guide underneath) gets this much more.
  writeToleranceScale: z.number().min(1).max(3),
  // The glyph's completion threshold, multiplied by this.
  completionScale: z.number().min(0.5).max(1.2),
  // Stroke order and direction: "hint" (feedback, recorded) or "required".
  strokeOrder: z.enum(["off", "hint", "required"]),
  // Shortest sentence (words) that counts as a sentence in open-ended writing.
  minSentenceWords: z.number().int().min(1).max(10),
});

export const writingRulesSchema = z.object({
  defaultLevel: z.string(),
  levels: z.record(z.string().regex(/^[A-Z0-9_]{1,40}$/), writingLevelRulesSchema),
  // Ink must land near the letter: below this share of ink on or next to a stroke, the
  // trace counts as scribbling and is not complete.
  minPrecision: z.number().min(0.2).max(1),
  // Within this many coverage points of the threshold a trace is "almost".
  almostMargin: z.number().min(0).max(0.4),
  // A letter formed wrongly on the first try in at least `missesForReview` of the child's
  // last `lookback` tries comes back for review (writing:<glyph id>) until it is formed
  // right on `correctToResolve` first tries in a row.
  letterReview: z.object({
    lookback: z.number().int().min(2).max(20),
    missesForReview: z.number().int().min(1).max(10),
    correctToResolve: z.number().int().min(1).max(10),
  }),
});

// Audio pacing (Phase 8.2): how fast, and in what pieces, speech is read to a child at
// each level. Browser voices do not reliably slow down from the rate alone (iOS Safari
// sounds nearly the same at 0.85 and 0.6), so pace is set by rate AND by the size of the
// pieces read in one go AND by the pauses between them — Slow is audibly slower on every
// engine because it reads smaller pieces with pauses, not only because of its rate.
// Phonics pieces (a sound, a letter name) are always read on their own, never run into
// the words around them. docs/audio-engine.md explains the chosen values.
export const AUDIO_CHUNKS = ["sentence", "phrase", "word"] as const;
export type AudioChunk = (typeof AUDIO_CHUNKS)[number];

export const readingPaceSchema = z.object({
  // Speech-synthesis rate (1 = the voice's own speed).
  rate: z.number().min(0.5).max(1.2),
  // Read in one go: a whole sentence, a short phrase (up to maxWords) or one word.
  chunk: z.enum(AUDIO_CHUNKS),
  maxWords: z.number().int().min(1).max(12),
  // Silence between the pieces of a sentence, and between sentences (ms).
  pauseMs: z.number().int().min(0).max(1500),
  sentenceGapMs: z.number().int().min(0).max(3000),
});

const bySpeed = <T extends z.ZodTypeAny>(schema: T) => z.object({ normal: schema, slow: schema });

export const audioRulesSchema = z.object({
  defaultLevel: z.string(),
  levels: z.record(z.string().regex(/^[A-Z0-9_]{1,40}$/), bySpeed(readingPaceSchema)),
  phonics: z.object({
    // A sound or a letter name on its own.
    rate: bySpeed(z.number().min(0.5).max(1.2)),
    // Silence around a sound or letter name inside a sentence ("It says … guh … as in goat").
    tokenGapMs: bySpeed(z.number().int().min(0).max(2000)),
    // Silence between the sounds of a word when segmenting or blending (g … ay … t).
    itemGapMs: bySpeed(z.number().int().min(0).max(2000)),
    // Silence before the whole word at the end of a blend (… t … gate).
    wordGapMs: bySpeed(z.number().int().min(0).max(3000)),
  }),
});

export type AudioRules = z.infer<typeof audioRulesSchema>;
export type ReadingPace = z.infer<typeof readingPaceSchema>;

export type ReadingRules = z.infer<typeof readingRulesSchema>;
export type WritingRules = z.infer<typeof writingRulesSchema>;
export type WritingLevelRules = z.infer<typeof writingLevelRulesSchema>;
export type ReadingLevelRules = z.infer<typeof readingLevelRulesSchema>;
export type MasteryRules = z.infer<typeof masteryRulesSchema>;
export type SpellingRules = z.infer<typeof spellingRulesSchema>;
export type SpellingLevelRules = z.infer<typeof spellingLevelRulesSchema>;
export type VocabularyRules = z.infer<typeof vocabularyRulesSchema>;
export type PrerequisiteRules = z.infer<typeof prerequisiteRulesSchema>;
export type ReviewRules = z.infer<typeof reviewRulesSchema>;
export type PlayerRules = z.infer<typeof playerRulesSchema>;
export type ScoringRules = z.infer<typeof scoringRulesSchema>;

export type LearningRules = {
  mastery: MasteryRules;
  prerequisites: PrerequisiteRules;
  review: ReviewRules;
  player: PlayerRules;
  scoring: ScoringRules;
  vocabulary: VocabularyRules;
  spelling: SpellingRules;
  reading: ReadingRules;
  writing: WritingRules;
  audio: AudioRules;
};

export const DEFAULT_RULES: LearningRules = {
  mastery: {
    bands: { practicing: 40, almostMastered: 70, mastered: 90 },
    windowSize: 30,
    recentSize: 10,
    recentWeight: 0.6,
    fullEvidenceAttempts: 10,
    masteredMinPracticeDays: 2,
    confidenceAttempts: 20,
    reviewIntervalDays: { NOT_STARTED: 0, LEARNING: 1, PRACTICING: 2, ALMOST_MASTERED: 4, MASTERED: 7 },
    afterMistakeReviewDays: 1,
  },
  prerequisites: { minStatus: "PRACTICING", previewSteps: 3 },
  review: { minAttempts: 4, weakBelowScore: 70, missedWordLookbackDays: 14, maxOpenItems: 10 },
  player: { maxTries: 2, sessionTimeoutMinutes: 30 },
  scoring: {
    threeStarPercent: 90,
    twoStarPercent: 70,
    pointsPerCorrect: 10,
    pointsPerStar: 5,
    firstTryScore: 100,
    retryScore: 50,
  },
  vocabulary: {
    fullEvidenceAttempts: 6,
    minAttempts: 3,
    weakBelowAccuracy: 70,
    reviewSavedWords: true,
    practiceQuestions: 6,
  },
  spelling: {
    fullEvidenceAttempts: 4,
    minAttempts: 3,
    weakBelowAccuracy: 70,
    requireIndependent: true,
    patternErrorsForReview: 2,
    patternLookbackDays: 14,
    practiceQuestions: 8,
    defaultLevel: "KG3",
    levels: {
      KG1: {
        spellingTypes: ["CVC"],
        inputMethod: "LETTER_TILES",
        maxWordLength: 3,
        maxHints: 4,
        dictationReplayLimit: null,
        slowReplay: true,
        sentenceDictation: false,
        sentencePunctuation: false,
      },
      KG2: {
        spellingTypes: ["CVC", "HIGH_FREQUENCY", "SIGHT_WORD"],
        inputMethod: "LETTER_TILES",
        maxWordLength: 4,
        maxHints: 4,
        dictationReplayLimit: null,
        slowReplay: true,
        sentenceDictation: false,
        sentencePunctuation: false,
      },
      KG3: {
        spellingTypes: [
          "CVC",
          "CVCC",
          "CCVC",
          "DIGRAPH",
          "BLEND",
          "SIGHT_WORD",
          "HIGH_FREQUENCY",
          "IRREGULAR",
        ],
        inputMethod: "ON_SCREEN_KEYBOARD",
        maxWordLength: 5,
        maxHints: 4,
        dictationReplayLimit: 5,
        slowReplay: true,
        sentenceDictation: true,
        sentencePunctuation: false,
      },
      GRADE1: {
        spellingTypes: [
          "CCVCC",
          "LONG_VOWEL",
          "VOWEL_TEAM",
          "R_CONTROLLED",
          "WORD_ENDING",
          "HIGH_FREQUENCY",
          "IRREGULAR",
        ],
        inputMethod: "ON_SCREEN_KEYBOARD",
        maxWordLength: 7,
        maxHints: 3,
        dictationReplayLimit: 4,
        slowReplay: true,
        sentenceDictation: true,
        sentencePunctuation: false,
      },
      GRADE2: {
        spellingTypes: [
          "WORD_ENDING",
          "MULTISYLLABIC",
          "IRREGULAR",
          "HIGH_FREQUENCY",
          "VOWEL_TEAM",
          "R_CONTROLLED",
        ],
        inputMethod: "KEYBOARD",
        maxWordLength: 10,
        maxHints: 3,
        dictationReplayLimit: 3,
        slowReplay: true,
        sentenceDictation: true,
        sentencePunctuation: true,
      },
    },
  },
  reading: {
    defaultLevel: "KG3",
    levels: {
      KG1: {
        maxParagraphs: 4,
        maxSentences: 4,
        maxSentenceWords: 5,
        minDecodablePct: 50,
        defaultMode: "listen_first",
        highlight: "word",
        minQuestions: 1,
        maxQuestions: 3,
      },
      KG2: {
        maxParagraphs: 6,
        maxSentences: 6,
        maxSentenceWords: 6,
        minDecodablePct: 70,
        defaultMode: "listen_first",
        highlight: "word",
        minQuestions: 2,
        maxQuestions: 4,
      },
      KG3: {
        maxParagraphs: 8,
        maxSentences: 8,
        maxSentenceWords: 8,
        minDecodablePct: 70,
        defaultMode: "listen_first",
        highlight: "sentence",
        minQuestions: 3,
        maxQuestions: 6,
      },
      GRADE1: {
        maxParagraphs: 6,
        maxSentences: 16,
        maxSentenceWords: 12,
        minDecodablePct: 60,
        defaultMode: "read_first",
        highlight: "sentence",
        minQuestions: 3,
        maxQuestions: 6,
      },
      GRADE2: {
        maxParagraphs: 8,
        maxSentences: 28,
        maxSentenceWords: 16,
        minDecodablePct: 50,
        defaultMode: "read_first",
        highlight: "sentence",
        minQuestions: 4,
        maxQuestions: 7,
      },
    },
    difficulty: {
      avgSentenceWords: { weight: 3, from: 2, full: 10 },
      avgWordLetters: { weight: 2, from: 2.5, full: 4.5 },
      totalWords: { weight: 2, from: 10, full: 120 },
      nonDecodablePct: { weight: 3, from: 0, full: 40 },
    },
    maxCountedSeconds: 900,
    helpTapsForReview: 2,
    helpLookbackSessions: 5,
    rereadBelowPercent: 60,
  },
  writing: {
    defaultLevel: "KG3",
    levels: {
      KG1: {
        mechanics: { capitalization: "off", punctuation: "off", spacing: "off", spelling: "hint" },
        traceToleranceScale: 1.4,
        writeToleranceScale: 1.4,
        completionScale: 0.85,
        strokeOrder: "hint",
        minSentenceWords: 1,
      },
      KG2: {
        mechanics: { capitalization: "hint", punctuation: "hint", spacing: "hint", spelling: "hint" },
        traceToleranceScale: 1.25,
        writeToleranceScale: 1.35,
        completionScale: 0.9,
        strokeOrder: "hint",
        minSentenceWords: 2,
      },
      KG3: {
        mechanics: { capitalization: "required", punctuation: "required", spacing: "hint", spelling: "hint" },
        traceToleranceScale: 1.1,
        writeToleranceScale: 1.3,
        completionScale: 0.95,
        strokeOrder: "hint",
        minSentenceWords: 3,
      },
      GRADE1: {
        mechanics: {
          capitalization: "required",
          punctuation: "required",
          spacing: "required",
          spelling: "hint",
        },
        traceToleranceScale: 1,
        writeToleranceScale: 1.25,
        completionScale: 1,
        strokeOrder: "hint",
        minSentenceWords: 3,
      },
      GRADE2: {
        mechanics: {
          capitalization: "required",
          punctuation: "required",
          spacing: "required",
          spelling: "required",
        },
        traceToleranceScale: 1,
        writeToleranceScale: 1.2,
        completionScale: 1,
        strokeOrder: "hint",
        minSentenceWords: 4,
      },
    },
    minPrecision: 0.7,
    almostMargin: 0.15,
    letterReview: { lookback: 4, missesForReview: 2, correctToResolve: 2 },
  },
  // Read-aloud for early readers is about 90–120 words a minute and "slow, pointing at each
  // word" about 50–70; adult conversation is 150+. Rates are kept at 0.6 or above (lower
  // distorts some voices): the youngest get small pieces and pauses instead.
  audio: {
    defaultLevel: "KG3",
    levels: {
      KG1: {
        normal: { rate: 0.7, chunk: "phrase", maxWords: 4, pauseMs: 350, sentenceGapMs: 750 },
        slow: { rate: 0.62, chunk: "word", maxWords: 1, pauseMs: 450, sentenceGapMs: 900 },
      },
      KG2: {
        normal: { rate: 0.8, chunk: "phrase", maxWords: 4, pauseMs: 180, sentenceGapMs: 550 },
        slow: { rate: 0.64, chunk: "word", maxWords: 1, pauseMs: 340, sentenceGapMs: 850 },
      },
      KG3: {
        normal: { rate: 0.83, chunk: "sentence", maxWords: 12, pauseMs: 0, sentenceGapMs: 500 },
        slow: { rate: 0.66, chunk: "phrase", maxWords: 2, pauseMs: 350, sentenceGapMs: 800 },
      },
      GRADE1: {
        normal: { rate: 0.88, chunk: "sentence", maxWords: 12, pauseMs: 0, sentenceGapMs: 450 },
        slow: { rate: 0.7, chunk: "phrase", maxWords: 2, pauseMs: 330, sentenceGapMs: 750 },
      },
      GRADE2: {
        normal: { rate: 0.92, chunk: "sentence", maxWords: 12, pauseMs: 0, sentenceGapMs: 400 },
        slow: { rate: 0.74, chunk: "phrase", maxWords: 2, pauseMs: 300, sentenceGapMs: 700 },
      },
    },
    phonics: {
      rate: { normal: 0.75, slow: 0.6 },
      tokenGapMs: { normal: 350, slow: 600 },
      itemGapMs: { normal: 450, slow: 750 },
      wordGapMs: { normal: 650, slow: 1000 },
    },
  },
};

const schemas = {
  mastery: masteryRulesSchema,
  prerequisites: prerequisiteRulesSchema,
  review: reviewRulesSchema,
  player: playerRulesSchema,
  scoring: scoringRulesSchema,
  vocabulary: vocabularyRulesSchema,
  spelling: spellingRulesSchema,
  reading: readingRulesSchema,
  writing: writingRulesSchema,
  audio: audioRulesSchema,
} as const;

// Merges stored overrides over the defaults. An override that fails validation is
// ignored (the defaults stay in force) and reported, so a bad edit cannot break lessons.
export function mergeLearningRules(rows: { code: string; config: unknown }[]): {
  rules: LearningRules;
  errors: string[];
} {
  const rules = structuredClone(DEFAULT_RULES);
  const errors: string[] = [];
  for (const row of rows) {
    if (!Object.hasOwn(schemas, row.code)) {
      errors.push(`unknown rule set "${row.code}"`);
      continue;
    }
    const code = row.code as keyof LearningRules;
    const override = row.config && typeof row.config === "object" ? row.config : {};
    const merged = deepMerge(rules[code], override as Record<string, unknown>);
    const parsed = schemas[code].safeParse(merged);
    if (parsed.success) (rules as Record<string, unknown>)[code] = parsed.data;
    else
      errors.push(
        `${code}: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
      );
  }
  return { rules, errors };
}

function deepMerge<T>(base: T, override: Record<string, unknown>): T {
  const out = { ...(base as Record<string, unknown>) };
  for (const [key, value] of Object.entries(override)) {
    const current = out[key];
    out[key] =
      value && typeof value === "object" && !Array.isArray(value) && current && typeof current === "object"
        ? deepMerge(current, value as Record<string, unknown>)
        : value;
  }
  return out as T;
}
