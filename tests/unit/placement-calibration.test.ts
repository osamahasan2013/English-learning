import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseBlueprint, type Domain } from "@/lib/learning/assessment-blueprint";
import { scoreSections, type SittingItem } from "@/lib/learning/assessment-evidence";
import { nextSection, type FlowSection } from "@/lib/learning/assessment-flow";
import { computeReadiness, confidenceRank } from "@/lib/learning/readiness";
import { DEFAULT_RULES } from "@/lib/learning/rules";

// Phase 9.1 — placement calibration and length, end to end through the REAL pieces: the
// shipped "Find My Level" blueprint (content/assessments.json), the level ladder the device
// runs, the server's section scoring, instructional readiness, and the adaptive rule that
// decides where lessons are taught (src/lib/server/adaptive.ts: readiness when its evidence
// is at least rules.adaptive.minReadinessConfidence, else the learning level).
//
// A simulated child has a TRUE level per domain: every item at or below it is answered
// right, every item above it wrong (or "I don't know").

const LEVEL_CODES = ["KG1", "KG2", "KG3", "GRADE1", "GRADE2"];
const LEVELS = LEVEL_CODES.map((code, i) => ({ id: `lvl-${code}`, code, rank: i + 1 }));
const rankOf = (code: string) => LEVEL_CODES.indexOf(code) + 1;
const NOW = new Date("2026-10-17T12:00:00Z");

const file = JSON.parse(readFileSync("content/assessments.json", "utf8")) as {
  assessments: { code: string; config: unknown }[];
};
const blueprint = parseBlueprint(file.assessments.find((a) => a.code === "find-my-level")!.config)!;
const sections: (FlowSection & { level: string })[] = blueprint.sections.map((s) => ({
  code: s.code,
  domain: s.domain,
  rank: rankOf(s.level!),
  items: s.draw,
  level: s.level!,
}));
const DOMAINS: Domain[] = ["PHONICS", "READING", "VOCABULARY", "SPELLING", "WRITING"];

type Child = { grade: number; trueLevel: number; above?: "wrong" | "skip"; allSkip?: boolean };

// Runs the ladder exactly as the device does and returns the answered items.
function sit(child: Child) {
  const startRank = Math.max(1, Math.min(5, child.grade + blueprint.stopping.startOffset));
  const outcomes: Record<string, { correct: number; total: number }> = {};
  const items: SittingItem[] = [];
  for (let guard = 0; guard < 50; guard++) {
    const s = nextSection({
      rule: blueprint.stopping.rule,
      startRank,
      passPercent: blueprint.passPercent ?? DEFAULT_RULES.assessment.sectionPassPercent,
      maxSectionsPerDomain: blueprint.stopping.maxSectionsPerDomain,
      sections,
      outcomes,
    });
    if (!s) break;
    const right = !child.allSkip && s.rank <= child.trueLevel;
    const skip = child.allSkip || (!right && child.above === "skip");
    for (let i = 0; i < s.items; i++)
      items.push({
        questionId: `${s.code}-${i}`,
        sectionCode: s.code,
        domain: s.domain as Domain,
        levelId: `lvl-${LEVEL_CODES[s.rank - 1]}`,
        levelRank: s.rank,
        skillId: `${s.code}-skill-${i % 2}`,
        outcome: right ? "correct" : skip ? "skipped" : "incorrect",
        credit: right ? 1 : 0,
        priorExposures: 0,
      });
    outcomes[s.code] = { correct: right ? s.items : 0, total: s.items };
  }
  return items;
}

function place(child: Child, domain: Domain = "PHONICS") {
  const items = sit(child);
  const results = scoreSections(
    items.filter((i) => i.domain === domain),
    blueprint.passPercent ?? DEFAULT_RULES.assessment.sectionPassPercent,
  );
  const readiness = computeReadiness({
    domain,
    levels: LEVELS,
    // The learning level starts at the school grade (it is the parent's setting).
    defaultRank: child.grade,
    sections: results,
    evidence: [],
    observedAt: NOW.toISOString(),
    mastery: [],
    skillTitles: new Map(),
    prerequisites: new Map(),
    now: NOW,
  });
  const confident =
    confidenceRank(readiness.confidence) >= confidenceRank(DEFAULT_RULES.adaptive.minReadinessConfidence);
  return {
    items: items.length,
    readiness,
    teachingRank: confident ? readiness.currentRank : child.grade,
  };
}

describe("placement calibration (school grade is context, never a cap)", () => {
  it("BELOW grade: a KG3 child secure only at KG1 is taught at KG2", () => {
    const r = place({ grade: 3, trueLevel: 1 });
    expect(r.readiness).toMatchObject({ currentRank: 2, strongestRank: 1, source: "assessment" });
    expect(r.readiness.confidence).not.toBe("INSUFFICIENT");
    expect(r.teachingRank).toBe(2);
  });

  it("BELOW grade, nothing secure: a Grade 1 child failing from KG3 down is taught at the lowest level checked", () => {
    const r = place({ grade: 4, trueLevel: 0 });
    expect(r.readiness.strongestRank).toBeNull();
    expect(r.teachingRank).toBeLessThan(4);
  });

  it("AT grade: a KG3 child secure at KG2 (learning KG3 now) stays at KG3", () => {
    const r = place({ grade: 3, trueLevel: 2 });
    expect(r.readiness).toMatchObject({ currentRank: 3, strongestRank: 2 });
    expect(r.teachingRank).toBe(3);
  });

  it("ABOVE grade: a KG3 child secure through Grade 1 is taught at Grade 2", () => {
    const r = place({ grade: 3, trueLevel: 4 });
    expect(r.readiness).toMatchObject({ currentRank: 5, strongestRank: 4 });
    expect(r.teachingRank).toBe(5);
  });

  it("ABOVE grade for the youngest: a KG1 child passing everything is placed well above KG1", () => {
    const r = place({ grade: 1, trueLevel: 5 });
    // Three sections climbed (KG1, KG2, KG3 all secure) → taught at Grade 1.
    expect(r.readiness.strongestRank).toBe(3);
    expect(r.teachingRank).toBe(4);
  });

  it("the school grade is never written: readiness depends on the evidence, not the grade", () => {
    // The same true level gives the same readiness whatever the grade (when the ladder reaches it).
    expect(place({ grade: 2, trueLevel: 2 }).readiness.currentRank).toBe(3);
    expect(place({ grade: 3, trueLevel: 2 }).readiness.currentRank).toBe(3);
    expect(place({ grade: 4, trueLevel: 2 }).readiness.currentRank).toBe(3);
  });

  it('INSUFFICIENT: "I don\'t know" to everything moves nothing — teaching stays at the learning level', () => {
    for (const grade of [1, 3, 5]) {
      const r = place({ grade, trueLevel: 0, allSkip: true });
      expect(r.readiness.confidence).toBe("INSUFFICIENT");
      expect(r.teachingRank).toBe(grade);
    }
  });

  it("skipping only what is too hard still places the child (skips above the true level)", () => {
    const r = place({ grade: 3, trueLevel: 3, above: "skip" });
    expect(r.readiness).toMatchObject({ currentRank: 4, strongestRank: 3 });
    expect(r.readiness.confidence).not.toBe("INSUFFICIENT");
  });

  it("each domain is placed on its own", () => {
    const strong = place({ grade: 3, trueLevel: 4 }, "READING");
    const weak = place({ grade: 3, trueLevel: 1 }, "WRITING");
    expect(strong.teachingRank).toBe(5);
    expect(weak.teachingRank).toBe(2);
  });
});

describe("placement length (86 items in the pool, a short ladder per child)", () => {
  const total = (grade: number, trueLevel: number) => sit({ grade, trueLevel }).length;

  it("the pool is 86 items in 25 sections; a sitting draws 3 per section", () => {
    expect(sections).toHaveLength(25);
    expect(new Set(sections.map((s) => s.items))).toEqual(new Set([3]));
    expect(blueprint.stopping).toMatchObject({ rule: "level_ladder", maxSectionsPerDomain: 3 });
  });

  it("a child working at their grade answers 15 (KG1) or 30 items", () => {
    expect(total(1, 0)).toBe(15);
    expect(total(2, 1)).toBe(30);
    expect(total(3, 2)).toBe(30);
    expect(total(4, 3)).toBe(30);
    expect(total(5, 4)).toBe(30);
  });

  it("no child answers more than 45 items, whatever their level (at most 3 sections per area)", () => {
    for (let grade = 1; grade <= 5; grade++)
      for (let trueLevel = 0; trueLevel <= 5; trueLevel++) {
        const items = sit({ grade, trueLevel });
        expect(items.length).toBeLessThanOrEqual(45);
        for (const d of DOMAINS)
          expect(
            new Set(items.filter((i) => i.domain === d).map((i) => i.sectionCode)).size,
          ).toBeLessThanOrEqual(3);
      }
  });

  it("a struggling KG1 or KG2 child stops after one section per area (15 items)", () => {
    expect(total(1, 0)).toBe(15);
    expect(total(2, 0)).toBe(15);
  });
});
