// The lesson player's flow as a pure reducer (the component only renders it):
//
//   answering ──correct──▶ correct ──next──▶ next step
//      │ wrong (1st try)
//      ▼
//    retry ──retry──▶ answering (2nd try) ──wrong──▶ reveal (show the answer) ──next──▶
//
// Unscored steps (INTRO) just move on with "next". Only first tries are scored.

export const MAX_TRIES = 2;

export type SessionStep = { questionId: string; scored: boolean };

export type SessionPhase = "answering" | "correct" | "retry" | "reveal";

export type SessionState = {
  steps: SessionStep[];
  index: number;
  attemptNumber: number;
  phase: SessionPhase;
  firstTries: Record<string, boolean>;
  finished: boolean;
};

export type SessionAction = { type: "answered"; isCorrect: boolean } | { type: "retry" } | { type: "next" };

export function initialSessionState(steps: SessionStep[]): SessionState {
  return {
    steps,
    index: 0,
    attemptNumber: 1,
    phase: "answering",
    firstTries: {},
    finished: steps.length === 0,
  };
}

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  if (state.finished) return state;
  const step = state.steps[state.index];

  switch (action.type) {
    case "answered": {
      if (state.phase !== "answering" || !step.scored) return state;
      const firstTries =
        state.attemptNumber === 1
          ? { ...state.firstTries, [step.questionId]: action.isCorrect }
          : state.firstTries;
      if (action.isCorrect) return { ...state, firstTries, phase: "correct" };
      return { ...state, firstTries, phase: state.attemptNumber < MAX_TRIES ? "retry" : "reveal" };
    }
    case "retry":
      if (state.phase !== "retry") return state;
      return { ...state, phase: "answering", attemptNumber: state.attemptNumber + 1 };
    case "next": {
      const canAdvance =
        state.phase === "correct" ||
        state.phase === "reveal" ||
        (state.phase === "answering" && !step.scored);
      if (!canAdvance) return state;
      const index = state.index + 1;
      if (index >= state.steps.length) return { ...state, finished: true };
      return { ...state, index, attemptNumber: 1, phase: "answering" };
    }
  }
}

export function firstTryResults(state: SessionState) {
  return state.steps
    .filter((s) => s.scored && s.questionId in state.firstTries)
    .map((s) => ({ isCorrect: state.firstTries[s.questionId] }));
}
