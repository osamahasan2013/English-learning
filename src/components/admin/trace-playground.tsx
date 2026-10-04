"use client";

import { useRef, useState, type PointerEvent } from "react";
import { Button } from "@/components/ui/button";
import { GlyphStrokes, GuideLines } from "@/features/activities/renderers/glyph-view";
import {
  evaluateTrace,
  simplifyStroke,
  type Point,
  type TraceGlyph,
  type TraceResult,
} from "@/lib/learning/tracing";
import { traceSettingsFor, type WritingSettings } from "@/lib/learning/writing-evaluation";

// Admin: draw over (or next to) a glyph and see what the tracing engine decides with each
// level's settings — coverage, precision and the issues found. Nothing is stored.
export function TracePlayground({
  glyph,
  levels,
}: {
  glyph: TraceGlyph;
  levels: { level: string; settings: WritingSettings }[];
}) {
  const [strokes, setStrokes] = useState<[number, number][][]>([]);
  const [level, setLevel] = useState(levels[0]?.level ?? "");
  const [mode, setMode] = useState<"trace" | "write">("trace");
  const current = useRef<Point[] | null>(null);
  const [live, setLive] = useState<Point[]>([]);
  const settings = levels.find((l) => l.level === level)?.settings;
  const result: TraceResult | null =
    settings && strokes.length > 0
      ? evaluateTrace(glyph.strokes, strokes, traceSettingsFor(glyph, mode, { trace: true }, settings))
      : null;

  const point = (e: PointerEvent<SVGSVGElement>): Point => {
    const r = e.currentTarget.getBoundingClientRect();
    return [
      Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)),
      Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100)),
    ];
  };
  const path = (pts: number[][]) => pts.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3 text-sm">
        <label>
          Level{" "}
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            className="border-border rounded-lg border px-2 py-1"
          >
            {levels.map((l) => (
              <option key={l.level}>{l.level}</option>
            ))}
          </select>
        </label>
        <label>
          Mode{" "}
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as "trace" | "write")}
            className="border-border rounded-lg border px-2 py-1"
          >
            <option value="trace">trace (over the letter)</option>
            <option value="write">write (aligned, from memory)</option>
          </select>
        </label>
      </div>
      <svg
        viewBox="0 0 100 100"
        className="bg-surface border-border aspect-square w-full max-w-sm touch-none rounded-2xl border-2"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          current.current = [point(e)];
          setLive(current.current);
        }}
        onPointerMove={(e) => {
          if (!current.current) return;
          current.current = [...current.current, point(e)];
          setLive(current.current);
        }}
        onPointerUp={() => {
          const pts = current.current;
          current.current = null;
          setLive([]);
          if (pts) setStrokes((s) => [...s, simplifyStroke(pts.length === 1 ? [pts[0], pts[0]] : pts)]);
        }}
        role="img"
        aria-label={`Drawing pad for ${glyph.name}`}
      >
        <GuideLines glyph={glyph} />
        {mode === "trace" ? <GlyphStrokes glyph={glyph} variant="trace" showStart /> : null}
        <g
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="stroke-success"
          strokeWidth={4}
        >
          {strokes.map((s, i) => (
            <path key={i} d={path(s)} />
          ))}
          {live.length > 1 ? <path d={path(live)} /> : null}
        </g>
      </svg>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setStrokes((s) => s.slice(0, -1))}
          disabled={!strokes.length}
        >
          Undo
        </Button>
        <Button variant="secondary" size="sm" onClick={() => setStrokes([])} disabled={!strokes.length}>
          Clear
        </Button>
      </div>
      {result ? (
        <dl className="grid grid-cols-2 gap-1 text-sm" aria-live="polite">
          <dt className="text-muted">Verdict</dt>
          <dd className="font-semibold">
            {result.complete ? "✅ complete" : result.almost ? "🟡 almost" : "✗ not yet"}
          </dd>
          <dt className="text-muted">Coverage</dt>
          <dd>{Math.round(result.coverage * 100)}%</dd>
          <dt className="text-muted">Precision</dt>
          <dd>{Math.round(result.precision * 100)}%</dd>
          <dt className="text-muted">Per stroke</dt>
          <dd>
            {result.strokes
              .map((s) => `${Math.round(s.coverage * 100)}%${s.reversed ? " (reversed)" : ""}`)
              .join(", ")}
          </dd>
          <dt className="text-muted">Order · direction · start</dt>
          <dd>
            {result.orderOk ? "✓" : "✗"} · {result.directionOk ? "✓" : "✗"} · {result.startOk ? "✓" : "✗"}
          </dd>
          <dt className="text-muted">Issues</dt>
          <dd>{result.issues.join(", ") || "—"}</dd>
        </dl>
      ) : (
        <p className="text-muted text-sm">Draw to see the result.</p>
      )}
    </div>
  );
}
