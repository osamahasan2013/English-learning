// Scores a tracing attempt: how much of the letter the child's strokes cover, discounted
// when most of the ink lands outside the letter (scribbling over everything is not
// tracing). Works on two same-sized boolean grids sampled from the canvases.

export const TRACE_TOLERANCE_CELLS = 1;
// Below this share of ink on (or next to) the letter, coverage is scaled down.
export const MIN_PRECISION = 0.6;

export function traceCoverage(guide: boolean[], strokes: boolean[], width: number): number {
  const height = Math.floor(guide.length / width);
  const guideCells = guide.filter(Boolean).length;
  const inkCells = strokes.filter(Boolean).length;
  if (guideCells === 0 || inkCells === 0) return 0;

  const near = (grid: boolean[], x: number, y: number) => {
    for (let dy = -TRACE_TOLERANCE_CELLS; dy <= TRACE_TOLERANCE_CELLS; dy++) {
      for (let dx = -TRACE_TOLERANCE_CELLS; dx <= TRACE_TOLERANCE_CELLS; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < width && ny < height && grid[ny * width + nx]) return true;
      }
    }
    return false;
  };

  let covered = 0;
  let onLetter = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (guide[i] && near(strokes, x, y)) covered++;
      if (strokes[i] && near(guide, x, y)) onLetter++;
    }
  }
  const coverage = covered / guideCells;
  const precision = onLetter / inkCells;
  const score = precision >= MIN_PRECISION ? coverage : coverage * (precision / MIN_PRECISION);
  return Math.round(score * 100);
}

// Samples a canvas's alpha channel onto a grid of `cell`-pixel squares.
export function sampleAlpha(data: Uint8ClampedArray, width: number, height: number, cell: number) {
  const cols = Math.floor(width / cell);
  const rows = Math.floor(height / cell);
  const grid: boolean[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cell + Math.floor(cell / 2);
      const y = r * cell + Math.floor(cell / 2);
      grid.push(data[(y * width + x) * 4 + 3] > 40);
    }
  }
  return { grid, cols };
}
