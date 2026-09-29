import { describe, expect, it } from "vitest";
import { segmentWord, splitHighlight } from "@/lib/learning/blending";

describe("segmentWord", () => {
  it("prefers digraph tiles", () => {
    expect(segmentWord("ship", ["p", "sh", "i", "ch"])).toEqual(["sh", "i", "p"]);
  });
  it("splits CVC words into letters", () => {
    expect(segmentWord("cat", ["t", "a", "c", "o"])).toEqual(["c", "a", "t"]);
  });
  it("falls back to letters when the tiles cannot build the word", () => {
    expect(segmentWord("dog", ["c", "a"])).toEqual(["d", "o", "g"]);
  });
});

describe("splitHighlight", () => {
  it("finds the pattern inside a word", () => {
    expect(splitHighlight("Fish", "sh")).toEqual({ before: "Fi", match: "sh", after: "" });
  });
  it("returns the whole text when there is nothing to highlight", () => {
    expect(splitHighlight("cat", "sh")).toEqual({ before: "cat", match: "", after: "" });
  });
});
