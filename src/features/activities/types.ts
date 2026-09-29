import type { QuestionResponse } from "@/lib/content/question-schemas";
import type { AudioSpeed } from "@/lib/audio/audio-service";
import type { LessonStep } from "@/lib/learning/lesson-payload";
import type { SessionPhase } from "@/lib/learning/lesson-session";

// Every activity renderer gets the same props. It shows the question, reports the
// child's response with onAnswer, and displays feedback for the current phase; it never
// decides correctness or progression itself (the lesson player does).
export type RendererProps<Q extends LessonStep["question"] = LessonStep["question"]> = {
  step: LessonStep & { question: Q };
  phase: SessionPhase;
  lastResponse: QuestionResponse | null;
  onAnswer: (response: QuestionResponse) => void;
  speak: (text: string, speed?: AudioSpeed) => Promise<unknown>;
};
