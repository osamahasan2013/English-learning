// Trusted item selection for one assessment sitting (Phase 9). Pure and deterministic: the
// same candidates, exposures and seed (the sitting id) always give the same items, so a
// sitting can be rebuilt and a refresh never reshuffles it. Runs on the server only, over
// published questions it loaded itself — a device never chooses its own questions.
//
// Per section, in order:
//   1. the candidates in the preferred difficulty range (all of them when too few qualify);
//   2. least exposed first (questions the child has met least often), ties broken by a
//      seeded hash, so practice of the exact item does not keep coming back as "evidence";
//   3. drawn round-robin across skills (coverage before depth), at most maxPerSkill per skill,
//      avoiding a second item about the same word/pattern/story while another is available —
//      ten CVC items about cat, bat, hat, mat... are not ten pieces of evidence;
//   4. up to `draw` items, and never more than maxItems in the whole sitting.

export type SelectionCandidate = {
  questionId: string;
  sectionCode: string;
  skillId: string;
  // What the item is "about" (word, pattern, story); null = unique.
  varietyKey: string | null;
  difficulty: number;
  // The child's earlier answers to this exact question.
  exposures: number;
};

export type SelectionSection = {
  code: string;
  draw: number;
  maxPerSkill: number;
  difficulty?: [number, number];
};

export type Selection = {
  items: { questionId: string; sectionCode: string }[];
  // Sections that could not get all the items they asked for (content gap, reported to admins).
  shortfalls: { sectionCode: string; wanted: number; got: number }[];
};

// FNV-1a: a small, stable string hash (not for security — only a reproducible shuffle).
export function stableHash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function selectItems(args: {
  sections: SelectionSection[];
  candidates: SelectionCandidate[];
  seed: string;
  maxItems: number;
}): Selection {
  const items: Selection["items"] = [];
  const shortfalls: Selection["shortfalls"] = [];
  const taken = new Set<string>();
  const usedVariety = new Set<string>();

  for (const section of args.sections) {
    const pool = args.candidates.filter((c) => c.sectionCode === section.code && !taken.has(c.questionId));
    const inRange = section.difficulty
      ? pool.filter((c) => c.difficulty >= section.difficulty![0] && c.difficulty <= section.difficulty![1])
      : pool;
    const eligible = inRange.length >= section.draw ? inRange : pool;
    const ordered = [...eligible].sort(
      (a, b) =>
        a.exposures - b.exposures ||
        stableHash(`${args.seed}:${a.questionId}`) - stableHash(`${args.seed}:${b.questionId}`) ||
        (a.questionId < b.questionId ? -1 : 1),
    );
    // Skills in the order their best item appears.
    const skillOrder: string[] = [];
    for (const c of ordered) if (!skillOrder.includes(c.skillId)) skillOrder.push(c.skillId);
    const perSkill = new Map<string, number>();
    const picked: SelectionCandidate[] = [];
    const room = () => Math.min(section.draw, args.maxItems - items.length);

    // Two passes: the first keeps every item about something new; the second allows a
    // repeated word only when the section would otherwise be short.
    for (const allowRepeat of [false, true]) {
      let progress = true;
      while (picked.length < room() && progress) {
        progress = false;
        for (const skill of skillOrder) {
          if (picked.length >= room()) break;
          if ((perSkill.get(skill) ?? 0) >= section.maxPerSkill) continue;
          const next = ordered.find(
            (c) =>
              c.skillId === skill &&
              !taken.has(c.questionId) &&
              (allowRepeat || c.varietyKey === null || !usedVariety.has(c.varietyKey)),
          );
          if (!next) continue;
          picked.push(next);
          taken.add(next.questionId);
          if (next.varietyKey) usedVariety.add(next.varietyKey);
          perSkill.set(skill, (perSkill.get(skill) ?? 0) + 1);
          progress = true;
        }
      }
    }
    for (const c of picked) items.push({ questionId: c.questionId, sectionCode: section.code });
    if (picked.length < section.draw && items.length < args.maxItems)
      shortfalls.push({ sectionCode: section.code, wanted: section.draw, got: picked.length });
  }
  return { items, shortfalls };
}
