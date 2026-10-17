// Which section of a sitting comes next (Phase 9). Pure; run by the lesson player on the
// device so a sitting keeps going offline. It only decides what to ASK next — it scores
// nothing: the server re-evaluates every stored answer and treats sections that were never
// reached as unobserved (not failed). A modified device that skips sections can therefore
// only lower its own evidence, never raise it.
//
// level_ladder, per domain (domains in blueprint order):
//   start at the section whose level is nearest to (school grade + startOffset), not above it;
//   passed  → the next level up, unless a higher level already failed (the boundary is found);
//   failed  → the next level down, unless a lower level already passed (boundary found) or
//             there is no lower level;
//   the domain ends at the boundary, at the top/bottom level, or after maxSectionsPerDomain
//   sections. The school grade only picks the start: passes keep going up to the top level,
//   so a child can place above their grade (and below it) — there is no grade ceiling.
// none: every section in order.

export type FlowSection = {
  code: string;
  domain: string;
  // Level rank (KG1 = 1 … GRADE2 = 5); sections of one domain have different ranks.
  rank: number;
  // Number of items the section has in this sitting.
  items: number;
};

export type SectionOutcome = { correct: number; total: number };

export type FlowState = {
  rule: "none" | "level_ladder";
  startRank: number;
  passPercent: number;
  sections: FlowSection[];
  // Sections finished so far, with the device's own count (from the answer key).
  outcomes: Record<string, SectionOutcome>;
  // At most this many sections per domain (blueprint stopping; unlimited when absent).
  maxSectionsPerDomain?: number;
};

const passed = (o: SectionOutcome, passPercent: number) =>
  o.total > 0 && (100 * o.correct) / o.total >= passPercent;

// The next section to serve, or null when the sitting is finished.
export function nextSection(state: FlowState): FlowSection | null {
  const pending = state.sections.filter((s) => s.items > 0 && !state.outcomes[s.code]);
  if (state.rule === "none") return pending[0] ?? null;

  const domains: string[] = [];
  for (const s of state.sections) if (!domains.includes(s.domain)) domains.push(s.domain);
  for (const domain of domains) {
    const ladder = state.sections
      .filter((s) => s.domain === domain && s.items > 0)
      .sort((a, b) => a.rank - b.rank);
    if (ladder.length === 0) continue;
    const done = ladder.filter((s) => state.outcomes[s.code]);
    if (done.length >= (state.maxSectionsPerDomain ?? Infinity)) continue;
    if (done.length === 0) {
      const atOrBelow = ladder.filter((s) => s.rank <= state.startRank);
      return atOrBelow.at(-1) ?? ladder[0];
    }
    const passedRanks = done
      .filter((s) => passed(state.outcomes[s.code], state.passPercent))
      .map((s) => s.rank);
    const failedRanks = done
      .filter((s) => !passed(state.outcomes[s.code], state.passPercent))
      .map((s) => s.rank);
    const highestPass = passedRanks.length ? Math.max(...passedRanks) : -Infinity;
    const lowestFail = failedRanks.length ? Math.min(...failedRanks) : Infinity;
    if (highestPass > -Infinity) {
      // Go up from the highest pass, unless the next level up already failed.
      const up = ladder.find((s) => s.rank > highestPass);
      if (up && up.rank < lowestFail && !state.outcomes[up.code]) return up;
    }
    if (highestPass === -Infinity) {
      // Nothing passed yet: go down from the lowest failure.
      const down = [...ladder].reverse().find((s) => s.rank < lowestFail);
      if (down && !state.outcomes[down.code]) return down;
    }
    // This domain's boundary is found (or the ladder ran out): next domain.
  }
  return null;
}

// Sections that will never be served now (for the progress indicator and the summary).
export function unreachedSections(state: FlowState): string[] {
  if (nextSection(state) !== null) return [];
  return state.sections.filter((s) => !state.outcomes[s.code]).map((s) => s.code);
}
