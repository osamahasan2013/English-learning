import { z } from "zod";

// Assessment blueprints (Phase 9, ADR-047): what an assessment measures, from which items,
// how many, with what feedback and when it stops. A blueprint is data — authored in
// content/assessments.json, stored in assessments.config, validated here — so no React
// component or server route hard-codes how an assessment behaves. One engine runs every
// assessment type; the type only names its purpose.

export const DOMAINS = ["PHONICS", "READING", "VOCABULARY", "SPELLING", "WRITING"] as const;
export type Domain = (typeof DOMAINS)[number];

// Curriculum subjects → the domain they teach. Sentence building is part of writing; the
// GAMES and ASSESSMENT subjects teach no domain of their own.
export const SUBJECT_DOMAIN: Readonly<Record<string, Domain>> = {
  PHONICS: "PHONICS",
  LETTERS: "PHONICS",
  BLENDING: "PHONICS",
  READING: "READING",
  SIGHT_WORDS: "READING",
  LISTENING: "READING",
  VOCABULARY: "VOCABULARY",
  SPELLING: "SPELLING",
  WRITING: "WRITING",
  SENTENCES: "WRITING",
  SENTENCE_BUILDING: "WRITING",
};

export const DOMAIN_NAMES: Readonly<Record<Domain, string>> = {
  PHONICS: "Phonics",
  READING: "Reading",
  VOCABULARY: "Vocabulary",
  SPELLING: "Spelling",
  WRITING: "Writing",
};

export const ASSESSMENT_TYPES = [
  "placement",
  "diagnostic",
  "progress_check",
  "skill_check",
  "reassessment",
  "end_of_unit",
  "review_check",
] as const;
export type AssessmentType = (typeof ASSESSMENT_TYPES)[number];

// What the child sees after an answer: nothing but "next" (placement, diagnostic — evidence
// must not be contaminated by the answer), a neutral "thank you" (progress checks), or the
// normal lesson feedback (skill and review checks, where learning from the answer is fine).
export const FEEDBACK_MODES = ["none", "encourage", "full"] as const;
export type FeedbackMode = (typeof FEEDBACK_MODES)[number];

// Where a section's items come from:
//   authored — the assessment's own items (assessment_items, one stage per section);
//   skills   — published lesson questions of the skills in the sitting's scope (re-assessment);
//   unit     — published lesson questions of a unit's skills (end of unit);
//   review   — published questions of the child's due review skills (review check);
//   level    — published questions of the domain's skills at the child's instructional level
//              (progress check, diagnostic).
export const ITEM_POOLS = ["authored", "skills", "unit", "review", "level"] as const;
export type ItemPool = (typeof ITEM_POOLS)[number];

const code = z.string().regex(/^[a-z0-9-]{1,40}$/);
const levelCode = z.string().regex(/^[A-Z0-9_]{2,20}$/);
const skillCode = z.string().regex(/^[a-z0-9-]{2,80}$/);
const difficulty = z.number().int().min(1).max(10);

export const blueprintSectionSchema = z
  .object({
    code,
    label: z.string().trim().min(1).max(60),
    domain: z.enum(DOMAINS),
    // The level this section's items represent. Dynamic pools may leave it out: the
    // domain's instructional level is used when the sitting starts.
    level: levelCode.optional(),
    // Authored pools: the content stage holding the items (default: section number).
    stage: z.number().int().min(1).max(60).optional(),
    // Items drawn for one sitting, at most maxPerSkill per skill.
    draw: z.number().int().min(1).max(20),
    maxPerSkill: z.number().int().min(1).max(20).default(2),
    // Preferred item difficulty (inclusive); relaxed when too few items qualify.
    difficulty: z.tuple([difficulty, difficulty]).optional(),
    // Dynamic pools: only these skills (codes).
    skills: z.array(skillCode).max(20).optional(),
  })
  .strict();
export type BlueprintSection = z.infer<typeof blueprintSectionSchema>;

export const blueprintSchema = z
  .object({
    version: z.literal(2),
    childTitle: z.string().trim().min(1).max(60),
    emoji: z.string().max(8).default("🎯"),
    // Report key for a domain-specific parent view (e.g. "phonics").
    report: z.string().max(40).optional(),
    feedback: z.enum(FEEDBACK_MODES),
    // "I don't know" is offered (an honest skip is evidence too, and less stressful than a guess).
    allowSkip: z.boolean().default(true),
    pool: z.enum(ITEM_POOLS).default("authored"),
    sections: z.array(blueprintSectionSchema).min(1).max(60),
    // level_ladder: per domain, start near the school grade (startOffset levels below), go up
    // a level after a passed section and down after a failed one, stop at the boundary — a
    // young child is never walked through every level. none: every drawn item, in order.
    stopping: z
      .object({
        rule: z.enum(["none", "level_ladder"]),
        startOffset: z.number().int().min(-4).max(2).default(-1),
      })
      .strict()
      .default({ rule: "none", startOffset: -1 }),
    // Section pass mark (weighted %); default: the assessment rules' sectionPassPercent.
    passPercent: z.number().min(1).max(100).optional(),
    maxItems: z.number().int().min(1).max(120).default(40),
    // A break screen every N items (0 = none).
    breakEvery: z.number().int().min(0).max(30).default(8),
    // An abandoned or expired sitting still produces a (partial, low-confidence) result.
    allowPartial: z.boolean().default(false),
    expiresAfterHours: z
      .number()
      .int()
      .min(1)
      .max(24 * 60)
      .optional(),
    // Weak skills found become assessment_gap review items.
    reviewGaps: z.boolean().default(true),
  })
  .strict()
  .superRefine((b, ctx) => {
    const codes = new Set<string>();
    b.sections.forEach((s, i) => {
      if (codes.has(s.code))
        ctx.addIssue({
          code: "custom",
          path: ["sections", i, "code"],
          message: `duplicate section "${s.code}"`,
        });
      codes.add(s.code);
      if (b.pool === "authored" && !s.level)
        ctx.addIssue({
          code: "custom",
          path: ["sections", i, "level"],
          message: "an authored section needs the level its items represent",
        });
      if (s.difficulty && s.difficulty[0] > s.difficulty[1])
        ctx.addIssue({
          code: "custom",
          path: ["sections", i, "difficulty"],
          message: "difficulty range is reversed",
        });
      if (s.maxPerSkill * (s.skills?.length || 20) < s.draw && s.skills)
        ctx.addIssue({
          code: "custom",
          path: ["sections", i, "draw"],
          message: `cannot draw ${s.draw} items from ${s.skills.length} skill(s) at ${s.maxPerSkill} per skill`,
        });
    });
    if (b.stopping.rule === "level_ladder" && b.sections.some((s) => !s.level))
      ctx.addIssue({
        code: "custom",
        path: ["stopping"],
        message: "the level ladder needs a level on every section",
      });
  });
export type Blueprint = z.infer<typeof blueprintSchema>;

export const domainsOf = (b: Blueprint): Domain[] => [...new Set(b.sections.map((s) => s.domain))];
export const sectionStage = (b: Blueprint, s: BlueprintSection) => s.stage ?? b.sections.indexOf(s) + 1;

// A blueprint for assessments stored before Phase 9 (stage-based configs): every authored
// item, grouped by its stage, with full feedback — what those sittings always did.
export function legacyBlueprint(
  title: string,
  stages: { stage: number; label: string; count: number; domain: Domain | null; level: string | null }[],
): Blueprint {
  return blueprintSchema.parse({
    version: 2,
    childTitle: title.slice(0, 60) || "Check",
    feedback: "full",
    allowSkip: false,
    pool: "authored",
    sections: stages.map((s) => ({
      code: `stage-${s.stage}`,
      label: s.label.slice(0, 60) || `Part ${s.stage}`,
      domain: s.domain ?? "PHONICS",
      level: s.level ?? "KG1",
      stage: s.stage,
      draw: Math.max(1, Math.min(20, s.count)),
      maxPerSkill: 20,
    })),
    maxItems: 120,
    breakEvery: 0,
  });
}

// Parses a stored config; null when it is not a Phase 9 blueprint (the caller then builds
// the legacy one from the items).
export function parseBlueprint(config: unknown): Blueprint | null {
  const parsed = blueprintSchema.safeParse(config);
  return parsed.success ? parsed.data : null;
}
