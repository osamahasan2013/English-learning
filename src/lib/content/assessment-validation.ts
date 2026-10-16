import { speechProblems } from "@/lib/audio/pronunciation";
import { blueprintSchema, sectionStage, type Blueprint } from "@/lib/learning/assessment-blueprint";
import { itemDifficulty } from "@/lib/learning/item-difficulty";

// Content-quality checks for assessments (Phase 9), run by the importer (errors reject the
// assessment, warnings become content flags for admins) and by the content tests on every
// shipped file. Pure: the caller expands each question (templates) and supplies the
// reference data.

export type AssessmentInput = {
  code: string;
  type: string;
  config: unknown;
  stages: {
    stage: number;
    label: string;
    skill: string;
    questions: { code?: string; skill?: string; template?: string; word?: string }[];
  }[];
};

export type ExpandedItem = {
  type: string;
  content: unknown;
  answer: unknown;
  word?: string | null;
  promptSpeech?: string | null;
};

export type AssessmentRefs = {
  skills: ReadonlyMap<string, { levelCode: string | null }>;
  levelCodes: ReadonlySet<string>;
  levelRank: (code: string) => number;
  // Phoneme codes the audio system knows (speech tokens are checked against them).
  phonemes?: ReadonlySet<string>;
  expand: (question: AssessmentInput["stages"][number]["questions"][number], code: string) => ExpandedItem;
};

export type AssessmentIssue = { key: string; message: string };

// Open-ended writing and unscored steps are never assessed automatically.
const NOT_ASSESSABLE = new Set(["INTRO", "READ_PASSAGE", "SENTENCE_WRITING", "GUIDED_WRITING", "STORY_ORDER_WRITING"]);
// A word may appear in at most this many items of one assessment.
const MAX_ITEMS_PER_WORD = 2;

const stable = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(stable).join(",")}]`
    : value && typeof value === "object"
      ? `{${Object.keys(value as object)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`)
          .join(",")}}`
      : JSON.stringify(value);

export type ValidatedAssessment = {
  blueprint: Blueprint;
  // Per content stage: the section it belongs to, and each item's difficulty.
  items: { stage: number; index: number; domain: string; levelCode: string | null; difficulty: number }[];
};

export function validateAssessment(
  a: AssessmentInput,
  refs: AssessmentRefs,
): { errors: AssessmentIssue[]; warnings: AssessmentIssue[]; result: ValidatedAssessment | null } {
  const errors: AssessmentIssue[] = [];
  const warnings: AssessmentIssue[] = [];
  const key = a.code;
  const parsed = blueprintSchema.safeParse(a.config);
  if (!parsed.success) {
    for (const issue of parsed.error.issues)
      errors.push({ key, message: `blueprint ${issue.path.join(".")}: ${issue.message}` });
    return { errors, warnings, result: null };
  }
  const blueprint = parsed.data;
  for (const s of blueprint.sections) {
    if (s.level && !refs.levelCodes.has(s.level)) errors.push({ key, message: `section ${s.code}: unknown level ${s.level}` });
    for (const skill of s.skills ?? [])
      if (!refs.skills.has(skill)) errors.push({ key, message: `section ${s.code}: unknown skill ${skill}` });
  }

  const items: ValidatedAssessment["items"] = [];
  if (blueprint.pool !== "authored") {
    if (a.stages.length > 0) errors.push({ key, message: `a ${blueprint.pool} pool takes its items from lessons: remove the stages` });
    return { errors, warnings, result: errors.length ? null : { blueprint, items } };
  }

  const stageNumbers = new Set(a.stages.map((s) => s.stage));
  const seen = new Map<string, string>();
  const wordCount = new Map<string, number>();
  for (const section of blueprint.sections) {
    const stageNo = sectionStage(blueprint, section);
    const stage = a.stages.find((s) => s.stage === stageNo);
    if (!stage) {
      errors.push({ key, message: `section ${section.code}: stage ${stageNo} has no questions` });
      continue;
    }
    if (stage.questions.length < section.draw)
      errors.push({
        key,
        message: `section ${section.code}: ${stage.questions.length} item(s) for a draw of ${section.draw} (insufficient pool)`,
      });
    const skills = new Set<string>();
    stage.questions.forEach((q, index) => {
      const skill = q.skill ?? stage.skill;
      const where = `section ${section.code} item ${index + 1}`;
      const ref = refs.skills.get(skill);
      if (!ref) {
        errors.push({ key, message: `${where}: unknown skill ${skill}` });
        return;
      }
      skills.add(skill);
      if (section.level && ref.levelCode && ref.levelCode !== section.level)
        warnings.push({ key, message: `${where}: skill ${skill} is taught at ${ref.levelCode}, the section measures ${section.level}` });
      let expanded: ExpandedItem;
      try {
        expanded = refs.expand(q, `${a.code}-s${stageNo}-q${index + 1}`);
      } catch (error) {
        errors.push({ key, message: `${where}: ${(error as Error).message}` });
        return;
      }
      if (NOT_ASSESSABLE.has(expanded.type))
        errors.push({ key, message: `${where}: ${expanded.type} cannot be assessed automatically` });
      if (expanded.answer === null) errors.push({ key, message: `${where}: has no answer` });
      // Spoken through the one audio system: sound and letter-name tokens, never bare letters.
      for (const problem of speechProblems(expanded.promptSpeech ?? "", expanded.content, refs.phonemes))
        errors.push({ key, message: `${where}: speech: ${problem}` });
      const fingerprint = stable({ type: expanded.type, content: expanded.content, answer: expanded.answer });
      const twin = seen.get(fingerprint);
      if (twin) errors.push({ key, message: `${where}: duplicate of ${twin}` });
      else seen.set(fingerprint, where);
      const word = (expanded.word ?? q.word ?? "").toLowerCase();
      if (word) wordCount.set(word, (wordCount.get(word) ?? 0) + 1);
      items.push({
        stage: stageNo,
        index,
        domain: section.domain,
        levelCode: section.level ?? null,
        difficulty: itemDifficulty({
          levelRank: section.level ? refs.levelRank(section.level) : 1,
          questionType: expanded.type,
          word: expanded.word ?? q.word ?? null,
        }),
      });
    });
    if (section.draw >= 2 && skills.size < 2)
      warnings.push({ key, message: `section ${section.code} measures only one skill (low coverage)` });
  }
  for (const s of a.stages)
    if (!blueprint.sections.some((sec) => sectionStage(blueprint, sec) === s.stage))
      errors.push({ key, message: `stage ${s.stage} is not part of any section` });
  for (const [word, count] of wordCount)
    if (count > MAX_ITEMS_PER_WORD)
      warnings.push({ key, message: `"${word}" is used in ${count} items (excessive repetition)` });
  if (stageNumbers.size !== a.stages.length) errors.push({ key, message: "stage numbers repeat" });
  return { errors, warnings, result: errors.length ? null : { blueprint, items } };
}
