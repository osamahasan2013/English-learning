import { describe, expect, it } from "vitest";
import {
  canGoBack,
  currentView,
  firstTryResults,
  initialSessionState,
  isResumable,
  sessionReducer,
  type SessionAction,
  type SessionState,
  type SessionStep,
} from "@/lib/learning/lesson-session";

const steps: SessionStep[] = [
  { questionId: "intro", scored: false, maxTries: 2 },
  { questionId: "q1", scored: true, maxTries: 2 },
  { questionId: "q2", scored: true, maxTries: 2 },
];

const right = (value = "x"): SessionAction => ({
  type: "answered",
  isCorrect: true,
  almost: false,
  response: { value },
});
const wrong = (almost = false, value = "y"): SessionAction => ({
  type: "answered",
  isCorrect: false,
  almost,
  response: { value },
});

function run(actions: SessionAction[], start: SessionState = initialSessionState(steps)) {
  return actions.reduce(sessionReducer, start);
}

describe("lesson session", () => {
  it("starts on the intro screen and ends on the summary", () => {
    const state = initialSessionState(steps);
    expect(state.screen).toBe("intro");
    expect(sessionReducer(state, right()).screen).toBe("intro");
    const done = run([
      { type: "start" },
      { type: "next" },
      right(),
      { type: "next" },
      right(),
      { type: "next" },
    ]);
    expect(done.screen).toBe("summary");
    expect(firstTryResults(done)).toEqual([{ isCorrect: true }, { isCorrect: true }]);
    expect(initialSessionState([]).screen).toBe("summary");
    expect(initialSessionState(steps, { skipIntro: true }).screen).toBe("steps");
  });

  it("does not let an intro be answered or a scored step be skipped", () => {
    let state = run([{ type: "start" }, right()]);
    expect(state.index).toBe(0);
    state = run([{ type: "next" }, { type: "next" }], state);
    expect(state.index).toBe(1); // the scored step needs an answer first
  });

  it("scores the first try only and offers a retry with the right feedback", () => {
    let state = run([{ type: "start" }, { type: "next" }, wrong()]);
    expect(state).toMatchObject({ phase: "retry", feedback: "TRY_AGAIN" });
    state = run([{ type: "retry" }, right()], state);
    expect(state).toMatchObject({ phase: "correct", feedback: "CORRECT", attemptNumber: 2 });
    expect(state.firstTries).toEqual({ q1: false });
  });

  it("says almost for a near miss, and reveals after the last try", () => {
    let state = run([{ type: "start" }, { type: "next" }, wrong(true)]);
    expect(state.feedback).toBe("ALMOST_CORRECT");
    state = run([{ type: "retry" }, wrong(true)], state);
    expect(state).toMatchObject({ phase: "reveal", feedback: "INCORRECT" });
  });

  it("honours a step's own number of tries", () => {
    const oneTry: SessionStep[] = [{ questionId: "q", scored: true, maxTries: 1 }];
    const state = run([wrong()], initialSessionState(oneTry, { skipIntro: true }));
    expect(state.phase).toBe("reveal");
  });

  it("goes back to finished steps read-only, then forward to the step in progress", () => {
    let state = run([{ type: "start" }, { type: "next" }, right("cat"), { type: "next" }]);
    expect(state.index).toBe(2);
    expect(canGoBack(state)).toBe(true);
    state = sessionReducer(state, { type: "previous" });
    expect(state.index).toBe(1);
    expect(currentView(state)).toMatchObject({
      reviewing: true,
      phase: "correct",
      response: { value: "cat" },
    });
    // Answers cannot be changed after the fact.
    expect(sessionReducer(state, wrong())).toBe(state);
    state = sessionReducer(state, { type: "next" });
    expect(currentView(state)).toMatchObject({ reviewing: false, phase: "answering" });
  });

  it("does not go back in the middle of feedback", () => {
    const state = run([{ type: "start" }, { type: "next" }, wrong()]);
    expect(canGoBack(state)).toBe(false);
    expect(sessionReducer(state, { type: "previous" }).index).toBe(1);
  });

  it("resumes only a saved state for the same steps with something answered", () => {
    const inProgress = run([{ type: "start" }, { type: "next" }, right()]);
    expect(isResumable(inProgress, steps)).toBe(true);
    expect(isResumable(initialSessionState(steps), steps)).toBe(false);
    expect(isResumable(inProgress, steps.slice(0, 2))).toBe(false);
    expect(isResumable({ ...inProgress, screen: "summary" }, steps)).toBe(false);
    // State is plain data, so it survives being saved and loaded.
    expect(JSON.parse(JSON.stringify(inProgress))).toEqual(inProgress);
  });
});
