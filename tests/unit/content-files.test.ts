import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  assessmentsFileSchema,
  curriculumFileSchema,
  phonicsFileSchema,
  referenceFileSchema,
  sentencesFileSchema,
  sightWordsFileSchema,
  storiesFileSchema,
  type QuestionInput,
} from "@/lib/content/content-schemas";
import { normalizeWord, parseWordsCsv } from "@/lib/content/csv";
import { parseQuestion } from "@/lib/content/question-schemas";
import { expandTemplate, type TemplateContext } from "@/lib/content/templates";
import { RENDERABLE_QUESTION_TYPES } from "@/features/activities/supported-types";

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

function expand(q: QuestionInput, seed: string) {
  if ("template" in q && typeof q.template === "string") {
    const { template, code: _c, difficulty: _d, skill: _s, ...params } = q;
    const ctx: TemplateContext = {
      seed,
      word: (t) => {
        const w = wordBank.get(normalizeWord(t));
        return (
          w && { word: w.word, emoji: w.emoji, childDefinition: w.childDefinition, patterns: w.patterns }
        );
      },
      pattern: (code) => {
        const p = patterns.get(code);
        return (
          p && {
            code: p.code,
            pattern: p.pattern,
            type: p.type,
            childExplanation: p.childExplanation,
            sounds: p.sounds,
          }
        );
      },
    };
    return expandTemplate(template, params as Record<string, unknown>, ctx);
  }
  return q as { type: string; content: unknown; answer: unknown };
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
            lesson.activities.forEach((activity, a) =>
              activity.questions.forEach((q, i) => {
                const seed = `${lesson.code}-a${a + 1}-q${i + 1}`;
                try {
                  const e = expand(q, seed);
                  const parsed = parseQuestion(e.type, e.content, e.answer);
                  if (!parsed.ok) problems.push(`${seed}: ${parsed.error}`);
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
});
