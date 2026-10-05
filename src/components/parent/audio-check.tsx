"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import {
  getAudioEngineInfo,
  getAudioSnapshot,
  getAudioTimings,
  setAudioTimingLog,
  stopAudio,
  subscribeAudioTimings,
} from "@/lib/audio/audio-service";
import {
  AUDIO_CHECK_ITEMS,
  describeDevice,
  formatResults,
  slowNormalRatio,
  summarizeTimings,
  type AudioCheckGroup,
  type AudioCheckItem,
  type AudioCheckResult,
  type RequestSummary,
} from "@/lib/audio/audio-check";
import type { AudioPacing } from "@/lib/audio/pacing";
import { explainSpeech, type SoundTable, type SpeechExplanation } from "@/lib/audio/pronunciation";
import { useAudio, useAudioSnapshot } from "@/lib/audio/use-audio";
import { cn } from "@/lib/utils";

type Verdict = "PASS" | "FAIL";
const NO_TIMINGS: never[] = [];
const GROUPS: AudioCheckGroup[] = [
  "LETTER NAME",
  "PHONEME",
  "WORD",
  "SENTENCE",
  "READING",
  "SEGMENTING",
  "BLENDING",
  "INSTRUCTION",
];
const SOURCE_LABEL: Record<SpeechExplanation["source"], string> = {
  recorded: "recorded audio",
  tts: "device voice (TTS)",
  keyword: "keyword (no safe isolated sound)",
  none: "unavailable",
};

// The browser and system (fixed for the page's life; none on the server).
let deviceInfo: { os: string; browser: string; language: string } | null = null;
const noSubscribe = () => () => {};
function deviceSnapshot() {
  deviceInfo ??= { ...describeDevice(navigator.userAgent), language: navigator.language };
  return deviceInfo;
}

// How each request of a check will be spoken: role, token, source and what the voice is given.
function explain(item: AudioCheckItem, sounds: SoundTable) {
  return item.requests.flatMap((r) =>
    explainSpeech(r.text, sounds).map((e) => ({ ...e, intent: r.intent, speed: r.speed })),
  );
}

function sourceOf(explained: SpeechExplanation[]) {
  const sources = [...new Set(explained.map((e) => e.source))];
  return sources.length ? sources.join(" + ") : "none";
}

// The grown-ups' listening test for a real device: plays fixed lines through the same
// audio service children use (same voices, pacing, pauses), shows what each line means
// (intent, target), where its sound comes from (recorded, device voice, keyword) and what
// the engine did, and lets the grown-up mark PASS or FAIL with a note. Results can be
// copied and shared; nothing is stored or sent, and no child data is involved.
export function AudioCheck({ sounds, pacing }: { sounds: SoundTable; pacing: Record<string, AudioPacing> }) {
  const levels = Object.keys(pacing);
  const [level, setLevel] = useState(levels.includes("KG1") ? "KG1" : levels[0]);
  const { speak, speaking } = useAudio(sounds, pacing[level]);
  const [runs, setRuns] = useState<Record<string, number>>({});
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const [engine, setEngine] = useState<ReturnType<typeof getAudioEngineInfo> | null>(null);
  const device = useSyncExternalStore(noSubscribe, deviceSnapshot, () => null);
  const timings = useSyncExternalStore(subscribeAudioTimings, getAudioTimings, () => NO_TIMINGS);
  const playback = useAudioSnapshot();
  const active = playback.state === "loading" || playback.state === "playing" ? playback.requestId : null;
  const summaries = useMemo(() => summarizeTimings(timings, active), [timings, active]);
  const byRequest = new Map(summaries.map((s) => [s.requestId, s]));
  const explained = useMemo(
    () => new Map(AUDIO_CHECK_ITEMS.map((item) => [item.id, explain(item, sounds)])),
    [sounds],
  );

  useEffect(() => {
    setAudioTimingLog(true);
    const refresh = () => setEngine(getAudioEngineInfo());
    refresh();
    // Voices arrive late on some devices.
    const timer = setTimeout(refresh, 1000);
    return () => {
      clearTimeout(timer);
      setAudioTimingLog(false);
    };
  }, []);

  const voiceName = engine?.voice
    ? `${engine.voice.name}${engine.voice.local ? " (on device)" : " (online)"}`
    : "device default";
  const locale = engine?.voice?.lang ?? device?.language ?? "unknown";

  function run(item: AudioCheckItem) {
    const playing = speak(item.requests, { sequence: item.sequence });
    // playAudio makes the request current before it first waits.
    setRuns((r) => ({ ...r, [`${level}:${item.id}`]: getAudioSnapshot().requestId }));
    void playing.then(() => setEngine(getAudioEngineInfo()));
  }

  const summary = (id: string, lv = level): RequestSummary | undefined => {
    const requestId = runs[`${lv}:${id}`];
    return requestId ? byRequest.get(requestId) : undefined;
  };
  const timingText = (s: RequestSummary) =>
    `rate ${s.rates.join(" / ")} · ${s.pieces} ${s.pieces === 1 ? "piece" : "pieces"} · paced silence ${
      s.pacedSilenceMs
    } ms · elapsed ${s.elapsedMs ?? "…"} ms · speaking ${s.speakingMs ?? "…"} ms · ${s.outcome}${
      s.retries ? ` · ${s.retries} retried` : ""
    }`;

  // Slow vs Normal for each reading sentence played at both speeds.
  const ratios = AUDIO_CHECK_ITEMS.filter((i) => i.group === "READING" && i.id.endsWith("-normal")).map(
    (i) => ({
      target: i.target,
      ...slowNormalRatio(summary(i.id), summary(i.id.replace(/-normal$/, "-slow"))),
    }),
  );

  async function copy() {
    const results: AudioCheckResult[] = levels.flatMap((lv) =>
      AUDIO_CHECK_ITEMS.filter((i) => runs[`${lv}:${i.id}`] || verdicts[`${lv}:${i.id}`]).map((i) => ({
        testId: i.id,
        intent: i.intent,
        target: i.target,
        verdict: verdicts[`${lv}:${i.id}`] ?? null,
        note: notes[`${lv}:${i.id}`]?.trim() ?? "",
        source: sourceOf(explained.get(i.id) ?? []),
        level: lv,
      })),
    );
    const text = formatResults({
      at: new Date().toISOString(),
      device: device ?? { os: "unknown", browser: "unknown" },
      voice: voiceName,
      locale,
      results,
      timing: (testId, lv) => {
        const s = summary(testId, lv);
        return s ? ` · ${timingText(s)}` : "";
      },
    });
    const ratioLines = ratios
      .filter((r) => !r.note.startsWith("play it at"))
      .map((r) => `${level} Slow / Normal “${r.target}”: ${r.note}`);
    try {
      await navigator.clipboard.writeText([text, ...ratioLines].join("\n"));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-6">
      <Card className="space-y-2">
        <CardTitle>This device</CardTitle>
        <p>
          <span className="font-semibold">Device:</span> {device ? `${device.os}, ${device.browser}` : "…"}
        </p>
        <p>
          <span className="font-semibold">Speech:</span>{" "}
          {engine ? (engine.tts ? `available, ${engine.voices} voices` : "not available") : "…"}
        </p>
        <p data-voice>
          <span className="font-semibold">Voice:</span>{" "}
          {engine?.voice
            ? `${engine.voice.name} (${engine.voice.lang}, ${engine.voice.local ? "on this device" : "online"})`
            : "the device's default (the voice list has not loaded yet, or is empty)"}
        </p>
        <p>
          <span className="font-semibold">Locale:</span> {locale}
        </p>
        <label className="flex flex-wrap items-center gap-2">
          <span className="font-semibold">Level:</span>
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            className="border-border bg-surface min-h-11 rounded-xl border-2 px-3"
          >
            {levels.map((lv) => (
              <option key={lv} value={lv}>
                {lv}
              </option>
            ))}
          </select>
          <span className="text-muted text-sm">
            Normal {pacing[level].reading.normal.rate} ({pacing[level].reading.normal.chunk}), Slow{" "}
            {pacing[level].reading.slow.rate} ({pacing[level].reading.slow.chunk})
          </span>
        </label>
      </Card>

      {GROUPS.map((group) => {
        const items = AUDIO_CHECK_ITEMS.filter((i) => i.group === group);
        if (!items.length) return null;
        return (
          <section key={group} className="space-y-3" aria-labelledby={`group-${group}`}>
            <h2 id={`group-${group}`} className="text-xl font-extrabold">
              {group}
            </h2>
            <ol className="space-y-3">
              {items.map((item) => {
                const key = `${level}:${item.id}`;
                const s = summary(item.id);
                const parts = explained.get(item.id) ?? [];
                return (
                  <li key={item.id}>
                    <Card className="space-y-2" data-check={item.id}>
                      <div className="flex flex-wrap items-center gap-3">
                        <Button onClick={() => run(item)} aria-label={`Play: ${item.label}`}>
                          <span aria-hidden>🔊 </span>
                          {item.label}
                        </Button>
                        <div className="flex gap-2" role="group" aria-label={`What you heard: ${item.label}`}>
                          {(["PASS", "FAIL"] as const).map((v) => (
                            <button
                              key={v}
                              type="button"
                              aria-pressed={verdicts[key] === v}
                              onClick={() => setVerdicts((all) => ({ ...all, [key]: v }))}
                              className={cn(
                                "min-h-11 rounded-xl border-2 px-3 font-semibold",
                                verdicts[key] === v
                                  ? v === "PASS"
                                    ? "border-success bg-success-soft"
                                    : "border-danger bg-danger-soft"
                                  : "border-border",
                              )}
                            >
                              {v === "PASS" ? "✅ PASS" : "❌ FAIL"}
                            </button>
                          ))}
                        </div>
                      </div>
                      <p className="text-muted">You should hear: {item.expect}</p>
                      <dl className="grid grid-cols-[auto_1fr] gap-x-3 text-sm" data-meta>
                        <dt className="font-semibold">Intent</dt>
                        <dd data-intent>{item.intent}</dd>
                        <dt className="font-semibold">Target</dt>
                        <dd data-target>{item.target}</dd>
                        <dt className="font-semibold">Source</dt>
                        <dd data-source>
                          {[...new Set(parts.map((p) => SOURCE_LABEL[p.source]))].join(" + ") ||
                            "unavailable"}
                        </dd>
                        <dt className="font-semibold">Voice</dt>
                        <dd>
                          {voiceName} · {locale}
                        </dd>
                      </dl>
                      <label className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-semibold">Note (optional):</span>
                        <input
                          type="text"
                          value={notes[key] ?? ""}
                          maxLength={200}
                          onChange={(e) => setNotes((all) => ({ ...all, [key]: e.target.value }))}
                          className="border-border bg-surface min-h-11 flex-1 rounded-xl border-2 px-3"
                          aria-label={`Note: ${item.label}`}
                        />
                      </label>
                      <details className="text-sm">
                        <summary className="cursor-pointer font-semibold">Technical details</summary>
                        <ul className="mt-2 space-y-1" data-explain>
                          {parts.map((p, i) => (
                            <li key={i}>
                              {p.intent} ({p.speed}) · {p.role} · {p.target} → “{p.rendering}” ·{" "}
                              {SOURCE_LABEL[p.source]}
                            </li>
                          ))}
                        </ul>
                        {s ? (
                          <p className="mt-2" data-timing>
                            {timingText(s)}
                          </p>
                        ) : (
                          <p className="text-muted mt-2">Play it to see what the device&apos;s voice did.</p>
                        )}
                      </details>
                    </Card>
                  </li>
                );
              })}
            </ol>
          </section>
        );
      })}

      <Card className="space-y-3">
        <CardTitle>Normal vs Slow ({level})</CardTitle>
        <ul className="space-y-1" data-ratio>
          {ratios.map((r) => (
            <li key={r.target}>
              “{r.target}”: {r.note}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2">
          {speaking ? (
            <Button variant="secondary" onClick={() => stopAudio()}>
              ⏹️ Stop
            </Button>
          ) : null}
          <Button variant="secondary" onClick={() => void copy()}>
            📋 Copy results
          </Button>
          {copied ? (
            <span role="status" className="self-center font-semibold">
              Copied.
            </span>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
