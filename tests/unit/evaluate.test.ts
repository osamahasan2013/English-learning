import { describe, expect, it } from "vitest";
import { classifySpellingError, evaluateResponse } from "@/lib/learning/evaluate";

describe("evaluateResponse", () => {
  it("accepts a matching choice id", () => {
    expect(evaluateResponse("MULTIPLE_CHOICE", { accepted: ["ship"] }, { value: "ship" })).toEqual({
      isCorrect: true,
      errorType: null,
    });
  });

  it("classifies a wrong choice", () => {
    expect(evaluateResponse("LISTEN_AND_CHOOSE", { accepted: ["ship"] }, { value: "chip" })).toEqual({
      isCorrect: false,
      errorType: "wrong_choice",
    });
  });

  it("ignores case and surrounding whitespace", () => {
    expect(evaluateResponse("SPELLING", { accepted: ["cat"] }, { value: "  CAT " }).isCorrect).toBe(true);
  });

  it("joins built tiles, so s+h+i+p and sh+i+p are both ship", () => {
    const answer = { accepted: ["ship"] };
    expect(evaluateResponse("WORD_BUILDER", answer, { sequence: ["s", "h", "i", "p"] }).isCorrect).toBe(true);
    expect(evaluateResponse("WORD_BUILDER", answer, { sequence: ["sh", "i", "p"] }).isCorrect).toBe(true);
  });

  it("reports letter order mistakes in word building", () => {
    expect(evaluateResponse("WORD_BUILDER", { accepted: ["ship"] }, { sequence: ["p", "i", "sh"] })).toEqual({
      isCorrect: false,
      errorType: "wrong_order",
    });
  });

  it("compares sentence tokens without case or punctuation", () => {
    const answer = { acceptedSequences: [["I", "like", "apples."]] };
    expect(
      evaluateResponse("SENTENCE_BUILDER", answer, { sequence: ["i", "like", "apples"] }).isCorrect,
    ).toBe(true);
    expect(evaluateResponse("SENTENCE_BUILDER", answer, { sequence: ["like", "I", "apples."] })).toEqual({
      isCorrect: false,
      errorType: "wrong_order",
    });
  });

  it("accepts any of several valid sentence orders", () => {
    const answer = {
      acceptedSequences: [
        ["Today", "I", "run."],
        ["I", "run", "today."],
      ],
    };
    expect(evaluateResponse("SENTENCE_BUILDER", answer, { sequence: ["I", "run", "today."] }).isCorrect).toBe(
      true,
    );
  });

  it("rejects a response of the wrong shape", () => {
    expect(
      evaluateResponse("SENTENCE_BUILDER", { acceptedSequences: [["a", "b"]] }, { value: "a b" }),
    ).toEqual({
      isCorrect: false,
      errorType: "invalid_response",
    });
  });

  it("treats unscored questions as correct", () => {
    expect(evaluateResponse("INTRO", null, { value: "" }).isCorrect).toBe(true);
  });
});

describe("classifySpellingError", () => {
  it.each([
    ["cat", "", "missing_letters"],
    ["cat", "act", "wrong_order"],
    ["ship", "sip", "missing_letters"],
    ["cat", "catt", "extra_letters"],
    ["cat", "cot", "wrong_letters"],
    ["ship", "chop", "wrong_letters"],
    ["ship", "shoop", "misspelling"],
  ])("%s spelled %j is %s", (target, given, expected) => {
    expect(classifySpellingError(target, given)).toBe(expected);
  });
});
