import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { soundLabelLookup, soundToken, speechProblems } from "@/lib/audio/pronunciation";
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
import { normalizeWord, parseSpellingCsv, parseWordsCsv } from "@/lib/content/csv";
import { parseActivityConfig } from "@/lib/content/activity-config";
import { parseQuestion, type AnswerSpec, type QuestionResponse } from "@/lib/content/question-schemas";
import { buildAnswerKey, checkWithKey, revealAnswer } from "@/lib/learning/answer-key";
import { evaluateResponse } from "@/lib/learning/evaluate";
import type { ClientQuestion } from "@/lib/learning/lesson-payload";
import { mergeLearningRules } from "@/lib/learning/rules";
import { SPELLING_ACTIVITIES, spellingActivityOf } from "@/lib/learning/spelling";
import { expandTemplate, type TemplateContext, type TemplateWord } from "@/lib/content/templates";
import { templateSpellingFromInput, templateWordFromInput, type CategoryRef } from "@/lib/content/word-bank";
import { RENDERABLE_QUESTION_TYPES } from "@/features/activities/supported-types";
import { expandBlueprint } from "@/lib/content/lesson-blueprints";
import { baseFormCandidates, paragraphsOf, runningWords } from "@/lib/learning/reading";
import {
  decomposeWord,
  segmentsUsePattern,
  type PatternInfo,
  type PhonemeInfo,
} from "@/lib/learning/phonics";

// Validates the shipped curriculum without a database, so a content mistake fails CI
// before it reaches an import.
import { resolveWritingSettings, WRITING_QUESTION_TYPES } from "@/lib/learning/writing-evaluation";
import { compileAnswer, correctWritingResponse, glyphByCode, wrongWritingResponse } from "../writing-helpers";
const dir = path.resolve(__dirname, "../../content");
// Writing (Phase 8): rubric answers are compiled as the importer does.
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
const spellingRows = readdirSync(path.join(dir, "spelling")).flatMap(
  (f) => parseSpellingCsv(readFileSync(path.join(dir, "spelling", f), "utf8")).rows,
);
const rules = mergeLearningRules(reference.rules).rules;

const levelCodes = new Set(reference.levels.map((l) => l.code));
const wordBank = new Map(words.flatMap((r) => (r.ok ? [[normalizeWord(r.word.word), r.word] as const] : [])));
const patterns = new Map(phonics.patterns.map((p) => [p.code, p]));
const phonemes = new Map<string, PhonemeInfo>(
  phonics.phonemes.map((ph) => [
    ph.code,
    // As the importer: in templates a sound's "sayAs" is its sound token ({/S/}).
    {
      code: ph.code,
      ipa: ph.ipa,
      label: ph.label,
      sayAs: soundToken([ph.code]),
      kind: ph.kind,
      voiced: ph.voiced,
    },
  ]),
);
const patternInfo: PatternInfo[] = phonics.patterns.map((p) => ({
  code: p.code,
  pattern: p.pattern,
  type: p.type,
  position: p.position,
  sounds: p.sounds.map((s) => ({ ...s, sayAs: soundToken(s.phonemes) })),
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
        sayAs: soundToken(seg.phonemes),
        phonemes: seg.phonemes,
      })),
      { categories: categoryRefs, levelRanks },
    ),
  ]),
);
// Spelling facts on the spelling targets, as the importer attaches them.
for (const r of spellingRows) {
  if (!r.ok) continue;
  const w = templateBank.get(normalizeWord(r.word.word));
  if (w) w.spelling = templateSpellingFromInput(r.word, w.segments ?? []);
}
const publishedWords = [...templateBank.values()].filter((w) => w.published !== false);

function expand(q: QuestionInput, seed: string, level?: string) {
  if ("template" in q && typeof q.template === "string") {
    const { template, code: _c, difficulty: _d, skill: _s, explanation: _e, ...params } = q;
    const ctx: TemplateContext = {
      seed,
      words: () => publishedWords,
      levelRank: level ? levelRanks.get(level) : undefined,
      spellingLevel: level ? rules.spelling.levels[level] : undefined,
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
            sounds: p.sounds.map((s) => ({ ...s, sayAs: soundToken(s.phonemes) })),
          }
        );
      },
      phoneme: (code) => {
        const p = phonemes.get(code);
        return p && { code: p.code, label: p.label, sayAs: p.sayAs, kind: p.kind };
      },
      soundForLabel: soundLabelLookup([...phonemes.values()]),
    };
    return expandTemplate(template, params as Record<string, unknown>, ctx);
  }
  return q as { type: string; content: unknown; answer: unknown; pattern?: string; word?: string };
}

// Reading: the stories, each level's reading skill → skill code, and for each story the
// word of the text that the importer would pick to find each target pattern in.
const stories = storiesFileSchema.parse(json("stories.json")).stories;
const storyByCode = new Map(stories.map((s) => [s.code, s]));
const readingSkillsByLevel = new Map(
  curriculum.map((file) => {
    const map = new Map<string, string>();
    for (const unit of file.units)
      for (const skill of unit.skills)
        if (skill.readingSkill && !map.has(skill.readingSkill)) map.set(skill.readingSkill, skill.code);
    return [file.level, map] as const;
  }),
);
function bankKeyFor(word: string) {
  if (templateBank.has(word)) return word;
  for (const [key, w] of templateBank) if ((w.forms ?? []).includes(word)) return key;
  return baseFormCandidates(word).find((b) => templateBank.has(b));
}
function patternWordsOf(code: string) {
  const story = storyByCode.get(code);
  const out = new Map<string, string>();
  if (!story) return out;
  for (const p of story.targetPatterns) {
    let chosen: { word: string; decodable: boolean } | null = null;
    for (const running of runningWords(paragraphsOf(story.pages))) {
      const key = bankKeyFor(running);
      const w = key ? templateBank.get(key) : undefined;
      if (!w || w.word.length < 2 || !(w.segments ?? []).some((seg) => seg.patternCode === p)) continue;
      const decodable = splits.get(key!)?.decodable ?? false;
      if (!chosen || (decodable && !chosen.decodable)) chosen = { word: w.word, decodable };
    }
    if (chosen) out.set(p, chosen.word);
  }
  return out;
}

// Lessons written as a blueprint, expanded the way the importer does.
function lessonActivities(
  lesson: CurriculumFile["units"][number]["skills"][number]["lessons"][number],
  level: string,
) {
  if (!lesson.blueprint) return lesson.activities;
  const storyCode = typeof lesson.blueprint.story === "string" ? lesson.blueprint.story : "";
  return expandBlueprint({
    levelRank: levelRanks.get(level),
    spellingLevel: rules.spelling.levels[level],
    ...lesson.blueprint,
    ...(lesson.blueprint.name === "reading"
      ? {
          storyData: storyByCode.get(storyCode),
          readingSkills: readingSkillsByLevel.get(level),
          readingLevel: rules.reading.levels[level],
          patternWords: patternWordsOf(storyCode),
        }
      : {}),
  }).map((a) => ({
    ...a,
    config: a.config ?? {},
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
                  const answer = WRITING_QUESTION_TYPES.has(e.type)
                    ? compileAnswer(e.type, e.answer, file.level)
                    : e.answer;
                  const parsed = parseQuestion(e.type, e.content, answer);
                  if (!parsed.ok) problems.push(`${seed}: ${parsed.error}`);
                  // Sounds are spoken through tokens, never as letters a voice misreads.
                  const speech = speechProblems(
                    "promptSpeech" in e ? String(e.promptSpeech ?? "") : "",
                    e.content,
                    new Set(phonemes.keys()),
                  );
                  if (speech.length) problems.push(`${seed}: speech: ${speech.join("; ")}`);
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
      "SENTENCE_DICTATION",
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

  it("has valid spelling targets: words of the bank, known types, levels, skills and patterns", () => {
    expect(spellingRows.filter((r) => !r.ok)).toEqual([]);
    const types = new Set(reference.spellingTypes.map((t) => t.code));
    const skills = new Set(curriculum.flatMap((f) => f.units.flatMap((u) => u.skills.map((s) => s.code))));
    const seen = new Set<string>();
    for (const r of spellingRows) {
      if (!r.ok) continue;
      const s = r.word;
      expect(seen.has(s.word), `${s.word} listed twice`).toBe(false);
      seen.add(s.word);
      expect(wordBank.has(normalizeWord(s.word)), `${s.word} is in the word bank`).toBe(true);
      expect(types.has(s.spellingType), `${s.word} → ${s.spellingType}`).toBe(true);
      expect(levelCodes.has(s.level), `${s.word} → ${s.level}`).toBe(true);
      if (s.skill) expect(skills.has(s.skill), `${s.word} → ${s.skill}`).toBe(true);
      if (s.phonicsPattern)
        expect(patterns.has(s.phonicsPattern), `${s.word} → ${s.phonicsPattern}`).toBe(true);
      expect(templateBank.get(normalizeWord(s.word))?.spelling, s.word).toBeDefined();
      // The level's spelling progression (rules → spelling.levels).
      const level = rules.spelling.levels[s.level];
      expect(level.spellingTypes, `${s.word}: ${s.spellingType} at ${s.level}`).toContain(s.spellingType);
      expect(s.word.length, `${s.word} is short enough for ${s.level}`).toBeLessThanOrEqual(
        level.maxWordLength,
      );
    }
    // Every level teaches spelling, and only some vocabulary words are spelling targets.
    for (const level of levelCodes)
      expect(
        [...spellingRows].some((r) => r.ok && r.word.level === level),
        level,
      ).toBe(true);
    expect(seen.size).toBeLessThan(wordBank.size);
    // Irregular words name their irregular part, and it is in the word.
    for (const r of spellingRows)
      if (r.ok && r.word.irregularPart)
        expect(r.word.word.includes(r.word.irregularPart), r.word.word).toBe(true);
  });

  it("uses every spelling activity in the spelling lessons", () => {
    const used = new Set<string>();
    for (const file of curriculum)
      for (const unit of file.units)
        for (const skill of unit.skills)
          for (const lesson of skill.lessons)
            lessonActivities(lesson, file.level).forEach((activity, a) =>
              activity.questions.forEach((q, i) => {
                const e = expand(q, `${lesson.code}-a${a + 1}-q${i + 1}`, file.level) as {
                  spellingActivity?: string;
                };
                const activityCode = spellingActivityOf({ spellingActivity: e.spellingActivity });
                if (activityCode) used.add(activityCode);
              }),
            );
    expect([...used].sort()).toEqual([...SPELLING_ACTIVITIES].sort());
    const categories = new Set(reference.feedback.flatMap((f) => (f.errorCategory ? [f.errorCategory] : [])));
    for (const c of [
      "MISSING_LETTER",
      "WRONG_VOWEL",
      "WRONG_DIGRAPH",
      "WRONG_BLEND",
      "WRONG_ENDING",
      "PUNCTUATION",
    ])
      expect(categories.has(c), c).toBe(true);
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
                const isWriting = WRITING_QUESTION_TYPES.has(e.type);
                const authored = isWriting ? compileAnswer(e.type, e.answer, file.level) : e.answer;
                const parsed = parseQuestion(e.type, e.content, authored);
                if (!parsed.ok) {
                  if (isWriting) problems.push(`${seed}: ${parsed.error}`);
                  continue;
                }
                if (parsed.question.answer === null) continue;
                const answer = parsed.question.answer as AnswerSpec;
                const content = parsed.question.content as Record<string, unknown>;
                const glyph = e.type === "TRACING" ? glyphByCode(String(content.glyph)) : null;
                if (e.type === "TRACING" && !glyph)
                  problems.push(`${seed}: unknown glyph ${String(content.glyph)}`);
                const writing = isWriting
                  ? { content, glyph, settings: resolveWritingSettings(file.level, rules.writing) }
                  : undefined;
                const right = isWriting
                  ? correctWritingResponse(e.type, content, answer as Record<string, unknown>, glyph)
                  : correctResponse(e.type, answer);
                const key = await buildAnswerKey(e.type, answer, seed, writing);
                const device = await checkWithKey(e.type, key, right);
                const server = evaluateResponse(e.type, answer, right, writing);
                if (!device.isCorrect || !server.isCorrect)
                  problems.push(
                    `${seed}: correct answer not accepted (device ${device.isCorrect}, server ${server.isCorrect})`,
                  );
                if (isWriting) {
                  const wrong = wrongWritingResponse(e.type, content);
                  const deviceWrong = await checkWithKey(e.type, key, wrong);
                  const serverWrong = evaluateResponse(e.type, answer, wrong, writing);
                  if (deviceWrong.isCorrect || serverWrong.isCorrect)
                    problems.push(`${seed}: a wrong answer was accepted`);
                  if (deviceWrong.almost !== serverWrong.almost)
                    problems.push(`${seed}: device and server disagree on almost`);
                }
                const { answer: _answer, ...client } = parsed.question;
                if (JSON.stringify(client).includes(JSON.stringify(answer)))
                  problems.push(`${seed}: answer leaks`);
                const reveal = await revealAnswer(client as ClientQuestion, key);
                if (!reveal && !["WORD_BUILDER", "SPELLING"].includes(e.type) && !isWriting)
                  problems.push(`${seed}: cannot reveal`);
                count++;
              }
    expect(problems).toEqual([]);
    expect(count).toBeGreaterThan(250);
  });
});

function correctResponse(type: string, answer: AnswerSpec): QuestionResponse {
  if ("pairs" in answer) return { pairs: answer.pairs };
  if ("acceptedSequences" in answer) return { sequence: answer.acceptedSequences[0] };
  if ("correct" in answer) return { sequence: answer.correct };
  if (!("accepted" in answer)) throw new Error(`no simple answer for ${type}`);
  if (type === "WORD_BUILDER") return { sequence: [...answer.accepted[0]] };
  return { value: answer.accepted[0] };
}
