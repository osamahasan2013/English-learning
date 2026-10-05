import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AUDIO_CHECK_ITEMS,
  describeDevice,
  formatResults,
  slowNormalRatio,
  type RequestSummary,
} from "@/lib/audio/audio-check";
import { citationForm } from "@/lib/audio/audio-service";
import { chunkText, paceFor, resolveAudioPacing } from "@/lib/audio/pacing";
import {
  buildSoundTable,
  explainSpeech,
  letterNameSpeech,
  lettersAsTokens,
  letterToken,
  loneLetters,
  planSpeech,
  soundLabelLookup,
  soundToken,
  speechFromDisplay,
  speechProblems,
  type SoundRow,
} from "@/lib/audio/pronunciation";
import { phonicsFileSchema } from "@/lib/content/content-schemas";
import { DEFAULT_RULES } from "@/lib/learning/rules";

// Phase 8.3 — pronunciation accuracy, against the REAL phonics content (content/phonics.json):
// every letter NAME is the letter's name and never one of its sounds; G and S are routed
// correctly in every mode (letter name, sound, word, segmenting, blending); "the" is never
// spoken alone or left dangling at the end of a piece. These tests check what the voice is
// GIVEN and with which meaning — they cannot check how a device's voice SOUNDS. That is the
// human listening test on /parent/audio-check.

const phonics = phonicsFileSchema.parse(JSON.parse(readFileSync("content/phonics.json", "utf8")));
const rows: SoundRow[] = [
  ...phonics.phonemes.map((p) => ({
    phonemes: [p.code],
    tts: p.sayAs,
    quality: p.ttsQuality,
    keyword: p.keyword ?? null,
    keywordPosition: p.keywordPosition,
  })),
];
const letters = phonics.patterns.filter((p) => p.type === "letter");
const table = buildSoundTable(
  rows,
  letters.map((p) => ({ letter: p.pattern, name: p.letterNameSayAs })),
);
const ALPHABET = "abcdefghijklmnopqrstuvwxyz".split("");

describe("letter names A–Z", () => {
  it("every letter of the alphabet has a letter pattern, a capital and a name", () => {
    expect(letters.map((p) => p.pattern).sort()).toEqual(ALPHABET);
    for (const p of letters) {
      expect(p.uppercase, p.pattern).toBe(p.pattern.toUpperCase());
      expect(p.letterName, p.pattern).toBeTruthy();
      // What the voice is given for the name is the capital letter (the stored rendering agrees).
      expect(p.letterNameSayAs, p.pattern).toBe(p.pattern.toUpperCase());
    }
  });

  for (const letter of ALPHABET) {
    it(`${letter.toUpperCase()}: LETTER_NAME → "${letter.toUpperCase()}", never one of its sounds`, () => {
      expect(letterNameSpeech(letter)).toBe(letter.toUpperCase());
      for (const token of [letterToken(letter), `{@${letter.toUpperCase()}}`])
        expect(planSpeech(token, table), token).toEqual([
          { kind: "tts", text: `${letter.toUpperCase()}.`, role: "letter_name" },
        ]);
      expect(explainSpeech(letterToken(letter), table)).toEqual([
        { role: "letter_name", target: letterToken(letter), source: "tts", rendering: letter.toUpperCase() },
      ]);
      // None of the letter's own sounds is rendered as its name (or vice versa) — except a
      // long vowel, which in phonics says its name ("e_e says ee"): that is correct.
      const pattern = letters.find((p) => p.pattern === letter)!;
      for (const sound of pattern.sounds) {
        const said = explainSpeech(soundToken(sound.phonemes), table)[0];
        expect(said.role).toBe("phoneme");
        expect(said.rendering.toLowerCase(), `${letter} ${sound.code}`).not.toBe(letter);
        if (!/_LONG$/.test(sound.code))
          expect(said.rendering.toLowerCase(), `${letter} ${sound.code}`).not.toBe(
            pattern.letterName.toLowerCase(),
          );
      }
    });
  }
});

describe("G, every way it is taught", () => {
  it("letter name G and g: the name, as a letter name", () => {
    expect(planSpeech("{@G}", table)).toEqual([{ kind: "tts", text: "G.", role: "letter_name" }]);
    expect(planSpeech("{@g}", table)).toEqual([{ kind: "tts", text: "G.", role: "letter_name" }]);
    expect(planSpeech("This is the letter {@g}.", table)).toEqual([
      { kind: "tts", text: "This is the letter G.", role: "speech" },
    ]);
  });

  it('phoneme /g/: the sound, never the name G (and never "jee")', () => {
    const g = planSpeech("{/G/}", table);
    expect(g).toEqual([{ kind: "tts", text: "guh", role: "phoneme" }]);
    expect(explainSpeech("{/G/}", table)[0]).toMatchObject({
      role: "phoneme",
      target: "{/G/}",
      source: "tts",
    });
    expect(["g", "g.", "jee"]).not.toContain(g[0].kind === "tts" ? g[0].text.toLowerCase() : "");
  });

  it("word gate: the word, whole", () => {
    expect(planSpeech("gate", table)).toEqual([{ kind: "tts", text: "gate", role: "speech" }]);
    expect(citationForm("gate")).toBe("gate.");
  });

  it("segmenting gate → /g/ /ā/ /t/: three separate sounds between the words", () => {
    expect(planSpeech("gate. {/G/}, {/EY/}, {/T/}. gate.", table)).toEqual([
      { kind: "tts", text: "gate.", role: "speech" },
      { kind: "tts", text: "guh", role: "phoneme" },
      { kind: "tts", text: "eigh", role: "phoneme" },
      { kind: "tts", text: "tuh", role: "phoneme" },
      { kind: "tts", text: "gate.", role: "speech" },
    ]);
  });

  it("blending /g/ + /ā/ + /t/ → gate: each sound its own request, then the word", () => {
    const sequence = ["{/G/}", "{/EY/}", "{/T/}"].map((t) => planSpeech(t, table)[0]);
    expect(sequence.map((p) => p.role)).toEqual(["phoneme", "phoneme", "phoneme"]);
    expect(planSpeech("gate", table)[0].role).toBe("speech");
  });
});

describe("S", () => {
  it("letter name S vs phoneme /s/", () => {
    expect(planSpeech("{@s}", table)).toEqual([{ kind: "tts", text: "S.", role: "letter_name" }]);
    expect(planSpeech("{/S/}", table)).toEqual([{ kind: "tts", text: "sah", role: "phoneme" }]);
    expect(planSpeech("It starts with {@s}. It says {/S/}, as in sun.", table)).toEqual([
      { kind: "tts", text: "It starts with S. It says sah, as in sun.", role: "speech" },
    ]);
  });
});

describe('"the"', () => {
  const SENTENCES = [
    "The cat is at the gate.",
    "The dog is in the sun.",
    "The big cat can run.",
    "The apple is red.",
    "The boy has a ball.",
    "Sam and the cat sat on the mat.",
  ];
  const ARTICLE = /^(the|a|an)$/i;
  const lastWord = (t: string) =>
    t
      .split(/\s+/)
      .at(-1)!
      .replace(/[^\p{L}]/gu, "");

  for (const level of ["KG1", "KG2", "KG3", "GRADE1", "GRADE2"])
    for (const speed of ["normal", "slow"] as const)
      it(`${level} ${speed}: "the" / "a" is never a piece on its own or at the end of a piece`, () => {
        const pace = paceFor("STORY_READING", speed, resolveAudioPacing(DEFAULT_RULES.audio, level));
        for (const s of SENTENCES) {
          const pieces = chunkText(s, pace);
          for (const p of pieces) {
            expect(ARTICLE.test(p.text.replace(/[^\p{L}\s]/gu, "").trim()), `${s} → "${p.text}"`).toBe(false);
            expect(ARTICLE.test(lastWord(p.text)), `${s} → "${p.text}"`).toBe(false);
          }
          // Nothing is lost or repeated: the pieces are the sentence.
          expect(pieces.map((p) => p.text).join(" ")).toBe(s);
        }
      });

  it("the word on its own is said as a word, with a full stop for its whole form", () => {
    expect(planSpeech("the", table)).toEqual([{ kind: "tts", text: "the", role: "speech" }]);
    expect(citationForm("the")).toBe("the.");
    expect(citationForm("The")).toBe("The.");
    expect(citationForm("gate!")).toBe("gate!");
  });

  it("is never spelled or turned into sounds in reading", () => {
    expect(planSpeech("The cat is at the gate.", table)).toEqual([
      { kind: "tts", text: "The cat is at the gate.", role: "speech" },
    ]);
    expect(explainSpeech("The cat is at the gate.", table).map((e) => e.role)).toEqual(["speech"]);
  });
});

describe("speech tokens are validated", () => {
  it("a bare letter on its own is rejected; a letter token, a sound token and the words a / I are fine", () => {
    expect(speechProblems("g", {})).toEqual([expect.stringContaining("ambiguous")]);
    expect(speechProblems("", { options: [{ speech: "S" }] })).toEqual([
      expect.stringContaining("ambiguous"),
    ]);
    for (const ok of ["{@g}", "{/G/}", "a", "I", "the", "Find the big letter {@g}."])
      expect(speechProblems(ok, {}), ok).toEqual([]);
  });

  it("malformed and unknown tokens are reported and never spoken", () => {
    expect(speechProblems("Say {sound}.", {})).toEqual([expect.stringContaining("not a valid speech token")]);
    expect(speechProblems("Say {/S", {})).toEqual([expect.stringContaining("not a valid speech token")]);
    expect(speechProblems("Say {/ZZZZ/}", {}, new Set(["S"]))).not.toEqual([]);
    expect(planSpeech("Say {sound} now.", table)).toEqual([
      { kind: "tts", text: "Say now.", role: "speech" },
    ]);
  });

  it("tokens inside punctuation, repeated tokens and mixed sentences keep their meaning", () => {
    expect(planSpeech("(It says {/S/}!)", table)).toEqual([
      { kind: "tts", text: "(It says sah!)", role: "speech" },
    ]);
    // A run of sounds — even the same one twice — is split into separate sounds.
    expect(planSpeech("{/S/} {/S/}", table)).toEqual([
      { kind: "tts", text: "sah", role: "phoneme" },
      { kind: "tts", text: "sah", role: "phoneme" },
    ]);
    expect(explainSpeech("The letter {@g} says {/G/} in gate.", table)).toEqual([
      { role: "speech", target: "The letter", source: "tts", rendering: "The letter" },
      { role: "letter_name", target: "{@g}", source: "tts", rendering: "G" },
      { role: "speech", target: "says", source: "tts", rendering: "says" },
      { role: "phoneme", target: "{/G/}", source: "tts", rendering: "guh" },
      { role: "speech", target: "in gate.", source: "tts", rendering: "in gate." },
    ]);
  });

  it("a sound with no safe rendering is a keyword or nothing — never a letter name", () => {
    const ae = explainSpeech("{/AE/}", table)[0];
    expect(ae).toMatchObject({ role: "phoneme", source: "keyword" });
    expect(ae.rendering).toMatch(/^the sound at the start of /);
  });
});

describe("audio check (/parent/audio-check)", () => {
  const byId = new Map(AUDIO_CHECK_ITEMS.map((i) => [i.id, i]));
  const roles = (id: string) =>
    byId.get(id)!.requests.flatMap((r) => explainSpeech(r.text, table).map((e) => e.role));

  it("has the required tests, each with an intent, a target and valid speech", () => {
    for (const id of [
      "letter-a",
      "letter-g",
      "letter-s",
      "letter-t",
      "phoneme-g",
      "phoneme-s",
      "phoneme-m",
      "phoneme-t",
      "word-gate",
      "word-cat",
      "word-the",
      "sentence",
      "segmenting",
      "blending",
      ...[1, 2, 3, 4, 5].flatMap((n) => [`reading-${n}-normal`, `reading-${n}-slow`]),
    ])
      expect(byId.has(id), id).toBe(true);
    expect(new Set(AUDIO_CHECK_ITEMS.map((i) => i.id)).size).toBe(AUDIO_CHECK_ITEMS.length);
    for (const item of AUDIO_CHECK_ITEMS) {
      expect(item.intent && item.target && item.expect, item.id).toBeTruthy();
      for (const r of item.requests) expect(speechProblems(r.text, {}), item.id).toEqual([]);
    }
  });

  it("each test means what it says: a letter name, a sound, a word, a sentence", () => {
    for (const l of ["a", "g", "s", "t"]) expect(roles(`letter-${l}`)).toEqual(["letter_name"]);
    for (const p of ["g", "s", "m", "t"]) expect(roles(`phoneme-${p}`)).toEqual(["phoneme"]);
    for (const w of ["gate", "cat", "the"]) {
      expect(roles(`word-${w}`)).toEqual(["speech"]);
      expect(byId.get(`word-${w}`)!.requests[0].intent).toBe("WORD");
    }
    expect(roles("segmenting")).toEqual(["phoneme", "phoneme", "phoneme"]);
    expect(roles("blending")).toEqual(["phoneme", "phoneme", "phoneme", "speech"]);
    for (const item of AUDIO_CHECK_ITEMS.filter((i) => i.group === "READING")) {
      expect(item.requests.map((r) => r.intent)).toEqual(["STORY_READING"]);
      expect(roles(item.id)).toEqual(["speech"]);
    }
  });

  it("compares Slow with Normal only when both played to the end", () => {
    const run = (elapsedMs: number, outcome: RequestSummary["outcome"]): RequestSummary => ({
      requestId: 1,
      intent: "STORY_READING",
      speed: "normal",
      level: "KG1",
      rates: [0.7],
      pieces: 2,
      retries: 0,
      pacedSilenceMs: 0,
      elapsedMs,
      speakingMs: elapsedMs,
      voice: "Samantha",
      outcome,
    });
    expect(slowNormalRatio(run(2000, "heard"), run(4000, "heard")).ratio).toBe(2);
    // An iPhone run where the next test started during Slow: 1.29× is not a real ratio.
    expect(slowNormalRatio(run(2223, "heard"), run(2870, "interrupted"))).toEqual({
      ratio: null,
      note: expect.stringContaining("Slow did not play to the end"),
    });
    expect(slowNormalRatio(undefined, run(1, "heard")).ratio).toBeNull();
  });

  it("reports the device without anything personal, and formats results to share", () => {
    expect(
      describeDevice(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
      ),
    ).toEqual({ os: "iOS 18.5", browser: "Safari" });
    expect(
      describeDevice(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36",
      ),
    ).toEqual({ os: "Android 14", browser: "Chrome" });
    const text = formatResults({
      at: "2026-10-05T10:00:00.000Z",
      device: { os: "iOS 18.5", browser: "Safari" },
      voice: "Samantha (on device)",
      locale: "en-US",
      results: [
        {
          testId: "letter-g",
          intent: "LETTER_NAME",
          target: "G",
          verdict: "FAIL",
          note: "heard S",
          source: "tts",
          level: "KG1",
        },
      ],
      timing: () => "",
    });
    expect(text).toContain("Device: iOS 18.5, Safari · voice: Samantha (on device) · locale: en-US");
    expect(text).toContain(
      "letter-g [KG1] FAIL · intent LETTER_NAME · target G · source tts · note: heard S",
    );
  });
});

describe("a raw letter is never handed to the voice (Phase 8.3)", () => {
  const labels = soundLabelLookup(phonics.phonemes);

  it("a letter standing alone is a letter NAME, rendered from the A–Z table", () => {
    expect(lettersAsTokens("s and h together")).toBe("{@s} and {@h} together");
    expect(lettersAsTokens("Of is spelled o-f.")).toBe("Of is spelled {@o} {@f}.");
    // Words, contractions and hyphenated words are left alone; "a" and "I" are words.
    for (const text of ["Let's go, I see a cat.", "a T-shirt", "it's", "x-ray", "A dog."])
      expect(lettersAsTokens(text), text).toBe(text);
    expect(planSpeech("It starts with b.", table)).toEqual([
      { kind: "tts", text: "It starts with B.", role: "speech" },
    ]);
    expect(planSpeech("g", table)).toEqual([{ kind: "tts", text: "G.", role: "letter_name" }]);
    expect(explainSpeech("big C", table).map((e) => e.role)).toEqual(["speech", "letter_name"]);
  });

  it("display text read aloud: letters become names, /sounds/ become sound tokens", () => {
    expect(speechFromDisplay("The s here says /z/.", labels)).toBe("The {@s} here says {/Z/}.");
    expect(speechFromDisplay("This is the letter i.", labels)).toBe("This is the letter {@i}.");
    // "a" is the letter where the article cannot stand: next to another letter, before a comma.
    expect(speechFromDisplay("a and i together say", labels)).toBe("{@a} and {@i} together say");
    expect(speechFromDisplay("e and a together often say /ee/", labels)).toBe(
      "{@e} and {@a} together often say {/IY/}",
    );
    expect(speechFromDisplay("When r comes after a, they say", labels)).toBe(
      "When {@r} comes after {@a}, they say",
    );
    for (const article of ["I see a cat.", "I see a...", "a", "Is it a cat or a dog?"])
      expect(lettersAsTokens(article), article).toBe(article);
    expect(planSpeech(speechFromDisplay("The s here says /z/.", labels), table)).toEqual([
      { kind: "tts", text: "The S here says zuh.", role: "speech" },
    ]);
  });

  it("content with a raw letter is rejected, whichever it means", () => {
    expect(loneLetters("Does the s say s, or z?")).toEqual(["s", "s", "z"]);
    expect(speechProblems("Does the s say s, or z?", {})).toEqual([
      expect.stringContaining('"s" alone'),
      expect.stringContaining('"z" alone'),
    ]);
    expect(speechProblems("Does the {@s} say {/S/}, or {/Z/}?", {})).toEqual([]);
    expect(speechProblems("{@o} and a together say", {})).toEqual([expect.stringContaining('"a" alone')]);
    expect(speechProblems("", { left: [{ speech: "big C" }] })).toEqual([
      expect.stringContaining('"C" alone'),
    ]);
  });
});

describe("a letter name is never a piece on its own inside a sentence", () => {
  const LINES = [
    "This is the letter {@g}. It says {/G/}, as in goat.",
    "Let's learn {@s} {@h}. It says {/SH/}!",
    "Find the big letter {@t}.",
    "Let's meet the letter {@s}!",
  ];
  for (const level of ["KG1", "KG2", "KG3", "GRADE1", "GRADE2"])
    for (const speed of ["normal", "slow"] as const)
      it(`${level} ${speed}`, () => {
        const pacing = resolveAudioPacing(DEFAULT_RULES.audio, level);
        for (const line of LINES)
          for (const part of planSpeech(line, table)) {
            expect(part.role, line).toBe("speech");
            const text = part.kind === "tts" ? part.text : "";
            for (const piece of chunkText(text, paceFor("INSTRUCTION", speed, pacing)))
              // Not "S." or "S H." on its own: the name stays with the words before it.
              expect(/^([B-HJ-Z][.!?,]*\s*)+$/.test(piece.text), `${line} → "${piece.text}"`).toBe(false);
          }
      });
});
