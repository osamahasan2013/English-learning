import { describe, expect, it } from "vitest";
import {
  addedSilenceMs,
  chunkText,
  countWords,
  paceFor,
  resolveAudioPacing,
  type AudioIntent,
} from "@/lib/audio/pacing";
import { summarizeTimings } from "@/lib/audio/audio-check";
import type { AudioTiming } from "@/lib/audio/audio-service";
import { DEFAULT_RULES, mergeLearningRules } from "@/lib/learning/rules";

// Reading pacing (Phase 8.2): per-level rate, pieces and pauses from the `audio` learning
// rules. Slow must be slower on every engine, so it reads smaller pieces with pauses, not
// only at a lower rate (iOS Safari barely changes speed with the rate alone).

const SAMPLE = "The cat is at the gate.";
const LEVELS = ["KG1", "KG2", "KG3", "GRADE1", "GRADE2"];

describe("pacing per level", () => {
  it("has a pace for every level, and falls back to the default level", () => {
    for (const level of LEVELS) expect(resolveAudioPacing(DEFAULT_RULES.audio, level).level).toBe(level);
    expect(resolveAudioPacing(DEFAULT_RULES.audio, "NOPE").level).toBe("KG3");
    expect(resolveAudioPacing(DEFAULT_RULES.audio, null).level).toBe("KG3");
  });

  it("Slow is slower than Normal at every level: lower rate AND more silence (engine-independent)", () => {
    for (const level of LEVELS) {
      const { reading } = resolveAudioPacing(DEFAULT_RULES.audio, level);
      expect(reading.slow.rate, level).toBeLessThan(reading.normal.rate);
      expect(addedSilenceMs(SAMPLE, reading.slow), level).toBeGreaterThanOrEqual(
        addedSilenceMs(SAMPLE, reading.normal) + 500,
      );
      // Never so slow that voices distort.
      expect(reading.slow.rate, level).toBeGreaterThanOrEqual(0.6);
    }
  });

  it("the youngest hear smaller pieces and slower speech than older children", () => {
    const kg1 = resolveAudioPacing(DEFAULT_RULES.audio, "KG1").reading;
    const g2 = resolveAudioPacing(DEFAULT_RULES.audio, "GRADE2").reading;
    expect(kg1.normal.rate).toBeLessThan(g2.normal.rate);
    expect(chunkText(SAMPLE, kg1.normal).length).toBeGreaterThan(chunkText(SAMPLE, g2.normal).length);
    expect(chunkText(SAMPLE, kg1.slow).map((c) => c.text)).toEqual([
      "The",
      "cat",
      "is",
      "at",
      "the",
      "gate.",
    ]);
    expect(chunkText(SAMPLE, g2.normal).map((c) => c.text)).toEqual([SAMPLE]);
  });

  it("can be changed per level with a learning_rules override (a bad one is ignored)", () => {
    const { rules } = mergeLearningRules([
      { code: "audio", config: { levels: { KG1: { slow: { rate: 0.7 } } } } },
    ]);
    expect(rules.audio.levels.KG1.slow.rate).toBe(0.7);
    expect(rules.audio.levels.KG1.slow.chunk).toBe("word");
    const bad = mergeLearningRules([{ code: "audio", config: { levels: { KG1: { slow: { rate: 0.1 } } } } }]);
    expect(bad.rules.audio.levels.KG1.slow.rate).toBe(DEFAULT_RULES.audio.levels.KG1.slow.rate);
    expect(bad.errors).toHaveLength(1);
  });
});

describe("chunkText", () => {
  const pace = { rate: 0.8, chunk: "phrase" as const, maxWords: 3, pauseMs: 200, sentenceGapMs: 600 };

  it("reads phrases of balanced size, keeping punctuation on its word", () => {
    expect(chunkText("The big red dog ran to the park.", pace).map((c) => c.text)).toEqual([
      "The big red",
      "dog ran to",
      "the park.",
    ]);
    expect(chunkText("Look, a cat!", pace).map((c) => c.text)).toEqual(["Look,", "a cat!"]);
  });

  it("puts the sentence gap between sentences and the phrase pause inside them", () => {
    const chunks = chunkText("I see a cat. It naps.", pace);
    expect(chunks.map((c) => [c.text, c.pauseBeforeMs])).toEqual([
      ["I see", 0],
      ["a cat.", 200],
      ["It naps.", 600],
    ]);
  });

  it("reports which words each piece covers (for highlighting)", () => {
    const words = chunkText("I see a cat. It naps.", { ...pace, chunk: "word" });
    expect(words.map((c) => [c.text, c.wordStart, c.wordCount])).toEqual([
      ["I", 0, 1],
      ["see", 1, 1],
      ["a", 2, 1],
      ["cat.", 3, 1],
      ["It", 4, 1],
      ["naps.", 5, 1],
    ]);
    expect(countWords("I see a cat. It naps.")).toBe(6);
  });

  it("splits a sentence too long for one utterance even when reading whole sentences", () => {
    const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ") + ".";
    const chunks = chunkText(long, { ...pace, chunk: "sentence" }, 120);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((c) => c.text.length <= 120)).toBe(true);
  });
});

describe("intents", () => {
  const kg1 = resolveAudioPacing(DEFAULT_RULES.audio, "KG1");

  it("instructions and feedback: natural sentences at Normal, phrases at Slow, never word by word", () => {
    for (const intent of ["INSTRUCTION", "FEEDBACK"] as AudioIntent[]) {
      expect(paceFor(intent, "normal", kg1).chunk).toBe("sentence");
      expect(paceFor(intent, "slow", kg1).chunk).toBe("phrase");
    }
    expect(paceFor("STORY_READING", "slow", kg1).chunk).toBe("word");
  });

  it("a word is one piece; a sound or letter name uses the phonics rate", () => {
    expect(paceFor("WORD", "slow", kg1).chunk).toBe("sentence");
    expect(paceFor("PHONEME", "normal", kg1).rate).toBe(kg1.phonics.rate.normal);
    expect(paceFor("LETTER_NAME", "slow", kg1).rate).toBe(kg1.phonics.rate.slow);
  });
});

describe("audio check timing summary", () => {
  const row = (piece: number, extra: Partial<AudioTiming> = {}): AudioTiming => ({
    requestId: 7,
    intent: "STORY_READING",
    role: "speech",
    speed: "slow",
    level: "KG1",
    rate: 0.62,
    piece,
    pieces: 2,
    pauseBeforeMs: piece === 0 ? 0 : 380,
    chars: 4,
    retry: false,
    voice: "Samantha",
    spokeAt: 1000 + piece * 1000,
    startedAt: 1050 + piece * 1000,
    endedAt: 1600 + piece * 1000,
    outcome: "ended",
    error: null,
    ...extra,
  });

  it("adds up pieces, paced silence, elapsed and speaking time per request", () => {
    expect(summarizeTimings([row(0), row(1)])).toEqual([
      expect.objectContaining({
        requestId: 7,
        pieces: 2,
        pacedSilenceMs: 380,
        elapsedMs: 1600,
        speakingMs: 1100,
        rates: [0.62],
        outcome: "heard",
      }),
    ]);
  });

  it("a request still playing (between two pieces) is not reported as finished", () => {
    expect(summarizeTimings([row(0)], 7)[0]).toMatchObject({ outcome: "playing", elapsedMs: null });
  });
});
