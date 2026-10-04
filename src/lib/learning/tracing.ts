import { z } from "zod";

// Handwriting: tracing a letter (or a pre-writing shape) and writing one from a model or
// from memory, judged against the glyph's reference strokes (handwriting_glyphs). Pure, so
// the device (instant feedback) and the server (the stored verdict) run the same code on
// the same data: the glyph is public, and the child's strokes travel in the answer.
//
// Coordinates are in a 0–100 box. A reference stroke is an ordered list of points: its
// first point is where the stroke starts, the point order is its direction. A child's
// stroke is the path of one touch, mouse drag or pen line.
//
// Nothing here is handwriting recognition. The trace is "complete" when enough of every
// reference stroke has ink near it (within the tolerance) and most of the ink is near the
// letter; stroke order, direction and the starting point are measured and reported, and
// only count against the child where the level asks for them (rules.writing).

export type Point = [number, number];
export type GlyphStroke = { points: Point[] };

const coordinate = z.number().min(0).max(100);
export const glyphStrokeSchema = z.object({
  points: z
    .array(z.tuple([coordinate, coordinate]))
    .min(2)
    .max(64),
});
export const glyphStrokesSchema = z.array(glyphStrokeSchema).min(1).max(8);

export const glyphGuideSchema = z
  .object({
    // Horizontal guide lines in box units: top (ascender), midline (x-height), baseline.
    top: coordinate.optional(),
    midline: coordinate.optional(),
    baseline: coordinate.optional(),
    // Where the reference shapes come from (font name, hand-drawn).
    reference: z.string().trim().max(80).optional(),
  })
  .strict();

// A glyph as the lesson player sees it.
export type TraceGlyph = {
  code: string;
  kind: "letter" | "digit" | "shape";
  character: string;
  letterCase: "upper" | "lower" | "none";
  name: string;
  strokes: GlyphStroke[];
  guide: z.infer<typeof glyphGuideSchema>;
  tolerance: number;
  completion: number;
  formationTip: string;
  formationSpeech: string;
};

// The child's strokes as recorded: integer points in the 0–100 box. The device keeps every
// few pixels of each stroke (simplifyStroke), so an answer stays a few hundred numbers.
export const MAX_TRACE_STROKES = 12;
export const MAX_TRACE_POINTS = 80;
export const traceStrokesSchema = z
  .array(
    z
      .array(z.tuple([z.number().int().min(0).max(100), z.number().int().min(0).max(100)]))
      .min(1)
      .max(MAX_TRACE_POINTS),
  )
  .max(MAX_TRACE_STROKES);

export type TraceSettings = {
  // Distance (box units) within which ink counts as on a stroke.
  tolerance: number;
  // Share of the reference that must be covered.
  completion: number;
  minPrecision: number;
  almostMargin: number;
  // Writing from a model or memory: the child's letter is moved and scaled onto the
  // reference box first, so size and position on the page do not matter.
  align: boolean;
  strokeOrder: "off" | "hint" | "required";
};

export type TraceIssue =
  | "no_ink"
  | "missing_part"
  | "off_the_letter"
  // The ink's weight sits elsewhere than the letter's: a mirrored or flipped letter (b for
  // d, u for n) that overlaps the right one almost everywhere.
  | "wrong_shape"
  | "stroke_order"
  | "direction"
  | "start_point";

export type TraceResult = {
  // 0–1: length-weighted share of the reference covered by ink.
  coverage: number;
  // 0–1: share of the child's ink near the reference.
  precision: number;
  // Per reference stroke: share covered, the child stroke that covers it best, and whether
  // that stroke was drawn backwards.
  strokes: { coverage: number; matched: number | null; reversed: boolean | null }[];
  orderOk: boolean;
  directionOk: boolean;
  startOk: boolean;
  complete: boolean;
  almost: boolean;
  issues: TraceIssue[];
};

// Validation for content: reports problems with a glyph's strokes (used by the importer).
export function glyphStrokeProblems(strokes: unknown): string[] {
  const parsed = glyphStrokesSchema.safeParse(strokes);
  if (!parsed.success) return parsed.error.issues.map((i) => `strokes.${i.path.join(".")} ${i.message}`);
  const problems: string[] = [];
  parsed.data.forEach((stroke, i) => {
    if (pathLength(stroke.points) === 0 && stroke.points.length > 1)
      problems.push(`stroke ${i + 1} has no length (all points are the same)`);
    // A long jump inside a drawn path is a typo in the points (a straight line may be
    // given as just its two ends).
    for (let p = 1; stroke.points.length > 2 && p < stroke.points.length; p++) {
      const [a, b] = [stroke.points[p - 1], stroke.points[p]];
      if (distance(a, b) > 60)
        problems.push(
          `stroke ${i + 1} jumps ${Math.round(distance(a, b))} units between points ${p} and ${p + 1}`,
        );
    }
  });
  return problems;
}

// ---- geometry ----------------------------------------------------------------------------

function distance(a: Point, b: Point) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function pathLength(points: Point[]) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i]);
  return total;
}

// Evenly spaced points along a path (every `step` units, ends included).
export function resample(points: Point[], step: number): Point[] {
  if (points.length < 2) return points.slice();
  const out: Point[] = [points[0]];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    const seg = distance(a, b);
    let t = step - carry;
    while (t <= seg) {
      out.push([a[0] + ((b[0] - a[0]) * t) / seg, a[1] + ((b[1] - a[1]) * t) / seg]);
      t += step;
    }
    carry = (carry + seg) % step;
  }
  const last = points[points.length - 1];
  if (distance(out[out.length - 1], last) > step / 4) out.push(last);
  return out;
}

// Drops points closer than `minGap` to the previous kept point (the device uses this to
// keep answers small), then caps the count.
export function simplifyStroke(points: Point[], minGap = 2, max = MAX_TRACE_POINTS): Point[] {
  if (points.length === 0) return [];
  const kept: Point[] = [points[0]];
  for (const p of points.slice(1)) if (distance(p, kept[kept.length - 1]) >= minGap) kept.push(p);
  if (kept.length === 1 && points.length > 1) kept.push(points[points.length - 1]);
  if (kept.length <= max) return kept.map(([x, y]) => [Math.round(x), Math.round(y)]);
  const stride = (kept.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => kept[Math.round(i * stride)]).map(([x, y]) => [
    Math.round(x),
    Math.round(y),
  ]);
}

function bounds(paths: Point[][]) {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const path of paths)
    for (const [x, y] of path) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

// Moves and uniformly scales the child's strokes onto the reference box (writing without a
// guide underneath: a small letter in a corner is still the letter).
function alignTo(child: Point[][], reference: Point[][]): Point[][] {
  const c = bounds(child);
  const r = bounds(reference);
  // A thin letter (l, a line across) has no width (or height) to scale by.
  const scales = [
    c.w > 4 && r.w > 8 ? r.w / c.w : Infinity,
    c.h > 4 && r.h > 8 ? r.h / c.h : Infinity,
  ].filter(Number.isFinite);
  const scale = scales.length ? Math.min(...scales) : 1;
  const cx = (c.minX + c.maxX) / 2;
  const cy = (c.minY + c.maxY) / 2;
  const rx = (r.minX + r.maxX) / 2;
  const ry = (r.minY + r.maxY) / 2;
  return child.map((path) => path.map(([x, y]) => [rx + (x - cx) * scale, ry + (y - cy) * scale] as Point));
}

// ---- evaluation --------------------------------------------------------------------------

// A point of a path with its direction there (unit vector; null for a single point).
type Directed = { p: Point; t: Point | null };

// Evenly spaced points of a path with the local direction, smoothed over a few points so a
// shaky line still has a clear way.
function directedSamples(path: Point[]): Directed[] {
  if (path.length < 2 || pathLength(path) === 0) return [{ p: path[0], t: null }];
  const pts = resample(path, SAMPLE_STEP);
  if (pts.length < 2) return [{ p: pts[0], t: null }];
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 2)];
    const b = pts[Math.min(pts.length - 1, i + 2)];
    const len = distance(a, b);
    return { p, t: len > 0 ? ([(b[0] - a[0]) / len, (b[1] - a[1]) / len] as Point) : null };
  });
}

// Centre of mass of evenly spaced samples (so length-weighted).
function centroid(samples: Directed[]): Point {
  let [x, y] = [0, 0];
  for (const s of samples) {
    x += s.p[0];
    y += s.p[1];
  }
  return [x / samples.length, y / samples.length];
}

// Ink this close in angle counts as running along the letter (cos 60°): enough for a
// child's wobble, not for a line crossing the stroke.
const COVER_ALIGNMENT = 0.5;
const PRECISION_ALIGNMENT = 0.35;

// Does ink sample q lie along reference sample s? A dot of the letter is covered by any ink
// near it; a tap (no direction) only covers a dot, but counts as ink on the letter.
function follows(s: Directed, q: Directed, within: number, alignment = COVER_ALIGNMENT) {
  if (distance(s.p, q.p) > within) return false;
  if (!s.t) return true;
  if (!q.t) return alignment === PRECISION_ALIGNMENT;
  return Math.abs(s.t[0] * q.t[0] + s.t[1] * q.t[1]) >= alignment;
}

const SAMPLE_STEP = 2;
// A reference stroke shorter than this is a dot (the dot of i, j).
const DOT_LENGTH = 6;
// No reference stroke may be left nearly untouched, whatever the overall coverage.
const MIN_STROKE_SHARE = 0.6;
// The ink's centre of mass may sit at most this share of the tolerance (and at least
// BALANCE_MIN units) from the letter's.
const BALANCE_SHARE = 0.7;
const BALANCE_MIN = 4;

export function evaluateTrace(
  reference: GlyphStroke[],
  drawn: number[][][],
  settings: TraceSettings,
): TraceResult {
  const childRaw = drawn.filter((s) => s.length > 0).map((s) => s.map(([x, y]) => [x, y] as Point));
  const refPaths = reference.map((s) => s.points);
  if (childRaw.length === 0) {
    return {
      coverage: 0,
      precision: 0,
      strokes: refPaths.map(() => ({ coverage: 0, matched: null, reversed: null })),
      orderOk: false,
      directionOk: false,
      startOk: false,
      complete: false,
      almost: false,
      issues: ["no_ink"],
    };
  }
  const child = settings.align ? alignTo(childRaw, refPaths) : childRaw;
  const tol = settings.tolerance;
  const childSamples = child.map(directedSamples);
  const allInk = childSamples.flat();

  let coveredLength = 0;
  let totalLength = 0;
  const refSamples: Directed[][] = [];
  const strokes = refPaths.map((path) => {
    const length = pathLength(path);
    const isDot = length < DOT_LENGTH;
    const samples: Directed[] = isDot ? [{ p: path[0], t: null }] : directedSamples(path);
    refSamples.push(samples);
    const weight = Math.max(length, DOT_LENGTH);
    // A point of the letter is covered by ink near it that runs the same way (either way
    // round): a line across a circle passes near it but does not follow it.
    const share = (ink: Directed[]) =>
      samples.filter((s) => ink.some((q) => follows(s, q, isDot ? tol * 1.2 : tol))).length / samples.length;
    const coverage = share(allInk);
    // The child stroke that alone covers most of this reference stroke.
    const shares = childSamples.map((c) => share(c));
    const best = Math.max(...shares);
    const matched: number | null = best >= 0.3 ? shares.indexOf(best) : null;
    totalLength += weight;
    coveredLength += weight * coverage;
    // Direction: does the matched stroke start nearer the reference start than its end?
    // Closed shapes (o) and dots have no telling direction.
    const closed = distance(path[0], path[path.length - 1]) < tol;
    let reversed: boolean | null = null;
    if (matched !== null && !closed && !isDot) {
      const c = child[matched];
      reversed = distance(c[0], path[path.length - 1]) + 1e-9 < distance(c[0], path[0]);
    }
    return { coverage, matched, reversed } as {
      coverage: number;
      matched: number | null;
      reversed: boolean | null;
    };
  });
  const refAll = refSamples.flat();

  const coverage = totalLength > 0 ? coveredLength / totalLength : 0;
  // Ink on the letter: near it and running along it (a tap counts where it lands).
  const precision =
    allInk.length > 0
      ? allInk.filter((q) => refAll.some((s) => follows(s, q, tol * 1.5, PRECISION_ALIGNMENT))).length /
        allInk.length
      : 0;

  const order = strokes.map((s) => s.matched).filter((m): m is number => m !== null);
  const orderOk = order.every((m, i) => i === 0 || m >= order[i - 1]);
  const directionOk = strokes.every((s) => s.reversed !== true);
  const startOk = distance(child[0][0], refPaths[0][0]) <= tol * 2;

  const everyStroke = strokes.every((s) => s.coverage >= MIN_STROKE_SHARE);
  // Balance is about shape, not position: the ink is moved and scaled onto the letter first.
  const shaped = settings.align ? allInk : alignTo(childRaw, refPaths).flatMap(directedSamples);
  const balanced = distance(centroid(shaped), centroid(refAll)) <= Math.max(BALANCE_MIN, tol * BALANCE_SHARE);
  const formed =
    coverage >= settings.completion && everyStroke && precision >= settings.minPrecision && balanced;
  const orderRequired = settings.strokeOrder === "required";
  const complete = formed && (!orderRequired || (orderOk && directionOk && startOk));
  const almost =
    !complete &&
    coverage >= settings.completion - settings.almostMargin &&
    precision >= settings.minPrecision * 0.8;

  const issues: TraceIssue[] = [];
  if (!everyStroke || coverage < settings.completion) issues.push("missing_part");
  if (precision < settings.minPrecision) issues.push("off_the_letter");
  if (!balanced && !issues.includes("missing_part")) issues.push("wrong_shape");
  if (settings.strokeOrder !== "off") {
    if (!startOk) issues.push("start_point");
    if (!orderOk) issues.push("stroke_order");
    if (!directionOk) issues.push("direction");
  }
  return {
    coverage: round3(coverage),
    precision: round3(precision),
    strokes: strokes.map((s) => ({ ...s, coverage: round3(s.coverage) })),
    orderOk,
    directionOk,
    startOk,
    complete,
    almost,
    issues,
  };
}

function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}
