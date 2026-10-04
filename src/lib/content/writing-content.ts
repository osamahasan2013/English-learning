import { z } from "zod";
import { glyphGuideSchema, glyphStrokeProblems, glyphStrokesSchema, type GlyphStroke } from "@/lib/learning/tracing";
import { rubricCriteriaSchema, type RubricCriterion } from "@/lib/learning/writing";
import { findUnsafeSpeech } from "@/lib/audio/pronunciation";

// The writing content file (content/writing.json): the writing skill list, the reference
// handwriting (glyphs) and the rubric templates for open-ended writing. Pure: the importer
// and the content tests use the same checks.

const code = z.string().regex(/^[A-Z][A-Z0-9_]{1,39}$/);
const levelCode = z.string().regex(/^[A-Z0-9_]{1,40}$/);
const slug = z.string().regex(/^[a-z0-9-]{2,80}$/);
const status = z.enum(["draft", "published", "archived"]).default("published");

export const WRITING_STRANDS = ["handwriting", "word", "sentence", "mechanics", "composition", "editing"] as const;

export const writingSkillSchema = z
  .object({
    code,
    name: z.string().min(1).max(80),
    childName: z.string().max(80).default(""),
    description: z.string().max(400).default(""),
    strand: z.enum(WRITING_STRANDS),
    minLevel: levelCode,
    maxLevel: levelCode,
    emoji: z.string().default(""),
    sortOrder: z.number().int(),
    status,
  })
  .strict();

export const glyphSchema = z
  .object({
    code: z.string().regex(/^[a-z0-9-]{2,60}$/),
    kind: z.enum(["letter", "digit", "shape"]),
    character: z.string().min(1).max(4),
    case: z.enum(["upper", "lower", "none"]).default("none"),
    script: z.string().regex(/^[a-z]{2,20}$/).default("latin"),
    name: z.string().min(1).max(40),
    strokes: glyphStrokesSchema,
    guide: glyphGuideSchema.default({}),
    tolerance: z.number().min(2).max(40).default(12),
    completion: z.number().min(0.3).max(0.98).default(0.7),
    difficulty: z.number().int().min(1).max(10).default(1),
    family: z.string().max(20).default(""),
    formationTip: z.string().max(200).default(""),
    formationSpeech: z.string().max(300).default(""),
    sortOrder: z.number().int().default(0),
    status,
  })
  .strict();
export type GlyphInput = z.infer<typeof glyphSchema>;

const keywordGroups = z.array(z.array(z.string().trim().min(1).max(40)).min(1).max(16)).min(1).max(8);
const extraCriterion = z
  .object({ label: z.string().min(1).max(80), hint: z.string().max(160).default(""), critical: z.boolean().default(true) })
  .strict();

// A rubric template: fixed criteria plus how the question's own keywords become criteria —
// `ideas` (what the writing must be about), `topic` (what the first sentence names) and
// `ownWords` (more than the given text copied back).
export const rubricTemplateSchema = z
  .object({
    code: slug,
    name: z.string().min(1).max(80),
    description: z.string().max(400).default(""),
    minLevel: levelCode,
    maxLevel: levelCode,
    criteria: rubricCriteriaSchema,
    ideas: extraCriterion.optional(),
    topic: extraCriterion.optional(),
    ownWords: extraCriterion.optional(),
    status,
  })
  .strict();
export type RubricTemplate = z.infer<typeof rubricTemplateSchema>;

export const writingFileSchema = z.object({
  writingSkills: z.array(writingSkillSchema).default([]),
  glyphs: z.array(glyphSchema).default([]),
  rubrics: z.array(rubricTemplateSchema).default([]),
});
export type WritingFile = z.infer<typeof writingFileSchema>;

// ---- glyph validation ------------------------------------------------------------------

// Problems that make a glyph unusable (errors) and doubts for an admin (warnings).
export function glyphProblems(glyph: GlyphInput): { errors: string[]; warnings: string[] } {
  const errors = [...glyphStrokeProblems(glyph.strokes)];
  const warnings: string[] = [];
  const ch = glyph.character;
  if (glyph.kind === "letter") {
    if (!/^[A-Za-z]$/.test(ch)) errors.push(`a letter glyph must be one letter, not "${ch}"`);
    else if (glyph.case === "upper" && ch !== ch.toUpperCase()) errors.push(`"${ch}" is not a capital letter`);
    else if (glyph.case === "lower" && ch !== ch.toLowerCase()) errors.push(`"${ch}" is not a small letter`);
    if (glyph.case === "none") errors.push("a letter glyph needs its case (upper or lower)");
  }
  if (glyph.kind === "digit" && !/^[0-9]$/.test(ch)) errors.push(`a digit glyph must be one digit, not "${ch}"`);
  if (glyph.kind !== "letter" && glyph.case !== "none") errors.push("only letters have a case");
  const g = glyph.guide;
  if (g.top !== undefined && g.baseline !== undefined && g.top >= g.baseline) errors.push("guide: the top line must be above the baseline");
  if (g.midline !== undefined && g.baseline !== undefined && g.midline >= g.baseline) errors.push("guide: the midline must be above the baseline");
  if (findUnsafeSpeech(glyph.formationSpeech).length > 0)
    errors.push(`formationSpeech: "${findUnsafeSpeech(glyph.formationSpeech).join(", ")}" would be read as letter names`);
  // Stroke order and direction: a letter is written from the top (its first stroke starts in
  // the upper part of the letter), so a stroke list stored bottom-up is caught here.
  if (glyph.kind !== "shape") {
    const ys = glyph.strokes.flatMap((s) => s.points.map((p) => p[1]));
    const [top, bottom] = [Math.min(...ys), Math.max(...ys)];
    const start = glyph.strokes[0].points[0][1];
    if (bottom - top > 5 && start > top + (bottom - top) * 0.6)
      warnings.push("the first stroke starts near the bottom: check the stroke order and direction");
  }
  const tiny = glyph.strokes.filter((s) => strokeLength(s) < 1.5);
  if (tiny.length > 0 && !["i", "j"].includes(ch)) warnings.push(`${tiny.length} stroke(s) are dots`);
  if (glyph.tolerance > 25) warnings.push(`tolerance ${glyph.tolerance} accepts very loose tracing`);
  if (glyph.completion < 0.5) warnings.push(`completion ${glyph.completion} accepts very little of the letter`);
  return { errors, warnings };
}

function strokeLength(s: GlyphStroke) {
  let total = 0;
  for (let i = 1; i < s.points.length; i++) total += Math.hypot(s.points[i][0] - s.points[i - 1][0], s.points[i][1] - s.points[i - 1][1]);
  return total;
}

// ---- rubrics --------------------------------------------------------------------------

// How a writing question names its rubric in the content files: the template and the
// question's own keyword groups. The importer compiles it into the stored, server-only
// answer ({ rubric: { code, criteria } }), so evaluation needs nothing but the question.
export const rubricRefSchema = z
  .object({
    rubric: slug,
    ideas: keywordGroups.optional(),
    ideasMin: z.number().int().min(1).max(8).optional(),
    topic: keywordGroups.optional(),
    ownWords: z.string().trim().min(1).max(300).optional(),
  })
  .strict();
export type RubricRef = z.infer<typeof rubricRefSchema>;

export class RubricError extends Error {}

export function compileRubric(template: RubricTemplate, ref: RubricRef): { code: string; criteria: RubricCriterion[] } {
  const criteria: RubricCriterion[] = template.criteria.map((c) => ({ ...c }));
  const add = (c: RubricCriterion) => {
    if (criteria.some((x) => x.id === c.id)) throw new RubricError(`rubric ${template.code} already has a criterion "${c.id}"`);
    criteria.push(c);
  };
  if (ref.ideas) {
    if (!template.ideas) throw new RubricError(`rubric ${template.code} takes no ideas`);
    if (ref.ideasMin !== undefined && ref.ideasMin > ref.ideas.length)
      throw new RubricError(`ideasMin ${ref.ideasMin} is more than the ${ref.ideas.length} idea groups`);
    add({ id: "ideas", dimension: "keywords", weight: 2, ...template.ideas, groups: ref.ideas, ...(ref.ideasMin ? { min: ref.ideasMin } : {}) });
  } else if (template.ideas?.critical) throw new RubricError(`rubric ${template.code} needs the question's ideas`);
  if (ref.topic) {
    if (!template.topic) throw new RubricError(`rubric ${template.code} takes no topic`);
    add({ id: "topic", dimension: "topic_sentence", weight: 1, ...template.topic, groups: ref.topic });
  } else if (template.topic?.critical) throw new RubricError(`rubric ${template.code} needs the question's topic`);
  if (ref.ownWords) {
    if (!template.ownWords) throw new RubricError(`rubric ${template.code} takes no ownWords`);
    add({ id: "own-words", dimension: "not_copied", weight: 1, ...template.ownWords, text: ref.ownWords });
  } else if (template.ownWords?.critical) throw new RubricError(`rubric ${template.code} needs the text not to copy (ownWords)`);
  const parsed = rubricCriteriaSchema.safeParse(criteria);
  if (!parsed.success) throw new RubricError(parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; "));
  if (!parsed.data.some((c) => c.critical === true || c.critical === "level"))
    throw new RubricError(`rubric ${template.code} has no critical criterion`);
  return { code: template.code, criteria: parsed.data };
}

// Story sequence writing: each picture's sentence must mention what happens in it (any one
// of its keyword groups).
export const storyAnswerInputSchema = z
  .object({
    acceptedSequences: z.array(z.array(z.string().regex(/^[a-z0-9-]{1,40}$/)).min(2).max(5)).min(1).max(4),
    events: z.record(z.string().regex(/^[a-z0-9-]{1,40}$/), keywordGroups),
    rubric: slug,
    ideas: keywordGroups.optional(),
    ideasMin: z.number().int().min(1).max(8).optional(),
  })
  .strict();

// Turns a writing question's authored answer into the stored one. Closed tasks (copy,
// complete, edit) and handwriting pass through unchanged.
export function compileWritingAnswer(
  questionType: string,
  answer: Record<string, unknown> | null,
  rubrics: Map<string, RubricTemplate & { minRank: number; maxRank: number }>,
  levelRank: number | undefined,
): Record<string, unknown> | null {
  if (!answer || typeof answer.rubric !== "string") return answer;
  const template = (code: string) => {
    const t = rubrics.get(code);
    if (!t) throw new RubricError(`unknown rubric "${code}"`);
    if (levelRank !== undefined && (levelRank < t.minRank || levelRank > t.maxRank))
      throw new RubricError(`rubric ${code} is not for this level`);
    return t;
  };
  if (questionType === "STORY_ORDER_WRITING") {
    const parsed = storyAnswerInputSchema.safeParse(answer);
    if (!parsed.success) throw new RubricError(parsed.error.issues.map((i) => `answer.${i.path.join(".")} ${i.message}`).join("; "));
    const a = parsed.data;
    const eventCriteria: Record<string, RubricCriterion[]> = {};
    for (const [id, groups] of Object.entries(a.events))
      eventCriteria[id] = [
        { id: "what-happens", dimension: "keywords", label: "Says what happens", hint: "Tell what happens in the picture.", critical: true, weight: 1, groups, min: 1 },
      ];
    return {
      acceptedSequences: a.acceptedSequences,
      eventCriteria,
      rubric: compileRubric(template(a.rubric), { rubric: a.rubric, ideas: a.ideas, ideasMin: a.ideasMin }),
    };
  }
  const parsed = rubricRefSchema.safeParse(answer);
  if (!parsed.success) throw new RubricError(parsed.error.issues.map((i) => `answer.${i.path.join(".")} ${i.message}`).join("; "));
  return { rubric: compileRubric(template(parsed.data.rubric), parsed.data) };
}
