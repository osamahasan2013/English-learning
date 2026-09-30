import type { QuestionResponse } from "@/lib/content/question-schemas";
import type { AudioSpeed } from "@/lib/audio/audio-service";
import type { Reveal } from "@/lib/learning/answer-key";
import type { LessonStep } from "@/lib/learning/lesson-payload";
import type { SessionPhase } from "@/lib/learning/lesson-session";

// Every activity renderer gets the same props. It shows the question, reports the
// child's response with onAnswer, and displays the current phase; it never decides
// correctness or progression itself (the lesson player does). Renderers never see the
// answer: after the last try the player passes `reveal`, recovered from the answer key.
export type RendererProps<Q extends LessonStep["question"] = LessonStep["question"]> = {
  step: LessonStep & { question: Q };
  phase: SessionPhase;
  lastResponse: QuestionResponse | null;
  reveal: Reveal | null;
  onAnswer: (response: QuestionResponse) => void;
  speak: (text: string, speed?: AudioSpeed) => Promise<unknown>;
};

// The question type a renderer handles, as the device sees it (no answer).
export type QuestionOf<T extends LessonStep["question"]["type"]> = Extract<
  LessonStep["question"],
  { type: T }
>;
