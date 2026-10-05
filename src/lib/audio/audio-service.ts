// Audio for every learning item goes through this service, never straight to a browser
// API. What to say is decided by the pronunciation resolver (pronunciation.ts): phonics
// sounds and letter names are tokens in the text, resolved to a recorded clip when one
// exists, otherwise to speech synthesis that says the SOUND (never the letter names).
// Moving to professional recordings means filling audio_assets — no component changes.
//
// One thing plays at a time (docs/audio-engine.md). Every request gets an id; starting a
// request makes it the current one and stops what was playing, including the rest of a
// sequence ("s… a… t… sat"). Callbacks from an older request never touch the newer one.
// Speech engines do not stop instantly: WebKit (iOS Safari) and Android process cancel()
// after the current task and take an utterance spoken right after it with them, so a new
// request waits until the engine confirms the old utterance is gone before it speaks, and
// an utterance the engine still drops is said once more. Nothing fails silently: the
// result says whether anything was heard, and failures are logged without content.

import {
  chunkText,
  countWords,
  DEFAULT_AUDIO_PACING,
  paceFor,
  type AudioIntent,
  type AudioPacing,
} from "@/lib/audio/pacing";
import {
  EMPTY_SOUND_TABLE,
  explainSpeech,
  planSpeech,
  unresolvedTokens,
  type SoundTable,
  type SpeechPart,
  type SpeechRole,
} from "@/lib/audio/pronunciation";

export type { AudioIntent, AudioPacing } from "@/lib/audio/pacing";

export type AudioSpeed = "normal" | "slow";

export type AudioRequest = {
  text: string;
  // A recorded file (Supabase Storage URL) for the whole text. Takes priority.
  assetUrl?: string | null;
  speed?: AudioSpeed;
  // Words on screen that a keyword fallback must not name (they are the answer choices).
  avoid?: readonly string[];
  // What the request teaches (pacing.ts): a story is paced for the level, a word is one
  // piece, a sound gets its own slower rate. Default: INSTRUCTION.
  intent?: AudioIntent;
};

// played: something was heard. interrupted: a newer request (or leaving) stopped it — not
// a failure. unavailable: nothing could be heard (no speech engine, no voice, blocked).
export type PlayResult = "played" | "interrupted" | "unavailable";

// The one playback state of the app. loading: a request is starting (the engine is
// letting go of the previous one, or a clip is loading). playing: sound is coming out.
// unavailable: the last request could not be heard.
export type PlaybackState = "idle" | "loading" | "playing" | "unavailable";

// Whoever started the current request (a screen's useAudio), so leaving one screen only
// stops its own sound.
export type AudioOwner = object;

export type AudioSnapshot = {
  state: PlaybackState;
  requestId: number;
  owner: AudioOwner | null;
  source: "asset" | "tts" | null;
};

// Engine handling. Speed and pauses are not here: they are the `audio` learning rules,
// per level (pacing.ts).
export const SPEECH_SETTINGS = {
  locale: "en-US",
  pitch: 1,
  volume: 1,
  recordedSlowPlaybackRate: 0.75,
  // A pause between the items of a sequence that is neither phonics nor reading, in ms.
  sequenceGapMs: 250,
  // How long to wait for the engine to confirm a cancel before speaking anyway.
  cancelSettleMs: 300,
  // An utterance the engine dropped (cut short by a cancel it processed late, or never
  // started) is said once more after this pause.
  retryDelayMs: 150,
  // No "start" by then: the engine is stuck or lost the utterance.
  startTimeoutMs: 4000,
  // An "end" that comes this soon after speak() with no "start" is a dropped utterance.
  droppedWithinMs: 100,
  // Longer text is split at sentence and phrase boundaries: some engines (Chrome's online
  // voices) stop after about 15 seconds of one utterance without telling anyone.
  maxUtteranceChars: 200,
} as const;

// Voices known to sound natural, preferred in this order when installed. Voices on the
// device come first: online voices (Chrome's "Google …", Edge's "… Online") need the
// network, drop utterances after cancel() and stop long ones, so they are a last resort.
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

export function pickVoice(voices: readonly SpeechSynthesisVoice[], locale: string = SPEECH_SETTINGS.locale) {
  const matching = voices.filter((v) => v.lang.replace("_", "-").toLowerCase() === locale.toLowerCase());
  const pool = matching.length ? matching : voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  const local = pool.filter((v) => v.localService);
  for (const candidates of [local, pool]) {
    for (const pattern of PREFERRED_VOICES) {
      const voice = candidates.find((v) => pattern.test(v.name));
      if (voice) return voice;
    }
  }
  return local[0] ?? pool[0] ?? null;
}

// The speech rate for a request (the level's pace for its intent and speed).
export function rateFor(
  speed: AudioSpeed,
  intent: AudioIntent = "INSTRUCTION",
  pacing: AudioPacing = DEFAULT_AUDIO_PACING,
) {
  return paceFor(intent, speed, pacing).rate;
}

// Text → utterances short enough for every engine, split after sentences, then phrases,
// then words. Short text (nearly everything) is one utterance.
export function splitForSpeech(text: string, max: number = SPEECH_SETTINGS.maxUtteranceChars): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean ? [clean] : [];
  const chunks: string[] = [];
  let buffer = "";
  const push = (piece: string) => {
    if (!piece) return;
    if (buffer && (buffer + " " + piece).length > max) {
      chunks.push(buffer);
      buffer = "";
    }
    if (piece.length <= max) {
      buffer = buffer ? `${buffer} ${piece}` : piece;
      return;
    }
    // One very long sentence: phrases, then words.
    const phrases = piece.split(/(?<=[,;:])\s+/);
    if (phrases.length > 1) phrases.forEach(push);
    else
      for (const word of piece.split(" ")) {
        if (buffer && (buffer + " " + word).length > max) {
          chunks.push(buffer);
          buffer = "";
        }
        buffer = buffer ? `${buffer} ${word}` : word;
      }
  };
  clean.split(/(?<=[.!?])\s+/).forEach(push);
  if (buffer) chunks.push(buffer);
  return chunks;
}

// ── Diagnostics ──────────────────────────────────────────────────────────────────────
// Structured, content-free records (ids, codes, rates, voice names, lengths) for parents'
// and admins' debugging in the browser console. Development logs everything; production
// only failures, and at most a few per page.

type LogFields = Record<string, string | number | boolean | null | undefined>;
let logged = 0;
const MAX_PRODUCTION_LOGS = 20;

function logAudio(level: "info" | "warn", event: string, fields: LogFields = {}) {
  const production = process.env.NODE_ENV === "production";
  if (production && (level === "info" || logged >= MAX_PRODUCTION_LOGS)) return;
  if (process.env.NODE_ENV === "test") return;
  logged++;
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    event: `audio.${event}`,
    ...fields,
  });
  if (level === "warn") console.warn(line);
  else console.info(line);
}

// ── Playback state (one store, read by useAudio) ─────────────────────────────────────

const IDLE: AudioSnapshot = { state: "idle", requestId: 0, owner: null, source: null };
let snapshot: AudioSnapshot = IDLE;
const listeners = new Set<() => void>();

function setSnapshot(next: Partial<AudioSnapshot>) {
  snapshot = { ...snapshot, ...next };
  for (const listener of listeners) listener();
}

export function subscribeAudio(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getAudioSnapshot() {
  return snapshot;
}

export function getServerAudioSnapshot() {
  return IDLE;
}

// ── Engine setup ─────────────────────────────────────────────────────────────────────

// Voices arrive asynchronously (Chrome, Safari): the choice is refreshed on
// "voiceschanged" instead of assuming getVoices() is filled at the first utterance.
let voice: SpeechSynthesisVoice | null = null;
let setUp = false;
// iOS speaks only after speech has been started inside a tap once; a silent utterance on
// the first tap anywhere unlocks it, so speech that starts after loading (a question read
// aloud when it appears) is heard too.
let unlockUtterance: SpeechSynthesisUtterance | null = null;
let unlocked = false;

function refreshVoice() {
  if (!isSpeechSynthesisAvailable()) return;
  const voices = window.speechSynthesis.getVoices();
  // An engine can briefly report no voices: keep the one already chosen.
  if (voices.length) voice = pickVoice(voices);
}

function unlock() {
  if (unlocked || !isSpeechSynthesisAvailable()) return;
  unlocked = true;
  const synth = window.speechSynthesis;
  if (activeUtterance || synth.speaking || synth.pending) return;
  const u = new SpeechSynthesisUtterance("");
  u.volume = 0;
  unlockUtterance = u;
  const done = () => {
    if (unlockUtterance === u) unlockUtterance = null;
  };
  u.onend = done;
  u.onerror = done;
  // Some engines never report an empty utterance's end.
  setTimeout(done, 1000);
  synth.speak(u);
}

function ensureSetup() {
  if (setUp || typeof window === "undefined") return;
  setUp = true;
  if (isSpeechSynthesisAvailable()) {
    refreshVoice();
    window.speechSynthesis.addEventListener?.("voiceschanged", refreshVoice);
  }
  window.addEventListener("pointerdown", unlock, { capture: true, passive: true });
  window.addEventListener("keydown", unlock, { capture: true, passive: true });
  // Leaving the page or hiding the app stops the sound (some browsers keep speaking; iOS
  // leaves the engine stuck after the screen locks if it is not cancelled).
  window.addEventListener("pagehide", () => stopAudio());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") stopAudio();
  });
}

// What the device offers (for the grown-ups' audio check page): no child data.
export function getAudioEngineInfo() {
  const tts = isSpeechSynthesisAvailable();
  if (tts) refreshVoice();
  return {
    tts,
    voices: tts ? window.speechSynthesis.getVoices().length : 0,
    voice: voice ? { name: voice.name, lang: voice.lang, local: voice.localService } : null,
  };
}

// Start loading the voice list early (the first press then gets the right voice).
export function prepareAudio() {
  ensureSetup();
  if (isSpeechSynthesisAvailable()) window.speechSynthesis.getVoices();
}

// ── Requests and cancellation ────────────────────────────────────────────────────────

let lastId = 0;
// The request allowed to make sound. Bumped by every new request and by stopAudio.
let current = 0;

// Our utterance the engine is working on, kept referenced (Chrome stops reporting events
// for an utterance that was garbage-collected) and with whoever waits for it to settle.
let activeUtterance: SpeechSynthesisUtterance | null = null;
const settleWaiters = new Set<() => void>();

let clip: HTMLAudioElement | null = null;
let releaseClip: (() => void) | null = null;

// One reusable element: once a tap has started it, iOS lets it play again later.
function clipElement() {
  if (!clip) clip = new Audio();
  return clip;
}

// Stops the engine and the clip. Returns a promise when the engine has to be waited for
// (it was speaking), or null when nothing was playing — then a request in a tap can speak
// straight away, still inside the tap (iOS needs that for the first sound).
function halt(): Promise<void> | null {
  if (clip && !clip.paused) clip.pause();
  releaseClip?.();
  releaseClip = null;
  if (!isSpeechSynthesisAvailable()) return null;
  const synth = window.speechSynthesis;
  const ours = activeUtterance;
  const onlyUnlock = !ours && unlockUtterance !== null;
  if (!ours && (onlyUnlock || (!synth.speaking && !synth.pending))) return null;
  const settled = new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      settleWaiters.delete(finish);
      // One more task: an engine that processes cancel() late flushes its whole queue in
      // the task it reports the cancel from.
      setTimeout(resolve, 0);
    };
    const timer = setTimeout(finish, ours ? SPEECH_SETTINGS.cancelSettleMs : 100);
    // Registered before cancel(): engines that cancel at once report it synchronously.
    if (ours) settleWaiters.add(finish);
  });
  synth.cancel();
  return settled;
}

// Stops whatever is playing. With an owner, only if that owner started it (a screen that
// unmounts must not cut off another screen's sound).
export function stopAudio(options: { owner?: AudioOwner } = {}) {
  if (options.owner && snapshot.owner !== options.owner) return;
  current = ++lastId;
  void halt();
  setSnapshot({ state: "idle", requestId: current, owner: null, source: null });
}

type Outcome = { outcome: "ended" | "interrupted" | "failed"; started: boolean; error?: string };

function playRecorded(url: string, speed: AudioSpeed, id: number): Promise<Outcome> {
  return new Promise((resolve) => {
    const audio = clipElement();
    let done = false;
    const finish = (o: Outcome) => {
      if (done) return;
      done = true;
      audio.onended = null;
      audio.onerror = null;
      audio.onplaying = null;
      if (releaseClip === release) releaseClip = null;
      resolve(o);
    };
    // A paused clip fires no "ended": whoever stops it releases the waiting request.
    const release = () => finish({ outcome: "interrupted", started: true });
    releaseClip = release;
    audio.src = url;
    audio.playbackRate = speed === "slow" ? SPEECH_SETTINGS.recordedSlowPlaybackRate : 1;
    audio.onplaying = () => {
      if (id === current) setSnapshot({ state: "playing", source: "asset" });
    };
    audio.onended = () => finish({ outcome: "ended", started: true });
    audio.onerror = () => finish({ outcome: "failed", started: false, error: "asset_error" });
    const played = audio.play();
    if (played && typeof played.catch === "function")
      played.catch((e: unknown) =>
        finish({
          outcome: "failed",
          started: false,
          error: e instanceof DOMException ? e.name : "play_rejected",
        }),
      );
  });
}

const INTERRUPTED = new Set(["interrupted", "canceled"]);

type PieceMeta = Omit<AudioTiming, "voice" | "spokeAt" | "startedAt" | "endedAt" | "outcome" | "error">;

function speakOnce(
  text: string,
  rate: number,
  id: number,
  chosen: SpeechSynthesisVoice | null | undefined,
  meta: PieceMeta,
): Promise<Outcome> {
  return new Promise((resolve) => {
    const synth = window.speechSynthesis;
    // Chrome on Android pauses the engine when the app was in the background.
    if (synth.paused) synth.resume();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = SPEECH_SETTINGS.locale;
    u.rate = rate;
    u.pitch = SPEECH_SETTINGS.pitch;
    u.volume = SPEECH_SETTINGS.volume;
    const v = chosen === undefined ? (voice ?? pickVoice(synth.getVoices())) : chosen;
    if (v) u.voice = v;
    activeUtterance = u;
    const spokenAt = Date.now();
    const timing = recordTiming({ ...meta, voice: v?.name ?? null, spokeAt: now() });
    let started = false;
    let settled = false;
    let endTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (outcome: Outcome["outcome"], error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(startTimer);
      clearTimeout(endTimer);
      if (activeUtterance === u) activeUtterance = null;
      updateTiming(timing, { endedAt: now(), outcome, error: error ?? null });
      for (const waiter of [...settleWaiters]) waiter();
      resolve({ outcome, started, error });
    };
    const onStart = () => {
      if (started) return;
      started = true;
      clearTimeout(startTimer);
      updateTiming(timing, { startedAt: now() });
      if (id === current) setSnapshot({ state: "playing", source: "tts" });
      // Some engines never report the end: never leave a request waiting forever.
      const expected = (text.length * 150) / rate;
      endTimer = setTimeout(() => finish("ended", "no_end"), Math.max(4000, expected * 2));
    };
    const startTimer = setTimeout(() => {
      // An engine that speaks without reporting "start" is still speaking.
      if (synth.speaking && activeUtterance === u) onStart();
      else finish("failed", "no_start");
    }, SPEECH_SETTINGS.startTimeoutMs);
    u.onstart = onStart;
    u.onend = () => {
      if (!started && Date.now() - spokenAt < SPEECH_SETTINGS.droppedWithinMs)
        finish("interrupted", "dropped");
      else {
        started = true;
        finish("ended");
      }
    };
    u.onerror = (e) => finish(INTERRUPTED.has(e.error) ? "interrupted" : "failed", e.error);
    synth.speak(u);
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Errors that mean "this voice cannot speak now" (an online voice offline, a voice that
// was removed): the device's default voice is tried instead.
const VOICE_ERRORS = new Set([
  "network",
  "synthesis-unavailable",
  "synthesis-failed",
  "voice-unavailable",
  "language-unavailable",
]);

// One piece (a phrase, a word, a sound) through the engine: a lost piece is said once
// more, a failing voice gives way to the default one. True when it was heard.
async function speakPiece(text: string, rate: number, id: number, meta: PieceMeta): Promise<boolean> {
  if (!isSpeechSynthesisAvailable() || text.trim() === "") return false;
  let r = await speakOnce(text, rate, id, undefined, meta);
  if (id !== current) return r.started;
  // Still the newest request, yet cut short or never started: the engine processed an
  // earlier cancel late, or lost it. Say it once more.
  if (r.outcome === "interrupted" || r.error === "no_start") {
    logAudio("warn", "utterance_lost", { requestId: id, reason: r.error, started: r.started });
    if (r.error === "no_start") {
      const settling = halt();
      if (settling) await settling;
    }
    await wait(SPEECH_SETTINGS.retryDelayMs);
    if (id !== current) return false;
    r = await speakOnce(text, rate, id, undefined, { ...meta, retry: true });
    if (id !== current) return r.started;
  }
  if (r.outcome === "failed" && r.error && VOICE_ERRORS.has(r.error) && voice) {
    logAudio("warn", "voice_failed", { requestId: id, voice: voice.name, error: r.error });
    r = await speakOnce(text, rate, id, null, { ...meta, retry: true });
    if (id !== current) return r.started;
  }
  if (r.outcome === "failed") {
    logAudio("warn", "tts_failed", {
      requestId: id,
      error: r.error,
      voice: voice?.name ?? null,
      voices: window.speechSynthesis.getVoices().length,
      rate,
      chars: text.length,
    });
    return false;
  }
  return r.started || r.outcome === "ended";
}

// ── Timing log (development and the audio check page) ────────────────────────────────
// What each piece asked for and what the engine did: rate, voice, pause, start, end. No
// words are kept (only their number of characters), so no child content is recorded. Off
// unless a page turns it on; kept in memory only.

export type AudioTiming = {
  requestId: number;
  intent: AudioIntent;
  role: SpeechRole;
  speed: AudioSpeed;
  level: string;
  rate: number;
  // Which piece of the request, out of how many, and the silence before it.
  piece: number;
  pieces: number;
  pauseBeforeMs: number;
  chars: number;
  retry: boolean;
  voice: string | null;
  spokeAt: number;
  startedAt: number | null;
  endedAt: number | null;
  outcome: Outcome["outcome"] | null;
  error: string | null;
  // How the whole request ended (set on its pieces when playAudio returns): a request
  // stopped in the silence between two pieces has only pieces that "ended".
  final?: PlayResult;
};

let timingOn = false;
let timings: AudioTiming[] = [];
const timingListeners = new Set<() => void>();
const MAX_TIMINGS = 400;
const now = () => (typeof performance !== "undefined" ? Math.round(performance.now()) : Date.now());

function emitTimings() {
  for (const listener of timingListeners) listener();
}

function recordTiming(entry: Omit<AudioTiming, "startedAt" | "endedAt" | "outcome" | "error">) {
  if (!timingOn) return null;
  const t: AudioTiming = { ...entry, startedAt: null, endedAt: null, outcome: null, error: null };
  timings = [...timings.slice(-(MAX_TIMINGS - 1)), t];
  emitTimings();
  return t;
}

function updateTiming(t: AudioTiming | null, change: Partial<AudioTiming>) {
  if (!t) return;
  Object.assign(t, change);
  timings = [...timings];
  emitTimings();
}

function finishTimings(requestId: number, result: PlayResult) {
  if (!timingOn) return;
  let changed = false;
  for (const t of timings)
    if (t.requestId === requestId) {
      t.final = result;
      changed = true;
    }
  if (changed) {
    timings = [...timings];
    emitTimings();
  }
}

export function setAudioTimingLog(on: boolean) {
  timingOn = on;
  if (!on) timings = [];
  emitTimings();
}

export function getAudioTimings() {
  return timings;
}

export function clearAudioTimings() {
  timings = [];
  emitTimings();
}

export function subscribeAudioTimings(listener: () => void) {
  timingListeners.add(listener);
  return () => {
    timingListeners.delete(listener);
  };
}

// ── Playing ──────────────────────────────────────────────────────────────────────────

export type PlayOptions = {
  // Phonics sounds and letter names for the tokens in the text.
  sounds?: SoundTable;
  // The child's level pacing (useAudio provides it). Default: the default level's.
  pacing?: AudioPacing;
  // A sequence that teaches a word's sounds: wider gaps between the sounds, and before
  // the whole word at the end of a blend.
  sequence?: "SEGMENTING" | "BLENDING";
  // Called as each item of a sequence starts (to highlight the sound being played).
  onItem?: (index: number) => void;
  // Called as each piece of an item starts, with the words of the item it covers (to
  // highlight the words being read when a sentence is read in phrases or word by word).
  onChunk?: (index: number, words: { start: number; count: number }) => void;
  // The screen starting the request (see stopAudio).
  owner?: AudioOwner;
};

function partsFor(request: AudioRequest, sounds: SoundTable): SpeechPart[] {
  const parts = planSpeech(request.text, sounds, request.avoid ? { avoid: new Set(request.avoid) } : {});
  if (!request.assetUrl) return parts;
  const fallback = parts.map((p) => (p.kind === "tts" ? p.text : p.fallback)).join(" ");
  return [{ kind: "asset", url: request.assetUrl, fallback, role: "speech" }];
}

// "the" → "the.", "gate" → "gate." (a word with its own punctuation is left alone).
export function citationForm(word: string) {
  const w = word.trim();
  return /^[\p{L}'-]+$/u.test(w) ? `${w}.` : w;
}

const PHONICS_INTENTS = new Set<AudioIntent>(["PHONEME", "LETTER_NAME"]);
const READING_INTENTS = new Set<AudioIntent>(["STORY_READING", "SENTENCE"]);

// The silence before item `index` of a sequence.
function gapBefore(
  requests: AudioRequest[],
  index: number,
  speed: AudioSpeed,
  pacing: AudioPacing,
  sequence?: PlayOptions["sequence"],
) {
  const item = requests[index].intent ?? "INSTRUCTION";
  const prev = requests[index - 1].intent ?? "INSTRUCTION";
  const last = index === requests.length - 1;
  if (sequence === "BLENDING" && last) return pacing.phonics.wordGapMs[speed];
  if (sequence || PHONICS_INTENTS.has(item) || PHONICS_INTENTS.has(prev))
    return item === "WORD" && PHONICS_INTENTS.has(prev)
      ? pacing.phonics.wordGapMs[speed]
      : pacing.phonics.itemGapMs[speed];
  if (READING_INTENTS.has(item) && READING_INTENTS.has(prev))
    return paceFor(item, speed, pacing).sentenceGapMs;
  return SPEECH_SETTINGS.sequenceGapMs;
}

// Plays one request or a sequence. Never throws: audio is an aid, and a device without it
// must still be fully usable (text is always shown too).
export async function playAudio(
  request: AudioRequest | AudioRequest[],
  options: PlayOptions = {},
): Promise<PlayResult> {
  const id = ++lastId;
  const result = await playRequest(id, request, options);
  finishTimings(id, result);
  return result;
}

async function playRequest(
  id: number,
  request: AudioRequest | AudioRequest[],
  options: PlayOptions,
): Promise<PlayResult> {
  ensureSetup();
  // Also re-read here: some Safari versions never send "voiceschanged".
  refreshVoice();
  current = id;
  const settling = halt();
  setSnapshot({ state: "loading", requestId: id, owner: options.owner ?? null, source: null });
  if (settling) await settling;
  const requests = Array.isArray(request) ? request : [request];
  const sounds = options.sounds ?? EMPTY_SOUND_TABLE;
  const pacing = options.pacing ?? DEFAULT_AUDIO_PACING;
  let played = false;
  try {
    for (const [index, req] of requests.entries()) {
      if (id !== current) return "interrupted";
      const speed = req.speed ?? "normal";
      const intent = req.intent ?? "INSTRUCTION";
      if (index > 0) {
        await wait(gapBefore(requests, index, speed, pacing, options.sequence));
        if (id !== current) return "interrupted";
      }
      options.onItem?.(index);
      const missing = unresolvedTokens(req.text, sounds);
      if (missing.length) logAudio("warn", "token_unresolved", { requestId: id, tokens: missing.join(" ") });
      const parts = partsFor(req, sounds);
      // Development only: what each request means and where its sound comes from — roles,
      // tokens and sources, never the words (no child content).
      if (process.env.NODE_ENV === "development") {
        const explained = req.assetUrl ? [] : explainSpeech(req.text, sounds);
        logAudio("info", "request", {
          requestId: id,
          intent,
          speed,
          level: pacing.level,
          roles: explained.map((e) => e.role).join(" ") || "speech",
          tokens: explained
            .filter((e) => e.role !== "speech")
            .map((e) => e.target)
            .join(" "),
          sources: req.assetUrl ? "recorded" : explained.map((e) => e.source).join(" "),
          voice: voice?.name ?? null,
          lang: voice?.lang ?? SPEECH_SETTINGS.locale,
        });
      }
      // Words of the item already covered by earlier parts (for onChunk).
      let wordsBefore = 0;
      for (const [pi, part] of parts.entries()) {
        if (id !== current) return "interrupted";
        // A sound or letter name stands apart from the words around it.
        if (pi > 0 && (part.role !== "speech" || parts[pi - 1].role !== "speech")) {
          await wait(pacing.phonics.tokenGapMs[speed]);
          if (id !== current) return "interrupted";
        }
        const partIntent: AudioIntent =
          part.role === "phoneme" ? "PHONEME" : part.role === "letter_name" ? "LETTER_NAME" : intent;
        const pace = paceFor(partIntent, speed, pacing);
        const meta = { requestId: id, intent: partIntent, role: part.role, speed, level: pacing.level };
        let ok = false;
        if (part.kind === "asset") {
          const r = await playRecorded(part.url, speed, id);
          ok = r.outcome === "ended" || (r.outcome === "interrupted" && r.started);
          if (r.outcome === "failed" && id === current) {
            logAudio("warn", "asset_failed", { requestId: id, error: r.error, fallback: "tts" });
            ok = await speakPiece(part.fallback, pace.rate, id, {
              ...meta,
              rate: pace.rate,
              piece: 0,
              pieces: 1,
              pauseBeforeMs: 0,
              chars: part.fallback.length,
              retry: false,
            });
          }
        } else if (part.role !== "speech") {
          ok = await speakPiece(part.text, pace.rate, id, {
            ...meta,
            rate: pace.rate,
            piece: 0,
            pieces: 1,
            pauseBeforeMs: 0,
            chars: part.text.length,
            retry: false,
          });
        } else {
          // A word said on its own ("the", "gate") ends with a full stop, so the voice gives
          // its whole citation form instead of a clipped or rising fragment.
          const said = partIntent === "WORD" ? citationForm(part.text) : part.text;
          const chunks = chunkText(said, pace, SPEECH_SETTINGS.maxUtteranceChars);
          for (const [ci, chunk] of chunks.entries()) {
            if (id !== current) return "interrupted";
            if (chunk.pauseBeforeMs > 0) {
              await wait(chunk.pauseBeforeMs);
              if (id !== current) return "interrupted";
            }
            options.onChunk?.(index, { start: wordsBefore + chunk.wordStart, count: chunk.wordCount });
            const heard = await speakPiece(chunk.text, pace.rate, id, {
              ...meta,
              rate: pace.rate,
              piece: ci,
              pieces: chunks.length,
              pauseBeforeMs: chunk.pauseBeforeMs,
              chars: chunk.text.length,
              retry: false,
            });
            ok ||= heard;
          }
          wordsBefore += countWords(part.text);
        }
        played ||= ok;
      }
    }
  } catch (error) {
    // A browser API that throws (an engine in a bad state): reported, never thrown.
    logAudio("warn", "playback_error", {
      requestId: id,
      error: error instanceof Error ? error.name : "unknown",
    });
  }
  if (id !== current) return "interrupted";
  if (!played)
    logAudio("warn", "unavailable", {
      requestId: id,
      tts: isSpeechSynthesisAvailable(),
      voices: isSpeechSynthesisAvailable() ? window.speechSynthesis.getVoices().length : 0,
    });
  setSnapshot({ state: played ? "idle" : "unavailable", source: null });
  return played ? "played" : "unavailable";
}

// How screens ask for speech: a line of text (with optional sound tokens) at a speed, or a
// sequence of lines played one after another (a word's sounds, then the word).
export type SpeakFn = (
  text: string | AudioRequest[],
  speed?: AudioSpeed,
  options?: Omit<PlayOptions, "sounds" | "owner" | "pacing"> & { intent?: AudioIntent },
) => Promise<PlayResult>;
