import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assessmentsFileSchema,
  curriculumFileSchema,
  type CurriculumFile,
  phonicsFileSchema,
  referenceFileSchema,
  sentencesFileSchema,
  sightWordsFileSchema,
  storiesFileSchema,
  type QuestionInput,
} from "@/lib/content/content-schemas";
import { normalizeWord, parseWordsCsv } from "@/lib/content/csv";
import { parseActivityConfig } from "@/lib/content/activity-config";
import { parseQuestion, type AnswerSpec, type QuestionResponse } from "@/lib/content/question-schemas";
import { buildAnswerKey, checkWithKey, revealAnswer } from "@/lib/learning/answer-key";
import { evaluateResponse } from "@/lib/learning/evaluate";
import type { ClientQuestion } from "@/lib/learning/lesson-payload";
import { mergeLearningRules } from "@/lib/learning/rules";
import { expandTemplate, type TemplateContext, type TemplateWord } from "@/lib/content/templates";
import { templateWordFromInput, type CategoryRef } from "@/lib/content/word-bank";
import { RENDERABLE_QUESTION_TYPES } from "@/features/activities/supported-types";
import { expandBlueprint } from "@/lib/content/lesson-blueprints";
import {
  decomposeWord,
  segmentsUsePattern,
  type PatternInfo,
  type PhonemeInfo,
} from "@/lib/learning/phonics";

// Validates the shipped curriculum without a database, so a content mistake fails CI
// before it reaches an import.
const dir = path.resolve(__dirname, "../../content");
const json = (file: string) => JSON.parse(readFileSync(path.join(dir, file), "utf8"));

const reference = referenceFileSchema.parse(json("reference.json"));
const phonics = phonicsFileSchema.parse(json("phonics.json"));
const words = readdirSync(path.join(dir, "words")).flatMap(
  (f) => parseWordsCsv(readFileSync(path.join(dir, "words", f), "utf8")).rows,
);
const curriculum = readdirSync(path.join(dir, "curriculum")).map((f) =>
  curriculumFileSchema.parse(json(path.join("curriculum", f))),
);
const assessments = assessmentsFileSchema.parse(json("assessments.json"));

const levelCodes = new Set(reference.levels.map((l) => l.code));
const wordBank = new Map(words.flatMap((r) => (r.ok ? [[normalizeWord(r.word.word), r.word] as const] : [])));
const patterns = new Map(phonics.patterns.map((p) => [p.code, p]));
const phonemes = new Map<string, PhonemeInfo>(
  phonics.phonemes.map((ph) => [
    ph.code,
    { code: ph.code, ipa: ph.ipa, label: ph.label, sayAs: ph.sayAs, kind: ph.kind, voiced: ph.voiced },
  ]),
);
const patternInfo: PatternInfo[] = phonics.patterns.map((p) => ({
  code: p.code,
  pattern: p.pattern,
  type: p.type,
  position: p.position,
  sounds: p.sounds,
}));
const patternsByCode = new Map(patternInfo.map((p) => [p.code, p]));
// The same grapheme split the importer stores in word_segments.
const splits = new Map(
  [...wordBank].map(([key, w]) => [
    key,
    decomposeWord({
      word: w.word,
      patterns: patternInfo,
      links: w.patterns,
      phonemes,
      irregular: w.irregular,
      authored: w.segments,
    }),
  ]),
);
const speech = (codes: string[]) => codes.map((c) => phonemes.get(c)?.sayAs ?? c.toLowerCase()).join(" ");

// The word bank exactly as the importer builds it (src/lib/content/word-bank.ts).
const categoryRefs = new Map<string, CategoryRef>(
  reference.wordCategories.map((c) => [
    c.code,
    { code: c.code, name: c.name, emoji: c.emoji, parent: c.parent ?? null },
  ]),
);
const levelRanks = new Map(
  [...reference.levels].sort((a, b) => a.sortOrder - b.sortOrder).map((l, i) => [l.code, i + 1]),
);
const templateBank = new Map<string, TemplateWord>(
  [...wordBank].map(([key, w]) => [
    key,
    templateWordFromInput(
      w,
      (splits.get(key)?.segments ?? []).map((seg) => ({
        grapheme: seg.grapheme,
        patternCode: seg.patternCode,
        sayAs: seg.sayAs || speech(seg.phonemes),
        phonemes: seg.phonemes,
      })),
      { categories: categoryRefs, levelRanks },
    ),
  ]),
);
const publishedWords = [...templateBank.values()].filter((w) => w.published !== false);

function expand(q: QuestionInput, seed: string, level?: string) {
  if ("template" in q && typeof q.template === "string") {
    const { template, code: _c, difficulty: _d, skill: _s, explanation: _e, ...params } = q;
    const ctx: TemplateContext = {
      seed,
      words: () => publishedWords,
      levelRank: level ? levelRanks.get(level) : undefined,
      word: (t) => templateBank.get(normalizeWord(t)),
      pattern: (code) => {
        const p = patterns.get(code);
        return (
          p && {
            code: p.code,
            pattern: p.pattern,
            type: p.type,
            childExplanation: p.childExplanation,
            uppercase: p.uppercase ?? null,
            letterName: p.letterName,
            letterNameSayAs: p.letterNameSayAs,
            sounds: p.sounds,
          }
        );
      },
      phoneme: (code) => {
        const p = phonemes.get(code);
        return p && { code: p.code, label: p.label, sayAs: p.sayAs, kind: p.kind };
      },
    };
    return expandTemplate(template, params as Record<string, unknown>, ctx);
  }
  return q as { type: string; content: unknown; answer: unknown; pattern?: string; word?: string };
}

// Lessons written as a blueprint, expanded the way the importer does.
function lessonActivities(
  lesson: CurriculumFile["units"][number]["skills"][number]["lessons"][number],
  level: string,
) {
  if (!lesson.blueprint) return lesson.activities;
  return expandBlueprint({ levelRank: levelRanks.get(level), ...lesson.blueprint }).map((a) => ({
    ...a,
    config: {},
    questions: a.questions.map((q) => ({ difficulty: 1, explanation: "", ...q }) as QuestionInput),
  }));
}

describe("shipped content", () => {
  it("has valid words with known levels, categories and patterns", () => {
    expect(words.filter((r) => !r.ok)).toEqual([]);
    const categories = new Set(reference.wordCategories.map((c) => c.code));
    for (const w of wordBank.values()) {
      expect(levelCodes.has(w.level), w.word).toBe(true);
      if (w.category) expect(categories.has(w.category), w.word).toBe(true);
      for (const p of w.patterns) {
        expect(patterns.has(p.code), `${w.word} → ${p.code}`).toBe(true);
        if (p.sound)
          expect(
            patterns.get(p.code)!.sounds.some((s) => s.code === p.sound),
            `${w.word} → ${p.sound}`,
          ).toBe(true);
      }
    }
    expect(wordBank.size).toBeGreaterThan(150);
  });

  it("covers every level from KG1 to Grade 2", () => {
    expect(new Set(curriculum.map((c) => c.level))).toEqual(
      new Set(["KG1", "KG2", "KG3", "GRADE1", "GRADE2"]),
    );
  });

  it("expands every lesson question into a valid, renderable question", () => {
    const problems: string[] = [];
    let count = 0;
    for (const file of curriculum) {
      for (const unit of file.units)
        for (const skill of unit.skills)
          for (const lesson of skill.lessons)
            lessonActivities(lesson, file.level).forEach((activity, a) =>
              activity.questions.forEach((q, i) => {
                const seed = `${lesson.code}-a${a + 1}-q${i + 1}`;
                try {
                  const e = expand(q, seed, file.level);
                  const parsed = parseQuestion(e.type, e.content, e.answer);
                  if (!parsed.ok) problems.push(`${seed}: ${parsed.error}`);
                  // A pattern question's word must really use the pattern's sound.
                  const target = "pattern" in e && e.pattern ? patternsByCode.get(e.pattern) : undefined;
                  const split = "word" in e && e.word ? splits.get(normalizeWord(e.word)) : undefined;
                  if (target && split && !segmentsUsePattern(split.segments, target, patternsByCode))
                    problems.push(`${seed}: "${e.word}" does not use ${target.code}`);
                  if (!(RENDERABLE_QUESTION_TYPES as readonly string[]).includes(e.type))
                    problems.push(`${seed}: no renderer for ${e.type}`);
                  count++;
                } catch (error) {
                  problems.push(`${seed}: ${(error as Error).message}`);
                }
              }),
            );
    }
    expect(problems).toEqual([]);
    expect(count).toBeGreaterThan(250);
  });

  it("has valid assessment questions and sentence/story files", () => {
    for (const a of assessments.assessments)
      for (const stage of a.stages)
        stage.questions.forEach((q, i) => {
          const e = expand(q, `${a.code}-s${stage.stage}-q${i + 1}`);
          expect(
            parseQuestion(e.type, e.content, e.answer).ok,
            `${a.code} stage ${stage.stage} q${i + 1}`,
          ).toBe(true);
        });
    expect(() => sentencesFileSchema.parse(json("sentences.json"))).not.toThrow();
    expect(() => storiesFileSchema.parse(json("stories.json"))).not.toThrow();
    const sight = sightWordsFileSchema.parse(json("sight-words.json"));
    for (const list of sight.lists)
      for (const w of list.words) expect(wordBank.has(normalizeWord(w)), w).toBe(true);
  });

  it("has a valid, strict configuration for every activity", () => {
    const problems: string[] = [];
    for (const file of curriculum)
      for (const unit of file.units)
        for (const skill of unit.skills)
          for (const lesson of skill.lessons)
            lessonActivities(lesson, file.level).forEach((activity, a) => {
              const parsed = parseActivityConfig(activity.type, activity.config);
              if (!parsed.ok) problems.push(`${lesson.code}-a${a + 1}: ${parsed.error}`);
            });
    expect(problems).toEqual([]);
  });

  it("uses every required activity type and subject, with feedback and rules", () => {
    const types = new Set(
      curriculum.flatMap((f) =>
        f.units.flatMap((u) =>
          u.skills.flatMap((s) => s.lessons.flatMap((l) => lessonActivities(l, f.level).map((a) => a.type))),
        ),
      ),
    );
    for (const required of [
      "MULTIPLE_CHOICE",
      "DRAG_DROP",
      "MATCH",
      "WORD_BUILDER",
      "MISSING_LETTER",
      "LISTEN_AND_CHOOSE",
      "SORT",
      "SENTENCE_BUILDER",
      "READING",
      "SPELLING",
      "WRITING",
      "TRACING",
      "BLEND_SOUNDS",
      "SEGMENT_WORD",
      "FIND_PATTERN",
    ])
      expect(types.has(required), required).toBe(true);

    const published = reference.subjects.filter((s) => s.status === "published").map((s) => s.code);
    expect(published).toEqual([
      "PHONICS",
      "READING",
      "VOCABULARY",
      "SPELLING",
      "WRITING",
      "LISTENING",
      "SENTENCE_BUILDING",
      "GAMES",
      "ASSESSMENT",
    ]);
    for (const file of curriculum)
      for (const unit of file.units)
        expect(published, `${unit.code} → ${unit.subject}`).toContain(unit.subject);

    const kinds = new Set(reference.feedback.map((f) => f.kind));
    expect(kinds).toEqual(new Set(["CORRECT", "INCORRECT", "TRY_AGAIN", "ALMOST_CORRECT", "COMPLETED"]));
    expect(mergeLearningRules(reference.rules).errors).toEqual([]);
  });

  it("checks every shipped question the same way on the device and on the server", async () => {
    const problems: string[] = [];
    let count = 0;
    for (const file of curriculum)
      for (const unit of file.units)
        for (const skill of unit.skills)
          for (const lesson of skill.lessons)
            for (const [a, activity] of lessonActivities(lesson, file.level).entries())
              for (const [i, q] of activity.questions.entries()) {
                const seed = `${lesson.code}-a${a + 1}-q${i + 1}`;
                const e = expand(q, seed, file.level);
                const parsed = parseQuestion(e.type, e.content, e.answer);
                if (!parsed.ok || parsed.question.answer === null) continue;
                const answer = parsed.question.answer as AnswerSpec;
                const right = correctResponse(e.type, answer);
                const key = await buildAnswerKey(e.type, answer, seed);
                const device = await checkWithKey(e.type, key, right);
                if (!device.isCorrect || !evaluateResponse(e.type, answer, right).isCorrect)
                  problems.push(`${seed}: correct answer not accepted`);
                const { answer: _answer, ...client } = parsed.question;
                if (JSON.stringify(client).includes(JSON.stringify(answer)))
                  problems.push(`${seed}: answer leaks`);
                const reveal = await revealAnswer(client as ClientQuestion, key);
                if (!reveal && !["WORD_BUILDER", "SPELLING"].includes(e.type))
                  problems.push(`${seed}: cannot reveal`);
                count++;
              }
    expect(problems).toEqual([]);
    expect(count).toBeGreaterThan(250);
  });
});

function correctResponse(type: string, answer: AnswerSpec): QuestionResponse {
  if ("minCoverage" in answer) return { coverage: answer.minCoverage };
  if ("pairs" in answer) return { pairs: answer.pairs };
  if ("acceptedSequences" in answer) return { sequence: answer.acceptedSequences[0] };
  if (type === "WORD_BUILDER") return { sequence: [...answer.accepted[0]] };
  return { value: answer.accepted[0] };
}
