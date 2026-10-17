import { describe, expect, it } from "vitest";
import {
  recommend,
  type AdaptiveDomain,
  type AdaptiveInput,
  type AdaptiveLesson,
  type AdaptiveSkill,
} from "@/lib/learning/adaptive";
import { validateAssessment } from "@/lib/content/assessment-validation";
import { blueprintSchema, legacyBlueprint } from "@/lib/learning/assessment-blueprint";
import { itemDifficulty } from "@/lib/learning/item-difficulty";
import {
  compareEvidence,
  contaminationWeight,
  isAssessmentGap,
  scoreSections,
  skillEvidence,
  type SittingItem,
} from "@/lib/learning/assessment-evidence";
import { nextSection, type FlowState } from "@/lib/learning/assessment-flow";
import { selectItems, type SelectionCandidate } from "@/lib/learning/item-selection";
import { computeMastery } from "@/lib/learning/mastery";
import {
  computeReadiness,
  inferFromPhonics,
  type MasteryFact,
  type ReadinessInput,
} from "@/lib/learning/readiness";
import { deriveSkillReviewItem } from "@/lib/learning/review-queue";
import { DEFAULT_RULES } from "@/lib/learning/rules";

const LEVELS = ["KG1", "KG2", "KG3", "GRADE1", "GRADE2"].map((code, i) => ({
  id: `lvl-${code}`,
  code,
  rank: i + 1,
}));
const NOW = new Date("2026-10-05T12:00:00Z");

// ---------------------------------------------------------------------------------------
describe("assessment blueprints", () => {
  const base = {
    version: 2,
    childTitle: "Find my level",
    feedback: "none",
    pool: "authored",
    stopping: { rule: "level_ladder", startOffset: -1 },
    sections: [
      { code: "ph-kg1", label: "Letters", domain: "PHONICS", level: "KG1", draw: 3 },
      { code: "ph-kg2", label: "Sounds", domain: "PHONICS", level: "KG2", draw: 3 },
    ],
  };

  it("accepts a valid blueprint and fills defaults", () => {
    const b = blueprintSchema.parse(base);
    expect(b).toMatchObject({ allowSkip: true, maxItems: 40, breakEvery: 8, reviewGaps: true });
    expect(b.sections[0].maxPerSkill).toBe(2);
  });

  it("rejects duplicate sections, missing levels, reversed difficulty and impossible draws", () => {
    const bad = (patch: object) => blueprintSchema.safeParse({ ...base, ...patch }).success;
    expect(bad({ sections: [base.sections[0], base.sections[0]] })).toBe(false);
    expect(bad({ sections: [{ ...base.sections[0], level: undefined }] })).toBe(false);
    expect(bad({ sections: [{ ...base.sections[0], difficulty: [5, 2] }] })).toBe(false);
    expect(
      bad({
        pool: "skills",
        stopping: { rule: "none" },
        sections: [{ ...base.sections[0], skills: ["kg1-letter-b"], draw: 5 }],
      }),
    ).toBe(false);
    expect(bad({ feedback: "loud" })).toBe(false);
    expect(bad({ extra: true })).toBe(false);
  });

  it("builds a legacy blueprint for stage-based assessments (every item, full feedback)", () => {
    const b = legacyBlueprint("Sound Check", [
      { stage: 1, label: "Letters", count: 2, domain: "PHONICS", level: "KG1" },
      { stage: 12, label: "Spelling", count: 2, domain: "SPELLING", level: "KG2" },
    ]);
    expect(b.feedback).toBe("full");
    expect(b.sections.map((s) => [s.stage, s.domain, s.draw])).toEqual([
      [1, "PHONICS", 2],
      [12, "SPELLING", 2],
    ]);
  });
});

// ---------------------------------------------------------------------------------------
describe("trusted item selection", () => {
  const cand = (
    id: string,
    skill: string,
    variety: string | null,
    exposures = 0,
    difficulty = 3,
  ): SelectionCandidate => ({
    questionId: id,
    sectionCode: "s",
    skillId: skill,
    varietyKey: variety,
    difficulty,
    exposures,
  });
  const cvc = [
    cand("cat", "short-a", "w:cat"),
    cand("bat", "short-a", "w:bat"),
    cand("hat", "short-a", "w:hat"),
    cand("mat", "short-a", "w:mat"),
    cand("pig", "short-i", "w:pig"),
    cand("sun", "short-u", "w:sun"),
    cand("hen", "short-e", "w:hen"),
  ];

  it("samples across skills instead of five near-identical items", () => {
    const { items } = selectItems({
      sections: [{ code: "s", draw: 4, maxPerSkill: 2 }],
      candidates: cvc,
      seed: "sitting-1",
      maxItems: 40,
    });
    const picked = items.map((i) => i.questionId);
    expect(picked).toHaveLength(4);
    expect(picked.filter((p) => ["cat", "bat", "hat", "mat"].includes(p)).length).toBeLessThanOrEqual(1);
  });

  it("is deterministic for a sitting and prefers items the child has not seen", () => {
    const args = {
      sections: [{ code: "s", draw: 3, maxPerSkill: 1 }],
      candidates: [
        cand("a1", "a", null, 5),
        cand("a2", "a", null, 0),
        cand("b1", "b", null, 2),
        cand("c1", "c", null, 0),
      ],
      seed: "sitting-7",
      maxItems: 40,
    };
    const first = selectItems(args);
    expect(selectItems(args)).toEqual(first);
    expect(selectItems({ ...args, candidates: [...args.candidates].reverse() })).toEqual(first);
    expect(first.items.map((i) => i.questionId)).toContain("a2");
    expect(first.items.map((i) => i.questionId)).not.toContain("a1");
  });

  it("avoids two items about the same word, honours maxPerSkill, difficulty and maxItems, reports shortfalls", () => {
    const sameWord = [cand("q1", "x", "w:ship"), cand("q2", "y", "w:ship"), cand("q3", "z", "w:shop")];
    const { items } = selectItems({
      sections: [{ code: "s", draw: 2, maxPerSkill: 1 }],
      candidates: sameWord,
      seed: "k",
      maxItems: 40,
    });
    expect(
      new Set(items.map((i) => sameWord.find((c) => c.questionId === i.questionId)!.varietyKey)).size,
    ).toBe(2);

    const hard = [cand("e1", "a", null, 0, 2), cand("h1", "a", null, 0, 8), cand("h2", "b", null, 0, 9)];
    const ranged = selectItems({
      sections: [{ code: "s", draw: 2, maxPerSkill: 2, difficulty: [7, 10] }],
      candidates: hard,
      seed: "k",
      maxItems: 40,
    });
    expect(ranged.items.map((i) => i.questionId).sort()).toEqual(["h1", "h2"]);

    const short = selectItems({
      sections: [{ code: "s", draw: 5, maxPerSkill: 1 }],
      candidates: cvc.slice(0, 3),
      seed: "k",
      maxItems: 40,
    });
    expect(short.shortfalls).toEqual([{ sectionCode: "s", wanted: 5, got: 1 }]);
    expect(
      selectItems({
        sections: [{ code: "s", draw: 6, maxPerSkill: 6 }],
        candidates: cvc,
        seed: "k",
        maxItems: 2,
      }).items,
    ).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------------------
describe("assessment flow (level ladder)", () => {
  const sections = [1, 2, 3, 4, 5].map((rank) => ({ code: `p${rank}`, domain: "PHONICS", rank, items: 3 }));
  const state = (outcomes: FlowState["outcomes"], startRank = 3): FlowState => ({
    rule: "level_ladder",
    startRank,
    passPercent: 75,
    sections: [...sections, { code: "r1", domain: "READING", rank: 1, items: 2 }],
    outcomes,
  });
  const pass = { correct: 3, total: 3 };
  const fail = { correct: 1, total: 3 };

  it("starts near the school grade, climbs while passing and stops at the boundary", () => {
    expect(nextSection(state({}))?.code).toBe("p3");
    expect(nextSection(state({ p3: pass }))?.code).toBe("p4");
    expect(nextSection(state({ p3: pass, p4: fail }))?.code).toBe("r1");
  });

  it("goes down after a failure until a level is passed or the bottom is reached", () => {
    expect(nextSection(state({ p3: fail }))?.code).toBe("p2");
    expect(nextSection(state({ p3: fail, p2: pass }))?.code).toBe("r1");
    expect(nextSection(state({ p3: fail, p2: fail, p1: fail }))?.code).toBe("r1");
    expect(nextSection(state({ p3: fail, p2: fail, p1: fail, r1: pass }))).toBeNull();
  });

  it("serves every section in order without a ladder", () => {
    const s: FlowState = { ...state({}), rule: "none" };
    expect(nextSection(s)?.code).toBe("p1");
    expect(nextSection({ ...s, outcomes: { p1: fail } })?.code).toBe("p2");
  });
});

// ---------------------------------------------------------------------------------------
const item = (over: Partial<SittingItem> & { questionId: string }): SittingItem => ({
  sectionCode: "ph-kg2",
  domain: "PHONICS",
  levelId: "lvl-KG2",
  levelRank: 2,
  skillId: "short-a",
  outcome: "correct",
  credit: 1,
  priorExposures: 0,
  ...over,
});

describe("assessment evidence", () => {
  it("weighs items the child already practised less (contamination)", () => {
    expect(contaminationWeight(0)).toBe(1);
    expect(contaminationWeight(1)).toBe(0.75);
    expect(contaminationWeight(5)).toBe(0.5);
  });

  it("scores sections from observed items: skipped counts as 0, never-reached items are left out", () => {
    const items = [
      item({ questionId: "1" }),
      item({ questionId: "2" }),
      item({ questionId: "3", outcome: "skipped", credit: 0 }),
      item({ questionId: "4", outcome: "unanswered", credit: 0 }),
      item({ questionId: "5", sectionCode: "ph-kg3", levelRank: 3, outcome: "unanswered", credit: 0 }),
    ];
    const [kg2, kg3] = scoreSections(items, 75);
    expect(kg2).toMatchObject({
      served: true,
      items: 3,
      correct: 2,
      skipped: 1,
      percent: 66.67,
      passed: false,
    });
    expect(kg3).toMatchObject({ served: false, items: 0, passed: false });
  });

  it("uses partial credit and contamination in the weighted percentage", () => {
    const items = [
      item({ questionId: "1", credit: 0.5, outcome: "incorrect" }),
      item({ questionId: "2", priorExposures: 4 }),
    ];
    // (0.5 * 1 + 1 * 0.5) / (1 + 0.5) = 66.67
    expect(scoreSections(items, 60)[0]).toMatchObject({ percent: 66.67, passed: true, weight: 1.5 });
  });

  it("calls a skill weak only on enough evidence — one wrong answer is not a gap", () => {
    const one = skillEvidence([item({ questionId: "1", outcome: "incorrect", credit: 0 })]);
    expect(one[0].strength).toBe("weak");
    expect(isAssessmentGap(one[0])).toBe(false);
    const three = skillEvidence([
      item({ questionId: "1", outcome: "incorrect", credit: 0 }),
      item({ questionId: "2", outcome: "incorrect", credit: 0 }),
      item({ questionId: "3" }),
    ]);
    expect(isAssessmentGap(three[0])).toBe(true);
  });

  it("compares a re-check with the earlier sitting", () => {
    const before = skillEvidence([
      item({ questionId: "1", outcome: "incorrect", credit: 0 }),
      item({ questionId: "2", outcome: "incorrect", credit: 0 }),
    ]);
    const after = skillEvidence([
      item({ questionId: "3" }),
      item({ questionId: "4" }),
      item({ questionId: "5", skillId: "sh" }),
    ]);
    expect(compareEvidence(before, after)).toEqual([
      { skillId: "short-a", before: 0, after: 100, change: "improved" },
      { skillId: "sh", before: null, after: 100, change: "new" },
    ]);
  });
});

// ---------------------------------------------------------------------------------------
const fact = (
  skillId: string,
  levelRank: number,
  status: MasteryFact["status"],
  attempts = 10,
  weak = false,
): MasteryFact => ({
  skillId,
  domain: "PHONICS",
  levelRank,
  status,
  masteryScore: status === "MASTERED" ? 95 : status === "ALMOST_MASTERED" ? 80 : 30,
  attempts,
  weak,
});
const readinessInput = (over: Partial<ReadinessInput>): ReadinessInput => ({
  domain: "PHONICS",
  levels: LEVELS,
  defaultRank: 4,
  sections: [],
  evidence: [],
  observedAt: null,
  mastery: [],
  skillTitles: new Map(),
  prerequisites: new Map(),
  now: NOW,
  ...over,
});
const sittingFor = (domain: SittingItem["domain"], results: Record<number, [number, number]>, skills = 3) =>
  Object.entries(results).flatMap(([rank, [right, total]]) =>
    Array.from({ length: total }, (_, i) =>
      item({
        questionId: `${domain}-${rank}-${i}`,
        domain,
        sectionCode: `${domain}-${rank}`,
        levelRank: Number(rank),
        levelId: `lvl-${rank}`,
        skillId: `${domain}-${rank}-skill-${i % skills}`,
        outcome: i < right ? "correct" : "incorrect",
        credit: i < right ? 1 : 0,
      }),
    ),
  );

describe("instructional readiness", () => {
  it("places a domain from the check: secure up to the last passed level, teach the next one", () => {
    const items = sittingFor("PHONICS", { 3: [3, 3], 4: [3, 4], 5: [1, 4] });
    const r = computeReadiness(
      readinessInput({
        sections: scoreSections(items, 75),
        evidence: skillEvidence(items),
        observedAt: NOW.toISOString(),
      }),
    );
    expect(r).toMatchObject({ strongestRank: 4, currentRank: 5, nextRank: null, source: "assessment" });
    expect(r.evidence.assumedBelowRank).toBe(3);
    expect(r.confidence).toBe("HIGH");
  });

  it("keeps domains independent: strong phonics and weak reading are not averaged", () => {
    const phonics = sittingFor("PHONICS", { 4: [4, 4], 5: [1, 4] });
    const reading = sittingFor("READING", { 2: [3, 3], 3: [0, 3] });
    const p = computeReadiness(
      readinessInput({ sections: scoreSections(phonics, 75), observedAt: NOW.toISOString() }),
    );
    const r = computeReadiness(
      readinessInput({
        domain: "READING",
        sections: scoreSections(reading, 75),
        observedAt: NOW.toISOString(),
      }),
    );
    expect([p.currentRank, r.currentRank]).toEqual([5, 3]);
  });

  it("derives confidence from the deciding evidence: amount, skills, consistency, recency", () => {
    const few = sittingFor("PHONICS", { 2: [2, 2] }, 1);
    expect(
      computeReadiness(readinessInput({ sections: scoreSections(few, 75), observedAt: NOW.toISOString() }))
        .confidence,
    ).toBe("LOW");
    const one = sittingFor("PHONICS", { 2: [1, 1] }, 1);
    expect(
      computeReadiness(readinessInput({ sections: scoreSections(one, 75), observedAt: NOW.toISOString() }))
        .confidence,
    ).toBe("INSUFFICIENT");
    const medium = sittingFor("PHONICS", { 2: [3, 3], 3: [1, 3] }, 2);
    expect(
      computeReadiness(readinessInput({ sections: scoreSections(medium, 75), observedAt: NOW.toISOString() }))
        .confidence,
    ).toBe("MEDIUM");
    // A pass above a failure is inconsistent: one step less sure.
    const odd = sittingFor("PHONICS", { 2: [3, 4], 3: [1, 4], 4: [4, 4] });
    const oddR = computeReadiness(
      readinessInput({ sections: scoreSections(odd, 75), observedAt: NOW.toISOString() }),
    );
    expect(oddR.evidence.consistent).toBe(false);
    expect(oddR.confidence).toBe("MEDIUM");
    // Old evidence: one step less sure.
    const old = new Date(NOW.getTime() - 90 * 86400000).toISOString();
    const strong = sittingFor("PHONICS", { 3: [4, 4], 4: [1, 4] });
    expect(
      computeReadiness(readinessInput({ sections: scoreSections(strong, 75), observedAt: old })).confidence,
    ).toBe("MEDIUM");
  });

  it("advances a level through mastery, never through completed lessons alone", () => {
    const secured = [
      fact("a", 4, "MASTERED"),
      fact("b", 4, "MASTERED"),
      fact("c", 4, "ALMOST_MASTERED"),
      fact("d", 4, "MASTERED"),
    ];
    const r = computeReadiness(readinessInput({ mastery: secured }));
    expect(r).toMatchObject({ strongestRank: 4, currentRank: 5, source: "mastery" });
    expect(r.evidence.securedByPractice).toEqual([4]);
    // One weak skill holds the level back; so does too little practice.
    expect(
      computeReadiness(readinessInput({ mastery: [...secured, fact("e", 4, "LEARNING", 10, true)] }))
        .currentRank,
    ).toBe(4);
    expect(
      computeReadiness(readinessInput({ mastery: secured.map((f) => ({ ...f, attempts: 2 })) })).currentRank,
    ).toBe(4);
  });

  it("without evidence teaches at the learning level with INSUFFICIENT confidence", () => {
    expect(computeReadiness(readinessInput({}))).toMatchObject({
      currentRank: 4,
      source: "default",
      confidence: "INSUFFICIENT",
    });
  });

  it("names strengths, needs and prerequisite gaps", () => {
    const items = sittingFor("PHONICS", { 3: [1, 3] }, 1).map((i) => ({ ...i, skillId: "short-vowels" }));
    const r = computeReadiness(
      readinessInput({
        sections: scoreSections(items, 75),
        evidence: skillEvidence(items),
        observedAt: NOW.toISOString(),
        mastery: [fact("long-vowels", 3, "NOT_STARTED", 0)],
        skillTitles: new Map([
          ["short-vowels", "Short vowels"],
          ["long-vowels", "Long vowels"],
        ]),
        prerequisites: new Map([["long-vowels", ["short-vowels"]]]),
      }),
    );
    expect(r.needs[0]).toMatchObject({ skillId: "short-vowels", detail: "1 of 3 right on the check" });
    expect(r.prerequisiteGaps).toEqual([
      { skillId: "short-vowels", title: "Short vowels", forSkillId: "long-vowels", forTitle: "Long vowels" },
    ]);
  });

  it("lets phonics inform reading and spelling (low confidence) without copying mastery", () => {
    const phonics = computeReadiness(
      readinessInput({
        sections: scoreSections(sittingFor("PHONICS", { 3: [3, 3], 4: [1, 4] }, 3), 75),
        observedAt: NOW.toISOString(),
      }),
    );
    const byDomain = new Map([
      ["PHONICS", phonics],
      ["READING", computeReadiness(readinessInput({ domain: "READING", defaultRank: 1 }))],
      ["VOCABULARY", computeReadiness(readinessInput({ domain: "VOCABULARY", defaultRank: 1 }))],
    ] as const);
    const map = new Map(byDomain);
    inferFromPhonics(map);
    expect(map.get("READING")).toMatchObject({ currentRank: 4, source: "inferred", confidence: "LOW" });
    expect(map.get("VOCABULARY")).toMatchObject({ currentRank: 1, source: "default" });
  });
});

// ---------------------------------------------------------------------------------------
describe("mastery does not flip on one answer", () => {
  const day = (d: number, h = 9) => new Date(Date.UTC(2026, 8, d, h)).toISOString();
  const input = (answers: [boolean, string][], masteryThreshold = 95) => ({
    attempts: answers.map(([isCorrect, attemptedAt], i) => ({
      isCorrect,
      attemptedAt,
      id: `a${String(i).padStart(3, "0")}`,
    })),
    // Default: a demanding skill (95), so one slip takes the raw score below its bar.
    masteryThreshold,
    importance: 3,
    now: NOW,
  });
  const masteredHistory: [boolean, string][] = Array.from({ length: 12 }, (_, i) => [
    true,
    day(1 + (i % 3), 9 + i),
  ]);

  it("one right answer is never mastery", () => {
    expect(computeMastery(input([[true, day(1)]])).status).toBe("LEARNING");
  });

  it("keeps MASTERED after one slip, drops after two recent mistakes", () => {
    expect(computeMastery(input(masteredHistory)).status).toBe("MASTERED");
    const oneSlip = computeMastery(input([...masteredHistory, [false, day(5)]]));
    expect(oneSlip.status).toBe("MASTERED");
    expect(oneSlip.masteryScore).toBeLessThan(95);
    expect(computeMastery(input([...masteredHistory, [false, day(5)], [false, day(5, 11)]])).status).not.toBe(
      "MASTERED",
    );
  });

  it("does not oscillate on isolated slips after mastery", () => {
    let history = [...masteredHistory];
    const statuses: string[] = [];
    [false, true, true, true, true, false, true, true, true, true].forEach((ok, i) => {
      history = [...history, [ok, day(6 + i)]];
      statuses.push(computeMastery(input(history, 90)).status);
    });
    expect(new Set(statuses)).toEqual(new Set(["MASTERED"]));
  });

  it("once repeated mistakes drop it, one right answer does not master it again", () => {
    const dropped: [boolean, string][] = [...masteredHistory, [false, day(5)], [false, day(5, 11)]];
    expect(computeMastery(input([...dropped, [true, day(6)]])).status).not.toBe("MASTERED");
  });

  it("is a pure function of the history (order of arrival does not matter)", () => {
    const h: [boolean, string][] = [...masteredHistory, [false, day(5)]];
    expect(computeMastery(input([...h].reverse())).status).toBe(computeMastery(input(h)).status);
  });
});

describe("assessment gaps in the review queue", () => {
  const skill = {
    skillId: "s1",
    lessonId: "l1",
    phonicsPatternId: null,
    active: true,
    status: "PRACTICING" as const,
    masteryScore: 75,
    attempts: 6,
    reviewPriority: 30,
    nextReviewAt: "2026-10-09T00:00:00Z",
    recentErrors: 0,
  };
  it("an open gap makes the skill due now with at least the gap priority", () => {
    expect(deriveSkillReviewItem(skill, NOW)).toMatchObject({ reason: "due_review", priority: 30 });
    expect(deriveSkillReviewItem({ ...skill, assessmentGap: { priority: 80 } }, NOW)).toMatchObject({
      reason: "assessment_gap",
      priority: 80,
      due_at: NOW.toISOString(),
    });
  });
});

// ---------------------------------------------------------------------------------------
describe("adaptive recommendations", () => {
  const lesson = (
    id: string,
    skillId: string,
    domain: AdaptiveLesson["domain"],
    levelRank: number,
    pathOrder: number,
  ): AdaptiveLesson => ({
    lessonId: id,
    title: id,
    emoji: "",
    estimatedMinutes: 5,
    skillId,
    domain,
    levelRank,
    pathOrder,
    subjectName: "",
  });
  const skill = (id: string, over: Partial<AdaptiveSkill> = {}): AdaptiveSkill => ({
    skillId: id,
    title: id,
    domain: "PHONICS",
    levelRank: 3,
    importance: 3,
    status: "NOT_STARTED",
    masteryScore: 0,
    attempts: 0,
    recentErrors: 0,
    ...over,
  });
  const domain = (
    d: AdaptiveDomain["domain"],
    rank: number,
    over: Partial<AdaptiveDomain> = {},
  ): AdaptiveDomain => ({
    domain: d,
    rank,
    confidence: "MEDIUM",
    coverage: 0,
    nextRank: rank < 5 ? rank + 1 : null,
    levelName: `L${rank}`,
    nextLevelName: `L${rank + 1}`,
    ...over,
  });
  const base = (over: Partial<AdaptiveInput> = {}): AdaptiveInput => {
    const lessons = [
      lesson("ph-short", "short-vowels", "PHONICS", 3, 1),
      lesson("ph-long", "long-vowels", "PHONICS", 4, 1),
      lesson("ph-team", "vowel-teams", "PHONICS", 4, 2),
      lesson("rd-story", "decoding", "READING", 2, 1),
      lesson("rd-next", "explicit-info", "READING", 2, 2),
      lesson("ph-g2", "suffixes", "PHONICS", 5, 1),
    ];
    return {
      domains: [domain("PHONICS", 4), domain("READING", 2)],
      lessons,
      lessonStates: new Map(),
      skills: new Map(
        [
          skill("short-vowels", { levelRank: 3, status: "MASTERED", masteryScore: 95, attempts: 20 }),
          skill("long-vowels", { levelRank: 4 }),
          skill("vowel-teams", { levelRank: 4 }),
          skill("decoding", { domain: "READING", levelRank: 2 }),
          skill("explicit-info", { domain: "READING", levelRank: 2 }),
          skill("suffixes", { levelRank: 5 }),
        ].map((s) => [s.skillId, s]),
      ),
      prerequisites: new Map([["long-vowels", ["short-vowels"]]]),
      practiceLesson: new Map(lessons.map((l) => [l.skillId, l])),
      reviews: [],
      gaps: [],
      now: NOW,
      ...over,
    };
  };
  const keys = (input: AdaptiveInput) =>
    recommend(input).map((r) => `${r.priority}:${r.kind}:${r.lessonId ?? r.recheck?.skillId}`);

  it("teaches each domain at its own instructional level (strong phonics, weak reading)", () => {
    const recs = recommend(base());
    expect(recs.filter((r) => r.kind === "target").map((r) => r.lessonId)).toEqual([
      "ph-long",
      "rd-story",
      "ph-team",
      "rd-next",
    ]);
    expect(recs.find((r) => r.lessonId === "rd-story")!.parentMessage).toContain("Reading at L2");
    // Evidence wording for parents, never a statistical-sounding "confidence" (Phase 9.1).
    expect(recs.find((r) => r.lessonId === "rd-story")!.parentMessage).toContain("moderate evidence");
    for (const r of recs) expect(r.parentMessage).not.toMatch(/confidence/i);
  });

  it("repairs a weak prerequisite before the lesson that needs it", () => {
    const input = base();
    (input.skills as Map<string, AdaptiveSkill>).set(
      "short-vowels",
      skill("short-vowels", { levelRank: 3, status: "LEARNING", masteryScore: 35, attempts: 8 }),
    );
    const recs = recommend(input);
    expect(recs[0]).toMatchObject({ kind: "repair", priority: "high", lessonId: "ph-short" });
    expect(recs[0].childMessage).toBe("Let's practise short-vowels first.");
    expect(recs[0].parentMessage).toContain("comes before long-vowels");
  });

  it("never calls a not-yet-learned prerequisite at the same level a gap: the lesson needing it waits", () => {
    // A new child: vowel-teams needs long-vowels, which comes earlier on the same path.
    const input = base({ prerequisites: new Map([["vowel-teams", ["long-vowels"]]]) });
    const recs = recommend(input);
    expect(recs.some((r) => r.kind === "repair")).toBe(false);
    const phonics = recs.filter((r) => r.domain === "PHONICS" && r.kind === "target");
    expect(phonics.map((r) => r.lessonId)).toEqual(["ph-long"]);
    expect(phonics[0].childMessage).toBe("You're ready for something new!");
  });

  it("does not repair a prerequisite the child has only just started", () => {
    const input = base({ prerequisites: new Map([["vowel-teams", ["long-vowels"]]]) });
    (input.skills as Map<string, AdaptiveSkill>).set(
      "long-vowels",
      skill("long-vowels", { levelRank: 4, status: "LEARNING", masteryScore: 50, attempts: 2 }),
    );
    expect(recommend(input).some((r) => r.kind === "repair")).toBe(false);
  });

  it("leads with the deciding reason when a target is upgraded to a repair", () => {
    const input = base({ prerequisites: new Map([["vowel-teams", ["long-vowels"]]]) });
    (input.skills as Map<string, AdaptiveSkill>).set(
      "long-vowels",
      skill("long-vowels", { levelRank: 4, status: "LEARNING", masteryScore: 30, attempts: 8 }),
    );
    const top = recommend(input).find((r) => r.lessonId === "ph-long")!;
    expect(top).toMatchObject({ kind: "repair", priority: "high" });
    expect(top.reasons[0].code).toBe("prerequisite_gap");
    expect(top.childMessage).toBe("Let's practise long-vowels first.");
  });

  it("treats an assessment gap as a blocking prerequisite and an urgent review", () => {
    const input = base({
      gaps: [{ skillId: "short-vowels", percent: 30, attemptsSince: 0, correctSince: 0 }],
      reviews: [
        {
          itemKey: "skill:short",
          skillId: "short-vowels",
          lessonId: "ph-short",
          reason: "assessment_gap",
          priority: 80,
          dueAt: NOW.toISOString(),
        },
      ],
    });
    const top = recommend(input)[0];
    expect(top).toMatchObject({ priority: "high", lessonId: "ph-short" });
    expect(top.reasons.map((r) => r.code).sort()).toEqual(["assessment_gap", "prerequisite_gap"]);
  });

  it("raises repeated recent errors and overdue important skills to high; mastered review is low", () => {
    const input = base({
      reviews: [
        {
          itemKey: "a",
          skillId: "vowel-teams",
          lessonId: "ph-team",
          reason: "recent_errors",
          priority: 50,
          dueAt: NOW.toISOString(),
        },
        {
          itemKey: "b",
          skillId: "short-vowels",
          lessonId: "ph-short",
          reason: "due_review",
          priority: 10,
          dueAt: NOW.toISOString(),
        },
      ],
    });
    const recs = recommend(input);
    expect(recs.find((r) => r.lessonId === "ph-team")).toMatchObject({ priority: "high", kind: "review" });
    expect(recs.find((r) => r.lessonId === "ph-short")).toMatchObject({ priority: "low" });
  });

  it("never offers a mastered skill as new learning, and holds back a lesson just finished", () => {
    const input = base({
      lessonStates: new Map([
        [
          "rd-story",
          {
            status: "IN_PROGRESS" as const,
            lastCompletedAt: new Date(NOW.getTime() - 3600000).toISOString(),
          },
        ],
      ]),
    });
    (input.skills as Map<string, AdaptiveSkill>).set(
      "long-vowels",
      skill("long-vowels", { levelRank: 4, status: "MASTERED", masteryScore: 96, attempts: 30 }),
    );
    const k = keys(input);
    expect(k.some((x) => x.endsWith(":ph-long"))).toBe(false);
    expect(k.some((x) => x.endsWith(":rd-story"))).toBe(false);
  });

  it("suggests a re-check once a gap has been practised with recent success", () => {
    const notYet = keys(
      base({ gaps: [{ skillId: "decoding", percent: 30, attemptsSince: 2, correctSince: 2 }] }),
    );
    expect(notYet.some((k) => k.includes("reassess"))).toBe(false);
    const ready = recommend(
      base({ gaps: [{ skillId: "decoding", percent: 30, attemptsSince: 5, correctSince: 5 }] }),
    );
    expect(ready.find((r) => r.kind === "reassess")).toMatchObject({
      priority: "medium",
      recheck: { assessmentCode: "skill-recheck", skillId: "decoding" },
      childMessage: "Show what you learned!",
    });
  });

  it("adds a stretch only with enough confidence and coverage", () => {
    const low = keys(base({ domains: [domain("PHONICS", 4, { coverage: 0.9, confidence: "LOW" })] }));
    expect(low.some((k) => k.includes("stretch"))).toBe(false);
    const ready = keys(base({ domains: [domain("PHONICS", 4, { coverage: 0.7, confidence: "HIGH" })] }));
    expect(ready).toContain("low:stretch:ph-g2");
  });

  it("is deterministic: the same state gives the same list, whatever the input order", () => {
    const input = base({
      reviews: [
        {
          itemKey: "a",
          skillId: "vowel-teams",
          lessonId: "ph-team",
          reason: "due_review",
          priority: 50,
          dueAt: NOW.toISOString(),
        },
      ],
    });
    const shuffled = {
      ...input,
      lessons: [...input.lessons].reverse(),
      reviews: [...input.reviews].reverse(),
    };
    expect(recommend(shuffled)).toEqual(recommend(input));
    expect(recommend(input)).toEqual(recommend(input));
  });

  it("keeps child messages free of scores and numbers", () => {
    const input = base({
      reviews: [
        {
          itemKey: "a",
          skillId: "vowel-teams",
          lessonId: "ph-team",
          reason: "recent_errors",
          priority: 50,
          dueAt: NOW.toISOString(),
        },
      ],
      gaps: [{ skillId: "decoding", percent: 30, attemptsSince: 5, correctSince: 5 }],
    });
    for (const r of recommend(input)) expect(r.childMessage).not.toMatch(/\d|%/);
  });

  it("uses only the configured number of recommendations", () => {
    expect(recommend(base({ rules: { ...DEFAULT_RULES.adaptive, maxRecommendations: 2 } }))).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------------------
describe("assessment content validation", () => {
  const refs = {
    skills: new Map([
      ["kg1-a", { levelCode: "KG1" }],
      ["kg1-b", { levelCode: "KG1" }],
      ["kg2-a", { levelCode: "KG2" }],
    ]),
    levelCodes: new Set(["KG1", "KG2"]),
    levelRank: (code: string) => (code === "KG1" ? 1 : 2),
    expand: (q: { word?: string; template?: string }) => ({
      type: q.template === "intro" ? "INTRO" : "MULTIPLE_CHOICE",
      content: { word: q.word },
      answer: q.template === "intro" ? null : { accepted: [q.word ?? ""] },
      word: q.word ?? null,
    }),
  };
  const config = (sections: object[], extra: object = {}) => ({
    version: 2,
    childTitle: "Check",
    feedback: "none",
    pool: "authored",
    sections,
    ...extra,
  });
  const stage = (n: number, words: string[], skill = "kg1-a") => ({
    stage: n,
    label: `Part ${n}`,
    skill,
    questions: words.map((word, i) => ({ template: "pick", word, skill: i % 2 ? "kg1-b" : skill })),
  });

  it("accepts valid content and computes item difficulty from the level", () => {
    const r = validateAssessment(
      {
        code: "ok",
        type: "placement",
        config: config([{ code: "s1", label: "A", domain: "PHONICS", level: "KG2", draw: 2 }]),
        stages: [stage(1, ["cat", "dog", "sun"], "kg2-a")],
      },
      refs,
    );
    expect(r.errors).toEqual([]);
    expect(r.result!.items.map((i) => i.difficulty)).toEqual([3, 3, 3]);
  });

  it("finds insufficient pools, duplicates, unknown skills and levels, unassessable types and stray stages", () => {
    const messages = validateAssessment(
      {
        code: "bad",
        type: "placement",
        config: config([
          { code: "s1", label: "A", domain: "PHONICS", level: "KG1", draw: 5 },
          { code: "s2", label: "B", domain: "PHONICS", level: "GRADE9", draw: 1 },
        ]),
        stages: [
          {
            ...stage(1, ["cat", "cat"]),
            questions: [
              { word: "cat" },
              { word: "cat" },
              { word: "x", skill: "nope" },
              { template: "intro", word: "y" },
            ],
          },
          stage(2, ["dog"]),
          stage(7, ["sun"]),
        ],
      },
      refs,
    ).errors.map((e) => e.message);
    const joined = messages.join(" | ");
    expect(joined).toContain("insufficient pool");
    expect(joined).toContain("duplicate of");
    expect(joined).toContain("unknown skill nope");
    expect(joined).toContain("unknown level GRADE9");
    expect(joined).toContain("INTRO cannot be assessed");
    expect(joined).toContain("stage 7 is not part of any section");
  });

  it("warns about one-skill sections, level mismatches and repeated words; rejects stages on dynamic pools", () => {
    const warnings = validateAssessment(
      {
        code: "warn",
        type: "placement",
        config: config([
          { code: "s1", label: "A", domain: "PHONICS", level: "KG1", draw: 2, maxPerSkill: 4 },
        ]),
        stages: [
          {
            stage: 1,
            label: "A",
            skill: "kg2-a",
            questions: [{ word: "cat" }, { word: "cat", template: "b" }, { word: "cat", template: "c" }],
          },
        ],
      },
      refs,
    ).warnings.map((w) => w.message);
    expect(warnings.join(" | ")).toMatch(
      /only one skill.*taught at KG2|taught at KG2.*only one skill|excessive repetition/,
    );
    const dynamic = validateAssessment(
      {
        code: "dyn",
        type: "reassessment",
        config: config([{ code: "r", label: "R", domain: "PHONICS", draw: 3 }], { pool: "skills" }),
        stages: [stage(1, ["a"])],
      },
      refs,
    );
    expect(dynamic.errors[0].message).toContain("remove the stages");
  });

  it("documents item difficulty: level base, task demand, word features", () => {
    expect(itemDifficulty({ levelRank: 1, questionType: "MULTIPLE_CHOICE" })).toBe(1);
    expect(itemDifficulty({ levelRank: 3, questionType: "SPELLING", word: "button" })).toBe(7);
    expect(
      itemDifficulty({ levelRank: 5, questionType: "WORD_BUILDER", irregular: true, word: "because" }),
    ).toBe(10);
    expect(itemDifficulty({ levelRank: 2, questionType: "MULTIPLE_CHOICE", authored: 9 })).toBe(5);
  });
});
