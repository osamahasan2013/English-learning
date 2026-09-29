import { describe, expect, it } from "vitest";
import {
  firstTryResults,
  initialSessionState,
  sessionReducer,
  type SessionAction,
} from "@/lib/learning/lesson-session";

const steps = [
  { questionId: "intro", scored: false },
  { questionId: "q1", scored: true },
  { questionId: "q2", scored: true },
];

function run(actions: SessionAction[]) {
  return actions.reduce(sessionReducer, initialSessionState(steps));
}

describe("lesson session", () => {
  it("advances past an unscored intro with next", () => {
    expect(run([{ type: "next" }]).index).toBe(1);
  });

  it("does not let an intro be answered or a scored step be skipped", () => {
    expect(run([{ type: "answered", isCorrect: true }]).phase).toBe("answering");
    const atQ1 = run([{ type: "next" }, { type: "next" }]);
    expect(atQ1.index).toBe(1);
  });

  it("scores the first try only, allowing one retry", () => {
    const state = run([
      { type: "next" },
      { type: "answered", isCorrect: false },
      { type: "retry" },
      { type: "answered", isCorrect: true },
    ]);
    expect(state.phase).toBe("correct");
    expect(state.attemptNumber).toBe(2);
    expect(state.firstTries).toEqual({ q1: false });
  });

  it("reveals the answer after the second wrong try", () => {
    const state = run([
      { type: "next" },
      { type: "answered", isCorrect: false },
      { type: "retry" },
      { type: "answered", isCorrect: false },
    ]);
    expect(state.phase).toBe("reveal");
    expect(sessionReducer(state, { type: "next" })).toMatchObject({
      index: 2,
      attemptNumber: 1,
      phase: "answering",
    });
  });

  it("finishes after the last step and reports first-try results in order", () => {
    const state = run([
      { type: "next" },
      { type: "answered", isCorrect: true },
      { type: "next" },
      { type: "answered", isCorrect: false },
      { type: "retry" },
      { type: "answered", isCorrect: true },
      { type: "next" },
    ]);
    expect(state.finished).toBe(true);
    expect(firstTryResults(state)).toEqual([{ isCorrect: true }, { isCorrect: false }]);
    expect(sessionReducer(state, { type: "next" })).toBe(state);
  });
});
