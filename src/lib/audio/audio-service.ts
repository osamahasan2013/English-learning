// Audio for every learning item goes through this service, never straight to a browser
// API. What to say is decided by the pronunciation resolver (pronunciation.ts): phonics
// sounds and letter names are tokens in the text, resolved to a recorded clip when one
// exists, otherwise to speech synthesis that says the SOUND (never the letter names).
// Moving to professional recordings means filling audio_assets — no component changes.
//
// One thing plays at a time. Every new request (or stopAudio) cancels what is playing,
// including the rest of a sequence ("s… a… t… sat"), so repeated taps never overlap or
// queue up, and leaving a screen stops the sound.

import { EMPTY_SOUND_TABLE, planSpeech, type SoundTable, type SpeechPart } from "@/lib/audio/pronunciation";

export type AudioSpeed = "normal" | "slow";

export type AudioRequest = {
  text: string;
  // A recorded file (Supabase Storage URL) for the whole text. Takes priority.
  assetUrl?: string | null;
  speed?: AudioSpeed;
};

// played: something was heard. interrupted: a newer request (or leaving) stopped it — not
// a failure. unavailable: nothing could play (no speech engine, blocked file).
export type PlayResult = "played" | "interrupted" | "unavailable";

export const SPEECH_SETTINGS = {
  locale: "en-US",
  // A little slower than conversation; "Slow" is clearly slower without dragging.
  rate: { normal: 0.85, slow: 0.6 } satisfies Record<AudioSpeed, number>,
  pitch: 1,
  recordedSlowPlaybackRate: 0.75,
  // A pause between the items of a sequence (each sound of a word), in ms.
  sequenceGapMs: 250,
} as const;

// Voices known to sound natural, preferred in this order when installed.
const PREFERRED_VOICES = [
  /natural/i,
  /samantha/i,
  /google us english/i,
  /aria/i,
  /jenny/i,
  /allison/i,
  /ava/i,
];

export function isSpeechSynthesisAvailable() {
  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    !!window.speechSynthesis &&
    typeof SpeechSynthesisUtterance !== "undefined"
  );
}

export function pickVoice(voices: SpeechSynthesisVoice[], locale: string = SPEECH_SETTINGS.locale) {
  const matching = voices.filter((v) => v.lang.replace("_", "-").toLowerCase() === locale.toLowerCase());
  const pool = matching.length ? matching : voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  for (const pattern of PREFERRED_VOICES) {
    const voice = pool.find((v) => pattern.test(v.name));
    if (voice) return voice;
  }
  return pool.find((v) => v.localService) ?? pool[0] ?? null;
}

// Voices arrive asynchronously in Chrome; keep the choice up to date instead of asking
// for every utterance (the first utterance used to get the default, often wrong, voice).
let voice: SpeechSynthesisVoice | null = null;
let listening = false;
function ensureSetup() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  if (isSpeechSynthesisAvailable()) {
    const refresh = () => {
      voice = pickVoice(window.speechSynthesis.getVoices());
    };
    refresh();
    window.speechSynthesis.addEventListener?.("voiceschanged", refresh);
  }
  // Leaving the page or hiding the app stops the sound (some browsers keep speaking).
  window.addEventListener("pagehide", () => stopAudio());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") stopAudio();
  });
}

let generation = 0;
let currentAudio: HTMLAudioElement | null = null;
let finishCurrent: (() => void) | null = null;

export function stopAudio() {
  generation++;
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  // A paused clip fires no "ended": release whoever is waiting on it.
  finishCurrent?.();
  finishCurrent = null;
  if (isSpeechSynthesisAvailable()) window.speechSynthesis.cancel();
}

function playRecorded(url: string, speed: AudioSpeed): Promise<boolean> {
  return new Promise((resolve) => {
    const audio = new Audio(url);
    currentAudio = audio;
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      if (finishCurrent === release) finishCurrent = null;
      resolve(ok);
    };
    const release = () => finish(false);
    finishCurrent = release;
    audio.playbackRate = speed === "slow" ? SPEECH_SETTINGS.recordedSlowPlaybackRate : 1;
    audio.onended = () => finish(true);
    audio.onerror = () => finish(false);
    audio.play().catch(() => finish(false));
  });
}

function speakSynthesized(text: string, speed: AudioSpeed): Promise<boolean> {
  if (!isSpeechSynthesisAvailable() || text.trim() === "") return Promise.resolve(false);
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = SPEECH_SETTINGS.locale;
    utterance.rate = SPEECH_SETTINGS.rate[speed];
    utterance.pitch = SPEECH_SETTINGS.pitch;
    const chosen = voice ?? pickVoice(synth.getVoices());
    if (chosen) utterance.voice = chosen;
    // Some engines never fire onend; never leave a caller waiting forever.
    const timeout = setTimeout(
      () => resolve(true),
      Math.max(3000, (text.length * 150) / SPEECH_SETTINGS.rate[speed]),
    );
    utterance.onend = () => {
      clearTimeout(timeout);
      resolve(true);
    };
    utterance.onerror = (e) => {
      clearTimeout(timeout);
      // Cancelled by a newer request: it did play, it was just cut short.
      resolve(e.error === "interrupted" || e.error === "canceled");
    };
    synth.speak(utterance);
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type PlayOptions = {
  // Phonics sounds and letter names for the tokens in the text.
  sounds?: SoundTable;
  // Called as each item of a sequence starts (to highlight the sound being played).
  onItem?: (index: number) => void;
};

function partsFor(request: AudioRequest, sounds: SoundTable): SpeechPart[] {
  const parts = planSpeech(request.text, sounds);
  if (!request.assetUrl) return parts;
  const fallback = parts.map((p) => (p.kind === "tts" ? p.text : p.fallback)).join(" ");
  return [{ kind: "asset", url: request.assetUrl, fallback }];
}

// Plays one request or a sequence. Never throws: audio is an aid, and a device without it
// must still be fully usable (text is always shown too).
export async function playAudio(
  request: AudioRequest | AudioRequest[],
  options: PlayOptions = {},
): Promise<PlayResult> {
  ensureSetup();
  stopAudio();
  if (isSpeechSynthesisAvailable()) window.speechSynthesis.getVoices();
  const mine = generation;
  const requests = Array.isArray(request) ? request : [request];
  const sounds = options.sounds ?? EMPTY_SOUND_TABLE;
  let played = false;
  for (const [index, req] of requests.entries()) {
    if (mine !== generation) return "interrupted";
    if (index > 0) {
      await wait(SPEECH_SETTINGS.sequenceGapMs);
      if (mine !== generation) return "interrupted";
    }
    options.onItem?.(index);
    const speed = req.speed ?? "normal";
    for (const part of partsFor(req, sounds)) {
      if (mine !== generation) return "interrupted";
      let ok = false;
      if (part.kind === "asset") {
        ok = await playRecorded(part.url, speed);
        if (!ok && mine === generation) ok = await speakSynthesized(part.fallback, speed);
      } else ok = await speakSynthesized(part.text, speed);
      played ||= ok;
    }
  }
  if (mine !== generation) return "interrupted";
  return played ? "played" : "unavailable";
}

// How screens ask for speech: a line of text (with optional sound tokens) at a speed, or a
// sequence of lines played one after another (a word's sounds, then the word).
export type SpeakFn = (
  text: string | AudioRequest[],
  speed?: AudioSpeed,
  options?: Omit<PlayOptions, "sounds">,
) => Promise<PlayResult>;
