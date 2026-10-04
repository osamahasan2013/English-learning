import type { Page } from "@playwright/test";

// An instrumented speech engine for browser tests. Headless Chromium has no voices (every
// utterance fails with "synthesis-failed"), so audio flows are checked against this model
// of the Web Speech API instead. It logs what was asked for and what was actually heard
// (start → end), and can model the engine behaviours that break real devices:
//
//   immediate   cancel() stops everything at once (desktop Chrome).
//   deferred    cancel() is processed a moment later and also removes an utterance queued
//               right after it (WebKit / iOS Safari, Android Chrome): speaking in the same
//               tick as cancel() loses the new sentence.
//   broken      every utterance fails ("synthesis-failed"), like a device with no voices.
//
// Voices arrive asynchronously (after "voiceschanged"), as in Chrome and Safari.

export type SpeechMode = "immediate" | "deferred" | "broken";

export type SpeechLogEntry = {
  type: "speak" | "start" | "end" | "cancel" | "cancelled" | "error";
  text?: string;
  rate?: number;
  voice?: string | null;
  error?: string;
  t: number;
};

export async function installFakeSpeech(page: Page, mode: SpeechMode = "deferred") {
  await page.addInitScript((mode: SpeechMode) => {
    const log: SpeechLogEntry[] = [];
    (window as unknown as { __speech: unknown }).__speech = { log, mode };
    const now = () => Math.round(performance.now());
    type U = EventTarget & {
      text: string;
      rate: number;
      pitch: number;
      volume: number;
      lang: string;
      voice: { name: string } | null;
      [handler: string]: unknown;
    };
    const fire = (u: U, type: string, extra: Record<string, unknown> = {}) => {
      const e = Object.assign(new Event(type), extra);
      u.dispatchEvent(e);
      const handler = u[`on${type}`];
      if (typeof handler === "function") handler.call(u, e);
    };
    class FakeUtterance extends EventTarget {
      text: string;
      rate = 1;
      pitch = 1;
      volume = 1;
      lang = "";
      voice: { name: string } | null = null;
      onstart = null;
      onend = null;
      onerror = null;
      constructor(text = "") {
        super();
        this.text = text;
      }
    }
    const voices = [
      { name: "Fake Samantha", lang: "en-US", localService: true, default: true, voiceURI: "fake-samantha" },
      { name: "Fake Daniel", lang: "en-GB", localService: true, default: false, voiceURI: "fake-daniel" },
    ];
    let voicesReady = false;
    let queue: U[] = [];
    let current: U | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const synth = new EventTarget() as EventTarget & Record<string, unknown>;
    const next = () => {
      if (current || queue.length === 0) return;
      const u = queue.shift()!;
      current = u;
      if (mode === "broken") {
        current = null;
        log.push({ type: "error", text: u.text, error: "synthesis-failed", t: now() });
        fire(u, "error", { error: "synthesis-failed" });
        setTimeout(next, 0);
        return;
      }
      log.push({ type: "start", text: u.text, rate: u.rate, voice: u.voice?.name ?? null, t: now() });
      fire(u, "start");
      // Roughly speaking speed: ~25 characters a second at rate 1 (kept short for tests).
      const duration = Math.max(120, (u.text.length * 40) / (u.rate || 1));
      timer = setTimeout(() => {
        if (current !== u) return;
        current = null;
        log.push({ type: "end", text: u.text, t: now() });
        fire(u, "end");
        next();
      }, duration);
    };
    const flush = () => {
      const playing = current;
      const cut = [current, ...queue].filter((u): u is U => !!u);
      if (timer) clearTimeout(timer);
      current = null;
      queue = [];
      for (const u of cut) {
        log.push({ type: "cancelled", text: u.text, t: now() });
        fire(u, "error", { error: u === playing ? "interrupted" : "canceled" });
      }
    };
    Object.defineProperties(synth, {
      speaking: { get: () => !!current },
      pending: { get: () => queue.length > 0 },
      paused: { get: () => false },
    });
    Object.assign(synth, {
      getVoices: () => (voicesReady ? voices : []),
      speak(u: U) {
        log.push({ type: "speak", text: u.text, rate: u.rate, voice: u.voice?.name ?? null, t: now() });
        queue.push(u);
        setTimeout(next, 0);
      },
      cancel() {
        log.push({ type: "cancel", t: now() });
        if (mode === "deferred") setTimeout(flush, 0);
        else flush();
      },
      pause() {},
      resume() {},
    });
    setTimeout(() => {
      voicesReady = true;
      synth.dispatchEvent(new Event("voiceschanged"));
    }, 200);
    Object.defineProperty(window, "speechSynthesis", { configurable: true, value: synth });
    (window as unknown as { SpeechSynthesisUtterance: unknown }).SpeechSynthesisUtterance = FakeUtterance;
  }, mode);
}

export async function speechLog(page: Page): Promise<SpeechLogEntry[]> {
  return page.evaluate(() => [
    ...(window as unknown as { __speech: { log: SpeechLogEntry[] } }).__speech.log,
  ]);
}

export async function clearSpeechLog(page: Page) {
  await page.evaluate(() => {
    (window as unknown as { __speech: { log: unknown[] } }).__speech.log.length = 0;
  });
}

// What was actually heard, in order: utterances that started (whether or not a newer
// request cut them short). The silent utterance that unlocks iOS speech is not speech.
export function heard(log: SpeechLogEntry[]) {
  return log.filter((e) => e.type === "start" && !!e.text);
}

// Two utterances must never sound at the same time: every start follows the previous
// utterance's end or cancellation.
export function overlaps(log: SpeechLogEntry[]) {
  let playing: string | null = null;
  const problems: string[] = [];
  for (const e of log) {
    if (!e.text && e.type !== "cancel") continue;
    if (e.type === "start") {
      if (playing !== null) problems.push(`"${e.text}" started while "${playing}" was playing`);
      playing = e.text ?? "";
    } else if ((e.type === "end" || e.type === "cancelled") && e.text === playing) playing = null;
  }
  return problems;
}
