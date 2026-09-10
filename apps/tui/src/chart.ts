import type { PriceSample } from "@zentis/strategy-sdk";

/**
 * A line chart drawn in braille cells, by hand.
 *
 * No charting library: one would be a dependency the binary carries for a picture it can draw in
 * sixty lines. Braille gives four vertical sub-rows per terminal row, which is the difference
 * between a line and a staircase at the eight or ten rows this region gets.
 *
 * Three series share one axis by being **normalised to their own first sample**, so what the chart
 * compares is how far each leg's reference pool has moved, not what its mid happens to be — three
 * mids that differ by orders of magnitude would otherwise put two lines flat against the frame.
 */

/** Braille dot bits, by (column 0-1, row 0-3), as the Unicode block orders them. */
const DOTS = [
  [0x01, 0x02, 0x04, 0x40],
  [0x08, 0x10, 0x20, 0x80],
];
const BRAILLE_BASE = 0x2800;

export interface Series {
  readonly key: string;
  readonly samples: PriceSample[];
}

export interface Plot {
  /** one string per terminal row, top first; every row is exactly `width` cells */
  readonly rows: string[];
  /** the band actually drawn, as a multiple of each series' own first sample */
  readonly minRatio: number;
  readonly maxRatio: number;
  /** how many of this series' points fell outside that band and were drawn on its edge */
  readonly clipped: number;
  readonly from: bigint | null;
  readonly to: bigint | null;
}

const EMPTY_ROW = (width: number) => " ".repeat(width);

/**
 * Samples come newest-first from the subgraph. Normalising against the *oldest* in the window is
 * what makes the line read left to right as time moving forwards.
 */
function normalise(samples: PriceSample[], windowSeconds: bigint): { t: bigint; ratio: number }[] {
  if (samples.length === 0) return [];
  const newest = samples[0]!.timestamp;
  const inWindow = samples.filter((s) => newest - s.timestamp <= windowSeconds).slice().reverse();
  const base = inWindow[0];
  if (base === undefined || base.mid === 0n) return [];
  return inWindow.map((s) => ({ t: s.timestamp, ratio: Number(s.mid) / Number(base.mid) }));
}

/**
 * Plots one series per call, each returning its own rows, so the caller can colour a whole line in
 * its leg's colour. Overlaying them into one grid would mean one colour for three lines, and the
 * chart's entire job is showing that one leg moved and the others did not.
 */
export function plot(
  series: Series[],
  width: number,
  height: number,
  windowSeconds: bigint,
): { byKey: Map<string, Plot>; from: bigint | null; to: bigint | null } {
  const points = new Map(series.map((s) => [s.key, normalise(s.samples, windowSeconds)]));
  const all = [...points.values()].flat();
  const byKey = new Map<string, Plot>();

  if (width <= 0 || height <= 0 || all.length === 0) {
    for (const s of series) {
      byKey.set(s.key, {
        rows: Array.from({ length: Math.max(0, height) }, () => EMPTY_ROW(Math.max(0, width))),
        minRatio: 1,
        maxRatio: 1,
        clipped: 0,
        from: null,
        to: null,
      });
    }
    return { byKey, from: null, to: null };
  }

  // One shared vertical scale across every series, or the lines could not be compared — and that
  // scale is logarithmic. A testnet reference pool really does step from ×1.045 to ×0.049 in a
  // single swap, and on a linear axis that one outlier owns the entire range while the other two
  // legs draw as flat lines along the frame. Ratios belong in log space for the same reason returns
  // always do: it is proportional moves that are being compared.
  //
  // Log space is necessary but not sufficient: against a 20x outlier a 10% move is still 3% of the
  // height. So the band is taken from the bulk of the points rather than their extremes, and a point
  // outside it is drawn on the edge row it exceeded rather than dropped. The excursion stays visible
  // and stays labelled; what it no longer does is flatten the two legs that behaved.
  const ratios = all
    .map((p) => p.ratio)
    .filter((r) => r > 0)
    .sort((a, b) => a - b);
  const at = (q: number) => ratios[Math.min(ratios.length - 1, Math.floor(q * (ratios.length - 1)))]!;
  const full = { lo: ratios[0]!, hi: ratios[ratios.length - 1]! };
  // Band only when the range is genuinely extreme. Banding unconditionally clips a tenth of the
  // points by construction, so every graph would carry an "(N beyond)" note that means nothing —
  // and a warning that is always on is not a warning.
  const extreme = full.hi / full.lo > 4;
  let lo = extreme ? at(0.05) : full.lo;
  let hi = extreme ? at(0.95) : full.hi;
  if (hi / lo < 1.000001) {
    lo *= 0.9995;
    hi *= 1.0005;
  }
  const logLo = Math.log(lo);
  const logSpan = Math.log(hi) - logLo;
  const times = all.map((p) => p.t);
  const from = times.reduce((a, b) => (a < b ? a : b));
  const to = times.reduce((a, b) => (a > b ? a : b));
  const span = to - from === 0n ? 1n : to - from;

  const subRows = height * 4;
  const subCols = width * 2;

  for (const s of series) {
    const pts = points.get(s.key) ?? [];
    const grid = Array.from({ length: height }, () => new Array<number>(width).fill(0));

    // Column-major: each sub-column takes the mean of the samples that land in it, and consecutive
    // sub-columns are joined vertically so the line is continuous rather than a scatter.
    const column = new Array<number | null>(subCols).fill(null);
    for (const p of pts) {
      const x = Math.min(subCols - 1, Number(((p.t - from) * BigInt(subCols - 1)) / span));
      // Clamped, not dropped: a point beyond the band still says "this leg went off the top".
      const scaled =
        ((Math.log(Math.max(p.ratio, Number.MIN_VALUE)) - logLo) / logSpan) * (subRows - 1);
      const y = Math.round(Math.max(0, Math.min(subRows - 1, scaled)));
      column[x] = column[x] === null ? y : Math.round((column[x]! + y) / 2);
    }
    let previous: number | null = null;
    for (let x = 0; x < subCols; x += 1) {
      const y = column[x];
      if (y === null || y === undefined) continue;
      const start = previous === null ? y : previous;
      const [top, bottom] = start <= y ? [start, y] : [y, start];
      for (let fill = top; fill <= bottom; fill += 1) {
        const row = height - 1 - Math.floor(fill / 4);
        const cell = Math.floor(x / 2);
        if (row < 0 || row >= height || cell < 0 || cell >= width) continue;
        grid[row]![cell]! |= DOTS[x % 2]![fill % 4]!;
      }
      previous = y;
    }

    byKey.set(s.key, {
      rows: grid.map((row) =>
        row.map((bits) => (bits === 0 ? " " : String.fromCharCode(BRAILLE_BASE + bits))).join(""),
      ),
      minRatio: lo,
      maxRatio: hi,
      clipped: pts.filter((p) => p.ratio < lo || p.ratio > hi).length,
      from,
      to,
    });
  }

  return { byKey, from, to };
}

/**
 * Marks on the time axis, one row, in the same coordinate space as the plot.
 *
 * The publishes and the fill are what make the demo's beat legible — a fill, then a reference, then
 * the other legs' lines not moving — so they are drawn against the same clock as the lines rather
 * than listed beside them.
 */
export function axisMarks(
  events: { at: bigint; glyph: string }[],
  from: bigint | null,
  to: bigint | null,
  width: number,
): string {
  if (from === null || to === null || width <= 0) return " ".repeat(Math.max(0, width));
  const span = to - from === 0n ? 1n : to - from;
  const row = new Array<string>(width).fill(" ");
  for (const event of events) {
    if (event.at < from || event.at > to) continue;
    const x = Math.min(width - 1, Number(((event.at - from) * BigInt(width - 1)) / span));
    row[x] = event.glyph;
  }
  return row.join("");
}
