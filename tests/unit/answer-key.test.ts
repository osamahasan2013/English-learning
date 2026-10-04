import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseQuestion, type AnswerSpec, type QuestionResponse } from "@/lib/content/question-schemas";
import { buildAnswerKey, checkWithKey, digest, revealAnswer } from "@/lib/learning/answer-key";
import { evaluateResponse } from "@/lib/learning/evaluate";
import type { ClientQuestion } from "@/lib/learning/lesson-payload";
import { sha256 } from "@/lib/learning/sha256";

// The device checks answers against digests; the server against the real answer. They
// must always agree, and the key must never contain the answer itself.

async function both(type: string, answer: AnswerSpec, response: QuestionResponse) {
  const key = await buildAnswerKey(type, answer, "salt-1");
  const device = await checkWithKey(type, key, response);
  const server = evaluateResponse(type, answer, response);
  return { device, server: { isCorrect: server.isCorrect, almost: server.almost }, key };
}

const cases: [string, AnswerSpec, QuestionResponse][] = [
  ["MULTIPLE_CHOICE", { accepted: ["ship"] }, { value: "ship" }],
  ["MULTIPLE_CHOICE", { accepted: ["ship"] }, { value: "chip" }],
  ["SPELLING", { accepted: ["cat"] }, { value: " CAT " }],
  ["SPELLING", { accepted: ["cat"] }, { value: "act" }],
  ["SPELLING", { accepted: ["cat"] }, { value: "dog" }],
  ["WORD_BUILDER", { accepted: ["ship"] }, { sequence: ["sh", "i", "p"] }],
  ["WORD_BUILDER", { accepted: ["ship"] }, { sequence: ["p", "i", "sh"] }],
  [
    "SENTENCE_BUILDER",
    { acceptedSequences: [["I", "like", "apples."]] },
    { sequence: ["i", "like", "apples"] },
  ],
  [
    "SENTENCE_BUILDER",
    { acceptedSequences: [["I", "like", "red", "apples."]] },
    { sequence: ["I", "like", "apples.", "red"] },
  ],
  ["DRAG_DROP", { acceptedSequences: [["cat", "mat"]] }, { sequence: ["cat", "run"] }],
  [
    "MATCH",
    {
      pairs: [
        ["a", "x"],
        ["b", "y"],
      ],
    },
    {
      pairs: [
        ["b", "y"],
        ["a", "x"],
      ],
    },
  ],
  [
    "SORT",
    {
      pairs: [
        ["a", "g1"],
        ["b", "g1"],
        ["c", "g2"],
      ],
    },
    {
      pairs: [
        ["a", "g1"],
        ["b", "g2"],
        ["c", "g2"],
      ],
    },
  ],
  ["WRITING", { accepted: ["I can see a bird."] }, { value: "i can see a bird" }],
  ["MISSING_LETTER", { accepted: ["a"] }, { sequence: ["a"] }],
];

describe("answer keys", () => {
  it.each(cases)("%s: device and server agree on %j → %j", async (type, answer, response) => {
    const { device, server } = await both(type, answer, response);
    expect(device).toEqual(server);
  });

  it("never contains the plaintext answer", async () => {
    for (const [type, answer] of cases) {
      if ("minCoverage" in answer) continue;
      const key = JSON.stringify(await buildAnswerKey(type, answer, "salt-1"));
      const plain = JSON.stringify(answer)
        .toLowerCase()
        .match(/[a-z]{3,}/g)!
        .filter((w) => !["accepted", "acceptedsequences", "pairs", "salt"].includes(w));
      for (const word of plain) expect(key.toLowerCase()).not.toContain(word);
    }
  });

  it("uses a per-question salt, so equal answers look different", async () => {
    const a = await buildAnswerKey("SPELLING", { accepted: ["cat"] }, "salt-a");
    const b = await buildAnswerKey("SPELLING", { accepted: ["cat"] }, "salt-b");
    expect(a).not.toEqual(b);
  });

  it("falls back to a pure SHA-256 identical to the platform one", () => {
    for (const text of ["", "abc", "a".repeat(200), "salt\u0000cat 🐱"]) {
      const bytes = new TextEncoder().encode(text);
      expect(Buffer.from(sha256(bytes)).toString("hex")).toBe(
        createHash("sha256").update(bytes).digest("hex"),
      );
    }
  });

  it("digests are stable", async () => {
    expect(await digest("s", "cat")).toBe(await digest("s", "cat"));
    expect(await digest("s", "cat")).not.toBe(await digest("s", "cab"));
  });
});

describe("revealing the answer after the last try", () => {
  async function reveal(type: string, content: unknown, answer: AnswerSpec) {
    const parsed = parseQuestion(type, content, answer);
    if (!parsed.ok) throw new Error(parsed.error);
    const { answer: _answer, ...question } = parsed.question;
    return revealAnswer(question as ClientQuestion, await buildAnswerKey(type, answer, "salt"));
  }

  it("finds the right option, blank, pairs and word on screen", async () => {
    expect(
      await reveal(
        "MULTIPLE_CHOICE",
        {
          options: [
            { id: "chip", text: "chip" },
            { id: "ship", text: "ship" },
          ],
        },
        { accepted: ["ship"] },
      ),
    ).toEqual({ text: "ship", optionId: "ship" });

    expect(
      await reveal(
        "SENTENCE_BUILDER",
        { tokens: ["cat.", "I", "a", "see"] },
        { acceptedSequences: [["I", "see", "a", "cat."]] },
      ),
    ).toMatchObject({ text: "I see a cat.", sequence: ["I", "see", "a", "cat."] });

    expect(
      await reveal(
        "DRAG_DROP",
        { parts: [{ text: "The" }, { blank: true }, { text: "sat." }], bank: ["run", "cat"] },
        { acceptedSequences: [["cat"]] },
      ),
    ).toMatchObject({ text: "The cat sat.", sequence: ["cat"] });

    expect(
      await reveal(
        "MATCH",
        {
          left: [
            { id: "a", text: "A" },
            { id: "b", text: "B" },
          ],
          right: [
            { id: "y", text: "b" },
            { id: "x", text: "a" },
          ],
        },
        {
          pairs: [
            ["a", "x"],
            ["b", "y"],
          ],
        },
      ),
    ).toMatchObject({
      pairs: [
        ["a", "x"],
        ["b", "y"],
      ],
    });

    expect(
      await reveal(
        "WRITING",
        { starter: "I can see a", wordBank: ["horse", "bird"] },
        { accepted: ["I can see a bird."] },
      ),
    ).toMatchObject({ text: "I can see a bird" });
  });
});
