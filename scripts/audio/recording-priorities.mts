// Which recordings to make first (Phase 8.3). Every sound, letter name and high-frequency
// word is ranked by what a wrong rendering costs a child: how important it is to teach,
// how often it is heard, how unreliable browser speech is for it, how easily it is
// confused with something else, and how young the children who hear it are. Reads the
// shipped content (/content); no database, nothing recorded or fabricated.
//
//   npx tsx scripts/audio/recording-priorities.mts > docs/recording-priorities.md
//
// The content keys are those of `audio_assets.content_key` (docs/audio-engine.md).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { phonicsFileSchema } from "../../src/lib/content/content-schemas";

const phonics = phonicsFileSchema.parse(JSON.parse(readFileSync("content/phonics.json", "utf8")));

// All shipped content as text (JSON + CSV), for counting how often a word is heard.
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}
const corpus = files("content")
  .filter((f) => f !== join("content", "phonics.json"))
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");
const wordCount = (w: string) =>
  (corpus.match(new RegExp(`(?<![\\p{L}'])${w}(?![\\p{L}'])`, "giu")) ?? []).length;

const LEVEL_SCORE: Record<string, number> = { KG1: 3, KG2: 2.5, KG3: 2, GRADE1: 1.5, GRADE2: 1 };
const LEVEL_ORDER = Object.keys(LEVEL_SCORE);
const frequencyScore = (n: number, top: number) => (n <= 0 ? 0 : (3 * Math.log1p(n)) / Math.log1p(top));

type Row = {
  key: string;
  what: string;
  level: string;
  importance: number;
  frequency: number;
  frequencyNote: string;
  ttsRisk: number;
  ambiguity: number;
  why: string;
};
const rows: Row[] = [];

// Letter names: engine-native ("G."), but one-syllable names that rhyme are the easiest
// to mishear, and an iPhone clips the start of a short utterance (the G heard as "S").
const RHYMES: Record<string, string> = {
  b: "B/D/E/P/T/V",
  c: "C/S/Z",
  d: "B/D/T",
  e: "E/B/D",
  g: "G/J/Z",
  p: "P/B/T",
  t: "T/D/P",
  v: "V/B/Z",
  z: "Z/C/G",
  f: "F/S/X",
  s: "S/F/X",
  x: "X/S/F",
  m: "M/N",
  n: "N/M",
  a: "A/J/K",
  j: "J/G/A",
  k: "K/A/J",
  i: "I/Y",
  y: "Y/I",
  q: "Q/U",
  u: "U/Q/YOU",
  o: "O",
  h: "H",
  l: "L",
  r: "R",
  w: "W",
};
const letterPatterns = phonics.patterns.filter((p) => p.type === "letter");
for (const p of letterPatterns) {
  const confusable = (RHYMES[p.pattern] ?? "").split("/").length;
  rows.push({
    key: `letter_name:${p.pattern}`,
    what: `letter name ${p.uppercase}`,
    level: p.level,
    importance: 3,
    frequency: 2.5,
    frequencyNote: "every letter lesson, alphabet and spelling feedback",
    ttsRisk: 1.5,
    ambiguity: confusable >= 3 ? 3 : confusable === 2 ? 2 : 1,
    why: `isolated one-syllable name; confusable: ${RHYMES[p.pattern] || "-"}`,
  });
}

// Phonemes: browser voices cannot say an isolated sound; "approximate" adds "uh", a
// "keyword" sound is replaced by a word ("the sound at the start of apple").
const phonemeLevel = new Map<string, string>();
const phonemeUses = new Map<string, number>();
for (const p of phonics.patterns)
  for (const s of p.sounds)
    for (const code of s.phonemes) {
      phonemeUses.set(code, (phonemeUses.get(code) ?? 0) + 1);
      const was = phonemeLevel.get(code);
      if (!was || LEVEL_ORDER.indexOf(p.level) < LEVEL_ORDER.indexOf(was)) phonemeLevel.set(code, p.level);
    }
const topUses = Math.max(...phonemeUses.values());
const QUALITY_RISK = { keyword: 3, approximate: 2, pure: 0.5 } as const;
const CONFUSED: Record<string, string> = {
  G: "/g/ vs /j/ (the letter name G)",
  J: "/j/ vs /g/",
  S: "/s/ vs the name S",
  Z: "/z/ vs /s/",
  F: "/f/ vs /th/",
  TH: "/th/ vs /f/ /v/",
  DH: "/th/ (voiced) vs /d/",
  B: "/b/ vs /p/ /d/",
  P: "/p/ vs /b/",
  D: "/d/ vs /t/ /b/",
  T: "/t/ vs /d/",
  M: "/m/ vs /n/",
  N: "/n/ vs /m/",
  IH: "short i vs short e",
  EH: "short e vs short i",
  AE: "short a vs short e",
  AH: "short u vs short o",
  AA: "short o vs short u",
  K: "/k/ vs /g/",
  V: "/v/ vs /f/ /b/",
};
for (const ph of phonics.phonemes) {
  const uses = phonemeUses.get(ph.code) ?? 0;
  rows.push({
    key: `phoneme:${ph.code}`,
    what: `sound ${ph.ipa} (${ph.label})`,
    level: phonemeLevel.get(ph.code) ?? "GRADE2",
    importance: 3,
    frequency: frequencyScore(uses, topUses),
    frequencyNote: `${uses} pattern sound${uses === 1 ? "" : "s"}`,
    ttsRisk: QUALITY_RISK[ph.ttsQuality],
    ambiguity: CONFUSED[ph.code] ? 2.5 : 1,
    why: `TTS ${ph.ttsQuality}${ph.ttsQuality === "approximate" ? ` ("${ph.sayAs}")` : ""}${
      ph.ttsQuality === "keyword" ? ` (keyword “${ph.keyword}”)` : ""
    }${CONFUSED[ph.code] ? `; ${CONFUSED[ph.code]}` : ""}`,
  });
}

// Multi-phoneme pattern sounds (digraphs, vowel teams, r-controlled, endings).
for (const p of phonics.patterns.filter((x) => x.type !== "letter"))
  for (const s of p.sounds.filter((x) => x.phonemes.length > 1 || x.ttsQuality === "keyword")) {
    rows.push({
      key: `pattern_sound:${s.code}`,
      what: `${p.pattern} — ${s.label}`,
      level: p.level,
      importance: 2,
      frequency: 1,
      frequencyNote: "its pattern's lessons",
      ttsRisk: QUALITY_RISK[s.ttsQuality ?? "approximate"],
      ambiguity: 1.5,
      why: `${p.type}; TTS ${s.ttsQuality ?? "approximate"}`,
    });
  }

// High-frequency and irregular words: short function words are reduced or clipped when a
// voice reads them alone ("the" was unclear on an iPhone); irregular words cannot be
// sounded out, so the child relies on hearing them right.
const sight = JSON.parse(readFileSync("content/sight-words.json", "utf8")) as {
  lists: { level: string; words: string[] }[];
};
// "I" keeps its capital (the word, not the letter).
const key = (w: string) => (w === "I" ? w : w.toLowerCase());
const words = new Map<string, { level: string; irregular: boolean; sight: boolean }>();
for (const list of sight.lists)
  for (const w of list.words) words.set(key(w), { level: list.level, irregular: false, sight: true });
for (const w of ["the", "a", "an", "is", "to", "of", "and"])
  if (!words.has(w)) words.set(w, { level: "KG2", irregular: false, sight: true });
for (const line of readFileSync("content/words/reading-words.csv", "utf8").split("\n").slice(1)) {
  const [word, level, , , , , , , sightWord, irregular] = line.split(",");
  if (!word || irregular !== "yes") continue;
  const prev = words.get(key(word));
  words.set(key(word), {
    level: prev?.level ?? level,
    irregular: true,
    sight: prev?.sight || sightWord === "yes",
  });
}
const counts = new Map([...words.keys()].map((w) => [w, wordCount(w)]));
const topWord = Math.max(...counts.values());
const REDUCED: Record<string, string> = {
  the: "“thuh”/“thee”; clipped alone",
  a: "“uh”/“ay”; mistaken for the letter name A",
  an: "reduced to “n”",
  to: "“tuh” vs “two/too”",
  of: "“uv”, reduced",
  and: "reduced to “n”",
  is: "short, clipped alone",
  I: "the letter name I",
  said: "irregular vowel",
  was: "irregular vowel",
};
for (const [w, info] of words) {
  const n = counts.get(w) ?? 0;
  const short = w.length <= 3;
  rows.push({
    key: `word:${w}`,
    what: `word “${w}”${info.irregular ? " (irregular)" : ""}`,
    level: info.level,
    importance: info.sight ? 2.5 : 2,
    frequency: frequencyScore(n, topWord),
    frequencyNote: `${n} in content`,
    ttsRisk: short ? 2 : 1,
    ambiguity: REDUCED[w] ? 2.5 : info.irregular ? 2 : 1,
    why:
      REDUCED[w] ??
      (info.irregular ? "irregular spelling" : short ? "short word, clipped alone" : "sight word"),
  });
}

const score = (r: Row) => r.importance + r.frequency + r.ttsRisk + r.ambiguity + LEVEL_SCORE[r.level];
rows.sort((a, b) => score(b) - score(a) || a.key.localeCompare(b.key));

const f = (n: number) => n.toFixed(1);
console.log(`# Recording priorities

Generated by \`npx tsx scripts/audio/recording-priorities.mts\` from the shipped content.
Production has **no recordings** yet: everything is browser speech synthesis. This is the
order in which to record clips (\`audio_assets\`, \`content_key\` below) so the riskiest
sounds stop depending on a device's voice first. Nothing here is recorded or invented.

Score = importance (0–3) + frequency (0–3) + TTS risk (0–3) + ambiguity (0–3) + level
(KG1 3 … Grade 2 1). Importance: letter names and sounds 3, sight words 2.5, other words
and pattern sounds 2. Frequency: letter names fixed 2.5 (in every letter lesson); sounds by
the number of pattern sounds that use them; words by occurrences in /content (log scale).
TTS risk: keyword sound 3, approximate sound 2 (a voice adds “uh”), short word 2, letter
name 1.5 (engine-native, but iOS clips short utterances), pure sound 0.5. Ambiguity: how
many things it is confused with (rhyming letter names, voiced/unvoiced pairs, reduced
function words).

Recommended first batch: the top 60 rows (all KG1 letter names and core sounds, plus
“the”, “a”, “is”, “to”, “and”, “of”, “an”). Record each as a separate, clean take: a
letter name as the name only (“G”), a sound without an added vowel (/g/ not “guh”), a
word in its citation form.

| # | Content key | What | Level | Score | Imp. | Freq. | TTS risk | Ambiguity | Why |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |`);
rows.forEach((r, i) =>
  console.log(
    `| ${i + 1} | \`${r.key}\` | ${r.what} | ${r.level} | ${f(score(r))} | ${f(r.importance)} | ${f(r.frequency)} (${r.frequencyNote}) | ${f(r.ttsRisk)} | ${f(r.ambiguity)} | ${r.why} |`,
  ),
);
