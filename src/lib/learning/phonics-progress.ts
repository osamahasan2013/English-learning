import type { MasteryStatus } from "@/lib/learning/mastery";
import { combinedStars, masteryStars } from "@/lib/learning/phonics";

// Phonics progress as children and parents see it, from the ordinary skill mastery rows
// (the Phonics Engine has no mastery of its own). Children see stars and "practise TH";
// parents see percentages. Pure: loaded by src/lib/server/phonics.ts.

export type PhonicsSkillFact = {
  skillId: string;
  code: string;
  title: string;
  stageCode: string;
  // The pattern the skill teaches, as a child reads it ("sh", "a–e", "Aa").
  patternLabel: string | null;
  emoji: string;
  lessonId: string | null;
  status: MasteryStatus;
  masteryScore: number;
  reviewPriority: number;
  sortOrder: number;
};

export type PhonicsStageFact = {
  code: string;
  name: string;
  childName: string;
  emoji: string;
  sortOrder: number;
};

export type PhonicsSkillView = PhonicsSkillFact & { stars: 0 | 1 | 2 | 3 };

export type PhonicsStageView = PhonicsStageFact & {
  stars: 0 | 1 | 2 | 3;
  started: number;
  mastered: number;
  // Average mastery of all the stage's skills (not started = 0), for parents.
  percent: number;
  skills: PhonicsSkillView[];
};

// The child's Phonics screen sections, in teaching order.
export const PHONICS_SECTIONS = [
  { key: "letters", title: "Letters", emoji: "🔤", stages: ["LETTERS", "LETTER_SOUNDS"] },
  {
    key: "sounds",
    title: "Sounds",
    emoji: "🔊",
    stages: ["BEGINNING_SOUNDS", "ENDING_SOUNDS", "SHORT_VOWELS"],
  },
  { key: "blend", title: "Blend", emoji: "🧩", stages: ["CVC", "BLENDING"] },
  {
    key: "read",
    title: "Read Words",
    emoji: "📚",
    stages: [
      "DIGRAPHS",
      "CONSONANT_BLENDS",
      "LONG_VOWELS",
      "VOWEL_TEAMS",
      "R_CONTROLLED",
      "WORD_ENDINGS",
      "ADVANCED",
    ],
  },
] as const;
export type PhonicsSectionKey = (typeof PHONICS_SECTIONS)[number]["key"] | "practice" | "mastery";

export function summarizeStages(stages: PhonicsStageFact[], skills: PhonicsSkillFact[]): PhonicsStageView[] {
  return [...stages]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((stage) => {
      const mine = skills
        .filter((s) => s.stageCode === stage.code)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((s) => ({ ...s, stars: masteryStars(s.status) }));
      const { stars, started } = combinedStars(mine.map((s) => s.status));
      const percent = mine.length
        ? Math.round(
            mine.reduce((n, s) => n + (s.status === "NOT_STARTED" ? 0 : s.masteryScore), 0) / mine.length,
          )
        : 0;
      return {
        ...stage,
        stars,
        started,
        mastered: mine.filter((s) => s.status === "MASTERED").length,
        percent,
        skills: mine,
      };
    })
    .filter((s) => s.skills.length > 0);
}

// What to practise next: started skills that are not mastered yet, the most urgent
// first. Never includes numbers — the child sees "Practise TH".
export function practiceSuggestions(skills: PhonicsSkillFact[], limit = 4): PhonicsSkillFact[] {
  return skills
    .filter((s) => s.status !== "NOT_STARTED" && s.status !== "MASTERED" && s.lessonId)
    .sort(
      (a, b) =>
        b.reviewPriority - a.reviewPriority || a.masteryScore - b.masteryScore || a.sortOrder - b.sortOrder,
    )
    .slice(0, limit);
}

// The next phonics skill to start: the first not-started skill in teaching order.
export function nextPhonicsSkill(stages: PhonicsStageView[]): PhonicsSkillView | null {
  for (const stage of stages)
    for (const s of stage.skills) if (s.status === "NOT_STARTED" && s.lessonId) return s;
  return null;
}
