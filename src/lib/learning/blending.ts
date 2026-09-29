// Splits a word into the tiles it is built from, longest tile first ("ship" with tiles
// sh, i, p, s, h → sh · i · p), for the blending demonstration.
export function segmentWord(word: string, tiles: string[]): string[] {
  const target = word.toLowerCase();
  const sorted = [...new Set(tiles.map((t) => t.toLowerCase()))].sort((a, b) => b.length - a.length);
  const out: string[] = [];
  let i = 0;
  while (i < target.length) {
    const tile = sorted.find((t) => target.startsWith(t, i));
    if (!tile) return [...target];
    out.push(tile);
    i += tile.length;
  }
  return out;
}

// Splits text around the first case-insensitive occurrence of `highlight`.
export function splitHighlight(text: string, highlight?: string) {
  if (!highlight) return { before: text, match: "", after: "" };
  const at = text.toLowerCase().indexOf(highlight.toLowerCase());
  if (at === -1) return { before: text, match: "", after: "" };
  return {
    before: text.slice(0, at),
    match: text.slice(at, at + highlight.length),
    after: text.slice(at + highlight.length),
  };
}
