// The grown-ups' audio check (/parent/audio-check): fixed test lines for listening on a
// real phone, tablet or computer, and a summary of what the speech engine actually did
// for each (from the audio service's timing log). Pure; no browser APIs. The lines are a
// diagnostic fixture, not learning content.

import type { AudioIntent, AudioTiming } from "@/lib/audio/audio-service";

export type AudioCheckItem = {
  id: string;
  label: string;
  // What a grown-up should hear.
  expect: string;
  requests: { text: string; intent: AudioIntent; speed: "normal" | "slow" }[];
  sequence?: "SEGMENTING" | "BLENDING";
};

const SENTENCE = "The cat is at the gate.";

export const AUDIO_CHECK_ITEMS: AudioCheckItem[] = [
  {
    id: "reading-normal",
    label: "Reading — Normal",
    expect: "“The cat is at the gate.” — clear, unhurried, every word easy to hear.",
    requests: [{ text: SENTENCE, intent: "STORY_READING", speed: "normal" }],
  },
  {
    id: "reading-slow",
    label: "Reading — Slow",
    expect:
      "The same sentence, clearly slower than Normal, with small pauses between words or pairs of words.",
    requests: [{ text: SENTENCE, intent: "STORY_READING", speed: "slow" }],
  },
  {
    id: "letter-name",
    label: "Letter name: G",
    expect: "The NAME of the letter: “jee”.",
    requests: [{ text: "{@g}", intent: "LETTER_NAME", speed: "normal" }],
  },
  {
    id: "phoneme",
    label: "Sound: /g/",
    expect: "The SOUND /g/ (“guh”), not “jee”.",
    requests: [{ text: "{/G/}", intent: "PHONEME", speed: "normal" }],
  },
  {
    id: "word",
    label: "Word: gate",
    expect: "Just “gate” — not spelled out, no letters.",
    requests: [{ text: "gate", intent: "WORD", speed: "normal" }],
  },
  {
    id: "segmenting",
    label: "Segmenting: g / ay / t",
    expect: "Three separate sounds with clear gaps: “guh … eigh … tuh”.",
    requests: [
      { text: "{/G/}", intent: "PHONEME", speed: "slow" },
      { text: "{/EY/}", intent: "PHONEME", speed: "slow" },
      { text: "{/T/}", intent: "PHONEME", speed: "slow" },
    ],
    sequence: "SEGMENTING",
  },
  {
    id: "blending",
    label: "Blending: g + ay + t → gate",
    expect: "The three sounds with gaps, a longer pause, then the whole word “gate”.",
    requests: [
      { text: "{/G/}", intent: "PHONEME", speed: "slow" },
      { text: "{/EY/}", intent: "PHONEME", speed: "slow" },
      { text: "{/T/}", intent: "PHONEME", speed: "slow" },
      { text: "gate", intent: "WORD", speed: "normal" },
    ],
    sequence: "BLENDING",
  },
  {
    id: "spelling-intro",
    label: "Spelling intro (gate)",
    expect: "“gate” … “guh” … “eigh” … “tuh” … “gate”, each part separate — never one fast run.",
    requests: [{ text: "gate. {/G/}, {/EY/}, {/T/}. gate.", intent: "INSTRUCTION", speed: "normal" }],
  },
];

export type RequestSummary = {
  requestId: number;
  intent: AudioIntent;
  speed: "normal" | "slow";
  level: string;
  rates: number[];
  pieces: number;
  retries: number;
  // Silence the pacing put between pieces of a sentence (ms).
  pacedSilenceMs: number;
  // From handing the first piece to the engine to the end of the last one (ms).
  elapsedMs: number | null;
  // Time the engine was actually speaking (ms).
  speakingMs: number | null;
  voice: string | null;
  outcome: "heard" | "interrupted" | "failed" | "playing";
};

// `active`: the request still playing (between two pieces every logged piece has ended, but
// more are coming), from the audio service's playback state.
export function summarizeTimings(
  timings: readonly AudioTiming[],
  active: number | null = null,
): RequestSummary[] {
  const byRequest = new Map<number, AudioTiming[]>();
  for (const t of timings) byRequest.set(t.requestId, [...(byRequest.get(t.requestId) ?? []), t]);
  return [...byRequest.entries()].map(([requestId, rows]) => {
    const first = rows[0];
    const done = requestId !== active && rows.every((r) => r.endedAt !== null);
    const ends = rows.map((r) => r.endedAt ?? 0);
    const spoken = rows.filter((r) => r.startedAt !== null && r.endedAt !== null);
    const outcome = !done
      ? "playing"
      : rows.some((r) => r.outcome === "interrupted" && !r.retry && r === rows.at(-1))
        ? "interrupted"
        : rows.some((r) => r.outcome === "ended")
          ? "heard"
          : "failed";
    const main = rows.find((r) => r.role === "speech") ?? first;
    return {
      requestId,
      intent: main.intent,
      speed: first.speed,
      level: first.level,
      rates: [...new Set(rows.map((r) => r.rate))],
      pieces: rows.filter((r) => !r.retry).length,
      retries: rows.filter((r) => r.retry).length,
      pacedSilenceMs: rows.reduce((ms, r) => ms + (r.retry ? 0 : r.pauseBeforeMs), 0),
      elapsedMs: done ? Math.max(...ends) - first.spokeAt : null,
      speakingMs: spoken.length ? spoken.reduce((ms, r) => ms + (r.endedAt! - r.startedAt!), 0) : null,
      voice: first.voice,
      outcome,
    };
  });
}
