"use client";

import { useState, type DragEvent } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Shared by word building and sentence building. Children tap a tile to move it into the
// answer row and tap it again to send it back; with a mouse, tiles can also be dragged
// into the row or onto another answer tile to reorder. Tap is the primary interaction
// because native drag-and-drop does not work on touch screens.
export function TileBoard({
  tiles,
  slots,
  locked,
  highlightState,
  checkLabel = "Check",
  onCheck,
  size = "word",
}: {
  tiles: string[];
  slots: number;
  locked: boolean;
  highlightState: "none" | "right" | "wrong";
  checkLabel?: string;
  onCheck: (sequence: string[]) => void;
  size?: "word" | "sentence";
}) {
  const [placed, setPlaced] = useState<number[]>([]);
  const available = tiles.map((tile, index) => ({ tile, index })).filter((t) => !placed.includes(t.index));
  const full = placed.length === slots;

  function place(index: number) {
    if (locked || placed.includes(index) || full) return;
    setPlaced((p) => [...p, index]);
  }
  function remove(position: number) {
    if (locked) return;
    setPlaced((p) => p.filter((_, i) => i !== position));
  }
  function onDropOnRow(e: DragEvent) {
    e.preventDefault();
    const data = e.dataTransfer.getData("text/plain");
    if (data.startsWith("tile:")) place(Number(data.slice(5)));
  }
  function onDropOnPlaced(e: DragEvent, target: number) {
    e.preventDefault();
    e.stopPropagation();
    const data = e.dataTransfer.getData("text/plain");
    if (data.startsWith("placed:")) {
      const from = Number(data.slice(7));
      setPlaced((p) => {
        const next = [...p];
        const [moved] = next.splice(from, 1);
        next.splice(target, 0, moved);
        return next;
      });
    } else if (data.startsWith("tile:") && !full) {
      const index = Number(data.slice(5));
      if (!placed.includes(index)) setPlaced((p) => [...p.slice(0, target), index, ...p.slice(target)]);
    }
  }

  const tileClass = size === "word" ? "min-h-20 min-w-20 px-4 text-5xl" : "min-h-16 px-5 text-3xl";

  return (
    <div className="flex w-full flex-col items-center gap-6">
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDropOnRow}
        aria-label="Your answer"
        role="list"
        className={cn(
          "flex min-h-28 w-full flex-wrap items-center justify-center gap-3 rounded-3xl border-4 border-dashed p-4",
          highlightState === "right"
            ? "border-success bg-success-soft"
            : highlightState === "wrong"
              ? "animate-wiggle border-danger bg-danger-soft"
              : "border-primary/40 bg-surface",
        )}
      >
        {Array.from({ length: slots }, (_, position) => {
          const index = placed[position];
          if (index === undefined) {
            return (
              <span
                key={`empty-${position}`}
                role="listitem"
                aria-label="empty"
                className={cn("bg-surface-muted rounded-2xl", size === "word" ? "size-20" : "h-16 w-20")}
              />
            );
          }
          return (
            <button
              key={`placed-${position}`}
              role="listitem"
              type="button"
              draggable={!locked}
              onDragStart={(e) => e.dataTransfer.setData("text/plain", `placed:${position}`)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => onDropOnPlaced(e, position)}
              onClick={() => remove(position)}
              disabled={locked}
              aria-label={`${tiles[index]}, tap to remove`}
              className={cn("bg-primary rounded-2xl font-extrabold text-white shadow", tileClass)}
            >
              {tiles[index]}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap justify-center gap-3" role="group" aria-label="Tiles">
        {available.map(({ tile, index }) => (
          <button
            key={index}
            type="button"
            draggable={!locked}
            onDragStart={(e) => e.dataTransfer.setData("text/plain", `tile:${index}`)}
            onClick={() => place(index)}
            disabled={locked || full}
            className={cn(
              "border-border bg-surface rounded-2xl border-4 font-extrabold shadow-sm transition enabled:active:scale-95 disabled:opacity-50",
              tileClass,
            )}
          >
            {tile}
          </button>
        ))}
      </div>

      {!locked ? (
        <div className="flex gap-3">
          <Button variant="secondary" size="lg" onClick={() => setPlaced([])} disabled={placed.length === 0}>
            <span aria-hidden>↺</span> Clear
          </Button>
          <Button
            variant="success"
            size="lg"
            onClick={() => onCheck(placed.map((i) => tiles[i]))}
            disabled={!full}
          >
            <span aria-hidden>✓</span> {checkLabel}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
