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
import { AUDIO_CHECK_ITEMS, summarizeTimings, type RequestSummary } from "@/lib/audio/audio-check";
import type { AudioPacing } from "@/lib/audio/pacing";
import type { SoundTable } from "@/lib/audio/pronunciation";
import { useAudio, useAudioSnapshot } from "@/lib/audio/use-audio";
import { cn } from "@/lib/utils";

type Verdict = "pass" | "fail" | null;
const NO_TIMINGS: never[] = [];

// The grown-ups' listening test for a real device: plays fixed lines through the same
// audio service children use (same voices, pacing, pauses), shows what the engine did
// (rate, pieces, silence, time) and lets the grown-up mark what they heard. Results can be
// copied and shared; nothing is stored or sent, and no child data is involved.
export function AudioCheck({ sounds, pacing }: { sounds: SoundTable; pacing: Record<string, AudioPacing> }) {
  const levels = Object.keys(pacing);
  const [level, setLevel] = useState(levels.includes("KG1") ? "KG1" : levels[0]);
  const { speak, speaking } = useAudio(sounds, pacing[level]);
  const [runs, setRuns] = useState<Record<string, number>>({});
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  const [copied, setCopied] = useState(false);
  const [engine, setEngine] = useState<ReturnType<typeof getAudioEngineInfo> | null>(null);
  const timings = useSyncExternalStore(subscribeAudioTimings, getAudioTimings, () => NO_TIMINGS);
  const playback = useAudioSnapshot();
  const active = playback.state === "loading" || playback.state === "playing" ? playback.requestId : null;
  const summaries = useMemo(() => summarizeTimings(timings, active), [timings, active]);
  const byRequest = new Map(summaries.map((s) => [s.requestId, s]));

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

  function run(id: string) {
    const item = AUDIO_CHECK_ITEMS.find((i) => i.id === id)!;
    const playing = speak(item.requests, { sequence: item.sequence });
    // playAudio makes the request current before it first waits.
    setRuns((r) => ({ ...r, [`${level}:${id}`]: getAudioSnapshot().requestId }));
    void playing.then(() => setEngine(getAudioEngineInfo()));
  }

  const summary = (id: string, lv = level): RequestSummary | undefined => {
    const requestId = runs[`${lv}:${id}`];
    return requestId ? byRequest.get(requestId) : undefined;
  };
  const normal = summary("reading-normal");
  const slow = summary("reading-slow");
  const ratio =
    normal?.elapsedMs && slow?.elapsedMs ? Math.round((slow.elapsedMs / normal.elapsedMs) * 100) / 100 : null;

  async function copy() {
    const lines = [
      `Word Garden audio check — ${new Date().toISOString()}`,
      `Device: ${navigator.userAgent}`,
      `Speech: ${engine?.tts ? "yes" : "no"}, voices ${engine?.voices ?? 0}, voice ${engine?.voice ? `${engine.voice.name} (${engine.voice.lang}${engine.voice.local ? ", on device" : ", online"})` : "default"}`,
      ...levels.flatMap((lv) =>
        AUDIO_CHECK_ITEMS.filter((i) => runs[`${lv}:${i.id}`] || verdicts[`${lv}:${i.id}`]).map((i) => {
          const s = summary(i.id, lv);
          return `${lv} ${i.label}: ${verdicts[`${lv}:${i.id}`] ?? "not marked"}${s ? ` | rate ${s.rates.join("/")} | pieces ${s.pieces} | paced silence ${s.pacedSilenceMs} ms | elapsed ${s.elapsedMs ?? "?"} ms | speaking ${s.speakingMs ?? "?"} ms | ${s.outcome}${s.retries ? ` | retries ${s.retries}` : ""}` : ""}`;
        }),
      ),
      ratio ? `${level} Slow / Normal elapsed: ${ratio}×` : "",
    ].filter(Boolean);
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
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
          <span className="font-semibold">Speech:</span>{" "}
          {engine ? (engine.tts ? `available, ${engine.voices} voices` : "not available") : "…"}
        </p>
        <p>
          <span className="font-semibold">Voice:</span>{" "}
          {engine?.voice
            ? `${engine.voice.name} (${engine.voice.lang}, ${engine.voice.local ? "on this device" : "online"})`
            : "the device's default (the voice list has not loaded yet, or is empty)"}
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

      <ol className="space-y-3">
        {AUDIO_CHECK_ITEMS.map((item) => {
          const key = `${level}:${item.id}`;
          const s = summary(item.id);
          return (
            <li key={item.id}>
              <Card className="space-y-2" data-check={item.id}>
                <div className="flex flex-wrap items-center gap-3">
                  <Button onClick={() => run(item.id)} aria-label={`Play: ${item.label}`}>
                    <span aria-hidden>🔊 </span>
                    {item.label}
                  </Button>
                  <div className="flex gap-2" role="group" aria-label={`What you heard: ${item.label}`}>
                    {(["pass", "fail"] as const).map((v) => (
                      <button
                        key={v}
                        type="button"
                        aria-pressed={verdicts[key] === v}
                        onClick={() => setVerdicts((all) => ({ ...all, [key]: v }))}
                        className={cn(
                          "min-h-11 rounded-xl border-2 px-3 font-semibold",
                          verdicts[key] === v
                            ? v === "pass"
                              ? "border-success bg-success-soft"
                              : "border-danger bg-danger-soft"
                            : "border-border",
                        )}
                      >
                        {v === "pass" ? "✅ Sounds right" : "❌ Sounds wrong"}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="text-muted">You should hear: {item.expect}</p>
                {s ? (
                  <p className="text-sm" data-timing>
                    rate {s.rates.join(" / ")} · {s.pieces} {s.pieces === 1 ? "piece" : "pieces"} · paced
                    silence {s.pacedSilenceMs} ms · elapsed {s.elapsedMs ?? "…"} ms · speaking{" "}
                    {s.speakingMs ?? "…"} ms · {s.outcome}
                    {s.retries ? ` · ${s.retries} retried` : ""}
                  </p>
                ) : null}
              </Card>
            </li>
          );
        })}
      </ol>

      <Card className="space-y-3">
        <CardTitle>Normal vs Slow ({level})</CardTitle>
        <p data-ratio>
          {ratio
            ? `Slow took ${ratio}× as long as Normal (${slow!.elapsedMs} ms vs ${normal!.elapsedMs} ms).`
            : "Play Reading — Normal and Reading — Slow to compare them."}
        </p>
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
