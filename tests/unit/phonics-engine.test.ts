import { describe, expect, it } from "vitest";
import { BlueprintError, expandBlueprint } from "@/lib/content/lesson-blueprints";
import { parseQuestion, type AnswerSpec } from "@/lib/content/question-schemas";
import { expandTemplate, type TemplateContext, type TemplateWord } from "@/lib/content/templates";
import { scoreSkillCheck, type AssessmentItemFact } from "@/lib/learning/assessment-scoring";
import { buildAnswerKey, checkWithKey, revealAnswer } from "@/lib/learning/answer-key";
import { evaluateResponse } from "@/lib/learning/evaluate";
import type { ClientQuestion } from "@/lib/learning/lesson-payload";
import {
  nextPhonicsSkill,
  practiceSuggestions,
  summarizeStages,
  type PhonicsSkillFact,
} from "@/lib/learning/phonics-progress";
import { syncEventSchema } from "@/lib/offline/sync-protocol";

// The Phonics Engine's activity types, blueprints, skill check scoring and progress views.

const seg = (grapheme: string, phonemes: string[], sayAs: string, patternCode: string | null = null) => ({
  grapheme,
  phonemes,
  sayAs,
  patternCode,
});
const WORDS: Record<string, TemplateWord> = {
  ship: {
    word: "ship",
    emoji: "🚢",
    childDefinition: "A big boat.",
    patterns: [{ code: "SH" }],
    segments: [
      seg("sh", ["SH"], "shh", "SH"),
      seg("i", ["IH"], "ih", "LETTER_I"),
      seg("p", ["P"], "puh", "LETTER_P"),
    ],
  },
  chip: {
    word: "chip",
    emoji: "🍟",
    childDefinition: "A thin slice.",
    patterns: [{ code: "CH" }],
    segments: [seg("ch", ["CH"], "ch", "CH"), seg("i", ["IH"], "ih"), seg("p", ["P"], "puh")],
  },
  shop: { word: "shop", emoji: "🏪", childDefinition: "", patterns: [{ code: "SH" }], segments: [] },
};
const PHONEMES: Record<string, { code: string; label: string; sayAs: string; kind: string }> = {
  SH: { code: "SH", label: "/sh/", sayAs: "shh", kind: "consonant" },
  IH: { code: "IH", label: "/i/", sayAs: "ih", kind: "vowel" },
  P: { code: "P", label: "/p/", sayAs: "puh", kind: "consonant" },
};
const ctx: TemplateContext = {
  seed: "test",
  word: (w) => WORDS[w],
  pattern: (code) =>
    code === "SH"
      ? {
          code: "SH",
          pattern: "sh",
          type: "consonant_digraph",
          childExplanation: "",
          sounds: [{ code: "SH", label: "sh", sayAs: "shh", primary: true }],
        }
      : undefined,
  phoneme: (code) => PHONEMES[code],
};

async function roundTrip(type: string, content: unknown, answer: unknown, right: unknown, wrong: unknown) {
  const parsed = parseQuestion(type, content, answer);
  if (!parsed.ok) throw new Error(parsed.error);
  const spec = parsed.question.answer as AnswerSpec;
  const key = await buildAnswerKey(type, spec, "salt");
  const { answer: _a, ...client } = parsed.question;
  return {
    serverRight: evaluateResponse(type, spec, right as never),
    serverWrong: evaluateResponse(type, spec, wrong as never),
    deviceRight: await checkWithKey(type, key, right as never),
    deviceWrong: await checkWithKey(type, key, wrong as never),
    reveal: await revealAnswer(client as ClientQuestion, key),
    leaks: JSON.stringify(client).includes(JSON.stringify(spec)),
  };
}

describe("new phonics activity types", () => {
  it("BLEND_SOUNDS: sound units from the word's split; device and server agree", async () => {
    const q = expandTemplate("blend_word", { word: "ship", distractors: ["chip", "shop"] }, ctx);
    expect(q.type).toBe("BLEND_SOUNDS");
    expect((q.content.units as { grapheme: string }[]).map((u) => u.grapheme)).toEqual(["sh", "i", "p"]);
    const r = await roundTrip(q.type, q.content, q.answer, { value: "ship" }, { value: "chip" });
    expect([r.serverRight.isCorrect, r.deviceRight.isCorrect]).toEqual([true, true]);
    expect([r.serverWrong.isCorrect, r.deviceWrong.isCorrect]).toEqual([false, false]);
    expect(r.reveal?.text).toBe("ship");
    expect(r.leaks).toBe(false);
  });

  it("SEGMENT_WORD: phoneme cards, not letters; the count matters", async () => {
    const q = expandTemplate("segment_word", { word: "ship" }, ctx);
    expect(q.type).toBe("SEGMENT_WORD");
    expect((q.content.sounds as { id: string }[]).map((s) => s.id).sort()).toEqual(["ih", "p", "sh"]);
    const r = await roundTrip(
      q.type,
      q.content,
      q.answer,
      { sequence: ["sh", "ih", "p"] },
      { sequence: ["sh", "ih"] },
    );
    expect([r.serverRight.isCorrect, r.deviceRight.isCorrect]).toEqual([true, true]);
    expect([r.serverWrong.isCorrect, r.deviceWrong.isCorrect]).toEqual([false, false]);
    expect(r.serverWrong.errorType).toBe("wrong_count");
    expect(r.reveal?.text).toMatch(/3 sounds/);
  });

  it("FIND_PATTERN: the letters that make the sound, as a span", async () => {
    const q = expandTemplate("find_pattern", { word: "ship", pattern: "SH" }, ctx);
    expect(q.answer).toEqual({ accepted: ["0-1"] });
    const r = await roundTrip(q.type, q.content, q.answer, { value: "0-1" }, { value: "1-2" });
    expect([r.serverRight.isCorrect, r.deviceRight.isCorrect]).toEqual([true, true]);
    expect([r.serverWrong.isCorrect, r.deviceWrong.isCorrect]).toEqual([false, false]);
    expect(r.reveal?.text).toBe("sh");
  });

  it("rejects inconsistent content", () => {
    expect(parseQuestion("FIND_PATTERN", { word: "ship", target: "sh" }, { accepted: ["1-2"] }).ok).toBe(
      false,
    );
    expect(
      parseQuestion(
        "SEGMENT_WORD",
        {
          word: "ship",
          speech: "ship",
          sounds: [
            { id: "sh", label: "/sh/", sayAs: "shh" },
            { id: "p", label: "/p/", sayAs: "p" },
          ],
          maxCount: 4,
        },
        { acceptedSequences: [["sh", "zz"]] },
      ).ok,
    ).toBe(false);
  });

  it("refuses words without a grapheme split instead of guessing", () => {
    expect(() => expandTemplate("segment_word", { word: "shop" }, ctx)).toThrow(/grapheme split/);
    expect(() => expandTemplate("find_pattern", { word: "chip", pattern: "SH" }, ctx)).toThrow();
  });
});

describe("lesson blueprints", () => {
  it("expands a pattern lesson into the eight-step structure", () => {
    const acts = expandBlueprint({
      name: "phonics_pattern",
      pattern: "SH",
      grapheme: "sh",
      words: ["ship", "fish", "shell", "shop", "dish", "sheep"],
      contrast: { pattern: "CH", grapheme: "ch", words: ["chip", "chin"] },
      sentence: "The fish is in the dish.",
    });
    expect(acts.map((a) => a.title)).toEqual([
      "Hear it",
      "See it",
      "Practise it",
      "Sort it",
      "Read it",
      "Spell it",
      "Write it",
      "Use it",
      "Quick check",
    ]);
    expect(acts[1].type).toBe("FIND_PATTERN");
  });

  it("uses a word choice (not letter tapping) for split patterns like a_e", () => {
    const acts = expandBlueprint({
      name: "phonics_pattern",
      pattern: "A_E",
      grapheme: "a",
      split: true,
      words: ["cake", "lake", "gate", "snake", "whale", "grapes"],
      contrast: { pattern: "LETTER_A", grapheme: "a", words: ["cat", "hat"] },
    });
    expect(acts[1].type).toBe("MULTIPLE_CHOICE");
    const spell = acts.find((a) => a.title === "Spell it")!;
    expect((spell.questions[0] as unknown as { choices: string[] }).choices).not.toContain("a");
  });

  it("has letter-sound and CVC blueprints and reports missing parameters", () => {
    expect(
      expandBlueprint({
        name: "cvc_blending",
        pattern: "LETTER_A",
        vowel: "a",
        words: ["cat", "hat", "map", "bag", "fan"],
        distractorWords: ["pig", "dog"],
        otherVowels: ["i", "o"],
      }).some((a) => a.type === "BLEND_SOUNDS"),
    ).toBe(true);
    expect(() => expandBlueprint({ name: "phonics_pattern", pattern: "SH" })).toThrow(BlueprintError);
    expect(() => expandBlueprint({ name: "nope" })).toThrow(/unknown lesson blueprint/);
  });
});

describe("phonics check scoring", () => {
  const items: AssessmentItemFact[] = [
    { questionId: "q1", stage: 1, stageLabel: "Letters", skillId: "s1", skillCode: "letters" },
    { questionId: "q2", stage: 1, stageLabel: "Letters", skillId: "s1", skillCode: "letters" },
    { questionId: "q3", stage: 2, stageLabel: "Blending", skillId: "s2", skillCode: "blend" },
    { questionId: "q4", stage: 2, stageLabel: "Blending", skillId: "s3", skillCode: "cvc" },
  ];

  it("scores each area and skill from first tries", () => {
    const outcome = scoreSkillCheck(
      items,
      new Map([
        ["q1", true],
        ["q2", true],
        ["q3", false],
        ["q4", true],
      ]),
      75,
    );
    expect(outcome.overallPercent).toBe(75);
    expect(outcome.areas).toEqual([
      { stage: 1, label: "Letters", correct: 2, total: 2, percent: 100, secure: true },
      { stage: 2, label: "Blending", correct: 1, total: 2, percent: 50, secure: false },
    ]);
    expect(outcome.skills.blend.percent).toBe(0);
    expect(outcome.gaps).toEqual(["Blending"]);
  });

  it("counts unanswered questions as not yet known", () => {
    const outcome = scoreSkillCheck(items, new Map([["q1", true]]));
    expect(outcome.overallPercent).toBe(25);
    expect(scoreSkillCheck([], new Map()).overallPercent).toBe(0);
  });
});

describe("phonics progress views", () => {
  const skill = (over: Partial<PhonicsSkillFact>): PhonicsSkillFact => ({
    skillId: over.code ?? "x",
    code: "x",
    title: "X",
    stageCode: "DIGRAPHS",
    patternLabel: null,
    emoji: "",
    lessonId: "l",
    status: "NOT_STARTED",
    masteryScore: 0,
    reviewPriority: 0,
    sortOrder: 0,
    ...over,
  });
  const stages = [
    { code: "LETTERS", name: "Letters", childName: "Letters", emoji: "🔤", sortOrder: 0 },
    { code: "DIGRAPHS", name: "Digraphs", childName: "Letter teams", emoji: "🧩", sortOrder: 7 },
    { code: "ADVANCED", name: "Advanced", childName: "Big words", emoji: "🎓", sortOrder: 13 },
  ];
  const skills = [
    skill({ code: "sh", stageCode: "DIGRAPHS", status: "MASTERED", masteryScore: 95, sortOrder: 1 }),
    skill({
      code: "th",
      stageCode: "DIGRAPHS",
      status: "LEARNING",
      masteryScore: 30,
      reviewPriority: 5,
      sortOrder: 2,
    }),
    skill({ code: "ch", stageCode: "DIGRAPHS", sortOrder: 3 }),
    skill({ code: "a", stageCode: "LETTERS", status: "PRACTICING", masteryScore: 60 }),
  ];

  it("summarises stages with stars for children and percentages for parents", () => {
    const view = summarizeStages(stages, skills);
    expect(view.map((s) => s.code)).toEqual(["LETTERS", "DIGRAPHS"]);
    const digraphs = view[1];
    expect(digraphs.skills.map((s) => [s.code, s.stars])).toEqual([
      ["sh", 3],
      ["th", 1],
      ["ch", 0],
    ]);
    expect(digraphs.stars).toBe(2);
    expect(digraphs.percent).toBe(Math.round((95 + 30) / 3));
    expect(digraphs.mastered).toBe(1);
  });

  it("suggests practice for started, unmastered skills and the next skill to start", () => {
    expect(practiceSuggestions(skills).map((s) => s.code)).toEqual(["th", "a"]);
    expect(nextPhonicsSkill(summarizeStages(stages, skills))?.code).toBe("ch");
  });
});

describe("sync protocol for assessments", () => {
  const base = {
    kind: "attempt",
    id: crypto.randomUUID(),
    questionId: crypto.randomUUID(),
    attemptNumber: 1,
    response: { value: "a" },
    responseTimeMs: 1000,
    attemptedAt: new Date().toISOString(),
  };
  it("accepts assessment answers that name their assessment", () => {
    expect(
      syncEventSchema.safeParse({
        ...base,
        lessonRunId: null,
        assessmentId: crypto.randomUUID(),
        assessmentAttemptId: crypto.randomUUID(),
      }).success,
    ).toBe(true);
    expect(
      syncEventSchema.safeParse({
        kind: "assessment_run",
        id: crypto.randomUUID(),
        assessmentId: crypto.randomUUID(),
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      }).success,
    ).toBe(true);
  });
  it("rejects answers without their assessment or with both a run and a sitting", () => {
    expect(
      syncEventSchema.safeParse({ ...base, lessonRunId: null, assessmentAttemptId: crypto.randomUUID() })
        .success,
    ).toBe(false);
    expect(
      syncEventSchema.safeParse({
        ...base,
        lessonRunId: crypto.randomUUID(),
        assessmentId: crypto.randomUUID(),
        assessmentAttemptId: crypto.randomUUID(),
      }).success,
    ).toBe(false);
  });
});
