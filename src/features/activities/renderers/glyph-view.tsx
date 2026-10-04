"use client";

import type { TraceGlyph } from "@/lib/learning/tracing";

// Draws a handwriting glyph from its reference strokes (handwriting_glyphs, via the lesson
// step) in the 0–100 box: guide lines, the letter, start dots with stroke numbers and
// arrows, and an animated "watch me write it" model. Stroke data is never part of a
// component: it always comes from the glyph.

const pathOf = (points: [number, number][]) =>
  points.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join(" ");

export function GuideLines({ glyph }: { glyph: TraceGlyph | null }) {
  const g = glyph?.guide ?? {};
  const lines: { y: number; dashed: boolean; key: string }[] = [];
  if (g.top !== undefined) lines.push({ y: g.top, dashed: false, key: "top" });
  if (g.midline !== undefined) lines.push({ y: g.midline, dashed: true, key: "mid" });
  lines.push({ y: g.baseline ?? 85, dashed: false, key: "base" });
  return (
    <g aria-hidden>
      {lines.map((l) => (
        <line
          key={l.key}
          x1={2}
          x2={98}
          y1={l.y}
          y2={l.y}
          className={l.key === "base" ? "stroke-primary/50" : "stroke-primary/25"}
          strokeWidth={l.key === "base" ? 0.9 : 0.6}
          strokeDasharray={l.dashed ? "3 2.5" : undefined}
        />
      ))}
    </g>
  );
}

export function GlyphStrokes({
  glyph,
  variant,
  showStart,
  animate = 0,
}: {
  glyph: TraceGlyph;
  // trace: a wide faint track to go over; model: the letter as written.
  variant: "trace" | "model";
  showStart: boolean;
  // A changing number replays the writing animation (0: none).
  animate?: number;
}) {
  const width = variant === "trace" ? Math.max(6, Math.min(14, glyph.tolerance)) : 5;
  return (
    <g aria-hidden strokeLinecap="round" strokeLinejoin="round" fill="none">
      {glyph.strokes.map((s, i) => (
        <path
          key={`base-${i}`}
          d={pathOf(s.points)}
          strokeWidth={width}
          className={variant === "trace" ? "stroke-primary/20" : "stroke-foreground/80"}
        />
      ))}
      {variant === "trace"
        ? glyph.strokes.map((s, i) => (
            <path
              key={`center-${i}`}
              d={pathOf(s.points)}
              strokeWidth={0.8}
              strokeDasharray="2 2.5"
              className="stroke-primary/60"
            />
          ))
        : null}
      {animate
        ? glyph.strokes.map((s, i) => (
            <path
              key={`anim-${animate}-${i}`}
              d={pathOf(s.points)}
              pathLength={1}
              strokeWidth={variant === "trace" ? 4 : 5.5}
              className="stroke-success animate-draw-stroke"
              style={{ animationDelay: `${i * 0.95}s` }}
            />
          ))
        : null}
      {showStart
        ? glyph.strokes.map((s, i) => (
            <StartMark key={`start-${i}`} points={s.points} n={i + 1} many={glyph.strokes.length > 1} />
          ))
        : null}
    </g>
  );
}

// A green start dot (numbered when the glyph has several strokes) and an arrow along the
// first part of the stroke.
function StartMark({ points, n, many }: { points: [number, number][]; n: number; many: boolean }) {
  const [x, y] = points[0];
  let target = points[1];
  for (const p of points.slice(1)) {
    target = p;
    if (Math.hypot(p[0] - x, p[1] - y) >= 9) break;
  }
  const len = Math.hypot(target[0] - x, target[1] - y);
  const arrow =
    len > 2
      ? (() => {
          const [ux, uy] = [(target[0] - x) / len, (target[1] - y) / len];
          const reach = Math.min(len, 11);
          const [ex, ey] = [x + ux * reach, y + uy * reach];
          const [px, py] = [-uy, ux];
          return {
            line: `M${x + ux * 3.5} ${y + uy * 3.5} L${ex} ${ey}`,
            head: `M${ex - ux * 2.6 + px * 1.8} ${ey - uy * 2.6 + py * 1.8} L${ex} ${ey} L${ex - ux * 2.6 - px * 1.8} ${ey - uy * 2.6 - py * 1.8}`,
          };
        })()
      : null;
  return (
    <g>
      {arrow ? (
        <>
          <path d={arrow.line} strokeWidth={1.1} className="stroke-success" />
          <path d={arrow.head} strokeWidth={1.1} className="stroke-success" />
        </>
      ) : null}
      <circle cx={x} cy={y} r={3.2} className="fill-success" />
      {many ? (
        <text x={x} y={y + 1.3} textAnchor="middle" fontSize={3.8} fontWeight={800} className="fill-white">
          {n}
        </text>
      ) : null}
    </g>
  );
}

// The letter on its own (the model to copy, a reference in a report).
export function GlyphModel({
  glyph,
  size = 140,
  animate = 0,
}: {
  glyph: TraceGlyph;
  size?: number;
  animate?: number;
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="img"
      aria-label={glyph.name}
      className="bg-surface rounded-3xl border-2"
    >
      <GuideLines glyph={glyph} />
      <GlyphStrokes glyph={glyph} variant="model" showStart animate={animate} />
    </svg>
  );
}
