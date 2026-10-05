// What to say for a piece of speech, decided in ONE place (pure, no browser APIs).
//
// Learning text is ordinary words, plus two kinds of token written by the content
// templates:
//
//   {/S/}, {/SH AH N/}   a SOUND: a sequence of ARPAbet phonemes (the phonics sound /s/)
//   {@s}                 a LETTER NAME: the alphabet name of a letter (said from the capital "S")
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
  // Words that have the sound, in order of preference (the first one not on screen is
  // used, so a question never gives its answer away: "the sound at the start of egg").
  keyword?: { words: string[]; position: KeywordPosition } | null;
  // A recorded clip of the sound, preferred over everything else.
  assetUrl?: string | null;
};

export type LetterEntry = { name: string; assetUrl?: string | null };

export type SoundTable = {
  // Keyed by the phoneme sequence: "S", "SH AH N".
  sounds: Record<string, SoundEntry>;
  // Keyed by the lowercase letter (name: the capital letter, "S"; an optional NAME clip).
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

// Tokens are written by the content templates in canonical form ({/SH/}, {@s}); hand-made
// ones are accepted in any case and with stray spaces ({/sh/}, { /SH/ }, { @S }) and read the
// same way, so a typo never turns a sound into its letters.
const TOKEN = /\{\s*\/\s*([A-Za-z]{1,3}(?:\s+[A-Za-z]{1,3})*)\s*\/\s*\}|\{\s*@\s*([A-Za-z])\s*\}/g;
// Anything else between braces, or a token that was never closed ("{/S/"), is broken:
// never read aloud.
const BROKEN_TOKEN = /\{[^{}]{0,40}\}|\{\s*[@/][^{}\s]*/g;

// A letter standing alone in words ("s and h", "big C", "It starts with b."): a voice reads
// it as the letter's name, so that is what it is — a letter name, rendered from the A–Z
// table like a {@s} token, never handed to the voice as a raw letter. "a", "A" and "I" are
// words. A letter inside a word, after an apostrophe ("let's") or joined with a hyphen
// ("T-shirt") is not alone.
const LONE_LETTER = /(?<![\p{L}\p{N}'’\-{@/])([B-HJ-Zb-z])(?![\p{L}\p{N}'’\-}])/gu;

// Letters spelled with hyphens ("o-f", "y-o-u") are letter names too.
const SPELLED = /(?<![\p{L}\p{N}'’\-])[A-Za-z](?:-[A-Za-z])+(?![\p{L}\p{N}'’\-])/gu;
const spelledTokens = (run: string) => run.split("-").map(letterToken).join(" ");

export function loneLetters(text: string): string[] {
  return parseSpeech(text).flatMap((p) => {
    if (p.kind !== "text") return [];
    const t = p.text.replace(BROKEN_TOKEN, " ");
    return [...[...t.matchAll(SPELLED)].map((m) => m[0]), ...[...t.matchAll(LONE_LETTER)].map((m) => m[1])];
  });
}

// Lone letters → letter tokens (tokens already in the text are kept as they are).
export function lettersAsTokens(text: string) {
  return parseSpeech(text)
    .map((p) =>
      p.kind === "text"
        ? p.text.replace(SPELLED, spelledTokens).replace(LONE_LETTER, (l: string) => letterToken(l))
        : p.kind === "sound"
          ? soundToken(p.phonemes)
          : letterToken(p.letter),
    )
    .join("");
}

export type SpeechToken = { kind: "sound"; phonemes: string[] } | { kind: "letter"; letter: string };
type Piece = { kind: "text"; text: string } | SpeechToken;

export function parseSpeech(text: string): Piece[] {
  const pieces: Piece[] = [];
  let at = 0;
  for (const m of text.matchAll(TOKEN)) {
    if (m.index > at) pieces.push({ kind: "text", text: text.slice(at, m.index) });
    pieces.push(
      m[1]
        ? { kind: "sound", phonemes: m[1].trim().toUpperCase().split(/\s+/) }
        : { kind: "letter", letter: m[2].toLowerCase() },
    );
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

// Words on screen, which a keyword must not name (it would give the answer away).
export type ResolveOptions = { avoid?: ReadonlySet<string> };

function entryText(entry: SoundEntry, options: ResolveOptions): string {
  if (entry.quality !== "keyword" && entry.tts) return entry.tts;
  if (!entry.keyword?.words.length) return "";
  const avoid = options.avoid;
  const word = entry.keyword.words.find((w) => !avoid?.has(w));
  // Every keyword is on screen: no safe way to name the sound without the answer.
  return word ? KEYWORD_PHRASE[entry.keyword.position](word) : "";
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
export function resolveSound(
  phonemes: readonly string[],
  table: SoundTable,
  options: ResolveOptions = {},
): ResolvedSound {
  const entry = table.sounds[soundKey(phonemes)];
  if (entry) {
    const text = entryText(entry, options);
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

// A letter's NAME (Phase 8.3). Speech synthesis is given the capital letter itself: every
// engine reads a capital letter as the letter's name from its own lexicon ("G" → /dʒiː/),
// while a spelled-out name ("jee", "ess") is a made-up word the engine has to guess, and
// guesses differ between voices (on an iPhone "jee" was heard as another letter). The
// spelled name stays in the table for people (letter_name_say_as, display) but is never
// what the voice reads. A recording of the letter's name wins over both.
export function resolveLetter(letter: string, table: SoundTable): { text: string; assetUrl: string | null } {
  const entry = table.letters[letter.toLowerCase()];
  return { text: letter.toUpperCase(), assetUrl: entry?.assetUrl ?? null };
}

// The letter-name rendering for every letter, A–Z, as the voice receives it.
export function letterNameSpeech(letter: string) {
  if (!/^[A-Za-z]$/.test(letter)) throw new Error(`not a letter: ${letter}`);
  return letter.toUpperCase();
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
          return p.text
            .replace(/[A-Za-z]+/g, (w) =>
              bad.has(w.toLowerCase()) ? [...w.toLowerCase()].map(letterToken).join(" ") : w,
            )
            .replace(SPELLED, spelledTokens)
            .replace(LONE_LETTER, (l: string) => letterToken(l));
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

// What a part of speech IS, kept from the token it came from: ordinary words, a phonics
// sound, or a letter's name. The audio service paces each kind differently, and a sound can
// never turn into a letter name on the way (they are different parts, resolved
// differently: resolveSound vs resolveLetter).
export type SpeechRole = "speech" | "phoneme" | "letter_name";

export type SpeechPart =
  | { kind: "tts"; text: string; role: SpeechRole }
  | { kind: "asset"; url: string; fallback: string; role: SpeechRole };

export type PlanOptions = ResolveOptions & {
  // false: tokens are read inside the surrounding words, as one line (captions, audits).
  separateTokens?: boolean;
};

// Text → the clips and utterances to play, in order.
//
// A RUN of sounds ("gate. {/G/}, {/EY/}, {/T/}. gate.") is split into parts of their own
// with a gap around each, so it is never one breath that sounds like "gate g a t gate".
// A single sound or a letter name inside a sentence stays in the sentence ("It says suh, as
// in sun.", "This is the letter S."): read on its own it would be a one-syllable utterance,
// which voices pronounce without context and iOS often clips at the start (a letter name
// alone was misheard on an iPhone). A token that is the whole text is a part of its own
// (a letter name alone is read as "G." so the voice gives it its full citation form). A
// recording always splits. The role of a part says what it is: words, a sound, a letter
// name — it is decided by the resolver, never inferred from the text. Unsafe words left in
// plain text (content imported before this check existed) are dropped: silence is better
// than teaching a letter name as a sound.
export function planSpeech(text: string, table: SoundTable, options: PlanOptions = {}): SpeechPart[] {
  const separate = options.separateTokens ?? true;
  const pieces = parseSpeech(lettersAsTokens(text));
  const meaningful = (p: Piece) => p.kind !== "text" || /[A-Za-z0-9]/.test(p.text.replace(BROKEN_TOKEN, ""));
  const tokens = pieces.filter((p) => p.kind !== "text");
  const alone = tokens.length === 1 && pieces.filter(meaningful).length === 1;
  // Is the token at `i` next to another sound token, with only punctuation between them?
  const inRun = (i: number) => {
    for (const step of [-1, 1]) {
      for (let j = i + step; j >= 0 && j < pieces.length; j += step) {
        const p = pieces[j];
        if (p.kind === "sound") return true;
        if (meaningful(p)) break;
      }
    }
    return false;
  };
  const parts: SpeechPart[] = [];
  let buffer = "";
  const flush = () => {
    let t = buffer
      .replace(/\s+/g, " ")
      .replace(/\s+([,.?!])/g, "$1")
      .trim();
    // Punctuation left at the start by a token that was split off (", as in goat").
    if (separate) t = t.replace(/^[,;:.!?]+\s*/, "");
    if (t && /[A-Za-z0-9]/.test(t)) parts.push({ kind: "tts", text: t, role: "speech" });
    buffer = "";
  };
  pieces.forEach((piece, i) => {
    if (piece.kind === "text") {
      buffer += stripUnsafe(piece.text.replace(BROKEN_TOKEN, " "));
      return;
    }
    const role: SpeechRole = piece.kind === "sound" ? "phoneme" : "letter_name";
    const r =
      piece.kind === "sound"
        ? resolveSound(piece.phonemes, table, options)
        : resolveLetter(piece.letter, table);
    if (r.assetUrl) {
      flush();
      parts.push({ kind: "asset", url: r.assetUrl, fallback: r.text, role });
    } else if (separate && (alone || (piece.kind === "sound" && inRun(i)))) {
      flush();
      if (r.text)
        parts.push({ kind: "tts", text: alone && role === "letter_name" ? `${r.text}.` : r.text, role });
    } else buffer += r.text;
  });
  flush();
  return parts;
}

// How a text will be spoken, token by token, before anything plays (the audio check page,
// tests, debugging): what each token is, what it resolves to and from which source.
export type SpeechExplanation = {
  role: SpeechRole;
  target: string;
  source: "recorded" | "tts" | "keyword" | "none";
  rendering: string;
};

export function explainSpeech(
  text: string,
  table: SoundTable,
  options: ResolveOptions = {},
): SpeechExplanation[] {
  return parseSpeech(lettersAsTokens(text)).flatMap((p): SpeechExplanation[] => {
    if (p.kind === "text") {
      const t = stripUnsafe(p.text.replace(BROKEN_TOKEN, " ")).replace(/\s+/g, " ").trim();
      return /[A-Za-z0-9]/.test(t) ? [{ role: "speech", target: t, source: "tts", rendering: t }] : [];
    }
    if (p.kind === "letter") {
      const r = resolveLetter(p.letter, table);
      return [
        {
          role: "letter_name",
          target: letterToken(p.letter),
          source: r.assetUrl ? "recorded" : "tts",
          rendering: r.text,
        },
      ];
    }
    const r = resolveSound(p.phonemes, table, options);
    const source =
      r.strategy === "asset"
        ? "recorded"
        : r.strategy === "keyword"
          ? "keyword"
          : r.strategy === "tts"
            ? "tts"
            : "none";
    return [{ role: "phoneme", target: soundToken(p.phonemes), source, rendering: r.text }];
  });
}

// Tokens that resolve to nothing (a sound with no rendering, no keyword and no clip, or a
// broken token): what is left of the text is still said, and the gap is logged.
export function unresolvedTokens(text: string, table: SoundTable, options: ResolveOptions = {}): string[] {
  const missing: string[] = [];
  for (const piece of parseSpeech(text)) {
    if (piece.kind === "sound") {
      const r = resolveSound(piece.phonemes, table, options);
      if (r.strategy === "none") missing.push(soundToken(piece.phonemes));
    } else if (piece.kind === "text") missing.push(...(piece.text.match(BROKEN_TOKEN) ?? []));
  }
  return missing;
}

// The whole thing as synthesis would say it (no clips): for tests, audits and captions.
export function speakableText(text: string, table: SoundTable, options: ResolveOptions = {}) {
  return planSpeech(text, stripAssets(table), { ...options, separateTokens: false })
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
      // Several keywords are stored space-separated: "egg elephant elbow".
      keyword: row.keyword
        ? { words: row.keyword.split(/\s+/).filter(Boolean), position: row.keywordPosition ?? "first" }
        : null,
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
    // A letter standing alone is neither a name nor a sound for certain: a voice guesses
    // ("g" alone can be read as "gram"; "says z" means the sound /z/ but is read "zee").
    // Content says which it is: {@g} for its name, a sound token for its sound.
    for (const l of new Set(loneLetters(text)))
      problems.push(
        `"${l}" alone is ambiguous (use ${spelledTokens(l.toLowerCase())} for its name or a sound token)`,
      );
    for (const broken of text.replace(TOKEN, " ").match(BROKEN_TOKEN) ?? [])
      problems.push(`"${broken}" is not a valid speech token`);
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

// The words a question shows (its options, items, word…), which a keyword must avoid.
export function visibleWords(content: unknown): Set<string> {
  const words = new Set<string>();
  const walk = (value: unknown, key: string) => {
    if (typeof value === "string") {
      if (key === "text" || key === "word" || key === "display")
        for (const w of value.toLowerCase().match(/[a-z]+/g) ?? []) words.add(w);
    } else if (Array.isArray(value)) value.forEach((v) => walk(v, key));
    else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) walk(v, k);
  };
  walk(content, "");
  return words;
}
