import type { MasteryStatus } from "@/lib/learning/mastery";
import type { WritingAnalysis } from "@/lib/learning/writing";

// The parent's writing report, from stored answers only (activity_attempts with the
// server's writing_analysis). Every number is a count of what was actually checked: a
// mechanic that was "off" for the child's level, or a spelling the app could not judge, is
// not counted as met or missed. No grades: shares of checks met, and the child's own words.

export type WritingAttemptFact = {
  // The question answered: samples show the newest answer to each question.
  questionId: string;
  questionType: string;
  prompt: string;
  attemptNumber: number;
  isCorrect: boolean;
  attemptedAt: string;
  response: unknown;
  analysis: WritingAnalysis | null;
};

export type CheckTally = { checked: number; met: number };

export type WritingSample = {
  attemptedAt: string;
  prompt: string;
  kind: WritingAnalysis["kind"];
  text: string;
  words: number;
  sentences: number;
  isCorrect: boolean;
  criteria: { label: string; met: boolean | null; critical: boolean }[];
  misspelled: { written: string; suggestion: string }[];
};

export type WritingSummary = {
  answers: number;
  firstTries: number;
  firstTryCorrect: number;
  // Open writing (rubric and story answers, first tries): words and sentences written.
  wordsWritten: number;
  sentencesWritten: number;
  openPieces: number;
  mechanics: Record<"capitalization" | "punctuation" | "spacing", CheckTally>;
  // Handwriting first tries: drawn or typed instead, and how often the letter was formed.
  handwriting: {
    drawn: number;
    typed: number;
    formed: number;
    letters: { glyph: string; tries: number; formed: number }[];
  };
  samples: WritingSample[];
};

const MECHANICS = ["capitalization", "punctuation", "spacing"] as const;
const OPEN_KINDS = new Set(["rubric", "story"]);

// The child's text as written: one box, or the boxes joined (story lines in their order).
export function writtenText(response: unknown): string {
  if (!response || typeof response !== "object") return "";
  const r = response as { value?: unknown; lines?: unknown };
  if (typeof r.value === "string") return r.value;
  if (Array.isArray(r.lines))
    return r.lines.filter((l): l is string => typeof l === "string" && l.trim() !== "").join("\n");
  return "";
}

export function summarizeWriting(attempts: WritingAttemptFact[], sampleCount = 8): WritingSummary {
  const summary: WritingSummary = {
    answers: attempts.length,
    firstTries: 0,
    firstTryCorrect: 0,
    wordsWritten: 0,
    sentencesWritten: 0,
    openPieces: 0,
    mechanics: {
      capitalization: { checked: 0, met: 0 },
      punctuation: { checked: 0, met: 0 },
      spacing: { checked: 0, met: 0 },
    },
    handwriting: { drawn: 0, typed: 0, formed: 0, letters: [] },
    samples: [],
  };
  const letters = new Map<string, { glyph: string; tries: number; formed: number }>();
  const newestFirst = [...attempts].sort((a, b) => b.attemptedAt.localeCompare(a.attemptedAt));
  for (const a of newestFirst) {
    if (a.attemptNumber !== 1) continue;
    summary.firstTries++;
    if (a.isCorrect) summary.firstTryCorrect++;
    const analysis = a.analysis;
    if (!analysis) continue;
    for (const c of analysis.criteria) {
      const m = MECHANICS.find((x) => x === c.dimension);
      if (!m || c.met === null) continue;
      summary.mechanics[m].checked++;
      if (c.met) summary.mechanics[m].met++;
    }
    if (analysis.kind === "trace" && analysis.trace) {
      if (analysis.trace.method === "typed") summary.handwriting.typed++;
      else summary.handwriting.drawn++;
      if (a.isCorrect) summary.handwriting.formed++;
      const l = letters.get(analysis.trace.glyph) ?? { glyph: analysis.trace.glyph, tries: 0, formed: 0 };
      l.tries++;
      if (a.isCorrect) l.formed++;
      letters.set(l.glyph, l);
    }
    if (OPEN_KINDS.has(analysis.kind)) {
      summary.openPieces++;
      summary.wordsWritten += analysis.words;
      summary.sentencesWritten += analysis.sentences;
    }
  }
  // Samples: the newest answer to each question (a retry shows what the child fixed).
  const sampled = new Set<string>();
  for (const a of newestFirst) {
    const analysis = a.analysis;
    if (
      !analysis ||
      analysis.kind === "trace" ||
      sampled.has(a.questionId) ||
      summary.samples.length >= sampleCount
    )
      continue;
    const text = writtenText(a.response);
    if (!text.trim()) continue;
    sampled.add(a.questionId);
    summary.samples.push({
      attemptedAt: a.attemptedAt,
      prompt: a.prompt,
      kind: analysis.kind,
      text,
      words: analysis.words,
      sentences: analysis.sentences,
      isCorrect: a.isCorrect,
      criteria: analysis.criteria.map((c) => ({ label: c.label, met: c.met, critical: c.critical })),
      misspelled: analysis.spelling?.misspelled ?? [],
    });
  }
  summary.handwriting.letters = [...letters.values()].sort(
    (a, b) => a.formed / a.tries - b.formed / b.tries || b.tries - a.tries,
  );
  return summary;
}

// Mastery of each writing skill taught at the child's level, from the curriculum skills
// tagged with it (ordinary skill_mastery; the best-practised skill speaks for it).
export type WritingSkillFact = {
  code: string;
  name: string;
  childName: string;
  strand: string;
  emoji: string;
  minRank: number;
  maxRank: number;
};
export type WritingSkillProgress = WritingSkillFact & {
  status: MasteryStatus;
  score: number | null;
  attempts: number;
};

export function writingSkillProgress(
  skills: WritingSkillFact[],
  mastery: { writingSkill: string; status: MasteryStatus; score: number; attempts: number }[],
  levelRank: number,
): WritingSkillProgress[] {
  return skills
    .filter((s) => levelRank >= s.minRank && levelRank <= s.maxRank)
    .map((s) => {
      const rows = mastery.filter((m) => m.writingSkill === s.code && m.attempts > 0);
      if (rows.length === 0)
        return { ...s, status: "NOT_STARTED" as MasteryStatus, score: null, attempts: 0 };
      const best = rows.reduce((a, b) => (b.attempts > a.attempts ? b : a));
      return {
        ...s,
        status: best.status,
        score: best.score,
        attempts: rows.reduce((n, r) => n + r.attempts, 0),
      };
    });
}
