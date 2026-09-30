"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { AudioControls } from "@/components/child/audio-controls";
import { Button } from "@/components/ui/button";
import { sampleAlpha, traceCoverage } from "@/lib/learning/tracing";
import { cn } from "@/lib/utils";
import type { QuestionOf, RendererProps } from "../types";

const SIZE = 320;
const CELL = 8;
const STROKE = 26;

// Trace a letter with a finger (or mouse/pen). The letter is drawn faintly on one canvas;
// the child's strokes go on another; "Done" scores how much of the letter was covered
// (src/lib/learning/tracing.ts) and reports only that number.
export function TracingRenderer({ step, phase, onAnswer, speak }: RendererProps<QuestionOf<"TRACING">>) {
  const { content } = step.question;
  const guideRef = useRef<HTMLCanvasElement>(null);
  const inkRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const locked = phase !== "answering";
  const showModel = step.activityConfig.showModel !== false;

  useEffect(() => {
    const ctx = guideRef.current?.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.fillStyle = showModel ? "rgba(99, 102, 241, 0.25)" : "rgba(99, 102, 241, 0.12)";
    ctx.font = `bold ${Math.round(SIZE * 0.8)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(content.letter, SIZE / 2, SIZE / 2 + SIZE * 0.04);
  }, [content.letter, showModel]);

  function point(e: PointerEvent<HTMLCanvasElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * SIZE) / rect.width,
      y: ((e.clientY - rect.top) * SIZE) / rect.height,
    };
  }
  function start(e: PointerEvent<HTMLCanvasElement>) {
    if (locked) return;
    const ctx = inkRef.current?.getContext("2d");
    if (!ctx) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const p = point(e);
    ctx.strokeStyle = "#16a34a";
    ctx.lineWidth = STROKE;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 0.1, p.y + 0.1);
    ctx.stroke();
    setHasInk(true);
  }
  function move(e: PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const ctx = inkRef.current?.getContext("2d");
    if (!ctx) return;
    const p = point(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
  function end() {
    drawing.current = false;
  }
  function clear() {
    inkRef.current?.getContext("2d")?.clearRect(0, 0, SIZE, SIZE);
    setHasInk(false);
  }
  function done() {
    const guide = guideRef.current?.getContext("2d")?.getImageData(0, 0, SIZE, SIZE);
    const ink = inkRef.current?.getContext("2d")?.getImageData(0, 0, SIZE, SIZE);
    if (!guide || !ink) return;
    const g = sampleAlpha(guide.data, SIZE, SIZE, CELL);
    const i = sampleAlpha(ink.data, SIZE, SIZE, CELL);
    onAnswer({ coverage: traceCoverage(g.grid, i.grid, g.cols) });
  }

  return (
    <div className="flex flex-col items-center gap-6">
      <p className="text-3xl font-extrabold">{step.prompt || `Trace the letter ${content.letter}`}</p>
      <AudioControls text={content.speech ?? step.promptSpeech ?? content.letter} speak={speak} />
      <div
        className={cn(
          "bg-surface relative rounded-[2rem] border-4 shadow-sm",
          phase === "correct"
            ? "border-success"
            : phase === "retry" || phase === "reveal"
              ? "border-danger"
              : "border-primary/40",
        )}
        style={{ width: "min(80vw, 320px)", aspectRatio: "1 / 1" }}
      >
        <canvas
          ref={guideRef}
          width={SIZE}
          height={SIZE}
          className="absolute inset-0 size-full"
          aria-hidden
        />
        <canvas
          ref={inkRef}
          width={SIZE}
          height={SIZE}
          data-testid="tracing-canvas"
          role="img"
          aria-label={`Tracing area for the letter ${content.letter}`}
          className="absolute inset-0 size-full touch-none"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        />
      </div>
      {!locked ? (
        <div className="flex gap-3">
          <Button variant="secondary" size="lg" onClick={clear} disabled={!hasInk}>
            <span aria-hidden>↺</span> Clear
          </Button>
          <Button variant="success" size="lg" onClick={done} disabled={!hasInk}>
            <span aria-hidden>✓</span> Done
          </Button>
        </div>
      ) : null}
    </div>
  );
}
