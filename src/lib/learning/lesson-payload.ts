import type { ParsedQuestion } from "@/lib/content/question-schemas";

// What the lesson player receives: everything needed to run a lesson offline, already
// validated. Built on the server by src/lib/server/lesson-loader.ts and cached on the
// device (src/lib/offline/db.ts).

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
  question: ParsedQuestion;
  pattern: LessonPattern | null;
  // For word building: what speech synthesis should say for each tile's sound (from the
  // tile's phonics pattern), so blending demos say "kuh… aa… tuh", not letter names.
  tileSounds: Record<string, string>;
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
  };
  steps: LessonStep[];
  loadedAt: string;
};
