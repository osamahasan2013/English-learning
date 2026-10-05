// The grown-ups' audio check (/parent/audio-check): fixed test lines for listening on a
// real phone, tablet or computer, and a summary of what the speech engine actually did
// for each (from the audio service's timing log). Pure; no browser APIs. The lines are a
// diagnostic fixture, not learning content.

import type { AudioIntent, AudioTiming } from "@/lib/audio/audio-service";

export type AudioCheckGroup =
  "LETTER NAME" | "PHONEME" | "WORD" | "SENTENCE" | "READING" | "SEGMENTING" | "BLENDING" | "INSTRUCTION";

export type AudioCheckItem = {
  id: string;
  group: AudioCheckGroup;
  label: string;
  // What is being taught, as the audio service receives it.
  intent: AudioIntent | "SEGMENTING" | "BLENDING";
  target: string;
  // What a grown-up should hear.
  expect: string;
  requests: { text: string; intent: AudioIntent; speed: "normal" | "slow" }[];
  sequence?: "SEGMENTING" | "BLENDING";
};

const letter = (l: string, sound: string): AudioCheckItem => ({
  id: `letter-${l}`,
  group: "LETTER NAME",
  label: `Letter name: ${l.toUpperCase()}`,
  intent: "LETTER_NAME",
  target: l.toUpperCase(),
  expect: `The NAME of the letter ${l.toUpperCase()} — not another letter, and not its sound (${sound}).`,
  requests: [{ text: `{@${l}}`, intent: "LETTER_NAME", speed: "normal" }],
});

const phoneme = (code: string, label: string, name: string): AudioCheckItem => ({
  id: `phoneme-${label}`,
  group: "PHONEME",
  label: `Sound: /${label}/`,
  intent: "PHONEME",
  target: `/${label}/`,
  expect: `The SOUND /${label}/ — not the letter name ${name}. (Browser voices add a short "uh"; a recording would be pure.)`,
  requests: [{ text: `{/${code}/}`, intent: "PHONEME", speed: "normal" }],
});

const word = (w: string, note: string): AudioCheckItem => ({
  id: `word-${w}`,
  group: "WORD",
  label: `Word: ${w}`,
  intent: "WORD",
  target: w,
  expect: `Just the word “${w}” — ${note}`,
  requests: [{ text: w, intent: "WORD", speed: "normal" }],
});

const READING = [
  "The cat is at the gate.",
  "The dog is in the sun.",
  "The big cat can run.",
  "The apple is red.",
  "The boy has a ball.",
];

const reading = (sentence: string, i: number, speed: "normal" | "slow"): AudioCheckItem => ({
  id: `reading-${i + 1}-${speed}`,
  group: "READING",
  label: `Reading ${i + 1} — ${speed === "normal" ? "Normal" : "Slow"}`,
  intent: "STORY_READING",
  target: sentence,
  expect:
    speed === "normal"
      ? `“${sentence}” — natural and clear, every word (including “the”) easy to hear, not too fast.`
      : `“${sentence}” — clearly slower than Normal, small pauses, still natural; “the” always with its word.`,
  requests: [{ text: sentence, intent: "STORY_READING", speed }],
});

export const AUDIO_CHECK_ITEMS: AudioCheckItem[] = [
  letter("a", "the a in apple"),
  letter("g", "/g/ as in goat"),
  letter("s", "/s/ as in sun"),
  letter("t", "/t/ as in top"),
  phoneme("G", "g", "G"),
  phoneme("S", "s", "S"),
  phoneme("M", "m", "M"),
  phoneme("T", "t", "T"),
  word("gate", "not spelled out, no letters, no separate sounds."),
  word("cat", "not spelled out."),
  word("the", "clearly the word “the” (“thuh” or “thee” are both fine), not cut off."),
  {
    id: "sentence",
    group: "SENTENCE",
    label: "Sentence",
    intent: "SENTENCE",
    target: READING[0],
    expect: `“${READING[0]}” — every word understood without guessing.`,
    requests: [{ text: READING[0], intent: "SENTENCE", speed: "normal" }],
  },
  ...READING.flatMap((s, i) => [reading(s, i, "normal"), reading(s, i, "slow")]),
  {
    id: "segmenting",
    group: "SEGMENTING",
    label: "Segmenting: gate → /g/ /ā/ /t/",
    intent: "SEGMENTING",
    target: "gate",
    expect: "Three separate sounds with clear gaps: “guh … eigh … tuh” — no letter names.",
    requests: [
      { text: "{/G/}", intent: "PHONEME", speed: "slow" },
      { text: "{/EY/}", intent: "PHONEME", speed: "slow" },
      { text: "{/T/}", intent: "PHONEME", speed: "slow" },
    ],
    sequence: "SEGMENTING",
  },
  {
    id: "blending",
    group: "BLENDING",
    label: "Blending: /g/ + /ā/ + /t/ → gate",
    intent: "BLENDING",
    target: "gate",
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
    group: "INSTRUCTION",
    label: "Spelling intro (gate)",
    intent: "INSTRUCTION",
    target: "gate. {/G/}, {/EY/}, {/T/}. gate.",
    expect: "“gate” … “guh” … “eigh” … “tuh” … “gate”, each part separate — never one fast run.",
    requests: [{ text: "gate. {/G/}, {/EY/}, {/T/}. gate.", intent: "INSTRUCTION", speed: "normal" }],
  },
  {
    id: "letter-intro",
    group: "INSTRUCTION",
    label: "Letter intro (G)",
    intent: "INSTRUCTION",
    target: "This is the letter {@g}. It says {/G/}, as in goat.",
    expect: "“This is the letter G. It says guh, as in goat.” — the NAME G, then the SOUND /g/.",
    requests: [
      { text: "This is the letter {@g}. It says {/G/}, as in goat.", intent: "INSTRUCTION", speed: "normal" },
    ],
  },
];

// The browser and system, from the user agent (for the results; nothing personal).
export function describeDevice(userAgent: string) {
  const os = /iPhone|iPad|iPod/.test(userAgent)
    ? `iOS${userAgent.match(/OS (\d+[_\d]*)/)?.[1] ? ` ${userAgent.match(/OS (\d+[_\d]*)/)![1].replace(/_/g, ".")}` : ""}`
    : /Android/.test(userAgent)
      ? `Android${userAgent.match(/Android (\d+(\.\d+)?)/)?.[1] ? ` ${userAgent.match(/Android (\d+(\.\d+)?)/)![1]}` : ""}`
      : /Mac OS X/.test(userAgent)
        ? "macOS"
        : /Windows/.test(userAgent)
          ? "Windows"
          : /Linux/.test(userAgent)
            ? "Linux"
            : "unknown";
  const browser = /CriOS\//.test(userAgent)
    ? "Chrome (iOS)"
    : /FxiOS\//.test(userAgent)
      ? "Firefox (iOS)"
      : /EdgA?\//.test(userAgent)
        ? "Edge"
        : /Chrome\//.test(userAgent)
          ? "Chrome"
          : /Firefox\//.test(userAgent)
            ? "Firefox"
            : /Safari\//.test(userAgent)
              ? "Safari"
              : "unknown";
  return { os, browser };
}

export type AudioCheckResult = {
  testId: string;
  intent: string;
  target: string;
  verdict: "PASS" | "FAIL" | null;
  note: string;
  source: string;
  level: string;
};

// The results as plain text to paste back (one line per test that was played or marked).
export function formatResults(args: {
  at: string;
  device: { os: string; browser: string };
  voice: string;
  locale: string;
  results: readonly AudioCheckResult[];
  timing: (testId: string, level: string) => string;
}) {
  return [
    `Word Garden audio check — ${args.at}`,
    `Device: ${args.device.os}, ${args.device.browser} · voice: ${args.voice} · locale: ${args.locale}`,
    ...args.results.map(
      (r) =>
        `${r.testId} [${r.level}] ${r.verdict ?? "NOT MARKED"} · intent ${r.intent} · target ${r.target} · source ${r.source}${
          r.note ? ` · note: ${r.note}` : ""
        }${args.timing(r.testId, r.level)}`,
    ),
  ].join("\n");
}

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
    // The request's own result when it has one (a request stopped between two pieces has
    // only pieces that ended); otherwise inferred from its pieces.
    const final = rows.find((r) => r.final)?.final;
    const done = final ? true : requestId !== active && rows.every((r) => r.endedAt !== null);
    const ends = rows.map((r) => r.endedAt ?? 0);
    const spoken = rows.filter((r) => r.startedAt !== null && r.endedAt !== null);
    const outcome = !done
      ? "playing"
      : final
        ? final === "played"
          ? "heard"
          : final === "interrupted"
            ? "interrupted"
            : "failed"
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

// Slow ÷ Normal elapsed time for one sentence — only when both were heard to the end. A run
// stopped early (the next test started while it was playing) measures only the part that
// played, which would make Slow look barely slower than Normal.
export function slowNormalRatio(normal?: RequestSummary, slow?: RequestSummary) {
  if (!normal || !slow) return { ratio: null, note: "play it at Normal and Slow to compare." };
  if (normal.outcome !== "heard" || slow.outcome !== "heard")
    return {
      ratio: null,
      note: `${[normal.outcome !== "heard" && "Normal", slow.outcome !== "heard" && "Slow"]
        .filter(Boolean)
        .join(" and ")} did not play to the end — play it again and let it finish to compare.`,
    };
  const ratio = Math.round((slow.elapsedMs! / normal.elapsedMs!) * 100) / 100;
  return {
    ratio,
    note: `Slow took ${ratio}× as long as Normal (${slow.elapsedMs} ms vs ${normal.elapsedMs} ms).`,
  };
}
