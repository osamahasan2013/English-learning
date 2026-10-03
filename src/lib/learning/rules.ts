import { z } from "zod";

// The engine's tunable numbers. Defaults live here; an admin can override any of them
// per rule set in the `learning_rules` table (code = mastery | prerequisites | review |
// player | scoring | vocabulary | spelling |
// reading), which the server merges over these defaults. Every value is
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

export type ReadingRules = z.infer<typeof readingRulesSchema>;
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
