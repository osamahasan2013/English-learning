import { z } from "zod";

// Scores a skill check (e.g. the Phonics Check) from the child's stored first tries.
// Each assessment item belongs to a stage ("area": letter sounds, blending, digraphs…) and
// measures one skill. The result keeps a percentage per area and per skill so the parent
// sees exactly where a child is strong or needs practice; the child only sees stars.
// Pure: the progress writer (src/lib/server/progress-writer.ts) feeds it stored rows.

export const skillCheckConfigSchema = z
  .object({
    report: z.string().optional(),
    childTitle: z.string().optional(),
    emoji: z.string().optional(),
    // An area at or above this score counts as secure.
    areaPassPercent: z.number().min(0).max(100).default(75),
  })
  .passthrough();
export type SkillCheckConfig = z.infer<typeof skillCheckConfigSchema>;

export type AssessmentItemFact = {
  questionId: string;
  stage: number;
  stageLabel: string;
  skillId: string;
  skillCode: string;
};

export type AreaScore = {
  stage: number;
  label: string;
  correct: number;
  total: number;
  percent: number;
  secure: boolean;
};

export type SkillScore = { skillId: string; correct: number; total: number; percent: number };

export type AssessmentOutcome = {
  overallPercent: number;
  correct: number;
  total: number;
  areas: AreaScore[];
  skills: Record<string, SkillScore>;
  // Areas below the pass mark, in stage order: what to practise next.
  gaps: string[];
};

const percent = (correct: number, total: number) =>
  total === 0 ? 0 : Math.round((10000 * correct) / total) / 100;

// Unanswered items count as not yet known (a child who stops early is not scored higher
// for the questions they skipped), but an area with no items at all is left out.
export function scoreSkillCheck(
  items: AssessmentItemFact[],
  firstTries: Map<string, boolean>,
  passPercent = 75,
): AssessmentOutcome {
  const byStage = new Map<number, { label: string; correct: number; total: number }>();
  const bySkill = new Map<string, SkillScore>();
  let correct = 0;
  for (const item of items) {
    const ok = firstTries.get(item.questionId) === true;
    if (ok) correct++;
    const area = byStage.get(item.stage) ?? { label: item.stageLabel, correct: 0, total: 0 };
    area.total++;
    if (ok) area.correct++;
    byStage.set(item.stage, area);
    const skill = bySkill.get(item.skillCode) ?? { skillId: item.skillId, correct: 0, total: 0, percent: 0 };
    skill.total++;
    if (ok) skill.correct++;
    bySkill.set(item.skillCode, skill);
  }
  const areas = [...byStage]
    .sort(([a], [b]) => a - b)
    .map(([stage, a]) => {
      const p = percent(a.correct, a.total);
      return {
        stage,
        label: a.label,
        correct: a.correct,
        total: a.total,
        percent: p,
        secure: p >= passPercent,
      };
    });
  const skills: Record<string, SkillScore> = {};
  for (const [code, s] of bySkill) skills[code] = { ...s, percent: percent(s.correct, s.total) };
  return {
    overallPercent: percent(correct, items.length),
    correct,
    total: items.length,
    areas,
    skills,
    gaps: areas.filter((a) => !a.secure).map((a) => a.label),
  };
}
