import type { ActivityConfig } from "@/lib/content/activity-config";
import type { ParsedQuestion } from "@/lib/content/question-schemas";
import type { AnswerKey } from "@/lib/learning/answer-key";
import type { FeedbackMessage } from "@/lib/learning/feedback";
import type { PlayerRules, ScoringRules } from "@/lib/learning/rules";
import type { SpellingStepSettings } from "@/lib/learning/spelling";
import type { SoundTable } from "@/lib/audio/pronunciation";

// What the lesson player receives: everything needed to run a lesson offline, already
// validated. Built on the server by src/lib/server/lesson-loader.ts and cached on the
// device (src/lib/offline/db.ts). It carries no plaintext answers: each scored step has
// an AnswerKey of salted digests instead (src/lib/learning/answer-key.ts, ADR-021).

// A question as the device sees it: its content without the answer.
export type ClientQuestion = ParsedQuestion extends infer Q
  ? Q extends { answer: unknown }
    ? Omit<Q, "answer">
    : never
  : never;

export type PatternSound = { code: string; label: string; sayAs: string; ipa: string };

export type LessonPattern = {
  code: string;
  pattern: string;
  type: string;
  childExplanation: string;
  sounds: PatternSound[];
};

export type LessonStep = {
  questionId: string;
  questionVersion: number;
  activityId: string;
  activityTitle: string;
  instructions: string;
  instructionsSpeech: string;
  stage: string;
  prompt: string;
  promptSpeech: string;
  skillId: string;
  wordId: string | null;
  scored: boolean;
  question: ClientQuestion;
  answerKey: AnswerKey;
  // Tries before the answer is shown (activity config, else the player rule).
  maxTries: number;
  // Shown after answering.
  explanation: string;
  // Validated activity configuration (e.g. the passage for reading questions).
  activityConfig: ActivityConfig;
  pattern: LessonPattern | null;
  // For word building: the sound token for each tile ({/K/}), from the tile's phonics
  // pattern, so blending demos say the sounds, never the letter names.
  tileSounds: Record<string, string>;
  // Spelling steps: the activity, input method, hints and dictation replays, resolved on the
  // server from the activity config and the level's spelling rules. null otherwise.
  spelling: SpellingStepSettings | null;
};

export type LessonPayload = {
  lesson: {
    id: string;
    code: string;
    title: string;
    childTitle: string;
    emoji: string;
    version: number;
    skillId: string;
    skillTitle: string;
    description: string;
    introSpeech: string;
    estimatedMinutes: number;
    difficulty: number;
    subjectName: string;
    levelName: string;
  };
  // Set when this payload is an assessment (a skill check such as the Phonics Check):
  // answers are recorded against an assessment sitting instead of a lesson run, with one
  // try each. `lesson` then describes the assessment.
  assessment?: { id: string; code: string; areas: { stage: number; label: string }[] };
  // Set when this payload is word practice (Word Explorer, My Words): published questions
  // about the chosen words, taken from their lessons. Answers count like any answers, but
  // no lesson run is recorded — the lessons themselves are not "completed" by practice.
  practice?: {
    kind: "word" | "my_words" | "spelling" | "dictation";
    returnHref: string;
    // What the "back" button on the summary says (defaults by kind).
    returnLabel?: string;
    wordIds: string[];
  };
  steps: LessonStep[];
  // Phonics sounds and letter names for the speech tokens in this lesson ({/S/}, {@s}),
  // with recorded clips where they exist (see src/lib/audio/pronunciation.ts). Optional:
  // lessons cached before it existed still play (their tokens are then not spoken).
  sounds?: SoundTable;
  feedback: FeedbackMessage[];
  rules: { player: PlayerRules; scoring: ScoringRules };
  loadedAt: string;
};
