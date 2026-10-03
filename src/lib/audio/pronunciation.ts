// What to say for a piece of speech, decided in ONE place (pure, no browser APIs).
//
// Learning text is ordinary words, plus two kinds of token written by the content
// templates:
//
//   {/S/}, {/SH AH N/}   a SOUND: a sequence of ARPAbet phonemes (the phonics sound /s/)
//   {@s}                 a LETTER NAME: the alphabet name of a letter ("ess")
//
// A token is never spoken as its letters. Each one resolves, in order, to
//   1. a recorded clip (audio_assets), when one exists;
//   2. otherwise a speech-synthesis rendering checked to say the sound, never the letter
//      names: "pure" (the sound alone: "ee", "oh", "shun") or "approximate" (the sound
//      plus a short "uh": "suh", "buh" — browser voices cannot say an isolated consonant);
//   3. otherwise a KEYWORD: "the sound at the start of apple". Browser voices cannot
//      produce some sounds at all (short a, e, i, the oo in book, ow in cow); for those we
//      name a word that has the sound rather than invent a wrong one.
// The table holding these comes from the database (phonemes, phonics_pattern_sounds,
// letter names, audio assets), so recorded audio replaces synthesis with no code change.

export type SoundQuality = "pure" | "approximate" | "keyword";
export type KeywordPosition = "first" | "middle" | "last";

export type SoundEntry = {
  // What speech synthesis says for the sound ("" when no safe rendering exists).
  tts: string;
  quality: SoundQuality;
  keyword?: { word: string; position: KeywordPosition } | null;
  // A recorded clip of the sound, preferred over everything else.
  assetUrl?: string | null;
};

export type LetterEntry = { name: string; assetUrl?: string | null };

export type SoundTable = {
  // Keyed by the phoneme sequence: "S", "SH AH N".
  sounds: Record<string, SoundEntry>;
  // Keyed by the lowercase letter: "s" → "ess".
  letters: Record<string, LetterEntry>;
};

export const EMPTY_SOUND_TABLE: SoundTable = { sounds: {}, letters: {} };

const PHONEME = /^[A-Z]{1,3}$/;

export function soundKey(phonemes: readonly string[]) {
  return phonemes.join(" ");
}

// The token for a sound. An empty sequence (a silent letter) has no sound: "".
export function soundToken(phonemes: readonly string[]) {
  if (phonemes.length === 0) return "";
  if (!phonemes.every((p) => PHONEME.test(p)))
    throw new Error(`not a phoneme sequence: ${phonemes.join(" ")}`);
  return `{/${soundKey(phonemes)}/}`;
}

export function letterToken(letter: string) {
  const l = letter.toLowerCase();
  if (!/^[a-z]$/.test(l)) throw new Error(`not a letter: ${letter}`);
  return `{@${l}}`;
}

const TOKEN = /\{\/([A-Z]{1,3}(?: [A-Z]{1,3})*)\/\}|\{@([a-z])\}/g;

export type SpeechToken = { kind: "sound"; phonemes: string[] } | { kind: "letter"; letter: string };
type Piece = { kind: "text"; text: string } | SpeechToken;

export function parseSpeech(text: string): Piece[] {
  const pieces: Piece[] = [];
  let at = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index > at) pieces.push({ kind: "text", text: text.slice(at, m.index) });
    pieces.push(m[1] ? { kind: "sound", phonemes: m[1].split(" ") } : { kind: "letter", letter: m[2] });
    at = m.index + m[0].length;
  }
  if (at < text.length) pieces.push({ kind: "text", text: text.slice(at) });
  return pieces;
}

export function speechTokens(text: string): SpeechToken[] {
  return parseSpeech(text).filter((p): p is SpeechToken => p.kind !== "text");
}

export function hasSpeechTokens(text: string) {
  return speechTokens(text).length > 0;
}

const KEYWORD_PHRASE: Record<KeywordPosition, (word: string) => string> = {
  first: (w) => `the sound at the start of ${w}`,
  middle: (w) => `the sound in the middle of ${w}`,
  last: (w) => `the sound at the end of ${w}`,
};

function entryText(entry: SoundEntry): string {
  if (entry.quality !== "keyword" && entry.tts) return entry.tts;
  return entry.keyword ? KEYWORD_PHRASE[entry.keyword.position](entry.keyword.word) : "";
}

export type ResolvedSound = {
  // The words speech synthesis would say ("" = nothing safe to say).
  text: string;
  assetUrl: string | null;
  strategy: "asset" | "tts" | "keyword" | "none";
  quality: SoundQuality | null;
};

// One sound → what to play. Sequences without their own entry ("K S") are built from
// their phonemes when every phoneme has a synthesis rendering; otherwise nothing is said
// rather than something wrong.
export function resolveSound(phonemes: readonly string[], table: SoundTable): ResolvedSound {
  const entry = table.sounds[soundKey(phonemes)];
  if (entry) {
    const text = entryText(entry);
    if (entry.assetUrl) return { text, assetUrl: entry.assetUrl, strategy: "asset", quality: entry.quality };
    if (text)
      return {
        text,
        assetUrl: null,
        strategy: entry.quality === "keyword" || !entry.tts ? "keyword" : "tts",
        quality: entry.quality,
      };
  }
  if (phonemes.length > 1) {
    const parts = phonemes.map((p) => table.sounds[p]);
    if (parts.every((p) => p && p.quality !== "keyword" && p.tts))
      return {
        text: parts.map((p) => p!.tts).join(" "),
        assetUrl: null,
        strategy: "tts",
        quality: parts.some((p) => p!.quality === "approximate") ? "approximate" : "pure",
      };
  }
  return { text: "", assetUrl: null, strategy: "none", quality: null };
}

// A letter's NAME. Without a table entry a single capital letter is read as its name
// by every speech engine, which is exactly the alphabet path wanted here.
export function resolveLetter(letter: string, table: SoundTable): { text: string; assetUrl: string | null } {
  const entry = table.letters[letter.toLowerCase()];
  return { text: entry?.name || letter.toUpperCase(), assetUrl: entry?.assetUrl ?? null };
}

// Words a speech engine reads as LETTER NAMES instead of a sound: one consonant repeated
// ("sss" → "ess ess ess", "hh" → "aitch aitch") and consonant clusters with no vowel
// ("th" → "tee aitch", "ng", "shh", "st" → "saint", "ks"). Checked with espeak-ng, the
// engine behind Chrome and Firefox on Linux; other engines behave the same way or worse.
// Single letters are allowed: they are letter names on purpose ("It starts with s.").
// Acronyms every voice reads as letters, as intended.
const ACRONYMS = new Set(["tv"]);

export function findUnsafeSpeech(text: string): string[] {
  const plain = parseSpeech(text)
    .map((p) => (p.kind === "text" ? p.text : " "))
    .join("");
  const bad: string[] = [];
  for (const word of plain.toLowerCase().match(/[a-z]+/g) ?? []) {
    if (word.length < 2 || ACRONYMS.has(word)) continue;
    if (/^([^aeiouy])\1+$/.test(word) || (/^[^aeiouy]+$/.test(word) && word.length <= 4)) bad.push(word);
  }
  return bad;
}

// Display text read aloud (a pattern's explanation, an authored hint): sounds written
// between slashes ("/k/") become sound tokens, and letter groups written for reading
// ("th", "ng") are said as letter NAMES — in display text they are letters.
export function speechFromDisplay(text: string, soundForLabel?: (label: string) => string[] | undefined) {
  return parseSpeech(text)
    .map((piece) => {
      if (piece.kind === "sound") return soundToken(piece.phonemes);
      if (piece.kind === "letter") return letterToken(piece.letter);
      const withSounds = piece.text.replace(/\/([a-z]{1,4})\//g, (m, label: string) => {
        const phonemes = soundForLabel?.(label);
        return phonemes?.length ? soundToken(phonemes) : m;
      });
      return parseSpeech(withSounds)
        .map((p) => {
          if (p.kind !== "text") return p.kind === "sound" ? soundToken(p.phonemes) : letterToken(p.letter);
          const bad = new Set(findUnsafeSpeech(p.text));
          return p.text.replace(/[A-Za-z]+/g, (w) =>
            bad.has(w.toLowerCase()) ? [...w.toLowerCase()].map(letterToken).join(" ") : w,
          );
        })
        .join("");
    })
    .join("");
}

function stripUnsafe(text: string) {
  const bad = new Set(findUnsafeSpeech(text));
  if (bad.size === 0) return text;
  return text.replace(/[A-Za-z]+/g, (w) => (bad.has(w.toLowerCase()) ? "" : w)).replace(/\s{2,}/g, " ");
}

export type SpeechPart = { kind: "tts"; text: string } | { kind: "asset"; url: string; fallback: string };

// Text → the clips and utterances to play, in order. Plain words around tokens join the
// token's rendering into one utterance (natural phrasing); a recorded clip splits it.
// Unsafe words left in plain text (content imported before this check existed) are
// dropped: silence is better than teaching a letter name as a sound.
export function planSpeech(text: string, table: SoundTable): SpeechPart[] {
  const parts: SpeechPart[] = [];
  let buffer = "";
  const flush = () => {
    const t = buffer
      .replace(/\s+/g, " ")
      .replace(/\s+([,.?!])/g, "$1")
      .trim();
    if (t && /[A-Za-z0-9]/.test(t)) parts.push({ kind: "tts", text: t });
    buffer = "";
  };
  for (const piece of parseSpeech(text)) {
    if (piece.kind === "text") {
      buffer += stripUnsafe(piece.text);
      continue;
    }
    const r =
      piece.kind === "sound" ? resolveSound(piece.phonemes, table) : resolveLetter(piece.letter, table);
    if (r.assetUrl) {
      flush();
      parts.push({ kind: "asset", url: r.assetUrl, fallback: r.text });
    } else buffer += r.text;
  }
  flush();
  return parts;
}

// The whole thing as synthesis would say it (no clips): for tests, audits and captions.
export function speakableText(text: string, table: SoundTable) {
  return planSpeech(text, stripAssets(table))
    .map((p) => (p.kind === "tts" ? p.text : p.fallback))
    .join(" ");
}

function stripAssets(table: SoundTable): SoundTable {
  return {
    sounds: Object.fromEntries(Object.entries(table.sounds).map(([k, v]) => [k, { ...v, assetUrl: null }])),
    letters: Object.fromEntries(Object.entries(table.letters).map(([k, v]) => [k, { ...v, assetUrl: null }])),
  };
}

// Building the table from database rows (server loaders and the importer share this).
export type SoundRow = {
  phonemes: string[];
  tts: string;
  quality: SoundQuality;
  keyword?: string | null;
  keywordPosition?: KeywordPosition | null;
  assetUrl?: string | null;
};

export function buildSoundTable(
  rows: SoundRow[],
  letters: { letter: string; name: string; assetUrl?: string | null }[] = [],
): SoundTable {
  const sounds: Record<string, SoundEntry> = {};
  for (const row of rows) {
    if (row.phonemes.length === 0) continue;
    const key = soundKey(row.phonemes);
    const entry: SoundEntry = {
      tts: row.tts,
      quality: row.quality,
      keyword: row.keyword ? { word: row.keyword, position: row.keywordPosition ?? "first" } : null,
      assetUrl: row.assetUrl ?? null,
    };
    const existing = sounds[key];
    // The first row for a sound wins (phonemes come first); a later row only adds a clip.
    if (!existing) sounds[key] = entry;
    else if (!existing.assetUrl && entry.assetUrl) existing.assetUrl = entry.assetUrl;
  }
  const letterMap: Record<string, LetterEntry> = {};
  for (const l of letters)
    if (/^[a-z]$/.test(l.letter) && l.name && !letterMap[l.letter])
      letterMap[l.letter] = { name: l.name, assetUrl: l.assetUrl ?? null };
  return { sounds, letters: letterMap };
}

// Problems in the speech of a question (its spoken prompt and every `speech` / `sayAs`
// string in its content): words a voice would read as letter names, and sound tokens for
// unknown phonemes. The importer rejects a question with any.
export function speechProblems(
  promptSpeech: string,
  content: unknown,
  knownPhonemes?: ReadonlySet<string>,
): string[] {
  const texts: string[] = [promptSpeech];
  const walk = (value: unknown, key: string) => {
    if (typeof value === "string") {
      if (/speech|sayas/i.test(key)) texts.push(value);
    } else if (Array.isArray(value)) value.forEach((v) => walk(v, key));
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, k);
  };
  walk(content, "");
  const problems: string[] = [];
  for (const text of texts) {
    for (const word of findUnsafeSpeech(text))
      problems.push(`"${word}" would be read as letter names (use a sound token)`);
    if (knownPhonemes)
      for (const token of speechTokens(text))
        if (token.kind === "sound")
          for (const p of token.phonemes)
            if (!knownPhonemes.has(p)) problems.push(`unknown phoneme ${p} in a sound token`);
  }
  return [...new Set(problems)];
}

// "/k/", "/ee/", "/id/" in display text → phonemes, from the phonemes' child labels (k,
// ee, sh …). An exact, unambiguous label wins; otherwise the label is split into labels
// that are each unambiguous ("id" → i + d). Ambiguous labels ("oo", "th") give undefined.
export function soundLabelLookup(phonemes: readonly { code: string; label: string }[]) {
  const byLabel = new Map<string, string[]>();
  for (const p of phonemes) byLabel.set(p.label, [...(byLabel.get(p.label) ?? []), p.code]);
  const exact = (label: string) => {
    const codes = byLabel.get(label);
    return codes && codes.length === 1 ? codes[0] : undefined;
  };
  return (label: string): string[] | undefined => {
    const one = exact(label);
    if (one) return [one];
    if (byLabel.has(label)) return undefined;
    // Split into the longest unambiguous labels, left to right.
    const out: string[] = [];
    let rest = label;
    while (rest) {
      let found = "";
      for (let n = Math.min(3, rest.length); n > 0 && !found; n--)
        if (exact(rest.slice(0, n))) found = rest.slice(0, n);
      if (!found) return undefined;
      out.push(exact(found)!);
      rest = rest.slice(found.length);
    }
    return out;
  };
}
