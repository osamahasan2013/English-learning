import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import {
  getAudioSnapshot,
  getAudioTimings,
  playAudio,
  setAudioTimingLog,
  rateFor,
  splitForSpeech,
  stopAudio,
  subscribeAudio,
  SPEECH_SETTINGS,
  type AudioSnapshot,
} from "@/lib/audio/audio-service";
import { resolveAudioPacing } from "@/lib/audio/pacing";
import { buildSoundTable } from "@/lib/audio/pronunciation";
import { DEFAULT_RULES } from "@/lib/learning/rules";
import { useAudio } from "@/lib/audio/use-audio";

// The audio service against a fake speech engine and audio element that behave like the
// real ones: utterances start and end asynchronously, voices arrive late, and cancel() is
// either processed at once (desktop Chrome) or after the current task, taking an
// utterance spoken right after it with it (WebKit / iOS Safari, Android). One thing plays
// at a time, the newest request wins, a cancelled request never touches the newer one, a
// lost utterance is said again, nothing hangs, and an interruption is not "no sound".

type FakeUtterance = {
  text: string;
  rate: number;
  volume: number;
  voice: { name: string } | null;
  onstart?: () => void;
  onend?: () => void;
  onerror?: (e: { error: string }) => void;
};

type Mode = "immediate" | "deferred";

class FakeEngine {
  mode: Mode = "immediate";
  spoken: FakeUtterance[] = [];
  // When each utterance was handed to the engine (fake-timer clock).
  times: number[] = [];
  started: FakeUtterance[] = [];
  queue: FakeUtterance[] = [];
  current: FakeUtterance | null = null;
  cancels = 0;
  resumes = 0;
  paused = false;
  voices: { name: string; lang: string; localService: boolean }[] = [];
  voicesChanged?: () => void;
  // Behaviour switches for one test.
  silent = false; // never reports anything (a stuck engine)
  dropNext = 0; // the next N utterances are cancelled by the engine itself
  endWithoutStart = 0; // the next N utterances "end" at once without starting
  failWith: string | null = null; // every utterance fails with this error
  failVoice: string | null = null; // utterances with this voice fail ("network")

  get speaking() {
    return !!this.current;
  }
  get pending() {
    return this.queue.length > 0;
  }
  getVoices = () => this.voices;
  addEventListener = (type: string, fn: () => void) => {
    if (type === "voiceschanged") this.voicesChanged = fn;
  };
  speak = (u: FakeUtterance) => {
    this.spoken.push(u);
    this.times.push(Date.now());
    this.queue.push(u);
    setTimeout(() => this.next(), 0);
  };
  resume = () => {
    this.resumes++;
    this.paused = false;
  };
  cancel = () => {
    this.cancels++;
    const flush = () => {
      const playing = this.current;
      const cut = [this.current, ...this.queue].filter((u): u is FakeUtterance => !!u);
      this.current = null;
      this.queue = [];
      for (const u of cut) u.onerror?.({ error: u === playing ? "interrupted" : "canceled" });
    };
    if (this.mode === "deferred") setTimeout(flush, 0);
    else flush();
  };
  next() {
    if (this.current || this.queue.length === 0 || this.silent) return;
    const u = this.queue.shift()!;
    if (this.failWith || (this.failVoice && u.voice?.name === this.failVoice)) {
      u.onerror?.({ error: this.failWith ?? "network" });
      this.next();
      return;
    }
    if (this.endWithoutStart > 0) {
      this.endWithoutStart--;
      u.onend?.();
      this.next();
      return;
    }
    this.current = u;
    this.started.push(u);
    u.onstart?.();
    if (this.dropNext > 0) {
      this.dropNext--;
      this.current = null;
      u.onerror?.({ error: "canceled" });
      this.next();
    }
  }
  // Ends the utterance being spoken (the test decides when speech is over).
  finish() {
    const u = this.current;
    if (!u) return;
    this.current = null;
    u.onend?.();
    this.next();
  }
}

let engine: FakeEngine;
let clips: string[];
let clipFails: boolean;

function installFakes() {
  engine = new FakeEngine();
  clips = [];
  clipFails = false;
  class Utterance {
    text: string;
    rate = 1;
    pitch = 1;
    volume = 1;
    lang = "";
    voice: unknown = null;
    constructor(text: string) {
      this.text = text;
    }
  }
  vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  Object.defineProperty(window, "speechSynthesis", { configurable: true, value: engine });
  class FakeAudio {
    src = "";
    paused = true;
    playbackRate = 1;
    onended: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onplaying: (() => void) | null = null;
    play() {
      clips.push(this.src);
      if (clipFails) return Promise.reject(new DOMException("blocked", "NotAllowedError"));
      this.paused = false;
      setTimeout(() => this.onplaying?.(), 1);
      setTimeout(() => {
        this.paused = true;
        this.onended?.();
      }, 10);
      return Promise.resolve();
    }
    pause() {
      this.paused = true;
    }
  }
  vi.stubGlobal("Audio", FakeAudio);
}

// Waits for the engine to be speaking, then ends that utterance.
async function finishCurrent() {
  await vi.waitFor(() => expect(engine.current).not.toBeNull());
  engine.finish();
}

const heard = () => engine.started.filter((u) => u.text).map((u) => u.text);

const table = buildSoundTable(
  [
    { phonemes: ["S"], tts: "suh", quality: "approximate" },
    { phonemes: ["AE"], tts: "", quality: "keyword", keyword: "apple", keywordPosition: "first" },
    { phonemes: ["T"], tts: "tuh", quality: "approximate", assetUrl: "https://x/t.mp3" },
  ],
  [{ letter: "s", name: "ess" }],
);

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  installFakes();
});
afterEach(async () => {
  stopAudio();
  await vi.advanceTimersByTimeAsync(SPEECH_SETTINGS.cancelSettleMs + 50);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("playAudio", () => {
  it("speaks the resolved sound, never the token or the letters", async () => {
    const done = playAudio({ text: "{/S/}", speed: "slow" }, { sounds: table });
    await finishCurrent();
    expect(await done).toBe("played");
    expect(heard()).toEqual(["suh"]);
    expect(engine.started[0].rate).toBe(rateFor("slow", "PHONEME"));
  });

  it("slow is genuinely slower than normal", () => {
    expect(rateFor("slow")).toBeLessThan(rateFor("normal"));
    expect(rateFor("slow")).toBeGreaterThanOrEqual(0.5);
  });

  it("starts speaking in the same tick when nothing is playing (inside the child's tap)", () => {
    void playAudio({ text: "cat" });
    // iOS only lets a page speak from inside a tap: no waiting before the first sound.
    expect(engine.spoken.map((u) => u.text)).toEqual(["cat"]);
  });

  it("plays a recorded clip when there is one, and synthesis only without it", async () => {
    const done = playAudio({ text: "{/T/}" }, { sounds: table });
    await vi.advanceTimersByTimeAsync(20);
    expect(await done).toBe("played");
    expect(clips).toEqual(["https://x/t.mp3"]);
    expect(engine.spoken).toEqual([]);
  });

  it("falls back to synthesis when the clip cannot play", async () => {
    clipFails = true;
    const done = playAudio({ text: "{/T/}" }, { sounds: table });
    await finishCurrent();
    expect(await done).toBe("played");
    expect(heard()).toEqual(["tuh"]);
  });

  it("stopAudio ends a sequence and a waiting clip (nothing gets stuck)", async () => {
    const done = playAudio([{ text: "{/T/}" }, { text: "{/S/}" }], { sounds: table });
    await vi.waitFor(() => expect(clips).toHaveLength(1));
    stopAudio();
    expect(await done).toBe("interrupted");
    await vi.advanceTimersByTimeAsync(1000);
    expect(engine.spoken).toEqual([]);
  });

  it("reports unavailable only when nothing can play", async () => {
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: undefined });
    expect(await playAudio({ text: "hello" })).toBe("unavailable");
  });

  it("reports each item as it starts (for highlighting)", async () => {
    const items: number[] = [];
    const done = playAudio([{ text: "{/S/}" }, { text: "sat" }], {
      sounds: table,
      onItem: (i) => items.push(i),
    });
    await finishCurrent();
    await vi.advanceTimersByTimeAsync(SPEECH_SETTINGS.sequenceGapMs + 5);
    await finishCurrent();
    await done;
    expect(items).toEqual([0, 1]);
  });

  for (const mode of ["immediate", "deferred"] as const) {
    describe(`${mode} cancel`, () => {
      beforeEach(() => {
        engine.mode = mode;
      });

      it("Slow while Listen is speaking: the same words again, slowly, and heard", async () => {
        const listen = playAudio({ text: "The cat sat.", intent: "STORY_READING" });
        await vi.waitFor(() => expect(engine.current?.text).toBe("The cat sat."));
        const slow = playAudio({ text: "The cat sat.", speed: "slow", intent: "STORY_READING" });
        expect(await listen).toBe("interrupted");
        // Slow restarts the same words from the beginning, slower and in short phrases.
        await vi.waitFor(() => expect(engine.current?.rate).toBe(rateFor("slow")));
        engine.finish();
        await finishCurrent();
        expect(await slow).toBe("played");
        expect(heard()).toEqual(["The cat sat.", "The cat", "sat."]);
        expect(engine.started.map((u) => u.rate)).toEqual([
          rateFor("normal"),
          rateFor("slow"),
          rateFor("slow"),
        ]);
      });

      it("rapid presses: only the last one plays, nothing overlaps or queues", async () => {
        const presses = [
          playAudio({ text: "one" }),
          playAudio({ text: "two", speed: "slow" }),
          playAudio({ text: "three" }),
          playAudio({ text: "four", speed: "slow" }),
        ];
        await vi.waitFor(() => expect(engine.current?.text).toBe("four"));
        expect(engine.queue).toHaveLength(0);
        engine.finish();
        expect(await Promise.all(presses)).toEqual(["interrupted", "interrupted", "interrupted", "played"]);
        expect(heard().at(-1)).toBe("four");
        expect(engine.started.at(-1)!.rate).toBe(rateFor("slow"));
      });

      it("repeated Listen taps on a sequence do not overlap or queue", async () => {
        const sequence = [
          { text: "{/S/}", speed: "slow" as const },
          { text: "{/AE/}", speed: "slow" as const },
          { text: "sat" },
        ];
        const first = playAudio(sequence, { sounds: table });
        await vi.waitFor(() => expect(engine.current?.text).toBe("suh"));
        // Tap again while the first sound is playing: the first sequence stops for good.
        const second = playAudio(sequence, { sounds: table });
        expect(await first).toBe("interrupted");
        for (let i = 0; i < 3; i++) {
          await finishCurrent();
          await vi.advanceTimersByTimeAsync(SPEECH_SETTINGS.sequenceGapMs + 5);
        }
        expect(await second).toBe("played");
        expect(heard()).toEqual(["suh", "suh", "the sound at the start of apple", "sat"]);
        expect(engine.queue).toHaveLength(0);
      });

      it("a cancelled request's late callbacks never change the newer request's state", async () => {
        const states: AudioSnapshot[] = [];
        const unsubscribe = subscribeAudio(() => states.push(getAudioSnapshot()));
        const first = playAudio({ text: "first" });
        await vi.waitFor(() => expect(engine.current?.text).toBe("first"));
        const second = playAudio({ text: "second" });
        const secondId = getAudioSnapshot().requestId;
        await first;
        await vi.waitFor(() => expect(engine.current?.text).toBe("second"));
        // Once the second request is under way, every change is about it.
        const later = states.slice(states.findIndex((s) => s.requestId === secondId));
        expect(later.every((s) => s.requestId === secondId)).toBe(true);
        expect(getAudioSnapshot()).toMatchObject({ state: "playing", requestId: secondId, source: "tts" });
        engine.finish();
        await second;
        expect(getAudioSnapshot()).toMatchObject({ state: "idle", requestId: secondId });
        unsubscribe();
      });
    });
  }

  it("an utterance the engine loses is said once more", async () => {
    engine.dropNext = 1;
    const done = playAudio({ text: "ship" });
    await vi.waitFor(() => expect(engine.spoken).toHaveLength(2));
    await finishCurrent();
    expect(await done).toBe("played");
    expect(engine.spoken.map((u) => u.text)).toEqual(["ship", "ship"]);
  });

  it("an 'end' with no start straight after speak() is a lost utterance, said again", async () => {
    engine.endWithoutStart = 1;
    const done = playAudio({ text: "chop" });
    await finishCurrent();
    expect(await done).toBe("played");
    expect(engine.spoken.map((u) => u.text)).toEqual(["chop", "chop"]);
  });

  it("a stuck engine never leaves the request waiting: retried, then reported", async () => {
    engine.silent = true;
    const done = playAudio({ text: "thin" });
    await vi.advanceTimersByTimeAsync(SPEECH_SETTINGS.startTimeoutMs * 2 + 1000);
    expect(await done).toBe("unavailable");
    expect(engine.spoken).toHaveLength(2);
    expect(getAudioSnapshot().state).toBe("unavailable");
  });

  it("an engine that refuses (no tap yet, no voices) is reported unavailable, not retried for ever", async () => {
    engine.failWith = "not-allowed";
    expect(await playAudio({ text: "fish" })).toBe("unavailable");
    expect(engine.spoken).toHaveLength(1);
  });

  it("voices arriving late are used as soon as they load", async () => {
    let done = playAudio({ text: "before" });
    await finishCurrent();
    await done;
    expect(engine.started[0].voice).toBeNull();
    engine.voices = [
      { name: "Google US English", lang: "en-US", localService: false },
      { name: "Samantha", lang: "en-US", localService: true },
    ];
    engine.voicesChanged?.();
    done = playAudio({ text: "after" });
    await finishCurrent();
    await done;
    // A voice on the device is preferred to an online one.
    expect(engine.started[1].voice).toMatchObject({ name: "Samantha" });
  });

  it("a voice that cannot speak (offline online voice) falls back to the default voice", async () => {
    engine.voices = [{ name: "Google US English", lang: "en-US", localService: false }];
    engine.voicesChanged?.();
    engine.failVoice = "Google US English";
    const done = playAudio({ text: "moon" });
    await finishCurrent();
    expect(await done).toBe("played");
    expect(engine.started.at(-1)!.voice).toBeNull();
  });

  it("a paused engine (app back from the background) is resumed before speaking", async () => {
    engine.paused = true;
    const done = playAudio({ text: "sun" });
    await finishCurrent();
    await done;
    expect(engine.resumes).toBeGreaterThan(0);
  });

  it("long text is spoken in short utterances, in order, with the level's sentence gaps", async () => {
    const sentence = "The little red hen found some grains of wheat in the farmyard one sunny morning.";
    const text = Array.from({ length: 3 }, () => sentence).join(" ");
    const done = playAudio({ text });
    for (let i = 0; i < 3; i++) await finishCurrent();
    expect(await done).toBe("played");
    expect(engine.spoken.map((u) => u.text)).toEqual([sentence, sentence, sentence]);
    expect(engine.spoken.every((u) => u.text.length <= SPEECH_SETTINGS.maxUtteranceChars)).toBe(true);
  });

  it("moves through idle → loading → playing → idle", async () => {
    const seen: string[] = [];
    const unsubscribe = subscribeAudio(() => {
      const s = getAudioSnapshot().state;
      if (seen.at(-1) !== s) seen.push(s);
    });
    const done = playAudio({ text: "hop" });
    await finishCurrent();
    await done;
    unsubscribe();
    expect(seen).toEqual(["loading", "playing", "idle"]);
  });
});

describe("splitForSpeech", () => {
  it("keeps short text whole and splits long text at sentences, then phrases, then words", () => {
    expect(splitForSpeech("The cat sat.")).toEqual(["The cat sat."]);
    expect(splitForSpeech("One. Two. Three.", 10)).toEqual(["One. Two.", "Three."]);
    expect(splitForSpeech("a big, red, round ball", 12)).toEqual(["a big, red,", "round ball"]);
    expect(splitForSpeech("one two three four five", 9)).toEqual(["one two", "three", "four five"]);
    expect(splitForSpeech("   ")).toEqual([]);
  });
});

describe("useAudio", () => {
  function Speaker({ text, onSpeak }: { text?: string; onSpeak: (p: Promise<unknown>) => void }) {
    const { speak } = useAudio(table);
    useEffect(() => {
      onSpeak(speak(text ? { text } : [{ text: "{/S/}" }, { text: "{/AE/}" }, { text: "sat" }]));
    }, [speak, onSpeak, text]);
    return null;
  }

  it("leaving the screen stops the speech and the rest of the sequence", async () => {
    let playing: Promise<unknown> | null = null;
    const view = render(<Speaker onSpeak={(p) => (playing ??= p)} />);
    await vi.waitFor(() => expect(engine.current?.text).toBe("suh"));
    act(() => view.unmount());
    expect(await playing).toBe("interrupted");
    await vi.advanceTimersByTimeAsync(2000);
    expect(heard()).toEqual(["suh"]);
  });

  it("a screen that closes does not stop the sound another screen started", async () => {
    let first: Promise<unknown> | null = null;
    let second: Promise<unknown> | null = null;
    const a = render(<Speaker text="from one" onSpeak={(p) => (first ??= p)} />);
    await vi.waitFor(() => expect(engine.current?.text).toBe("from one"));
    render(<Speaker text="from two" onSpeak={(p) => (second ??= p)} />);
    await vi.waitFor(() => expect(engine.current?.text).toBe("from two"));
    act(() => a.unmount());
    await finishCurrent();
    expect(await first).toBe("interrupted");
    expect(await second).toBe("played");
  });
});

// Phase 8.2: what the child hears, piece by piece, and the silence between the pieces.
describe("pacing and audio intents", () => {
  const phonics = buildSoundTable(
    [
      { phonemes: ["G"], tts: "guh", quality: "approximate" },
      { phonemes: ["EY"], tts: "eigh", quality: "pure" },
      { phonemes: ["T"], tts: "tuh", quality: "approximate" },
    ],
    [{ letter: "g", name: "jee" }],
  );
  const kg1 = resolveAudioPacing(DEFAULT_RULES.audio, "KG1");
  const g2 = resolveAudioPacing(DEFAULT_RULES.audio, "GRADE2");

  // Plays a request to the end, finishing each utterance as soon as it starts.
  async function playThrough(p: Promise<string>) {
    let settled = false;
    void p.then(() => (settled = true));
    while (!settled) {
      await vi.advanceTimersByTimeAsync(5);
      if (engine.current) engine.finish();
    }
    return p;
  }
  const gaps = () => engine.times.slice(1).map((t, i) => t - engine.times[i]);

  it('"gate. {/G/}, {/EY/}, {/T/}. gate." is five separate pieces with clear gaps, not one breath', async () => {
    expect(
      await playThrough(
        playAudio({ text: "gate. {/G/}, {/EY/}, {/T/}. gate." }, { sounds: phonics, pacing: kg1 }),
      ),
    ).toBe("played");
    expect(engine.spoken.map((u) => u.text)).toEqual(["gate.", "guh", "eigh", "tuh", "gate."]);
    for (const gap of gaps()) expect(gap).toBeGreaterThanOrEqual(kg1.phonics.tokenGapMs.normal);
    // The sounds at the phonics rate, the words at the reading rate.
    expect(engine.spoken.map((u) => u.rate)).toEqual([
      kg1.reading.normal.rate,
      kg1.phonics.rate.normal,
      kg1.phonics.rate.normal,
      kg1.phonics.rate.normal,
      kg1.reading.normal.rate,
    ]);
  });

  it("a letter name and a sound stay different things all the way to the engine", async () => {
    setAudioTimingLog(true);
    try {
      // On their own (a letter tile, a sound button): separate requests, separate meanings.
      await playThrough(playAudio({ text: "{@g}", intent: "LETTER_NAME" }, { sounds: phonics, pacing: kg1 }));
      await playThrough(playAudio({ text: "{/G/}", intent: "PHONEME" }, { sounds: phonics, pacing: kg1 }));
      expect(engine.spoken.map((u) => u.text)).toEqual(["G.", "guh"]);
      expect(getAudioTimings().map((t) => [t.role, t.intent])).toEqual([
        ["letter_name", "LETTER_NAME"],
        ["phoneme", "PHONEME"],
      ]);
      // Inside a sentence, each stays in context (a one-syllable utterance is clipped and
      // guessed at by some voices) — and is still the name, or the sound, never the other.
      engine.spoken = [];
      await playThrough(
        playAudio({ text: "This is {@g}. It says {/G/}." }, { sounds: phonics, pacing: kg1 }),
      );
      expect(engine.spoken.map((u) => u.text)).toEqual(["This is G.", "It says guh."]);
    } finally {
      setAudioTimingLog(false);
    }
  });

  it("a word is said whole, never spelled out, unless a blend is asked for", async () => {
    await playThrough(
      playAudio({ text: "gate", intent: "WORD", speed: "slow" }, { sounds: phonics, pacing: kg1 }),
    );
    // Said whole, with a full stop for its citation form; never letters or sounds.
    expect(engine.spoken.map((u) => u.text)).toEqual(["gate."]);
  });

  it("a blend: sounds with clear gaps, a longer gap, then the whole word", async () => {
    const sequence = [
      { text: "{/G/}", intent: "PHONEME" as const, speed: "slow" as const },
      { text: "{/EY/}", intent: "PHONEME" as const, speed: "slow" as const },
      { text: "{/T/}", intent: "PHONEME" as const, speed: "slow" as const },
      { text: "gate", intent: "WORD" as const, speed: "slow" as const },
    ];
    await playThrough(playAudio(sequence, { sounds: phonics, pacing: kg1, sequence: "BLENDING" }));
    expect(engine.spoken.map((u) => u.text)).toEqual(["guh", "eigh", "tuh", "gate."]);
    const [g1, g2gap, beforeWord] = gaps();
    expect(g1).toBeGreaterThanOrEqual(kg1.phonics.itemGapMs.slow);
    expect(g2gap).toBeGreaterThanOrEqual(kg1.phonics.itemGapMs.slow);
    expect(beforeWord).toBeGreaterThanOrEqual(kg1.phonics.wordGapMs.slow);
  });

  it("KG1 story reading: Normal in short phrases, Slow word by word with pauses", async () => {
    await playThrough(
      playAudio({ text: "The cat is at the gate.", intent: "STORY_READING" }, { pacing: kg1 }),
    );
    expect(engine.spoken.map((u) => u.text)).toEqual(["The cat is", "at the gate."]);
    const normalEnd = Date.now();
    const normalStart = engine.times[0];
    engine.spoken = [];
    engine.times = [];
    await playThrough(
      playAudio({ text: "The cat is at the gate.", intent: "STORY_READING", speed: "slow" }, { pacing: kg1 }),
    );
    // Word by word, with "the" never on its own (Phase 8.3).
    expect(engine.spoken.map((u) => u.text)).toEqual(["The cat", "is", "at", "the gate."]);
    expect(engine.spoken.every((u) => u.rate === kg1.reading.slow.rate)).toBe(true);
    for (const gap of gaps()) expect(gap).toBeGreaterThanOrEqual(kg1.reading.slow.pauseMs);
    // Slow takes clearly longer even with an engine that ignores the rate entirely.
    expect(Date.now() - engine.times[0]).toBeGreaterThan(normalEnd - normalStart + 900);
  });

  it("Grade 2 story reading: Normal reads whole sentences", async () => {
    await playThrough(
      playAudio({ text: "The cat is at the gate. It naps.", intent: "STORY_READING" }, { pacing: g2 }),
    );
    expect(engine.spoken.map((u) => u.text)).toEqual(["The cat is at the gate.", "It naps."]);
    expect(gaps()[0]).toBeGreaterThanOrEqual(g2.reading.normal.sentenceGapMs);
  });

  it("reports the words of each piece as it starts (highlighting follows the speech)", async () => {
    const pieces: [number, number, number][] = [];
    await playThrough(
      playAudio([{ text: "I see a cat.", intent: "STORY_READING", speed: "slow" }], {
        pacing: kg1,
        onChunk: (item, w) => pieces.push([item, w.start, w.count]),
      }),
    );
    expect(pieces).toEqual([
      [0, 0, 1],
      [0, 1, 1],
      [0, 2, 2],
    ]);
  });

  it("Slow pressed in the middle of a paced reading: the old pieces never come back", async () => {
    const first = playAudio(
      { text: "The cat is at the gate.", intent: "STORY_READING", speed: "slow" },
      { pacing: kg1 },
    );
    await vi.waitFor(() => expect(engine.current?.text).toBe("The cat"));
    engine.finish();
    await vi.waitFor(() => expect(engine.current?.text).toBe("is"));
    const second = playAudio({ text: "It naps.", intent: "STORY_READING", speed: "slow" }, { pacing: kg1 });
    expect(await first).toBe("interrupted");
    expect(await playThrough(second)).toBe("played");
    expect(engine.spoken.map((u) => u.text)).toEqual(["The cat", "is", "It", "naps."]);
  });

  it("the timing log records rate, pieces, pauses, start and end — and no words", async () => {
    expect(getAudioTimings()).toEqual([]);
    setAudioTimingLog(true);
    await playThrough(
      playAudio({ text: "I see a cat.", intent: "STORY_READING", speed: "slow" }, { pacing: kg1 }),
    );
    const log = getAudioTimings();
    expect(log).toHaveLength(3);
    expect(log[1]).toMatchObject({
      intent: "STORY_READING",
      speed: "slow",
      level: "KG1",
      rate: kg1.reading.slow.rate,
      piece: 1,
      pieces: 3,
      pauseBeforeMs: kg1.reading.slow.pauseMs,
      chars: 3,
      outcome: "ended",
    });
    expect(log.every((t) => t.startedAt !== null && t.endedAt! >= t.startedAt!)).toBe(true);
    expect(JSON.stringify(log)).not.toMatch(/cat/);
    expect(log.every((t) => t.final === "played")).toBe(true);
    setAudioTimingLog(false);
    expect(getAudioTimings()).toEqual([]);
  });

  it("the timing log marks a request stopped in the silence between two pieces", async () => {
    setAudioTimingLog(true);
    try {
      const reading = playAudio(
        { text: "The apple is red.", intent: "STORY_READING", speed: "slow" },
        { pacing: kg1 },
      );
      // "The apple" and "is" play to the end; the next test starts during the pause before "red.".
      for (const piece of ["The apple", "is"]) {
        await vi.waitFor(() => expect(engine.current?.text).toBe(piece));
        engine.finish();
      }
      await vi.advanceTimersByTimeAsync(50);
      stopAudio();
      expect(await reading).toBe("interrupted");
      const log = getAudioTimings();
      expect(log.map((t) => t.outcome)).toEqual(["ended", "ended"]);
      expect(log.every((t) => t.final === "interrupted")).toBe(true);
    } finally {
      setAudioTimingLog(false);
    }
  });
});
