import { describe, expect, it } from "vitest";
import { recommend, type AdaptiveRecommendation } from "@/lib/learning/adaptive";
import { DOMAINS } from "@/lib/learning/assessment-blueprint";
import { buildDailyPlan, type PlanItem } from "@/lib/learning/daily-plan";
import {
  answerTrend,
  assessmentStatus,
  attentionNotes,
  buildParentDashboard,
  childHref,
  countsText,
  DOMAIN_STATE_TEXT,
  domainSnapshot,
  homeGuidance,
  isStartPath,
  levelLines,
  PARENT_MASTERY_TEXT,
  practiceView,
  recentLearning,
  strengthsAndNeeds,
  todayView,
  TREND_MIN_PER_HALF,
  trendText,
  type ParentReadiness,
  type ParentSkill,
  type TrendPoint,
} from "@/lib/parent/view-model";

// Phase 10 — the parent presentation read-model. It must only reword what the engines
// computed: these tests pin its labels, its deterministic summaries, its empty states and
// that it never produces misleading wording.

const UUID = "11111111-2222-3333-4444-555555555555";

function rec(
  over: Partial<AdaptiveRecommendation> & Pick<AdaptiveRecommendation, "key">,
): AdaptiveRecommendation {
  return {
    kind: "target",
    priority: "medium",
    lessonId: UUID,
    title: "Lesson",
    emoji: "📘",
    domain: "PHONICS",
    skillId: "s1",
    minutes: 5,
    recheck: null,
    reasons: [{ code: "target" }],
    childMessage: "You're ready for something new!",
    parentMessage: "Next lesson for Phonics at Kindergarten 3.",
    ...over,
  };
}

function skill(over: Partial<ParentSkill> & Pick<ParentSkill, "skillId">): ParentSkill {
  return {
    title: over.skillId,
    domain: "PHONICS",
    status: "LEARNING",
    masteryScore: 40,
    attempts: 5,
    lastPracticedAt: "2026-10-10T10:00:00Z",
    ...over,
  };
}

function readiness(over: Partial<ParentReadiness> = {}): ParentReadiness[] {
  return DOMAINS.map((domain) => ({
    domain,
    name: domain[0] + domain.slice(1).toLowerCase(),
    teachingLevelName: "Kindergarten 3",
    confidence: "INSUFFICIENT",
    confident: false,
    source: "default",
    strengths: [],
    needs: [],
    ...over,
  }));
}

const points = (pattern: boolean[], start = Date.parse("2026-09-01T00:00:00Z")): TrendPoint[] =>
  pattern.map((correct, i) => ({ at: new Date(start + i * 3600_000).toISOString(), correct }));

describe("parent wording", () => {
  it("maps mastery to parent words", () => {
    expect(PARENT_MASTERY_TEXT.MASTERED.meaning).toBe("Consistently demonstrates this skill");
    expect(PARENT_MASTERY_TEXT.LEARNING.meaning).toBe("Still developing this skill");
    expect(PARENT_MASTERY_TEXT.NOT_STARTED.label).toBe("Not started");
  });

  it("names the evidence states the brief asks for", () => {
    expect(DOMAIN_STATE_TEXT.NOT_ENOUGH_EVIDENCE.label).toBe("Not enough evidence yet");
    expect(DOMAIN_STATE_TEXT.LIMITED_EVIDENCE.label).toBe("Limited evidence");
    expect(DOMAIN_STATE_TEXT.NEEDS_REVIEW.label).toBe("Needs review");
    expect(DOMAIN_STATE_TEXT.MASTERED.help).toMatch(/currently mastered/);
  });

  it("never uses misleading or unsupported claims", () => {
    const texts = [
      ...Object.values(PARENT_MASTERY_TEXT).flatMap((t) => [t.label, t.meaning]),
      ...Object.values(DOMAIN_STATE_TEXT).flatMap((t) => [t.label, t.help]),
      ...DOMAINS.map((domain) => homeGuidance({ domain, title: "sh", reasons: [{ code: "target" }] })),
      trendText(
        answerTrend(
          points(
            Array(40)
              .fill(false)
              .map((_, i) => i >= 20),
          ),
        ),
      ),
      trendText(
        answerTrend(
          points(
            Array(40)
              .fill(true)
              .map((_, i) => i < 20),
          ),
        ),
      ),
      trendText(answerTrend([])),
    ].join(" ");
    for (const banned of [
      /\bbehind\b/i,
      /above grade/i,
      /below grade/i,
      /\bwpm\b/i,
      /words per minute/i,
      /\bAI\b/,
      /\bIQ\b/,
      /pronunciation score/i,
      /creative/i,
      /fail/i,
    ])
      expect(texts).not.toMatch(banned);
  });
});

describe("domainSnapshot", () => {
  it("no answers → Not enough evidence yet", () => {
    const d = domainSnapshot({
      domain: "READING",
      skills: [skill({ skillId: "p", domain: "PHONICS" })],
      recommendations: [],
    });
    expect(d.state).toBe("NOT_ENOUGH_EVIDENCE");
    expect(d.practised).toBe(0);
  });

  it("answers but no skill practised enough to judge → Limited evidence", () => {
    const d = domainSnapshot({
      domain: "PHONICS",
      skills: [skill({ skillId: "a", attempts: 2 }), skill({ skillId: "b", attempts: 3 })],
      recommendations: [],
      minAttempts: 4,
    });
    expect(d.state).toBe("LIMITED_EVIDENCE");
    expect(d.answers).toBe(5);
  });

  it("an adaptive review or repair in the area → Needs review (low-priority maintenance does not count)", () => {
    const skills = [skill({ skillId: "a", status: "MASTERED", attempts: 10 })];
    const review = rec({
      key: "r",
      kind: "review",
      priority: "high",
      reasons: [{ code: "weak_skill", skillTitle: "sh" }],
    });
    const maintenance = rec({
      key: "m",
      kind: "review",
      priority: "low",
      reasons: [{ code: "maintenance", skillTitle: "ch" }],
    });
    expect(domainSnapshot({ domain: "PHONICS", skills, recommendations: [maintenance] }).state).toBe(
      "MASTERED",
    );
    const d = domainSnapshot({ domain: "PHONICS", skills, recommendations: [maintenance, review] });
    expect(d.state).toBe("NEEDS_REVIEW");
    expect(d.toReview).toEqual(["sh"]);
    // Another area's review does not touch this one.
    expect(
      domainSnapshot({ domain: "PHONICS", skills, recommendations: [{ ...review, domain: "READING" }] })
        .state,
    ).toBe("MASTERED");
  });

  it("otherwise the status most judged skills hold, ties going to the lower status", () => {
    const skills = [
      skill({ skillId: "a", status: "MASTERED", attempts: 8 }),
      skill({ skillId: "b", status: "LEARNING", attempts: 8 }),
      skill({ skillId: "c", status: "MASTERED", attempts: 1 }), // not judged
    ];
    const d = domainSnapshot({ domain: "PHONICS", skills, recommendations: [] });
    expect(d.state).toBe("LEARNING");
    expect(d.counts).toMatchObject({ MASTERED: 2, LEARNING: 1 });
    expect(countsText(d.counts)).toBe("2 mastered · 1 learning");
  });

  it("is deterministic (same input, same output)", () => {
    const skills = [skill({ skillId: "a", status: "PRACTICING", attempts: 6 })];
    expect(domainSnapshot({ domain: "PHONICS", skills, recommendations: [] })).toEqual(
      domainSnapshot({ domain: "PHONICS", skills: [...skills], recommendations: [] }),
    );
  });
});

describe("answerTrend (presentation only)", () => {
  it("never shows a trend from one data point or a handful of answers", () => {
    expect(answerTrend(points([true])).kind).toBe("insufficient");
    expect(answerTrend(points(Array(2 * TREND_MIN_PER_HALF - 1).fill(true))).kind).toBe("insufficient");
    expect(trendText(answerTrend(points([true])))).toMatch(/Not enough answers yet/);
  });

  it("up, steady and down compare the earlier and the recent half", () => {
    const up = answerTrend(points([...Array(10).fill(false), ...Array(10).fill(true)]));
    expect(up).toMatchObject({
      kind: "up",
      earlier: { correct: 0, total: 10 },
      recent: { correct: 10, total: 10 },
    });
    expect(answerTrend(points(Array(20).fill(true))).kind).toBe("steady");
    expect(answerTrend(points([...Array(10).fill(true), ...Array(10).fill(false)])).kind).toBe("down");
    // A change under 10 points is "steady" (one answer of 20 is 5 points); 10 points is not.
    const nearly = Array(40).fill(true);
    nearly[39] = false;
    expect(answerTrend(points(nearly)).kind).toBe("steady");
    const ten = Array(20).fill(true);
    ten[19] = false;
    expect(answerTrend(points(ten)).kind).toBe("down");
  });

  it("uses only the latest answers, in time order whatever the input order", () => {
    const old = points(Array(40).fill(false), Date.parse("2026-08-01T00:00:00Z"));
    const recent = points(
      [...Array(20).fill(false), ...Array(20).fill(true)],
      Date.parse("2026-09-01T00:00:00Z"),
    );
    const t = answerTrend([...recent, ...old].reverse());
    expect(t).toMatchObject({ kind: "up", answers: 40 });
  });
});

describe("today, practice and Start targets — all from adaptive.ts", () => {
  const recs = [
    rec({
      key: "lesson:a",
      kind: "repair",
      priority: "high",
      title: "S sound",
      parentMessage: "s comes first.",
    }),
    rec({ key: "lesson:b", title: "Next", domain: "READING" }),
    rec({ key: "lesson:c", kind: "stretch", priority: "low", domain: "WRITING" }),
    rec({ key: "lesson:d" }),
    rec({ key: "lesson:e" }),
    rec({ key: "lesson:f" }),
  ];

  it("today keeps the plan's order and minutes and adds each item's parent reason", () => {
    const plan: PlanItem[] = buildDailyPlan({ dailyMinutes: 15, recommendations: recs });
    const today = todayView(plan, recs);
    expect(today.items.map((i) => i.key)).toEqual(plan.map((p) => p.key));
    expect(today.items[0]).toMatchObject({
      reason: "s comes first.",
      kindLabel: "Practise first",
      priorityLabel: "Do first",
    });
    expect(today.minutes).toBe(plan.reduce((n, p) => n + p.minutes, 0));
    expect(today.nothingUrgent).toBe(false);
  });

  it('says "Nothing urgent right now" only when no recommendation is high priority', () => {
    expect(todayView([], recs.slice(1)).nothingUrgent).toBe(true);
    expect(todayView([], []).items).toEqual([]);
  });

  it("practice = the top recommendation, then up to four options, then the rest, in adaptive order", () => {
    const p = practiceView(recs);
    expect(p.top?.key).toBe("lesson:a");
    expect(p.options.map((o) => o.key)).toEqual(["lesson:b", "lesson:c", "lesson:d", "lesson:e"]);
    expect(p.later.map((o) => o.key)).toEqual(["lesson:f"]);
    expect(practiceView([]).top).toBeNull();
  });

  it("matches the real engine's output order exactly (no second ranking)", () => {
    const real = recommend({
      domains: [
        {
          domain: "PHONICS",
          rank: 1,
          confidence: "LOW",
          coverage: 0,
          nextRank: null,
          levelName: "KG1",
          nextLevelName: null,
        },
      ],
      lessons: [1, 2, 3].map((i) => ({
        lessonId: `0000000${i}-0000-0000-0000-000000000000`,
        title: `L${i}`,
        emoji: "",
        estimatedMinutes: 5,
        skillId: `s${i}`,
        domain: "PHONICS" as const,
        levelRank: 1,
        pathOrder: i,
        subjectName: "Phonics",
      })),
      lessonStates: new Map(),
      skills: new Map(),
      prerequisites: new Map(),
      practiceLesson: new Map(),
      reviews: [],
      gaps: [],
      now: new Date("2026-10-17T12:00:00Z"),
    });
    const p = practiceView(real);
    expect([p.top, ...p.options, ...p.later].map((x) => x!.key)).toEqual(real.map((r) => r.key));
  });

  it("Start leads only to a lesson or a re-check in child mode", () => {
    expect(childHref({ lessonId: UUID, recheck: null })).toBe(`/child/learn/${UUID}`);
    expect(childHref({ lessonId: null, recheck: { assessmentCode: "skill-recheck", skillId: UUID } })).toBe(
      `/child/check/skill-recheck?skill=${UUID}`,
    );
    expect(childHref({ lessonId: null, recheck: null })).toBeNull();
    expect(isStartPath(`/child/learn/${UUID}`)).toBe(true);
    expect(isStartPath(`/child/check/skill-recheck?skill=${UUID}`)).toBe(true);
    for (const bad of [
      "/parent/dashboard",
      "/admin/dashboard",
      "https://evil.example/child/learn/x",
      `//evil.example/child/learn/${UUID}`,
      `/child/learn/${UUID}/../../admin`,
      `/child/learn/${UUID}?next=https://evil.example`,
      "/child/home",
    ])
      expect(isStartPath(bad)).toBe(false);
  });

  it("home guidance is tied to the area and the skill; phonics is about sounds, not letter names", () => {
    const phonics = homeGuidance({
      domain: "PHONICS",
      title: "Lesson",
      reasons: [{ code: "weak_skill", skillTitle: "sh" }],
    });
    expect(phonics).toContain("“sh”");
    expect(phonics).toMatch(/the sound, not the letter name/);
    expect(homeGuidance({ domain: "SPELLING", title: "CVC words", reasons: [{ code: "target" }] })).toContain(
      "CVC words",
    );
    expect(homeGuidance({ domain: null, title: "x", reasons: [{ code: "continue" }] })).toMatch(
      /regular practice/,
    );
  });
});

describe("levels, strengths and needs, recent learning, checks, attention", () => {
  it('"Learning at" per area with its evidence label — five lines, never one collapsed level', () => {
    const lines = levelLines(
      readiness().map((r) =>
        r.domain === "READING"
          ? { ...r, teachingLevelName: "Grade 1", confidence: "HIGH", confident: true, source: "assessment" }
          : r,
      ),
    );
    expect(lines).toHaveLength(5);
    expect(lines.find((l) => l.domain === "READING")).toMatchObject({
      learningAt: "Grade 1",
      evidence: "Strong evidence",
      fromEvidence: true,
    });
    expect(lines.find((l) => l.domain === "PHONICS")).toMatchObject({
      evidence: "Not enough evidence yet",
      fromEvidence: false,
    });
  });

  it("needs follow the adaptive order, skip low priority, dedupe, and add check needs after", () => {
    const r = readiness().map((x) =>
      x.domain === "SPELLING"
        ? { ...x, needs: [{ skillId: "n1", title: "Vowel teams", detail: "2 of 5 on the check" }] }
        : x,
    );
    const { needs, strengths } = strengthsAndNeeds({
      readiness: r,
      skills: [skill({ skillId: "m", title: "Letter a", status: "MASTERED" })],
      recommendations: [
        rec({
          key: "1",
          kind: "repair",
          priority: "high",
          reasons: [{ code: "prerequisite_gap", skillTitle: "s" }],
        }),
        rec({
          key: "2",
          kind: "review",
          priority: "low",
          reasons: [{ code: "maintenance", skillTitle: "old" }],
        }),
        rec({
          key: "3",
          kind: "review",
          priority: "medium",
          reasons: [{ code: "due_review", skillTitle: "S" }],
        }),
        rec({ key: "4", kind: "target" }),
      ],
    });
    expect(needs.map((n) => n.title)).toEqual(["s", "Vowel teams"]);
    expect(strengths).toEqual([
      { title: "Letter a", domainName: "Phonics", why: "Consistently demonstrates this skill" },
    ]);
  });

  it("recent learning lists finished lessons and finished checks only, newest first", () => {
    const items = recentLearning(
      [
        {
          id: "r1",
          title: "The sh sound",
          emoji: "🐚",
          completedAt: "2026-10-10T10:00:00Z",
          correct: 4,
          total: 5,
        },
      ],
      [
        {
          id: "c1",
          title: "Find My Level",
          type: "placement",
          status: "completed",
          startedAt: "2026-10-11T09:00:00Z",
          completedAt: "2026-10-11T09:20:00Z",
        },
        {
          id: "c2",
          title: "Phonics Check",
          type: "diagnostic",
          status: "abandoned",
          startedAt: "2026-10-12T09:00:00Z",
          completedAt: null,
        },
        {
          id: "c3",
          title: "Phonics Check",
          type: "diagnostic",
          status: "in_progress",
          startedAt: "2026-10-13T09:00:00Z",
          completedAt: null,
        },
      ],
    );
    expect(items.map((i) => i.title)).toEqual(["Find My Level", "The sh sound"]);
    expect(items[1].detail).toBe("Lesson finished · 4 of 5 right first time");
  });

  it("check status: never a grade; no check yet says so", () => {
    expect(assessmentStatus({ history: [], waiting: 0 })).toMatchObject({
      latest: null,
      placementDone: false,
    });
    expect(assessmentStatus({ history: [], waiting: 0 }).message).toMatch(/No check yet/);
    const s = assessmentStatus({
      history: [
        {
          id: "1",
          title: "Find My Level",
          type: "placement",
          status: "completed",
          startedAt: "2026-10-01T00:00:00Z",
          completedAt: "2026-10-01T00:30:00Z",
        },
      ],
      waiting: 1,
    });
    expect(s).toMatchObject({ latest: { title: "Find My Level" }, placementDone: true, waiting: 1 });
    expect(s.message).toMatch(/not a school grade/);
  });

  it("attention notes are lightweight, neutral and link to the child's own pages", () => {
    const notes = attentionNotes({
      childName: "Maya",
      childId: UUID,
      waitingChecks: 1,
      recommendations: [rec({ key: "x", priority: "high" })],
      lessonsCompleted: 3,
      activeDaysThisWeek: 0,
      placementDone: false,
      hasEvidence: false,
    });
    expect(notes.map((n) => n.key)).toEqual(["check-waiting", "do-first", "quiet-week", "find-level"]);
    for (const n of notes) if (n.href) expect(n.href).toContain(`child=${UUID}`);
    expect(notes.map((n) => n.text).join(" ")).not.toMatch(/behind|worry|alert|warning/i);
  });
});

describe("buildParentDashboard", () => {
  it("a brand-new child: truthful empty states everywhere", () => {
    const view = buildParentDashboard({
      childId: UUID,
      childName: "Maya",
      readiness: readiness(),
      recommendations: [],
      plan: [],
      skills: [],
      runs: [],
      history: [],
      waitingChecks: 0,
      lessonsCompleted: 0,
      activeDaysThisWeek: 0,
    });
    expect(view.hasEvidence).toBe(false);
    expect(view.today).toEqual({ items: [], minutes: 0, nothingUrgent: true });
    expect(view.next).toBeNull();
    expect(view.recent).toEqual([]);
    expect(view.domains.map((d) => d.state)).toEqual(Array(5).fill("NOT_ENOUGH_EVIDENCE"));
    expect(view.strengths).toEqual([]);
    expect(view.needs).toEqual([]);
    expect(view.attention.map((a) => a.key)).toEqual(["find-level"]);
  });

  it("keeps each child's data apart: the view depends only on that child's inputs", () => {
    const base = {
      readiness: readiness(),
      plan: [],
      runs: [],
      history: [],
      waitingChecks: 0,
      lessonsCompleted: 0,
      activeDaysThisWeek: 0,
    };
    const a = buildParentDashboard({
      ...base,
      childId: UUID,
      childName: "A",
      recommendations: [rec({ key: "a" })],
      skills: [skill({ skillId: "a", status: "MASTERED", attempts: 9 })],
    });
    const b = buildParentDashboard({
      ...base,
      childId: UUID.replace("1", "9"),
      childName: "B",
      recommendations: [],
      skills: [],
    });
    expect(a.next?.key).toBe("a");
    expect(b.next).toBeNull();
    expect(b.domains[0].state).toBe("NOT_ENOUGH_EVIDENCE");
    expect(a.domains[0].state).toBe("MASTERED");
  });
});
