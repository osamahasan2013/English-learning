import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildSoundTable,
  findUnsafeSpeech,
  letterToken,
  parseSpeech,
  planSpeech,
  resolveLetter,
  resolveSound,
  soundToken,
  speakableText,
  speechFromDisplay,
  speechProblems,
  type SoundTable,
} from "@/lib/audio/pronunciation";
import { phonicsFileSchema } from "@/lib/content/content-schemas";

// The pronunciation resolver decides what is said for phonics sounds and letter names.
// Browser voices read letters as letter NAMES ("sss" → "ess ess ess", "th" → "tee aitch";
// checked with espeak-ng, the engine behind Chrome and Firefox on Linux), so a sound is
// never spoken as its letters.

const table: SoundTable = buildSoundTable(
  [
    { phonemes: ["S"], tts: "suh", quality: "approximate", keyword: "sun", keywordPosition: "first" },
    { phonemes: ["M"], tts: "muh", quality: "approximate", keyword: "man", keywordPosition: "first" },
    { phonemes: ["K"], tts: "kuh", quality: "approximate" },
    { phonemes: ["T"], tts: "tuh", quality: "approximate" },
    { phonemes: ["SH"], tts: "shuh", quality: "approximate" },
    { phonemes: ["AE"], tts: "", quality: "keyword", keyword: "apple", keywordPosition: "first" },
    { phonemes: ["UH"], tts: "", quality: "keyword", keyword: "book", keywordPosition: "middle" },
    { phonemes: ["IY"], tts: "ee", quality: "pure" },
    { phonemes: ["SH", "AH", "N"], tts: "shun", quality: "pure" },
  ],
  [
    { letter: "s", name: "ess" },
    { letter: "h", name: "aitch" },
  ],
);

describe("letter name vs phoneme", () => {
  it("a letter-name request says the letter's NAME", () => {
    expect(speakableText(letterToken("s"), table)).toBe("ess");
    expect(resolveLetter("h", table).text).toBe("aitch");
    // Without a table entry a single capital is read as its name by every engine.
    expect(resolveLetter("b", table).text).toBe("B");
  });

  it("a phonics request says the SOUND, through the phoneme strategy", () => {
    expect(speakableText(soundToken(["S"]), table)).toBe("suh");
    expect(resolveSound(["S"], table)).toMatchObject({ strategy: "tts", quality: "approximate" });
  });

  it('the sound /s/ is never "s s s", "sss" or the name "ess"', () => {
    const said = speakableText(soundToken(["S"]), table);
    expect(said).not.toMatch(/^s( s)+$/);
    expect(said).not.toMatch(/sss/);
    expect(said).not.toBe("ess");
    expect(findUnsafeSpeech(said)).toEqual([]);
  });

  it("phonics never falls back to the alphabet path", () => {
    // Even with letter names in the table, a sound with no rendering says nothing
    // rather than the letter's name.
    expect(resolveSound(["Z"], table)).toMatchObject({ text: "", strategy: "none" });
    expect(speakableText("It says {/Z/}.", table)).toBe("It says.");
    expect(speakableText(soundToken(["S"]), table)).not.toBe(resolveLetter("s", table).text);
  });

  it("the same letter can be taught both ways, explicitly", () => {
    expect(speakableText("This is the letter {@s}. It says {/S/}, as in sun.", table)).toBe(
      "This is the letter ess. It says suh, as in sun.",
    );
  });
});

describe("sounds without a safe synthesis rendering", () => {
  it("name a keyword that has the sound instead of inventing one", () => {
    expect(speakableText(soundToken(["AE"]), table)).toBe("the sound at the start of apple");
    expect(speakableText(soundToken(["UH"]), table)).toBe("the sound in the middle of book");
    expect(resolveSound(["AE"], table).strategy).toBe("keyword");
  });

  it("multi-sound patterns use their own rendering, else their phonemes", () => {
    expect(speakableText(soundToken(["SH", "AH", "N"]), table)).toBe("shun");
    expect(speakableText(soundToken(["K", "S"]), table)).toBe("kuh suh");
    // A part with no rendering: nothing, not a guess.
    expect(resolveSound(["K", "AE"], table).strategy).toBe("none");
  });
});

describe("recorded audio", () => {
  const withClip = buildSoundTable([
    { phonemes: ["S"], tts: "suh", quality: "approximate", assetUrl: "https://x/s.mp3" },
    { phonemes: ["M"], tts: "muh", quality: "approximate" },
  ]);

  it("an existing clip takes priority over speech synthesis", () => {
    expect(planSpeech(soundToken(["S"]), withClip)).toEqual([
      { kind: "asset", url: "https://x/s.mp3", fallback: "suh" },
    ]);
  });

  it("speech synthesis is used only when there is no clip", () => {
    expect(planSpeech(soundToken(["M"]), withClip)).toEqual([{ kind: "tts", text: "muh" }]);
  });

  it("a clip splits a sentence; the words around it are still spoken", () => {
    expect(planSpeech("Which one starts with {/S/}, or {/M/}?", withClip)).toEqual([
      { kind: "tts", text: "Which one starts with" },
      { kind: "asset", url: "https://x/s.mp3", fallback: "suh" },
      { kind: "tts", text: ", or muh?" },
    ]);
  });

  it("a later row adds a clip to a sound without replacing its rendering", () => {
    const t = buildSoundTable([
      { phonemes: ["S"], tts: "suh", quality: "approximate" },
      { phonemes: ["S"], tts: "", quality: "approximate", assetUrl: "https://x/s2.mp3" },
    ]);
    expect(t.sounds.S).toMatchObject({ tts: "suh", assetUrl: "https://x/s2.mp3" });
  });
});

describe("unsafe speech", () => {
  it("finds words voices read as letter names", () => {
    expect(findUnsafeSpeech("It says sss. Then th, ng, shh and st.")).toEqual([
      "sss",
      "th",
      "ng",
      "shh",
      "st",
    ]);
    // Letter names on purpose, real words and acronyms are fine.
    expect(findUnsafeSpeech("It starts with s. I see a sky on TV. ee oo")).toEqual([]);
    // Inside a token the letters are not words.
    expect(findUnsafeSpeech("{/SH/} {@s}")).toEqual([]);
  });

  it("drops letter strings left in old content rather than say letter names", () => {
    expect(speakableText("Which one starts with sss?", table)).toBe("Which one starts with?");
  });

  it("display text read aloud: /k/ is the sound, ch the letters", () => {
    const speech = speechFromDisplay("The ch in school says /k/.", (l) => (l === "k" ? ["K"] : undefined));
    expect(speech).toBe("The {@c} {@h} in school says {/K/}.");
    expect(speakableText(speech, table)).toBe("The C aitch in school says kuh.");
  });

  it("checks every speech string in a question", () => {
    expect(
      speechProblems("Which word has {/SH/}?", { options: [{ text: "sh", speech: "shh" }] }, new Set(["SH"])),
    ).toEqual(['"shh" would be read as letter names (use a sound token)']);
    expect(speechProblems("{/QQ/}", {}, new Set(["SH"]))).toEqual(["unknown phoneme QQ in a sound token"]);
    // Display text (option text) is not speech.
    expect(speechProblems("", { options: [{ text: "sh" }] })).toEqual([]);
  });

  it("parses tokens and text", () => {
    expect(parseSpeech("a {/SH AH N/} b {@x}")).toEqual([
      { kind: "text", text: "a " },
      { kind: "sound", phonemes: ["SH", "AH", "N"] },
      { kind: "text", text: " b " },
      { kind: "letter", letter: "x" },
    ]);
    expect(soundToken([])).toBe("");
    expect(() => soundToken(["sh"])).toThrow();
  });
});

describe("the shipped phonics data", () => {
  const file = phonicsFileSchema.parse(JSON.parse(readFileSync("content/phonics.json", "utf8")));
  const shipped = buildSoundTable(
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

  it("every pattern sound resolves to something safe to say", () => {
    for (const p of file.patterns)
      for (const s of p.sounds) {
        const r = resolveSound(s.phonemes, shipped);
        expect(r.strategy, `${p.code} ${s.code}`).not.toBe("none");
        expect(findUnsafeSpeech(r.text), `${p.code} ${s.code}: ${r.text}`).toEqual([]);
      }
  });

  it("no letter's sound is said as the letter's name", () => {
    for (const p of file.patterns.filter((x) => x.type === "letter")) {
      const name = resolveLetter(p.pattern, shipped).text.toLowerCase();
      for (const s of p.sounds) {
        // Long vowels "say their name" (a_e, ee …): only consonant sounds are checked.
        if (s.code.includes("LONG") || ["AY", "EY", "IY", "OW"].includes(s.phonemes.join(" "))) continue;
        expect(resolveSound(s.phonemes, shipped).text.toLowerCase(), `${p.code} ${s.code}`).not.toBe(name);
      }
    }
  });

  it("the key sounds use the renderings checked with espeak-ng", () => {
    const say = (p: string[]) => resolveSound(p, shipped).text;
    expect(say(["S"])).toBe("suh");
    expect(say(["M"])).toBe("muh");
    expect(say(["SH"])).toBe("shuh");
    expect(say(["CH"])).toBe("chuh");
    // TH has two sounds: voiceless (thin) and voiced (this).
    expect(say(["TH"])).toBe("thuh");
    expect(say(["DH"])).toBe("the");
    expect(say(["NG"])).toBe("ung");
    expect(say(["EY"])).toBe("eigh");
    expect(say(["IH", "NG"])).toBe("ing");
    expect(say(["AE"])).toBe("the sound at the start of apple");
  });
});
