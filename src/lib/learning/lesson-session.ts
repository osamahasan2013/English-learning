import type { QuestionResponse } from "@/lib/content/question-schemas";
import { nextSection, type FlowSection } from "@/lib/learning/assessment-flow";
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

// An assessment sitting's section flow (Phase 9, assessment-flow.ts): which section each
// step belongs to and how the next section is chosen. Without it steps run in order.
export type SessionFlow = {
  rule: "none" | "level_ladder";
  startRank: number;
  passPercent: number;
  maxSectionsPerDomain?: number;
  sections: FlowSection[];
  sectionOf: Record<string, string>;
};

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
  flow?: SessionFlow;
};

export type SessionAction =
  | { type: "start" }
  | { type: "answered"; isCorrect: boolean; almost: boolean; response: QuestionResponse }
  | { type: "retry" }
  | { type: "next" }
  | { type: "previous" }
  // "I don't know" (assessments that allow it): a first try that is not right, no feedback.
  | { type: "skip" };

export function initialSessionState(
  steps: SessionStep[],
  options: {
    skipIntro?: boolean;
    flow?: SessionFlow;
    // Answers already stored for this sitting (another device): never asked again.
    answered?: Record<string, boolean>;
  } = {},
): SessionState {
  const known = Object.fromEntries(
    Object.entries(options.answered ?? {}).filter(([q]) => steps.some((s) => s.questionId === q)),
  );
  const state: SessionState = {
    steps,
    screen: steps.length === 0 ? "summary" : options.skipIntro ? "steps" : "intro",
    index: 0,
    furthest: 0,
    attemptNumber: 1,
    phase: "answering",
    feedback: null,
    response: null,
    outcomes: Object.fromEntries(
      Object.entries(known).map(([q, ok]) => [
        q,
        { phase: ok ? "correct" : "reveal", feedback: null, response: null },
      ]),
    ),
    firstTries: known,
    flow: options.flow,
  };
  return options.skipIntro ? enter(state) : state;
}

// The next step to serve after `from` (-1 = before the first): in order without a flow;
// with one, the rest of the current section, then the section the flow chooses
// (assessment-flow.ts), skipping steps already answered. null = finished.
export function nextStepIndex(state: SessionState, from: number): number | null {
  const flow = state.flow;
  if (!flow) return from + 1 < state.steps.length ? from + 1 : null;
  const pending = (section: string) =>
    state.steps.findIndex(
      (s) => flow.sectionOf[s.questionId] === section && !(s.questionId in state.firstTries),
    );
  const current = from >= 0 ? flow.sectionOf[state.steps[from]?.questionId ?? ""] : undefined;
  if (current) {
    const next = pending(current);
    if (next >= 0) return next;
  }
  const outcomes: Record<string, { correct: number; total: number }> = {};
  for (const section of flow.sections) {
    const own = state.steps.filter((s) => flow.sectionOf[s.questionId] === section.code);
    if (own.length === 0 || own.some((s) => !(s.questionId in state.firstTries))) continue;
    outcomes[section.code] = {
      correct: own.filter((s) => state.firstTries[s.questionId]).length,
      total: own.length,
    };
  }
  // A section that was started but not finished (resume) is served first.
  const started = flow.sections.find(
    (sec) =>
      !outcomes[sec.code] &&
      state.steps.some((s) => flow.sectionOf[s.questionId] === sec.code && s.questionId in state.firstTries),
  );
  const section =
    started ??
    nextSection({
      rule: flow.rule,
      startRank: flow.startRank,
      passPercent: flow.passPercent,
      maxSectionsPerDomain: flow.maxSectionsPerDomain,
      sections: flow.sections,
      outcomes,
    });
  if (!section) return null;
  const index = pending(section.code);
  return index >= 0 ? index : null;
}

// Leaves the intro: the first step to serve (or the summary when nothing is left).
function enter(state: SessionState): SessionState {
  const first = nextStepIndex(state, -1);
  if (first === null) return { ...state, screen: "summary" };
  return { ...state, screen: "steps", index: first, furthest: first };
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
  // An assessment never goes back (answers are evidence; sections are chosen as you go).
  if (state.flow) return false;
  if (state.screen !== "steps" || state.index === 0) return false;
  // Not in the middle of feedback for the live step: finish it first.
  return state.index < state.furthest || state.phase === "answering";
}

export function sessionReducer(state: SessionState, action: SessionAction): SessionState {
  if (state.screen === "summary") return state;
  if (state.screen === "intro") return action.type === "start" ? enter(state) : state;
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
    case "skip": {
      if (state.index !== state.furthest || state.phase !== "answering" || !step.scored) return state;
      if (state.attemptNumber !== 1) return state;
      return {
        ...state,
        firstTries: { ...state.firstTries, [step.questionId]: false },
        phase: "reveal",
        feedback: null,
        response: { skipped: true },
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
      const index = nextStepIndex({ ...state, outcomes }, state.index);
      if (index === null || index >= state.steps.length) return { ...state, outcomes, screen: "summary" };
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
