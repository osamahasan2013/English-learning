import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEffect } from "react";
import { playAudio, stopAudio, SPEECH_SETTINGS } from "@/lib/audio/audio-service";
import { buildSoundTable } from "@/lib/audio/pronunciation";
import { useAudio } from "@/lib/audio/use-audio";

// The audio service against a fake speech engine and audio element: one thing plays at a
// time, a new request (or leaving the screen) stops the old one including the rest of a
// sequence, recorded clips win, and an interruption is not reported as "no sound".

type FakeUtterance = {
  text: string;
  rate: number;
  onend?: () => void;
  onerror?: (e: { error: string }) => void;
};

let spoken: FakeUtterance[];
let pending: FakeUtterance[];
let clips: string[];
let clipFails: boolean;

function installFakes() {
  spoken = [];
  pending = [];
  clips = [];
  clipFails = false;
  class Utterance {
    text: string;
    rate = 1;
    pitch = 1;
    lang = "";
    voice: unknown = null;
    onend?: () => void;
    onerror?: (e: { error: string }) => void;
    constructor(text: string) {
      this.text = text;
    }
  }
  vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
  Object.defineProperty(window, "speechSynthesis", {
    configurable: true,
    value: {
      speak: (u: FakeUtterance) => {
        spoken.push(u);
        pending.push(u);
      },
      cancel: () => {
        const cut = pending;
        pending = [];
        for (const u of cut) u.onerror?.({ error: "interrupted" });
      },
      getVoices: () => [],
      addEventListener: () => {},
    },
  });
  class FakeAudio {
    src: string;
    playbackRate = 1;
    onended?: () => void;
    onerror?: () => void;
    constructor(src: string) {
      this.src = src;
    }
    play() {
      clips.push(this.src);
      if (clipFails) return Promise.reject(new Error("blocked"));
      setTimeout(() => this.onended?.(), 10);
      return Promise.resolve();
    }
    pause() {}
  }
  vi.stubGlobal("Audio", FakeAudio);
}

// Finishes the utterance currently being spoken.
async function finishCurrent() {
  await vi.waitFor(() => expect(pending.length).toBeGreaterThan(0));
  const u = pending.shift()!;
  u.onend?.();
}

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
afterEach(() => {
  stopAudio();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("playAudio", () => {
  it("speaks the resolved sound, never the token or the letters", async () => {
    const done = playAudio({ text: "{/S/}", speed: "slow" }, { sounds: table });
    await finishCurrent();
    expect(await done).toBe("played");
    expect(spoken.map((u) => u.text)).toEqual(["suh"]);
    expect(spoken[0].rate).toBe(SPEECH_SETTINGS.rate.slow);
  });

  it("slow is genuinely slower than normal", () => {
    expect(SPEECH_SETTINGS.rate.slow).toBeLessThan(SPEECH_SETTINGS.rate.normal);
    expect(SPEECH_SETTINGS.rate.slow).toBeGreaterThanOrEqual(0.5);
  });

  it("plays a recorded clip when there is one, and synthesis only without it", async () => {
    const done = playAudio({ text: "{/T/}" }, { sounds: table });
    await vi.advanceTimersByTimeAsync(20);
    expect(await done).toBe("played");
    expect(clips).toEqual(["https://x/t.mp3"]);
    expect(spoken).toEqual([]);
  });

  it("falls back to synthesis when the clip cannot play", async () => {
    clipFails = true;
    const done = playAudio({ text: "{/T/}" }, { sounds: table });
    await finishCurrent();
    expect(await done).toBe("played");
    expect(spoken.map((u) => u.text)).toEqual(["tuh"]);
  });

  it("repeated Listen taps do not overlap or queue", async () => {
    const sequence = [
      { text: "{/S/}", speed: "slow" as const },
      { text: "{/AE/}", speed: "slow" as const },
      { text: "sat" },
    ];
    const first = playAudio(sequence, { sounds: table });
    await vi.waitFor(() => expect(spoken).toHaveLength(1));
    // Tap again while the first sound is playing: the first sequence stops for good.
    const second = playAudio(sequence, { sounds: table });
    expect(await first).toBe("interrupted");
    for (let i = 0; i < 3; i++) {
      await finishCurrent();
      await vi.advanceTimersByTimeAsync(SPEECH_SETTINGS.sequenceGapMs + 5);
    }
    expect(await second).toBe("played");
    expect(spoken.map((u) => u.text)).toEqual(["suh", "suh", "the sound at the start of apple", "sat"]);
    // Never more than one utterance in flight.
    expect(pending).toHaveLength(0);
  });

  it("stopAudio ends a sequence and a waiting clip (nothing gets stuck)", async () => {
    const done = playAudio([{ text: "{/T/}" }, { text: "{/S/}" }], { sounds: table });
    await vi.waitFor(() => expect(clips).toHaveLength(1));
    stopAudio();
    expect(await done).toBe("interrupted");
    await vi.advanceTimersByTimeAsync(1000);
    expect(spoken).toEqual([]);
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
});

describe("useAudio", () => {
  function Speaker({ onSpeak }: { onSpeak: (p: Promise<unknown>) => void }) {
    const { speak } = useAudio(table);
    useEffect(() => {
      onSpeak(speak([{ text: "{/S/}" }, { text: "{/AE/}" }, { text: "sat" }]));
    }, [speak, onSpeak]);
    return null;
  }

  it("leaving the screen stops the speech and the rest of the sequence", async () => {
    let playing: Promise<unknown> | null = null;
    const view = render(<Speaker onSpeak={(p) => (playing ??= p)} />);
    await vi.waitFor(() => expect(spoken).toHaveLength(1));
    act(() => view.unmount());
    expect(await playing).toBe("interrupted");
    await vi.advanceTimersByTimeAsync(2000);
    expect(spoken.map((u) => u.text)).toEqual(["suh"]);
  });
});
