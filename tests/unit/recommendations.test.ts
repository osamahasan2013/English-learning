import { describe, expect, it } from "vitest";
import {
  practiceRecommendations,
  reviewCandidates,
  strongSkills,
  weakSkills,
  type SkillMasterySummary,
} from "@/lib/learning/recommendations";

const now = new Date("2026-09-29T12:00:00Z");

function skill(overrides: Partial<SkillMasterySummary> & { skillId: string }): SkillMasterySummary {
  return {
    title: overrides.skillId.toUpperCase(),
    status: "PRACTICING",
    masteryScore: 70,
    attempts: 10,
    reviewPriority: 10,
    nextReviewAt: "2026-10-05T00:00:00Z",
    ...overrides,
  };
}

// The example from the product brief: SH 92%, CH 89%, TH 47% → "Practice TH".
const skills = [
  skill({ skillId: "sh", masteryScore: 92, status: "MASTERED", reviewPriority: 5 }),
  skill({ skillId: "ch", masteryScore: 89, status: "ALMOST_MASTERED", reviewPriority: 8 }),
  skill({ skillId: "th", masteryScore: 47, status: "LEARNING", reviewPriority: 60 }),
];

describe("recommendations", () => {
  it("recommends practising the weak skill", () => {
    expect(practiceRecommendations(skills)).toEqual([{ skill: skills[2], message: "Practice TH" }]);
  });

  it("does not call a skill weak without enough evidence", () => {
    expect(weakSkills([skill({ skillId: "x", masteryScore: 0, attempts: 3 })])).toEqual([]);
  });

  it("lists strong skills by score", () => {
    expect(strongSkills(skills).map((s) => s.skillId)).toEqual(["sh", "ch"]);
  });

  it("puts weak skills first in review, and includes mastered skills once they are due", () => {
    const due = [
      ...skills,
      skill({ skillId: "ee", masteryScore: 95, status: "MASTERED", nextReviewAt: "2026-09-28T00:00:00Z" }),
    ];
    expect(reviewCandidates(due, now).map((s) => s.skillId)).toEqual(["th", "ee"]);
  });

  it("never reviews skills that were not started", () => {
    expect(
      reviewCandidates(
        [skill({ skillId: "x", status: "NOT_STARTED", attempts: 0, nextReviewAt: null })],
        now,
      ),
    ).toEqual([]);
  });
});
