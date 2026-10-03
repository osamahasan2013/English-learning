// Pronunciation audit: what every phonics sound and letter name resolves to, and — when
// espeak-ng is installed (the engine behind Chrome and Firefox on Linux) — the phonemes
// that engine actually produces for that text. Reads content/phonics.json; no database.
//
//   npm run audio:audit            # markdown table on stdout
//
// A rendering that comes out as letter names ("'Es" = ess, "'eItS" = aitch) is a bug.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { buildSoundTable, resolveLetter, resolveSound } from "../../src/lib/audio/pronunciation";
import { phonicsFileSchema } from "../../src/lib/content/content-schemas";

const file = phonicsFileSchema.parse(JSON.parse(readFileSync("content/phonics.json", "utf8")));
const table = buildSoundTable(
  [
    ...file.phonemes.map((p) => ({
      phonemes: [p.code],
      tts: p.sayAs,
      quality: p.ttsQuality,
      keyword: p.keyword,
      keywordPosition: p.keywordPosition,
    })),
    ...file.patterns.flatMap((p) =>
      p.sounds
        .filter((s) => s.phonemes.length > 1)
        .map((s) => ({
          phonemes: s.phonemes,
          tts: s.sayAs,
          quality: s.ttsQuality,
          keyword: s.keyword,
          keywordPosition: s.keywordPosition,
        })),
    ),
  ],
  file.patterns
    .filter((p) => p.type === "letter")
    .map((p) => ({ letter: p.pattern, name: p.letterNameSayAs })),
);

let espeak = true;
function phonemize(text: string) {
  if (!espeak || !text) return "";
  try {
    return execFileSync("espeak-ng", ["-v", "en-us", "-x", "-q", text])
      .toString()
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    espeak = false;
    return "";
  }
}

console.log("| Pattern | Sound | IPA | Says | espeak-ng | Strategy |");
console.log("| --- | --- | --- | --- | --- | --- |");
for (const p of file.patterns)
  for (const s of p.sounds) {
    const r = resolveSound(s.phonemes, table);
    console.log(
      `| ${p.code} | ${s.code} | ${s.ipa} | ${r.text} | \`${phonemize(r.text)}\` | ${r.strategy} (${r.quality ?? "-"}) |`,
    );
  }
for (const p of file.patterns.filter((x) => x.type === "letter")) {
  const r = resolveLetter(p.pattern, table);
  console.log(`| ${p.code} | letter name | | ${r.text} | \`${phonemize(r.text)}\` | letter name |`);
}
if (!espeak) console.error("espeak-ng not found: install it to see what a real engine says.");
