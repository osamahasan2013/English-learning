import { describe, expect, it } from "vitest";
import {
  compileRubric,
  glyphProblems,
  rubricTemplateSchema,
  glyphSchema,
  RubricError,
} from "@/lib/content/writing-content";
import { buildAnswerKey, checkWithKey } from "@/lib/learning/answer-key";
import { evaluateResponse } from "@/lib/learning/evaluate";
import { DEFAULT_RULES } from "@/lib/learning/rules";
import {
  evaluateTrace,
  glyphStrokeProblems,
  resample,
  simplifyStroke,
  type Point,
} from "@/lib/learning/tracing";
import {
  analyzeMechanics,
  deriveLetterReview,
  editFixes,
  evaluateCompletion,
  evaluateCopy,
  evaluateEdit,
  evaluateRubric,
  evaluateStoryWriting,
  letterNeedsReview,
  phrasesOf,
  plainMatcher,
  writingKey,
  writtenSentences,
  writtenWords,
  type RubricCriterion,
} from "@/lib/learning/writing";
import { resolveWritingSettings, traceSettingsFor, withStarters } from "@/lib/learning/writing-evaluation";
import { summarizeWriting, writingSkillProgress } from "@/lib/learning/writing-report";
import { glyphByCode, strokesOf, writingContent } from "../writing-helpers";

const KG1 = resolveWritingSettings("KG1");
const KG3 = resolveWritingSettings("KG3");
const G1 = resolveWritingSettings("GRADE1");
const G2 = resolveWritingSettings("GRADE2");
const ctx = (s = G1) => ({ mechanics: s.mechanics, minSentenceWords: s.minSentenceWords });

// Draw a glyph's strokes with a transform and a steady wobble (a child's hand).
function drawn(code: string, t: (p: Point) => Point = (p) => p, wobble = 0, reverse = false) {
  return glyphByCode(code)!.strokes.map((s) => {
    let pts = resample(s.points as Point[], 1.5).map((p, i) => {
      const [x, y] = t(p);
      return [x + Math.sin(i / 4) * wobble, y + Math.cos(i / 5) * wobble] as Point;
    });
    if (reverse) pts = pts.reverse();
    return simplifyStroke(
      pts.map(([x, y]) => [Math.max(0, Math.min(100, x)), Math.max(0, Math.min(100, y))] as Point),
    );
  });
}
const trace = (target: string, strokes: number[][][], mode: "trace" | "write" = "trace", settings = KG1) => {
  const glyph = glyphByCode(target)!;
  return evaluateTrace(glyph.strokes, strokes, traceSettingsFor(glyph, mode, { trace: true }, settings));
};

describe("tracing engine", () => {
  it("accepts every shipped glyph traced along its strokes, with a wobble, at every level", () => {
    for (const settings of [KG1, G1, G2])
      for (const g of writingContent.glyphs) {
        expect(
          trace(
            g.code,
            drawn(g.code, (p) => p, 2.5),
            "trace",
            settings,
          ).complete,
          `${g.code} trace`,
        ).toBe(true);
        expect(
          trace(
            g.code,
            drawn(g.code, (p) => p, 2.5),
            "write",
            settings,
          ).complete,
          `${g.code} write`,
        ).toBe(true);
      }
  });

  it("aligns a letter written small and off-centre (write mode), but not when tracing", () => {
    const small = drawn("lower-a", ([x, y]) => [x * 0.5 + 10, y * 0.5 + 5]);
    expect(trace("lower-a", small, "write").complete).toBe(true);
    expect(trace("lower-a", small, "trace").complete).toBe(false);
  });

  it.each([
    ["lower-o", "lower-l"],
    ["lower-a", "lower-x"],
    ["upper-a", "upper-o"],
    ["lower-b", "lower-d"],
    ["lower-n", "lower-u"],
    ["upper-e", "upper-f"],
    ["lower-p", "lower-q"],
    ["digit-6", "digit-9"],
  ])("rejects %s written as %s from memory", (target, wrong) => {
    expect(trace(target, drawn(wrong), "write").complete).toBe(false);
  });

  it("rejects scribbles, a corner mark and no ink", () => {
    expect(
      trace("lower-a", [
        [
          [10, 10],
          [90, 90],
          [10, 90],
          [90, 10],
          [50, 50],
        ],
      ]).complete,
    ).toBe(false);
    const corner = trace("lower-a", [
      [
        [2, 2],
        [2, 30],
      ],
    ]);
    expect(corner.complete).toBe(false);
    expect(corner.issues).toContain("missing_part");
    expect(trace("lower-a", [])).toMatchObject({ complete: false, issues: ["no_ink"] });
  });

  it("reports a missing part and an almost-complete trace", () => {
    const half = drawn("upper-h").slice(0, 2);
    const r = trace("upper-h", half);
    expect(r.complete).toBe(false);
    expect(r.issues).toContain("missing_part");
  });

  it("measures stroke order, direction and the start point; they only count when required", () => {
    const reversed = drawn("lower-l", (p) => p, 0, true);
    const hint = trace("lower-l", reversed);
    expect(hint.complete).toBe(true);
    expect(hint).toMatchObject({ directionOk: false, startOk: false });
    const glyph = glyphByCode("lower-l")!;
    const required = evaluateTrace(glyph.strokes, reversed, {
      ...traceSettingsFor(glyph, "trace", { trace: true }, KG1),
      strokeOrder: "required",
    });
    expect(required.complete).toBe(false);
    expect(required.issues).toEqual(expect.arrayContaining(["direction", "start_point"]));
    const swapped = [...drawn("lower-t")].reverse();
    expect(trace("lower-t", swapped).orderOk).toBe(false);
  });

  it("counts the dot of i and j", () => {
    const withoutDot = drawn("lower-i").slice(0, 1);
    expect(trace("lower-i", withoutDot).complete).toBe(false);
    expect(trace("lower-i", drawn("lower-i")).complete).toBe(true);
  });

  it("keeps answers small: integer points, capped per stroke", () => {
    const long = Array.from({ length: 500 }, (_, i) => [i / 5, 50 + Math.sin(i / 10) * 20] as Point);
    const s = simplifyStroke(long);
    expect(s.length).toBeLessThanOrEqual(80);
    expect(s.every(([x, y]) => Number.isInteger(x) && Number.isInteger(y))).toBe(true);
  });

  it("validates glyph content: malformed paths, jumps, case and stroke-order doubts", () => {
    expect(glyphStrokeProblems([{ points: [[0, 0]] }])).not.toEqual([]);
    expect(
      glyphStrokeProblems([
        {
          points: [
            [0, 0],
            [101, 5],
          ],
        },
      ]),
    ).not.toEqual([]);
    expect(
      glyphStrokeProblems([
        {
          points: [
            [0, 0],
            [5, 5],
            [95, 95],
          ],
        },
      ])[0],
    ).toMatch(/jumps/);
    expect(
      glyphStrokeProblems([
        {
          points: [
            [5, 5],
            [5, 5],
          ],
        },
      ])[0],
    ).toMatch(/no length/);
    const base = glyphSchema.parse({
      code: "lower-l",
      kind: "letter",
      character: "l",
      case: "lower",
      name: "small l",
      strokes: [
        {
          points: [
            [50, 15],
            [50, 80],
          ],
        },
      ],
    });
    expect(glyphProblems(base)).toEqual({ errors: [], warnings: [] });
    expect(glyphProblems({ ...base, character: "L" }).errors[0]).toMatch(/not a small letter/);
    expect(glyphProblems({ ...base, kind: "digit" }).errors.length).toBeGreaterThan(0);
    expect(
      glyphProblems({
        ...base,
        strokes: [
          {
            points: [
              [50, 80],
              [50, 15],
            ],
          },
        ],
      }).warnings[0],
    ).toMatch(/stroke order/);
    expect(glyphProblems({ ...base, formationSpeech: "Say sh" }).errors[0]).toMatch(/letter names/);
    expect(glyphProblems({ ...base, tolerance: 30 }).warnings[0]).toMatch(/tolerance/);
    for (const g of writingContent.glyphs) expect(glyphProblems(g).errors, g.code).toEqual([]);
  });
});

describe("writing mechanics", () => {
  it("finds a missing capital, a lone i, a missing end mark, joined and split words", () => {
    const r = analyzeMechanics(["the cat is big", "i like it."], ["the", "cat", "is", "big", "because"]);
    expect(r.capitalization).toMatchObject({ ok: false, sentencesMissing: 2, lowercaseI: true });
    expect(r.punctuation).toMatchObject({ ok: false, missingEnd: 1 });
    expect(analyzeMechanics(["The catis big."], ["the", "cat", "is", "big"]).spacing.issues[0]).toMatchObject(
      { kind: "joined" },
    );
    expect(analyzeMechanics(["It is be cause."], ["it", "is", "because"]).spacing.issues[0]).toMatchObject({
      kind: "split",
      word: "because",
    });
    expect(analyzeMechanics(["The  cat sat ."]).spacing.issues[0]).toEqual({ kind: "extra_space" });
    expect(analyzeMechanics(["I can run. We can hop!"])).toMatchObject({
      capitalization: { ok: true },
      punctuation: { ok: true },
    });
  });

  it("splits words and sentences as a child writes them", () => {
    expect(writtenWords("I can’t see  the dog!")).toEqual(["i", "can't", "see", "the", "dog"]);
    expect(writtenSentences("I see a cat. It is big! and")).toEqual(["I see a cat.", "It is big!", "and"]);
    expect(phrasesOf("ice cream cone")).toEqual(
      expect.arrayContaining(["ice", "ice cream", "ice cream cone"]),
    );
  });

  it("holds each level to its own mechanics (not over-penalising KG1 and KG2)", () => {
    const sloppy = "the cat is big";
    expect(
      evaluateCopy({ accepted: ["The cat is big."], actual: sloppy, mechanics: KG1.mechanics }).isCorrect,
    ).toBe(true);
    expect(
      evaluateCopy({
        accepted: ["The cat is big."],
        actual: sloppy,
        mechanics: resolveWritingSettings("KG2").mechanics,
      }).isCorrect,
    ).toBe(true);
    const g1 = evaluateCopy({ accepted: ["The cat is big."], actual: sloppy, mechanics: G1.mechanics });
    expect(g1).toMatchObject({ isCorrect: false, almost: true, errorType: "CAPITALIZATION" });
    expect(DEFAULT_RULES.writing.levels.KG1.mechanics.capitalization).toBe("off");
  });
});

describe("closed writing tasks", () => {
  it("copying: right words, then mechanics; a spacing slip is not a wrong word", () => {
    const accepted = ["The cat is big."];
    expect(evaluateCopy({ accepted, actual: "The cat is big.", mechanics: G1.mechanics }).isCorrect).toBe(
      true,
    );
    const spacing = evaluateCopy({ accepted, actual: "The catis big.", mechanics: G1.mechanics });
    expect(spacing).toMatchObject({ isCorrect: false, errorType: "SPACING" });
    expect(evaluateCopy({ accepted, actual: "The catis big.", mechanics: KG3.mechanics }).isCorrect).toBe(
      true,
    );
    const wrong = evaluateCopy({ accepted, actual: "The dog is big.", mechanics: G1.mechanics });
    expect(wrong.isCorrect).toBe(false);
    expect(wrong.analysis.criteria.find((c) => c.id === "words")?.met).toBe(false);
  });

  it("completion: any accepted word, a close spelling is a near miss", () => {
    expect(evaluateCompletion({ accepted: ["dog", "puppy"], actual: " Puppy " }).isCorrect).toBe(true);
    expect(evaluateCompletion({ accepted: ["dog"], actual: "dogg" })).toMatchObject({
      isCorrect: false,
      almost: true,
      errorType: "MISSPELLED",
    });
    expect(evaluateCompletion({ accepted: ["dog"], actual: "cat" })).toMatchObject({
      isCorrect: false,
      almost: false,
    });
  });

  it("editing: classifies each fix and counts the ones made", () => {
    const fixes = editFixes("my frend and i went to the park", "My friend and I went to the park.");
    expect(fixes.map((f) => f.kind)).toEqual(["capitalization", "spelling", "capitalization", "punctuation"]);
    const original = "the cat is on the mat";
    const accepted = ["The cat is on the mat."];
    expect(evaluateEdit({ original, accepted, actual: "The cat is on the mat." }).isCorrect).toBe(true);
    const unchanged = evaluateEdit({ original, accepted, actual: original });
    expect(unchanged).toMatchObject({ isCorrect: false, almost: false });
    const half = evaluateEdit({ original, accepted, actual: "The cat is on the mat" });
    expect(half).toMatchObject({ isCorrect: false, almost: true, errorType: "PUNCTUATION" });
    expect(half.analysis.edit).toEqual({ fixesNeeded: 2, fixesMade: 1 });
  });
});

const sentenceRubric: RubricCriterion[] = compileRubric(
  rubricTemplateSchema.parse(writingContent.rubrics.find((r) => r.code === "g1-sentence")),
  { rubric: "g1-sentence", ideas: [["dog", "dogs", "puppy"]] },
).criteria;

describe("open writing (rubrics)", () => {
  const run = (text: string, settings = G1, criteria = sentenceRubric, lexicon?: Set<string>) =>
    evaluateRubric({
      criteria,
      lines: [text],
      match: plainMatcher(text),
      firstSentenceMatch: plainMatcher(writtenSentences(text)[0] ?? ""),
      context: { ...ctx(settings), lexicon },
    });

  it("accepts many different good sentences — never one stored sentence", () => {
    for (const text of [
      "The dog runs in the park.",
      "My puppy likes to play ball.",
      "I have two dogs at home.",
    ])
      expect(run(text).isCorrect, text).toBe(true);
  });

  it("checks critical criteria; minor ones are only tips", () => {
    const off = run("The cat sat on the mat.");
    expect(off).toMatchObject({ isCorrect: false, errorType: "WRITING_CONTENT" });
    const short = run("A dog.");
    expect(short.isCorrect).toBe(false);
    expect(short.analysis.criteria.find((c) => c.id === "words")?.met).toBe(false);
    const misspelled = run(
      "The dog is very hapy today.",
      G1,
      sentenceRubric,
      new Set(["the", "dog", "is", "very", "happy", "today"]),
    );
    expect(misspelled.isCorrect).toBe(true);
    expect(misspelled.analysis.spelling?.misspelled).toEqual([{ written: "hapy", suggestion: "happy" }]);
    expect(misspelled.analysis.criteria.find((c) => c.id === "spelling")).toMatchObject({
      critical: false,
      met: false,
    });
  });

  it("never fails open writing on words the word list cannot split (everyone ≠ every one)", () => {
    const lexicon = new Set(["the", "dog", "made", "every", "one", "smile"]);
    const r = run("The dog made everyone smile.", G2, sentenceRubric, lexicon);
    expect(r.isCorrect).toBe(true);
    expect(r.analysis.criteria.find((c) => c.id === "spaces")).toMatchObject({ critical: false });
  });

  it("is honest about spelling it cannot check", () => {
    expect(
      run("The dog runs fast today.").analysis.criteria.find((c) => c.id === "spelling")?.met,
    ).toBeNull();
  });

  it("applies mechanics by level: required in Grade 1, a hint in KG2, off in KG1", () => {
    expect(run("the dog runs in the park").isCorrect).toBe(false);
    const kg2 = run("the dog runs in the park", resolveWritingSettings("KG2"));
    expect(kg2.analysis.criteria.find((c) => c.id === "capital")).toMatchObject({
      critical: false,
      met: false,
    });
    expect(run("the dog runs in the park", KG1).analysis.criteria.some((c) => c.id === "capital")).toBe(
      false,
    );
  });

  it("checks topic sentences, endings, sequence words, copying and filled boxes", () => {
    const criteria: RubricCriterion[] = [
      {
        id: "topic",
        dimension: "topic_sentence",
        label: "Topic",
        hint: "",
        weight: 1,
        critical: true,
        groups: [["dogs"]],
      },
      { id: "end", dimension: "ending", label: "End", hint: "", weight: 1, critical: true, minSentences: 3 },
      { id: "seq", dimension: "sequence_words", label: "Order", hint: "", weight: 1, critical: true, min: 2 },
      {
        id: "own",
        dimension: "not_copied",
        label: "Own",
        hint: "",
        weight: 1,
        critical: true,
        text: "Dogs are pets.",
      },
      {
        id: "filled",
        dimension: "lines_filled",
        label: "Filled",
        hint: "",
        weight: 1,
        critical: true,
        min: 2,
      },
    ];
    const lines = [
      "Dogs are great pets. First, they play with you.",
      "Then they sleep. That is why I love dogs.",
    ];
    const whole = lines.join(" ");
    const ok = evaluateRubric({
      criteria,
      lines,
      match: plainMatcher(whole),
      firstSentenceMatch: plainMatcher(writtenSentences(whole)[0]),
      context: ctx(),
    });
    expect(ok.analysis.criteria.filter((c) => !c.met)).toEqual([]);
    const copied = evaluateRubric({
      criteria,
      lines: ["Dogs are pets.", ""],
      match: plainMatcher("Dogs are pets."),
      firstSentenceMatch: plainMatcher("Dogs are pets."),
      context: ctx(),
    });
    expect(copied.isCorrect).toBe(false);
    expect(copied.analysis.criteria.filter((c) => c.met === false).map((c) => c.id)).toEqual([
      "end",
      "seq",
      "own",
      "filled",
    ]);
  });

  it("uses the starters of the frames as part of the child's sentence", () => {
    expect(
      withStarters(
        ["a cat.", "", "My dog is big."],
        [{ starter: "I have" }, { starter: "It is" }, { starter: "My dog" }],
      ),
    ).toEqual(["I have a cat.", "", "My dog is big."]);
  });

  it("compiles rubric templates with the question's ideas, and refuses bad configuration", () => {
    const template = rubricTemplateSchema.parse(
      writingContent.rubrics.find((r) => r.code === "g2-paragraph"),
    );
    const compiled = compileRubric(template, { rubric: "g2-paragraph", ideas: [["dog"]], topic: [["dog"]] });
    expect(compiled.criteria.map((c) => c.id)).toEqual(expect.arrayContaining(["ideas", "topic"]));
    expect(() => compileRubric(template, { rubric: "g2-paragraph", ideas: [["dog"]] })).toThrow(RubricError);
    expect(() =>
      compileRubric(template, { rubric: "g2-paragraph", ideas: [["dog"]], ideasMin: 3, topic: [["dog"]] }),
    ).toThrow(/ideasMin/);
    expect(() =>
      compileRubric(template, { rubric: "g2-paragraph", ideas: [["dog"]], topic: [["dog"]], ownWords: "x" }),
    ).toThrow(/ownWords/);
  });
});

describe("story sequence writing", () => {
  const eventCriteria: Record<string, RubricCriterion[]> = {
    egg: [
      {
        id: "w",
        dimension: "keywords",
        label: "Says what happens",
        hint: "",
        weight: 1,
        critical: true,
        groups: [["egg", "eggs"]],
        min: 1,
      },
    ],
    chick: [
      {
        id: "w",
        dimension: "keywords",
        label: "Says what happens",
        hint: "",
        weight: 1,
        critical: true,
        groups: [["chick", "hatch", "hatched"]],
        min: 1,
      },
    ],
  };
  const criteria: RubricCriterion[] = [
    {
      id: "seq",
      dimension: "sequence_words",
      label: "Order words",
      hint: "",
      weight: 1,
      critical: false,
      min: 1,
    },
  ];
  const story = (sequence: string[], lines: string[]) =>
    evaluateStoryWriting({
      acceptedOrders: [["egg", "chick"]],
      sequence,
      lines,
      eventCriteria,
      criteria,
      matcherFor: plainMatcher,
      context: ctx(),
    });

  it("needs the right order and each picture's idea", () => {
    expect(story(["egg", "chick"], ["First, there is an egg.", "Then the chick hatched."]).isCorrect).toBe(
      true,
    );
    const wrongOrder = story(["chick", "egg"], ["The chick hatched.", "There is an egg."]);
    expect(wrongOrder).toMatchObject({ isCorrect: false, errorType: "WRITING_ORDER" });
    expect(wrongOrder.analysis.orderOk).toBe(false);
    expect(story(["egg", "chick"], ["There is a bird.", "Then it hatched."]).isCorrect).toBe(false);
  });
});

describe("device and server agree on writing (digest-only keys)", () => {
  const cases: { type: string; answer: never; content: unknown; level: string; responses: unknown[] }[] = [
    {
      type: "SENTENCE_WRITING",
      answer: { accepted: ["The cat is big."] } as never,
      content: { mode: "copy", model: "The cat is big.", wordBank: [] },
      level: "GRADE1",
      responses: [
        { value: "The cat is big." },
        { value: "the cat is big" },
        { value: "The catis big." },
        { value: "A dog." },
      ],
    },
    {
      type: "SENTENCE_WRITING",
      answer: { accepted: ["dog"] } as never,
      content: { mode: "complete", parts: [{ text: "I see a" }, { blank: true }], wordBank: [] },
      level: "KG2",
      responses: [{ value: "Dog" }, { value: "cat" }],
    },
    {
      type: "SENTENCE_WRITING",
      answer: { rubric: { code: "g1-sentence", criteria: sentenceRubric } } as never,
      content: { mode: "free", wordBank: [], starter: "I see" },
      level: "GRADE1",
      responses: [{ value: "a big dog in the park." }, { value: "a cat." }, { value: "the dog runs" }],
    },
    {
      type: "EDIT_AND_CORRECT",
      answer: { accepted: ["The cat is on the mat."] } as never,
      content: { text: "the cat is on the mat", focus: ["capitalization"] },
      level: "GRADE1",
      responses: [
        { value: "The cat is on the mat." },
        { value: "The cat is on the mat" },
        { value: "the cat is on the mat" },
      ],
    },
    {
      type: "TRACING",
      answer: { trace: true } as never,
      content: { glyph: "lower-a", mode: "trace", showStart: true },
      level: "KG1",
      responses: [
        { strokes: strokesOf(glyphByCode("lower-a")!) },
        {
          strokes: [
            [
              [1, 1],
              [1, 40],
            ],
          ],
        },
        { strokes: [], typed: "a" },
        { strokes: [], typed: "A" },
      ],
    },
  ];
  it.each(cases)("$type ($level)", async ({ type, answer, content, level, responses }) => {
    const settings = resolveWritingSettings(level);
    const glyph = type === "TRACING" ? glyphByCode("lower-a") : null;
    const writing = { content, glyph, settings };
    const key = await buildAnswerKey(type, answer, "salt-1", writing);
    expect(JSON.stringify(key)).not.toMatch(/The cat is big|"dog"|puppy/);
    for (const response of responses) {
      const device = await checkWithKey(type, key, response as never);
      const server = evaluateResponse(type, answer, response as never, writing);
      expect({ isCorrect: device.isCorrect, almost: device.almost }, JSON.stringify(response)).toEqual({
        isCorrect: server.isCorrect,
        almost: server.almost,
      });
      if (device.writing && server.writing)
        expect(device.writing.criteria.map((c) => [c.id, c.met])).toEqual(
          server.writing.criteria
            .map((c) => [c.id, c.met === null ? null : c.met])
            .map(([id, met]) => [id, id === "spelling" ? null : met]),
        );
    }
  });
});

describe("letter review", () => {
  const t = (isCorrect: boolean, minutes: number) => ({
    isCorrect,
    attemptedAt: new Date(Date.UTC(2026, 9, 1, 10, minutes)).toISOString(),
  });
  it("brings a letter back after repeated misses and resolves it after right tries in a row", () => {
    expect(letterNeedsReview([t(false, 1)])).toBe(false);
    expect(letterNeedsReview([t(false, 1), t(false, 2)])).toBe(true);
    expect(letterNeedsReview([t(false, 1), t(false, 2), t(true, 3)])).toBe(true);
    expect(letterNeedsReview([t(false, 1), t(false, 2), t(true, 3), t(true, 4)])).toBe(false);
    const item = deriveLetterReview(
      {
        glyphId: "00000000-0000-0000-0000-000000000001",
        skillId: null,
        lessonId: null,
        tries: [t(false, 1), t(false, 2)],
      },
      new Date(),
    );
    expect(item).toMatchObject({
      item_key: writingKey("00000000-0000-0000-0000-000000000001"),
      reason: "writing_letter",
      glyph_id: "00000000-0000-0000-0000-000000000001",
    });
  });
});

describe("writing report", () => {
  it("counts only what was checked, keeps the child's own words, and never grades", () => {
    const analysis = run1();
    const summary = summarizeWriting([
      {
        questionId: "q1",
        questionType: "SENTENCE_WRITING",
        prompt: "Write about the dog.",
        attemptNumber: 1,
        isCorrect: true,
        attemptedAt: "2026-10-01T10:00:00Z",
        response: { value: "The dog runs." },
        analysis,
      },
      {
        questionId: "q2",
        questionType: "SENTENCE_WRITING",
        prompt: "x",
        attemptNumber: 2,
        isCorrect: true,
        attemptedAt: "2026-10-01T10:01:00Z",
        response: { value: "y" },
        analysis,
      },
      {
        questionId: "q3",
        questionType: "TRACING",
        prompt: "Trace a",
        attemptNumber: 1,
        isCorrect: false,
        attemptedAt: "2026-10-01T10:02:00Z",
        response: { strokes: [] },
        analysis: {
          v: 1,
          kind: "trace",
          criteria: [],
          words: 0,
          sentences: 0,
          trace: { glyph: "lower-a", method: "draw", mode: "trace" },
        },
      },
    ]);
    expect(summary).toMatchObject({
      answers: 3,
      firstTries: 2,
      firstTryCorrect: 1,
      openPieces: 1,
      wordsWritten: 3,
    });
    expect(summary.mechanics.capitalization).toEqual({ checked: 1, met: 1 });
    expect(summary.handwriting.letters).toEqual([{ glyph: "lower-a", tries: 1, formed: 0 }]);
    // Samples: the newest answer per question (retries included), newest first.
    expect(summary.samples.map((x) => x.text)).toEqual(["y", "The dog runs."]);
    const skills = writingSkillProgress(
      [
        {
          code: "PARAGRAPH_WRITING",
          name: "P",
          childName: "",
          strand: "composition",
          emoji: "",
          minRank: 4,
          maxRank: 5,
        },
        {
          code: "LETTER_TRACING",
          name: "T",
          childName: "",
          strand: "handwriting",
          emoji: "",
          minRank: 1,
          maxRank: 2,
        },
      ],
      [],
      1,
    );
    expect(skills.map((s) => [s.code, s.status])).toEqual([["LETTER_TRACING", "NOT_STARTED"]]);
  });
});

function run1() {
  const text = "The dog runs.";
  return evaluateRubric({
    criteria: sentenceRubric,
    lines: [text],
    match: plainMatcher(text),
    firstSentenceMatch: plainMatcher(text),
    context: ctx(),
  }).analysis;
}
