import type { QuestionResponse } from "@/lib/content/question-schemas";
import type { FeedbackKind } from "@/lib/learning/feedback";

// The lesson player's flow as a pure, serializable reducer (the component only renders
// it, and saves it on the device so a lesson can be resumed after closing the tab):
//
//   intro ──start──▶ steps ──(last step)──▶ summary
//
// Within a step:
//   answering ──correct──▶ correct ──next──▶ next step
//      │ wrong, tries left
//      ▼
//    retry ──retry──▶ answering (next try) ──wrong, no tries left──▶ reveal ──next──▶
//
// Unscored steps (INTRO) just move on with "next". "previous" revisits finished steps
// read-only (answers are never changed after the fact) and "next" walks forward again to
// the step in progress. Only first tries are scored.

export type SessionStep = { questionId: string; scored: boolean; maxTries: number };

export type SessionPhase = "answering" | "correct" | "retry" | "reveal";

export type StepOutcome = {
  phase: "correct" | "reveal" | "done";
  feedback: FeedbackKind | null;
  response: QuestionResponse | null;
};

export type SessionState = {
  steps: SessionStep[];
  screen: "intro" | "steps" | "summary";
  // The step on screen, and the furthest step reached (the one being answered).
  index: number;
  furthest: number;
  // Live state of the furthest step.
  attemptNumber: number;
  phase: SessionPhase;
  feedback: FeedbackKind | null;
  response: QuestionResponse | null;
  outcomes: Record<string, StepOutcome>;
  firstTries: Record<string, boolean>;
};

export type SessionAction =
  | { type: "start" }
  | { type: "answered"; isCorrect: boolean; almost: boolean; response: QuestionResponse }
  | { type: "retry" }
  | { type: "next" }
  | { type: "previous" };

export function initialSessionState(
  steps: SessionStep[],
  options: { skipIntro?: boolean } = {},
): SessionState {
  return {
    steps,
    screen: steps.length === 0 ? "summary" : options.skipIntro ? "steps" : "intro",
    index: 0,
    furthest: 0,
    attemptNumber: 1,
    phase: "answering",
    feedback: null,
    response: null,
    outcomes: {},
    firstTries: {},
  };
}

// What the player shows for the current step: live state, or a finished step's outcome.
export function currentView(state: SessionState) {
  const step = state.steps[state.index];
  if (state.index < state.furthest && step) {
    const outcome = state.outcomes[step.questionId];
    return {
      reviewing: true,
      phase: (outcome?.phase === "done" ? "answering" : (outcome?.phase ?? "answering")) as SessionPhase,
      feedback: outcome?.feedback ?? null,
      response: outcome?.response ?? null,
      attemptNumber: 1,
    };
  }
  return {
    reviewing: false,
    phase: state.phase,
    feedback: state.feedback,
    response: state.response,
    attemptNumber: state.attemptNumber,
  };
}

export function canGoBack(state: SessionState) {
  if (state.screen !== "steps" || state.index === 0) return false;
  // Not in the middle of feedback for the live step: finish it first.
  return state.index < state.furthest || state.phase === "answering";
}

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  if (state.screen === "summary") return state;
  if (state.screen === "intro") return action.type === "start" ? { ...state, screen: "steps" } : state;
  const step = state.steps[state.index];

  switch (action.type) {
    case "start":
      return state;
    case "answered": {
      if (state.index !== state.furthest || state.phase !== "answering" || !step.scored) return state;
      const firstTries =
        state.attemptNumber === 1
          ? { ...state.firstTries, [step.questionId]: action.isCorrect }
          : state.firstTries;
      if (action.isCorrect) {
        return { ...state, firstTries, phase: "correct", feedback: "CORRECT", response: action.response };
      }
      const triesLeft = state.attemptNumber < step.maxTries;
      return {
        ...state,
        firstTries,
        phase: triesLeft ? "retry" : "reveal",
        feedback: triesLeft ? (action.almost ? "ALMOST_CORRECT" : "TRY_AGAIN") : "INCORRECT",
        response: action.response,
      };
    }
    case "retry":
      if (state.index !== state.furthest || state.phase !== "retry") return state;
      return {
        ...state,
        phase: "answering",
        feedback: null,
        response: null,
        attemptNumber: state.attemptNumber + 1,
      };
    case "previous":
      return canGoBack(state) ? { ...state, index: state.index - 1 } : state;
    case "next": {
      if (state.index < state.furthest) return { ...state, index: state.index + 1 };
      const canAdvance =
        state.phase === "correct" ||
        state.phase === "reveal" ||
        (state.phase === "answering" && !step.scored);
      if (!canAdvance) return state;
      const outcomes = {
        ...state.outcomes,
        [step.questionId]: {
          phase: step.scored ? (state.phase as "correct" | "reveal") : ("done" as const),
          feedback: state.feedback,
          response: state.response,
        },
      };
      const index = state.index + 1;
      if (index >= state.steps.length) return { ...state, outcomes, screen: "summary" };
      return {
        ...state,
        outcomes,
        index,
        furthest: index,
        attemptNumber: 1,
        phase: "answering",
        feedback: null,
        response: null,
      };
    }
  }
}

export function firstTryResults(state: SessionState) {
  return state.steps
    .filter((s) => s.scored && s.questionId in state.firstTries)
    .map((s) => ({ isCorrect: state.firstTries[s.questionId] }));
}

// A saved state is only resumed if it belongs to exactly the same steps.
export function isResumable(
  saved: SessionState | null | undefined,
  steps: SessionStep[],
): saved is SessionState {
  if (!saved || saved.screen === "summary" || saved.steps.length !== steps.length) return false;
  // Nothing answered yet: nothing worth resuming.
  if (saved.furthest === 0 && Object.keys(saved.firstTries).length === 0) return false;
  return saved.steps.every((s, i) => s.questionId === steps[i].questionId);
}
