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
  soundLabelLookup,
  unresolvedTokens,
  visibleWords,
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

describe("keywords never give the answer away", () => {
  const t = buildSoundTable([
    {
      phonemes: ["EH"],
      tts: "",
      quality: "keyword",
      keyword: "egg elephant elbow",
      keywordPosition: "first",
    },
  ]);

  it("names the first keyword that is not on screen", () => {
    const question = {
      options: [
        { id: "sun", text: "sun" },
        { id: "egg", text: "egg" },
      ],
    };
    const avoid = visibleWords(question);
    expect(speakableText("Which one starts with {/EH/}?", t)).toBe(
      "Which one starts with the sound at the start of egg?",
    );
    expect(speakableText("Which one starts with {/EH/}?", t, { avoid })).toBe(
      "Which one starts with the sound at the start of elephant?",
    );
  });

  it("says nothing for the sound when every keyword is on screen", () => {
    const avoid = new Set(["egg", "elephant", "elbow"]);
    expect(resolveSound(["EH"], t, { avoid }).strategy).toBe("none");
  });

  it("collects the words a question shows", () => {
    expect(
      [
        ...visibleWords({
          word: "Ship",
          display: "🚢 ship",
          options: [{ text: "fish", speech: "x" }],
          items: [{ text: "big egg" }],
        }),
      ].sort(),
    ).toEqual(["big", "egg", "fish", "ship"]);
  });
});

describe("recorded audio", () => {
  const withClip = buildSoundTable([
    { phonemes: ["S"], tts: "suh", quality: "approximate", assetUrl: "https://x/s.mp3" },
    { phonemes: ["M"], tts: "muh", quality: "approximate" },
  ]);

  it("an existing clip takes priority over speech synthesis", () => {
    expect(planSpeech(soundToken(["S"]), withClip)).toEqual([
      { kind: "asset", url: "https://x/s.mp3", fallback: "suh", role: "phoneme" },
    ]);
  });

  it("speech synthesis is used only when there is no clip", () => {
    expect(planSpeech(soundToken(["M"]), withClip)).toEqual([{ kind: "tts", text: "muh", role: "phoneme" }]);
  });

  it("every sound is a part of its own: never run into the words around it", () => {
    expect(planSpeech("Which one starts with {/S/}, or {/M/}?", withClip)).toEqual([
      { kind: "tts", text: "Which one starts with", role: "speech" },
      { kind: "asset", url: "https://x/s.mp3", fallback: "suh", role: "phoneme" },
      { kind: "tts", text: "or", role: "speech" },
      { kind: "tts", text: "muh", role: "phoneme" },
    ]);
    // Captions still read as one line.
    expect(speakableText("Which one starts with {/S/}, or {/M/}?", withClip)).toBe(
      "Which one starts with suh, or muh?",
    );
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

  it("reads sound labels written between slashes, splitting only unambiguous ones", () => {
    const lookup = soundLabelLookup([
      { code: "IH", label: "i" },
      { code: "D", label: "d" },
      { code: "IY", label: "ee" },
      { code: "UW", label: "oo" },
      { code: "UH", label: "oo" },
    ]);
    expect(lookup("ee")).toEqual(["IY"]);
    expect(lookup("id")).toEqual(["IH", "D"]);
    expect(lookup("oo")).toBeUndefined();
    expect(lookup("zz")).toBeUndefined();
    expect(speechFromDisplay("It can say /d/ or /id/.", lookup)).toBe("It can say {/D/} or {/IH D/}.");
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

describe("token parsing (every supported form)", () => {
  it("reads canonical sound and letter tokens", () => {
    expect(parseSpeech("{/SH/} and {@s}")).toEqual([
      { kind: "sound", phonemes: ["SH"] },
      { kind: "text", text: " and " },
      { kind: "letter", letter: "s" },
    ]);
    expect(parseSpeech("{/SH AH N/}")).toEqual([{ kind: "sound", phonemes: ["SH", "AH", "N"] }]);
  });

  it("normalizes case and stray spaces, so a typo never becomes letters", () => {
    expect(parseSpeech("{/sh/}")).toEqual([{ kind: "sound", phonemes: ["SH"] }]);
    expect(parseSpeech("{/ k s /}")).toEqual([{ kind: "sound", phonemes: ["K", "S"] }]);
    expect(parseSpeech("{@S}")).toEqual([{ kind: "letter", letter: "s" }]);
    expect(parseSpeech("{@ m }")).toEqual([{ kind: "letter", letter: "m" }]);
    expect(speakableText("Say {/s/}.", table)).toBe("Say suh.");
    expect(speakableText("It starts with {@S}.", table)).toBe("It starts with ess.");
  });

  it("never reads a broken token aloud", () => {
    expect(speakableText("Say {/S1/} now", table)).toBe("Say now");
    expect(speakableText("Say {sound} now", table)).toBe("Say now");
    expect(speakableText("Say {/S/", table)).not.toMatch(/\{|\//);
  });

  it("reports tokens that resolve to nothing, and still says the rest", () => {
    expect(unresolvedTokens("Write {/ZH/} and {oops}", table)).toEqual(["{/ZH/}", "{oops}"]);
    expect(unresolvedTokens("Say {/S/} and {@s}", table)).toEqual([]);
    expect(speakableText("Write the letters for {/ZH/}.", table)).toBe("Write the letters for.");
  });

  it("keeps letter names and sounds apart for the core phonics sounds", () => {
    for (const [phonemes, letter] of [
      [["S"], "s"],
      [["M"], "m"],
      [["K"], "k"],
    ] as const) {
      const sound = speakableText(soundToken(phonemes), table).toLowerCase();
      const name = speakableText(letterToken(letter), table).toLowerCase();
      expect(sound).not.toBe(name);
      expect(findUnsafeSpeech(sound)).toEqual([]);
    }
  });
});

describe("letter name vs sound keep their meaning (Phase 8.2)", () => {
  const t = buildSoundTable(
    [
      { phonemes: ["G"], tts: "guh", quality: "approximate", assetUrl: "https://x/sound-g.mp3" },
      { phonemes: ["S"], tts: "suh", quality: "approximate" },
      { phonemes: ["K"], tts: "kuh", quality: "approximate" },
      { phonemes: ["T"], tts: "tuh", quality: "approximate" },
    ],
    [
      { letter: "g", name: "jee", assetUrl: "https://x/name-g.mp3" },
      { letter: "s", name: "ess" },
      { letter: "c", name: "see" },
      { letter: "t", name: "tee" },
    ],
  );

  for (const [letter, phonemes, name, sound] of [
    ["s", ["S"], "ess", "suh"],
    ["c", ["K"], "see", "kuh"],
    ["t", ["T"], "tee", "tuh"],
  ] as const) {
    it(`${letter.toUpperCase()} (letter name "${name}") ≠ /${phonemes[0].toLowerCase()}/ (sound "${sound}")`, () => {
      expect(planSpeech(letterToken(letter), t)).toEqual([{ kind: "tts", text: name, role: "letter_name" }]);
      expect(planSpeech(soundToken(phonemes), t)).toEqual([{ kind: "tts", text: sound, role: "phoneme" }]);
    });
  }

  it("G: the letter's NAME recording and the SOUND recording are never swapped", () => {
    expect(planSpeech("{@g}", t)).toEqual([
      { kind: "asset", url: "https://x/name-g.mp3", fallback: "jee", role: "letter_name" },
    ]);
    expect(planSpeech("{/G/}", t)).toEqual([
      { kind: "asset", url: "https://x/sound-g.mp3", fallback: "guh", role: "phoneme" },
    ]);
  });

  it("a sound with no safe rendering says nothing — never the letter's name", () => {
    const none = buildSoundTable(
      [{ phonemes: ["ZH"], tts: "", quality: "keyword" }],
      [{ letter: "z", name: "zee" }],
    );
    expect(planSpeech("{/ZH/}", none)).toEqual([]);
    expect(planSpeech("{/zh/}", none)).toEqual([]);
  });

  it("tokens in any case or spacing keep their kind", () => {
    for (const token of ["{@s}", "{@S}", "{ @s }", "{@ s}"])
      expect(planSpeech(token, t), token).toEqual([{ kind: "tts", text: "ess", role: "letter_name" }]);
    for (const token of ["{/s/}", "{/S/}", "{/ s /}", "{/ S/}"])
      expect(planSpeech(token, t), token).toEqual([{ kind: "tts", text: "suh", role: "phoneme" }]);
    for (const broken of ["{/s", "{@", "{sound}", "{/S1/}", "{@ss}"])
      expect(planSpeech(`Say ${broken} now`, t), broken).toEqual([
        { kind: "tts", text: "Say now", role: "speech" },
      ]);
  });
});

it("{ /s/ } and { @s } (spaces inside the braces) are tokens too", () => {
  const t = buildSoundTable(
    [{ phonemes: ["S"], tts: "suh", quality: "approximate" }],
    [{ letter: "s", name: "ess" }],
  );
  expect(planSpeech("{ /s/ }", t)).toEqual([{ kind: "tts", text: "suh", role: "phoneme" }]);
  expect(planSpeech("{ @s }", t)).toEqual([{ kind: "tts", text: "ess", role: "letter_name" }]);
  expect(
    planSpeech("{ /SH/ }", buildSoundTable([{ phonemes: ["SH"], tts: "shuh", quality: "approximate" }])),
  ).toEqual([{ kind: "tts", text: "shuh", role: "phoneme" }]);
});
