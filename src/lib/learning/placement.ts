import { z } from "zod";

// Placement ("Find My Level") scoring. Stages run in order (letters → sounds → CVC →
// blending → digraphs → sight words → sentences → reading); the child keeps going while
// they pass. The suggested level is the one mapped to the last stage passed. This is a
// transparent rule, not a validated reading-level instrument, and the UI must call the
// result a "suggested level" (docs/curriculum.md → "Placement").

export const placementConfigSchema = z.object({
  startLevelCode: z.string(),
  stages: z
    .array(
      z.object({
        stage: z.number().int().min(1),
        label: z.string(),
        passPercent: z.number().min(0).max(100),
        levelOnPass: z.string(),
      }),
    )
    .min(1),
});
export type PlacementConfig = z.infer<typeof placementConfigSchema>;

export type StageResult = { stage: number; correct: number; total: number };

export type PlacementOutcome = {
  suggestedLevelCode: string;
  stagesPassed: number[];
  // Stage where the child stopped passing, if any: the place to start teaching.
  firstGapStage: number | null;
  overallPercent: number;
};

export function computePlacement(config: PlacementConfig, results: StageResult[]): PlacementOutcome {
  const byStage = new Map(results.map((r) => [r.stage, r]));
  const ordered = [...config.stages].sort((a, b) => a.stage - b.stage);
  let suggested = config.startLevelCode;
  const stagesPassed: number[] = [];
  let firstGapStage: number | null = null;

  for (const stage of ordered) {
    const result = byStage.get(stage.stage);
    const percent = result && result.total > 0 ? (100 * result.correct) / result.total : 0;
    if (result && result.total > 0 && percent >= stage.passPercent) {
      stagesPassed.push(stage.stage);
      suggested = stage.levelOnPass;
    } else {
      firstGapStage = stage.stage;
      break;
    }
  }

  const totals = results.reduce((acc, r) => ({ c: acc.c + r.correct, t: acc.t + r.total }), { c: 0, t: 0 });
  return {
    suggestedLevelCode: suggested,
    stagesPassed,
    firstGapStage,
    overallPercent: totals.t ? Math.round((10000 * totals.c) / totals.t) / 100 : 0,
  };
}
