// Audio for every learning item goes through this service, never straight to a browser
// API. Today it speaks with the browser's speech synthesis (American English, a little
// slower than conversation); when a recorded asset URL exists it plays that instead. Moving
// to professional recordings means filling audio_assets — no lesson component changes.

export type AudioSpeed = "normal" | "slow";

export type AudioRequest = {
  text: string;
  // A recorded file (Supabase Storage URL). Takes priority over speech synthesis.
  assetUrl?: string | null;
  speed?: AudioSpeed;
};

export const SPEECH_SETTINGS = {
  locale: "en-US",
  // Slightly slower than ordinary conversation, and much slower for "Slow".
  rate: { normal: 0.85, slow: 0.55 } satisfies Record<AudioSpeed, number>,
  pitch: 1.05,
  recordedSlowPlaybackRate: 0.75,
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

let currentAudio: HTMLAudioElement | null = null;

export function stopAudio() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  if (isSpeechSynthesisAvailable()) window.speechSynthesis.cancel();
}

function playRecorded(url: string, speed: AudioSpeed): Promise<boolean> {
  return new Promise((resolve) => {
    const audio = new Audio(url);
    currentAudio = audio;
    audio.playbackRate = speed === "slow" ? SPEECH_SETTINGS.recordedSlowPlaybackRate : 1;
    audio.onended = () => resolve(true);
    audio.onerror = () => resolve(false);
    audio.play().catch(() => resolve(false));
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
    const voice = pickVoice(synth.getVoices());
    if (voice) utterance.voice = voice;
    // Some engines never fire onend; never leave a caller waiting forever.
    const timeout = setTimeout(() => resolve(true), Math.max(3000, text.length * 180));
    utterance.onend = () => {
      clearTimeout(timeout);
      resolve(true);
    };
    utterance.onerror = () => {
      clearTimeout(timeout);
      resolve(false);
    };
    synth.cancel();
    synth.speak(utterance);
  });
}

// Resolves true if something was played. Never throws: audio is an aid, and a device
// without it must still be fully usable (text is always shown too).
export async function playAudio(request: AudioRequest): Promise<boolean> {
  const speed = request.speed ?? "normal";
  stopAudio();
  if (request.assetUrl) {
    if (await playRecorded(request.assetUrl, speed)) return true;
  }
  return speakSynthesized(request.text, speed);
}
