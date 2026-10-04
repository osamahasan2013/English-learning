"use client";

import { useCallback, useEffect, useRef, useState, type PointerEvent } from "react";
import { AudioControls } from "@/components/child/audio-controls";
import { Button } from "@/components/ui/button";
import { MAX_TRACE_STROKES, simplifyStroke, type Point } from "@/lib/learning/tracing";
import { cn } from "@/lib/utils";
import type { QuestionOf, RendererProps } from "../types";
import { GlyphModel, GlyphStrokes, GuideLines } from "./glyph-view";

const INK_SIZE = 400;

// Handwriting with a finger, mouse or pen (pointer events cover all three), in one of three
// modes (content.mode):
//   trace — go over the faint letter, starting at the green dot
//   copy  — look at the letter, write it in the empty box
//   write — hear it (its name, its sound, a word), write it from memory
// The child's strokes are recorded as points in the glyph's 0–100 box and sent as the
// answer; whether they make the letter is decided by the tracing engine (tracing.ts), on
// the device for feedback and again on the server. "Type it" is the alternative for
// children who cannot draw on the screen.
export function TracingRenderer({
  step,
  phase,
  lastResponse,
  onAnswer,
  speak,
}: RendererProps<QuestionOf<"TRACING">>) {
  const { content } = step.question;
  const glyph = step.glyph ?? null;
  const inkRef = useRef<HTMLCanvasElement>(null);
  const current = useRef<Point[] | null>(null);
  const [strokes, setStrokes] = useState<[number, number][][]>([]);
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState("");
  const [demo, setDemo] = useState(() =>
    step.activityConfig.showModel !== false && content.mode !== "write" ? 1 : 0,
  );
  const locked = phase !== "answering";
  const mode = content.mode;
  const name = glyph?.name ?? "the letter";

  const redraw = useCallback((all: number[][][]) => {
    const ctx = inkRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, INK_SIZE, INK_SIZE);
    for (const s of all) drawStroke(ctx, s);
  }, []);

  // Looking back at an answer: show the strokes that were sent.
  useEffect(() => {
    if (locked && lastResponse && "strokes" in lastResponse) redraw(lastResponse.strokes);
  }, [locked, lastResponse, redraw]);

  function point(e: PointerEvent<HTMLCanvasElement>): Point {
    const rect = e.currentTarget.getBoundingClientRect();
    const clamp = (v: number) => Math.max(0, Math.min(100, v));
    return [
      clamp(((e.clientX - rect.left) / rect.width) * 100),
      clamp(((e.clientY - rect.top) / rect.height) * 100),
    ];
  }
  function start(e: PointerEvent<HTMLCanvasElement>) {
    if (locked || strokes.length >= MAX_TRACE_STROKES) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    current.current = [point(e)];
    setDemo(0);
  }
  function move(e: PointerEvent<HTMLCanvasElement>) {
    const pts = current.current;
    if (!pts) return;
    const p = point(e);
    const last = pts[pts.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.6) return;
    pts.push(p);
    const ctx = inkRef.current?.getContext("2d");
    if (ctx) drawStroke(ctx, [last, p]);
  }
  function end() {
    const pts = current.current;
    current.current = null;
    if (!pts) return;
    // A tap is a dot (the dot on i and j).
    const stroke = simplifyStroke(pts.length === 1 ? [pts[0], pts[0]] : pts);
    if (stroke.length === 0) return;
    const next = [...strokes, stroke];
    setStrokes(next);
    redraw(next);
  }
  function undo() {
    const next = strokes.slice(0, -1);
    setStrokes(next);
    redraw(next);
  }
  function clear() {
    setStrokes([]);
    redraw([]);
  }
  function watch() {
    setDemo((d) => d + 1);
    if (glyph?.formationSpeech) void speak(glyph.formationSpeech);
  }

  const border =
    phase === "correct"
      ? "border-success"
      : phase === "retry" || phase === "reveal"
        ? "border-danger"
        : "border-primary/40";
  const prompt =
    step.prompt ||
    (mode === "trace"
      ? `Trace ${name}`
      : mode === "copy"
        ? `Write ${name}`
        : "Listen, then write the letter");

  return (
    <div className="flex flex-col items-center gap-5">
      <p className="text-center text-3xl font-extrabold">{prompt}</p>
      <AudioControls text={content.speech ?? step.promptSpeech ?? name} speak={speak} />
      {glyph?.formationTip && mode !== "write" ? (
        <p className="text-muted text-center text-xl">{glyph.formationTip}</p>
      ) : null}

      <div className="flex flex-wrap items-center justify-center gap-4">
        {mode === "copy" && glyph ? <GlyphModel glyph={glyph} size={120} animate={demo} /> : null}
        <div
          className={cn("bg-surface relative rounded-[2rem] border-4 shadow-sm", border)}
          style={{ width: "min(78vw, 360px)", aspectRatio: "1 / 1" }}
        >
          <svg viewBox="0 0 100 100" className="absolute inset-0 size-full" aria-hidden>
            <GuideLines glyph={glyph} />
            {glyph && mode === "trace" ? (
              <GlyphStrokes glyph={glyph} variant="trace" showStart={content.showStart} animate={demo} />
            ) : null}
            {/* After a wrong last try, the letter is shown so the child can see how it goes. */}
            {glyph && mode !== "trace" && phase === "reveal" ? (
              <GlyphStrokes glyph={glyph} variant="trace" showStart />
            ) : null}
          </svg>
          <canvas
            ref={inkRef}
            width={INK_SIZE}
            height={INK_SIZE}
            data-testid="tracing-canvas"
            role="img"
            aria-label={`Writing area for ${name}. ${strokes.length} ${strokes.length === 1 ? "line" : "lines"} drawn.`}
            className={cn(
              "absolute inset-0 size-full touch-none select-none",
              locked ? "cursor-default" : "cursor-crosshair",
            )}
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            onPointerLeave={(e) => {
              if (current.current && e.buttons === 0) end();
            }}
          />
        </div>
      </div>

      {!locked && typing ? (
        <form
          className="flex flex-wrap items-center justify-center gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (typed.trim()) onAnswer({ strokes: [], typed: typed.trim() });
          }}
        >
          <label htmlFor={`type-${step.questionId}`} className="text-xl font-bold">
            Type {mode === "write" ? "the letter" : name}
          </label>
          <input
            id={`type-${step.questionId}`}
            value={typed}
            onChange={(e) => setTyped(e.target.value.slice(0, 2))}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="none"
            spellCheck={false}
            className="bg-surface border-primary/40 size-20 rounded-3xl border-4 text-center text-5xl font-extrabold"
          />
          <Button type="submit" variant="success" size="lg" disabled={!typed.trim()}>
            <span aria-hidden>✓</span> Check
          </Button>
        </form>
      ) : null}

      {!locked ? (
        <div className="flex flex-wrap justify-center gap-3">
          {glyph && mode !== "write" ? (
            <Button variant="secondary" size="lg" onClick={watch}>
              <span aria-hidden>👀</span> Show me
            </Button>
          ) : null}
          <Button variant="secondary" size="lg" onClick={undo} disabled={strokes.length === 0}>
            <span aria-hidden>↩</span> Undo
          </Button>
          <Button variant="secondary" size="lg" onClick={clear} disabled={strokes.length === 0}>
            <span aria-hidden>↺</span> Clear
          </Button>
          <Button
            variant="success"
            size="lg"
            onClick={() => onAnswer({ strokes })}
            disabled={strokes.length === 0}
          >
            <span aria-hidden>✓</span> Done
          </Button>
          <Button variant="secondary" size="lg" onClick={() => setTyping((t) => !t)} aria-pressed={typing}>
            <span aria-hidden>⌨️</span> Type it
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function drawStroke(ctx: CanvasRenderingContext2D, points: number[][]) {
  const k = INK_SIZE / 100;
  ctx.strokeStyle = "#16a34a";
  ctx.lineWidth = 22;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(points[0][0] * k, points[0][1] * k);
  if (points.length === 1) ctx.lineTo(points[0][0] * k + 0.1, points[0][1] * k + 0.1);
  for (const [x, y] of points.slice(1)) ctx.lineTo(x * k, y * k);
  ctx.stroke();
}
