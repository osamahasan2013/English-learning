import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import {
  getAudioSnapshot,
  playAudio,
  rateFor,
  splitForSpeech,
  stopAudio,
  subscribeAudio,
  SPEECH_SETTINGS,
  type AudioSnapshot,
} from "@/lib/audio/audio-service";
import { buildSoundTable } from "@/lib/audio/pronunciation";
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
    expect(engine.started[0].rate).toBe(SPEECH_SETTINGS.rate.slow);
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
        const listen = playAudio({ text: "The cat sat." });
        await vi.waitFor(() => expect(engine.current?.text).toBe("The cat sat."));
        const slow = playAudio({ text: "The cat sat.", speed: "slow" });
        expect(await listen).toBe("interrupted");
        await vi.waitFor(() => expect(engine.current?.rate).toBe(rateFor("slow")));
        engine.finish();
        expect(await slow).toBe("played");
        expect(heard()).toEqual(["The cat sat.", "The cat sat."]);
        expect(engine.started.map((u) => u.rate)).toEqual([rateFor("normal"), rateFor("slow")]);
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

  it("long text is spoken in short utterances, in order", async () => {
    const sentence = "The little red hen found some grains of wheat in the farmyard one sunny morning.";
    const text = Array.from({ length: 4 }, () => sentence).join(" ");
    const done = playAudio({ text });
    for (let i = 0; i < 2; i++) await finishCurrent();
    expect(await done).toBe("played");
    expect(engine.spoken.length).toBe(2);
    expect(engine.spoken.every((u) => u.text.length <= SPEECH_SETTINGS.maxUtteranceChars)).toBe(true);
    expect(engine.spoken.map((u) => u.text).join(" ")).toBe(text);
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
    const a = render(<Speaker text="from a" onSpeak={(p) => (first ??= p)} />);
    await vi.waitFor(() => expect(engine.current?.text).toBe("from a"));
    render(<Speaker text="from b" onSpeak={(p) => (second ??= p)} />);
    await vi.waitFor(() => expect(engine.current?.text).toBe("from b"));
    act(() => a.unmount());
    await finishCurrent();
    expect(await first).toBe("interrupted");
    expect(await second).toBe("played");
  });
});
