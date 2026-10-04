import { readFileSync } from "node:fs";
import path from "node:path";
import type { QuestionResponse } from "@/lib/content/question-schemas";
import { compileWritingAnswer, writingFileSchema, type RubricTemplate } from "@/lib/content/writing-content";
import { resample, simplifyStroke, type Point, type TraceGlyph } from "@/lib/learning/tracing";
import type { RubricCriterion } from "@/lib/learning/writing";

// Shared by the unit and integration tests: the shipped writing content, and responses a
// child could give to a writing question — one that meets every check, and one that does
// not — built from the question itself (glyph strokes, accepted texts, rubric criteria).

const writingFile = writingFileSchema.parse(
  JSON.parse(readFileSync(path.resolve(__dirname, "../content/writing.json"), "utf8")),
);
const RANKS: Record<string, number> = { KG1: 1, KG2: 2, KG3: 3, GRADE1: 4, GRADE2: 5 };
export const writingContent = writingFile;
export const rubricTemplates = new Map<string, RubricTemplate & { minRank: number; maxRank: number }>(
  writingFile.rubrics.map((r) => [r.code, { ...r, minRank: RANKS[r.minLevel], maxRank: RANKS[r.maxLevel] }]),
);

export function glyphByCode(code: string): TraceGlyph | null {
  const g = writingFile.glyphs.find((x) => x.code === code);
  if (!g) return null;
  return {
    code: g.code,
    kind: g.kind,
    character: g.character,
    letterCase: g.case,
    name: g.name,
    strokes: g.strokes,
    guide: g.guide,
    tolerance: g.tolerance,
    completion: g.completion,
    formationTip: g.formationTip,
    formationSpeech: g.formationSpeech,
  };
}

export function compileAnswer(type: string, answer: unknown, level?: string) {
  return compileWritingAnswer(
    type,
    answer as Record<string, unknown> | null,
    rubricTemplates,
    level ? RANKS[level] : undefined,
  );
}

// The glyph's own strokes, as a careful child would draw them (integer points).
export function strokesOf(glyph: TraceGlyph): [number, number][][] {
  return glyph.strokes.map((s) => simplifyStroke(resample(s.points as Point[], 1.5)));
}

const SEQUENCE = ["First,", "Next,", "Then", "After that,", "Later,", "At the end,"];
const FILLER = [
  "We had so much fun together that sunny day",
  "It was a really great time for all of us",
  "Everyone was happy and smiling all day long",
];

// Sentences that meet a rubric's criteria: every idea named, enough words and sentences,
// sequence words, a topic sentence and an ending, capitals and end marks.
function rubricSentences(criteria: RubricCriterion[], minLines: number): string[] {
  const sentences: string[] = [];
  const topic = criteria.find((c) => c.dimension === "topic_sentence");
  if (topic && "groups" in topic) sentences.push(`My ${topic.groups[0][0]} is the topic I picked today.`);
  for (const c of criteria)
    if (c.dimension === "keywords")
      for (const g of c.groups) sentences.push(`I like the ${g[0]} very much indeed.`);
  const need = (dim: string, key: "min" | "minSentences") => {
    const c = criteria.find((x) => x.dimension === dim) as
      { min?: number; minSentences?: number } | undefined;
    return c?.[key] ?? 0;
  };
  const minSentences = Math.max(
    need("sentences", "min"),
    need("ending", "minSentences"),
    need("sequence_words", "min"),
    minLines,
    1,
  );
  let i = 0;
  while (
    sentences.length < minSentences ||
    sentences.join(" ").split(/\s+/).length < need("words", "min") + 2
  )
    sentences.push(`${FILLER[i++ % FILLER.length]}.`);
  if (criteria.some((c) => c.dimension === "ending"))
    sentences.push("That is why I will always remember it.");
  const seq = need("sequence_words", "min");
  const lower = (s: string) => (/^I\b/.test(s) ? s : `${s[0].toLowerCase()}${s.slice(1)}`);
  return sentences.map((s, j) => (j < seq ? `${SEQUENCE[j]} ${lower(s)}` : s));
}

// Spreads sentences over the boxes, at least one each.
function spread(sentences: string[], boxes: number): string[] {
  const lines = sentences.slice(0, boxes);
  const rest = sentences.slice(boxes);
  if (rest.length > 0) lines[boxes - 1] = `${lines[boxes - 1]} ${rest.join(" ")}`;
  return lines;
}

type AnyAnswer = Record<string, unknown>;

export function correctWritingResponse(
  type: string,
  content: AnyAnswer,
  answer: AnyAnswer,
  glyph: TraceGlyph | null,
): QuestionResponse {
  switch (type) {
    case "TRACING":
      return { strokes: strokesOf(glyph!) };
    case "SENTENCE_WRITING":
    case "EDIT_AND_CORRECT": {
      if ("accepted" in answer) return { value: (answer.accepted as string[])[0] };
      const criteria = (answer.rubric as { criteria: RubricCriterion[] }).criteria;
      return { value: rubricSentences(criteria, 1).join(" ") };
    }
    case "GUIDED_WRITING": {
      const criteria = (answer.rubric as { criteria: RubricCriterion[] }).criteria;
      const frames = (content.frames as unknown[]).length;
      return { lines: spread(rubricSentences(criteria, frames), frames) };
    }
    case "STORY_ORDER_WRITING": {
      const order = (answer.acceptedSequences as string[][])[0];
      const events = answer.eventCriteria as Record<string, { groups: string[][] }[]>;
      const overall = (answer.rubric as { criteria: RubricCriterion[] }).criteria;
      const seq =
        (overall.find((c) => c.dimension === "sequence_words") as { min?: number } | undefined)?.min ?? 0;
      const TAILS = [
        "came along on a windy morning",
        "was there in the old red barn",
        "made everyone stop and look around",
        "was the best part of the whole day",
        "showed us something new and surprising",
      ];
      const lines = order.map((id, i) => {
        const word = events[id]?.[0]?.groups[0][0] ?? "story";
        const body = `the ${word} ${TAILS[i % TAILS.length]}.`;
        return i < Math.max(seq, 1) ? `${SEQUENCE[i]} ${body}` : `${body[0].toUpperCase()}${body.slice(1)}`;
      });
      return { lines, order };
    }
    default:
      throw new Error(`not a writing type: ${type}`);
  }
}

export function wrongWritingResponse(type: string, content: AnyAnswer): QuestionResponse {
  switch (type) {
    case "TRACING":
      return {
        strokes: [
          [
            [2, 2],
            [2, 30],
          ],
        ],
      };
    case "SENTENCE_WRITING":
      return { value: "zz" };
    case "EDIT_AND_CORRECT":
      return { value: String(content.text) };
    case "GUIDED_WRITING":
      return { lines: ["zz"] };
    case "STORY_ORDER_WRITING": {
      const ids = (content.events as { id: string }[]).map((e) => e.id);
      return { lines: ids.map(() => "zz"), order: ids };
    }
    default:
      throw new Error(`not a writing type: ${type}`);
  }
}
