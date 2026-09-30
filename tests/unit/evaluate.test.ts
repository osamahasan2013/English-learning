import { describe, expect, it } from "vitest";
import { classifySpellingError, evaluateResponse } from "@/lib/learning/evaluate";

describe("evaluateResponse", () => {
  it("accepts a matching choice id", () => {
    expect(evaluateResponse("MULTIPLE_CHOICE", { accepted: ["ship"] }, { value: "ship" })).toEqual({
      isCorrect: true,
      almost: false,
      errorType: null,
    });
  });

  it("classifies a wrong choice", () => {
    expect(evaluateResponse("LISTEN_AND_CHOOSE", { accepted: ["ship"] }, { value: "chip" })).toEqual({
      isCorrect: false,
      almost: false,
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
    // Right letters in the wrong order is a near miss ("almost").
    expect(evaluateResponse("WORD_BUILDER", { accepted: ["ship"] }, { sequence: ["p", "i", "sh"] })).toEqual({
      isCorrect: false,
      almost: true,
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
      almost: false,
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
      almost: false,
      errorType: "invalid_response",
    });
  });

  it("treats unscored questions as correct", () => {
    expect(evaluateResponse("INTRO", null, { value: "" }).isCorrect).toBe(true);
  });

  it("matches pairs as a set and calls most-right pairs almost", () => {
    const answer = {
      pairs: [
        ["a", "x"],
        ["b", "y"],
        ["c", "z"],
      ] as [string, string][],
    };
    expect(
      evaluateResponse("MATCH", answer, {
        pairs: [
          ["c", "z"],
          ["a", "x"],
          ["b", "y"],
        ],
      }).isCorrect,
    ).toBe(true);
    expect(
      evaluateResponse("MATCH", answer, {
        pairs: [
          ["a", "x"],
          ["b", "z"],
          ["c", "y"],
        ],
      }),
    ).toEqual({
      isCorrect: false,
      almost: false,
      errorType: "wrong_match",
    });
    expect(
      evaluateResponse(
        "SORT",
        { pairs: [...answer.pairs, ["d", "x"]] },
        {
          pairs: [
            ["a", "x"],
            ["b", "y"],
            ["c", "x"],
            ["d", "x"],
          ],
        },
      ),
    ).toEqual({ isCorrect: false, almost: true, errorType: "wrong_group" });
    // Repeating a right pair does not make up for a missing one.
    expect(
      evaluateResponse("MATCH", answer, {
        pairs: [
          ["a", "x"],
          ["a", "x"],
          ["b", "y"],
        ],
      }).isCorrect,
    ).toBe(false);
  });

  it("fills blanks in order and treats most-right blanks as almost", () => {
    const answer = { acceptedSequences: [["cat", "mat"]] };
    expect(evaluateResponse("DRAG_DROP", answer, { sequence: ["Cat", "mat"] }).isCorrect).toBe(true);
    expect(evaluateResponse("DRAG_DROP", answer, { sequence: ["cat", "run"] })).toEqual({
      isCorrect: false,
      almost: true,
      errorType: "wrong_word",
    });
    expect(evaluateResponse("DRAG_DROP", answer, { sequence: ["mat", "cat"] }).almost).toBe(false);
  });

  it("checks written sentences without case or end punctuation", () => {
    const answer = { accepted: ["I can see a bird."] };
    expect(evaluateResponse("WRITING", answer, { value: "i can see a bird" }).isCorrect).toBe(true);
    expect(evaluateResponse("WRITING", answer, { value: "I can see a horse." }).isCorrect).toBe(false);
  });

  it("scores tracing on coverage, with a near miss margin", () => {
    const answer = { minCoverage: 60 };
    expect(evaluateResponse("TRACING", answer, { coverage: 72 }).isCorrect).toBe(true);
    expect(evaluateResponse("TRACING", answer, { coverage: 50 })).toEqual({
      isCorrect: false,
      almost: true,
      errorType: "incomplete_trace",
    });
    expect(evaluateResponse("TRACING", answer, { coverage: 10 }).almost).toBe(false);
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
