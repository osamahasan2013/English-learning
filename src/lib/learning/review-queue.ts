import type { MasteryStatus } from "@/lib/learning/mastery";
import { DEFAULT_RULES, type ReviewRules } from "@/lib/learning/rules";

// The review queue (foundation; no spaced-repetition algorithm yet). Rules:
//   * every practised, active skill has one open item, due at its next review date;
//     weak skills and skills with recent mistakes are due now;
//   * words: missed, weak or saved-and-due words (deriveWordReview in vocabulary.ts);
//   * spelling: words missed or weak when spelled and phonics patterns often misspelled
//     (deriveSpellingReview / derivePatternReview in spelling.ts);
//   * items that no longer apply are resolved, not deleted.
// Priority 0–100 (higher first) reuses the skill's review priority from mastery.ts.

export type ReviewReason =
  | "weak_skill"
  | "due_review"
  | "recent_errors"
  | "missed_word"
  | "weak_word"
  // Spelling (spelling.ts): a word missed or weak when spelled, a pattern often misspelled.
  | "missed_spelling"
  | "weak_spelling"
  | "spelling_pattern";

export type SkillReviewInput = {
  skillId: string;
  lessonId: string | null;
  phonicsPatternId: string | null;
  active: boolean;
  status: MasteryStatus;
  masteryScore: number;
  attempts: number;
  reviewPriority: number;
  nextReviewAt: string | null;
  // Wrong answers among the latest five first tries.
  recentErrors: number;
};

export type ReviewItemRow = {
  item_key: string;
  skill_id: string | null;
  word_id: string | null;
  phonics_pattern_id: string | null;
  lesson_id: string | null;
  priority: number;
  due_at: string;
  reason: ReviewReason;
  status: "open";
  resolved_at: null;
};

export const skillKey = (skillId: string) => `skill:${skillId}`;
export const wordKey = (wordId: string) => `word:${wordId}`;

const RECENT_ERRORS_FOR_REVIEW = 2;

export function deriveSkillReviewItem(
  skill: SkillReviewInput,
  now: Date,
  rules: ReviewRules = DEFAULT_RULES.review,
): ReviewItemRow | null {
  if (!skill.active || skill.attempts === 0 || skill.status === "NOT_STARTED") return null;
  const weak = skill.attempts >= rules.minAttempts && skill.masteryScore < rules.weakBelowScore;
  const reason: ReviewReason = weak
    ? "weak_skill"
    : skill.recentErrors >= RECENT_ERRORS_FOR_REVIEW
      ? "recent_errors"
      : "due_review";
  const due = reason === "due_review" && skill.nextReviewAt ? skill.nextReviewAt : now.toISOString();
  return {
    item_key: skillKey(skill.skillId),
    skill_id: skill.skillId,
    word_id: null,
    phonics_pattern_id: skill.phonicsPatternId,
    lesson_id: skill.lessonId,
    priority: Math.round(skill.reviewPriority * 100) / 100,
    due_at: due,
    reason,
    status: "open",
    resolved_at: null,
  };
}

export type ReviewItemSummary = {
  itemKey: string;
  skillId: string | null;
  wordId: string | null;
  lessonId: string | null;
  priority: number;
  dueAt: string;
  reason: ReviewReason;
  status: "open" | "done";
};

// Open items that are due, most urgent first.
export function dueReviewItems<T extends ReviewItemSummary>(items: T[], now: Date, limit = 10): T[] {
  return items
    .filter((i) => i.status === "open" && Date.parse(i.dueAt) <= now.getTime())
    .sort((a, b) => b.priority - a.priority || a.dueAt.localeCompare(b.dueAt))
    .slice(0, limit);
}
