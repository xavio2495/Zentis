import type { PriceSample } from "@zentis/strategy-sdk";

/**
 * A line chart drawn in box-drawing characters, by hand.
 *
 * No charting library: one would be a dependency the binary carries for a picture it can draw in a
 * page. The first version used braille for its four sub-rows per cell, and in the fonts people
 * actually run terminals in braille renders as scattered dots with gaps between them — a line that
 * reads as noise. `─ │ ╭ ╮ ╰ ╯` join cell to cell in any monospace font, so the line is a line.
 *
 * It is drawn as steps, not slopes, because that is what a pool's price is: it holds between swaps
 * and jumps at each one. A diagonal between two swaps would draw prices nobody could have traded.
 *
 * Three series share one axis by being **normalised to their own first sample**, so what the chart
 * compares is how far each leg's reference pool has moved, not what its mid happens to be — three
 * mids that differ by orders of magnitude would otherwise put two lines flat against the frame.
 */


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
  /** the prices at the bottom and top of the band, so the axis is labelled in prices, not ratios */
  readonly lowMid: bigint;
  readonly highMid: bigint;
  readonly from: bigint | null;
  readonly to: bigint | null;
}

const EMPTY_ROW = (width: number) => " ".repeat(width);

/** A mid scaled by a ratio, kept in bigint so an eighteen-decimal price does not lose its digits. */
const scaleMid = (mid: bigint, ratio: number): bigint =>
  (mid * BigInt(Math.round(ratio * 1e12))) / 1_000_000_000_000n;

/**
 * Samples come newest-first from the subgraph. Normalising against the *oldest* in the window is
 * what makes the line read left to right as time moving forwards.
 */
function normalise(
  samples: PriceSample[],
  windowSeconds: bigint,
): { points: { t: bigint; ratio: number; mid: bigint }[]; baseMid: bigint } {
  if (samples.length === 0) return { points: [], baseMid: 0n };
  const newest = samples[0]!.timestamp;
  const start = newest - windowSeconds;
  const inWindow = samples.filter((s) => s.timestamp >= start).slice().reverse();
  // The price a pool was holding when the window opened is the last swap *before* it, carried to the
  // window's left edge. A pool's price is a step function, so dropping that sample left a quiet
  // pool's one-hour window as a single point at "now".
  const before = samples.find((s) => s.timestamp < start);
  const series = before === undefined ? inWindow : [{ timestamp: start, mid: before.mid }, ...inWindow];
  const base = series[0];
  if (base === undefined || base.mid === 0n) return { points: [], baseMid: 0n };
  return {
    points: series.map((s) => ({ t: s.timestamp, ratio: Number(s.mid) / Number(base.mid), mid: s.mid })),
    baseMid: base.mid,
  };
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
  const normalised = new Map(series.map((s) => [s.key, normalise(s.samples, windowSeconds)]));
  const points = new Map([...normalised].map(([key, n]) => [key, n.points]));
  const all = [...points.values()].flat();
  const byKey = new Map<string, Plot>();

  if (width <= 0 || height <= 0 || all.length === 0) {
    for (const s of series) {
      byKey.set(s.key, {
        rows: Array.from({ length: Math.max(0, height) }, () => EMPTY_ROW(Math.max(0, width))),
        minRatio: 1,
        maxRatio: 1,
        clipped: 0,
        lowMid: 0n,
        highMid: 0n,
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

  for (const s of series) {
    const pts = points.get(s.key) ?? [];

    // One value per column: the last price seen in that column, carried forward across columns with
    // no swap in them. Carrying forward is the step function the pool actually is.
    const column = new Array<number | null>(width).fill(null);
    for (const p of pts) {
      const x = Math.min(width - 1, Number(((p.t - from) * BigInt(Math.max(1, width - 1))) / span));
      // Clamped, not dropped: a point beyond the band still says "this leg went off the top".
      const scaled =
        ((Math.log(Math.max(p.ratio, Number.MIN_VALUE)) - logLo) / logSpan) * (height - 1);
      column[x] = Math.round(Math.max(0, Math.min(height - 1, scaled)));
    }
    let carried: number | null = null;
    for (let x = 0; x < width; x += 1) {
      if (column[x] === null) column[x] = carried;
      else carried = column[x]!;
    }

    // Rows are counted from the bottom here and flipped when written, so "up" means up.
    const grid = Array.from({ length: height }, () => new Array<string>(width).fill(" "));
    const put = (x: number, level: number, glyph: string) => {
      const row = height - 1 - level;
      if (row >= 0 && row < height && x >= 0 && x < width) grid[row]![x] = glyph;
    };

    let previous: number | null = null;
    for (let x = 0; x < width; x += 1) {
      const level = column[x];
      if (level === null || level === undefined) continue;
      if (previous === null || level === previous) {
        put(x, level, "─");
      } else if (level > previous) {
        put(x, previous, "╯");
        for (let between = previous + 1; between < level; between += 1) put(x, between, "│");
        put(x, level, "╭");
      } else {
        put(x, previous, "╮");
        for (let between = level + 1; between < previous; between += 1) put(x, between, "│");
        put(x, level, "╰");
      }
      previous = level;
    }

    byKey.set(s.key, {
      rows: grid.map((row) => row.join("")),
      minRatio: lo,
      maxRatio: hi,
      clipped: pts.filter((p) => p.ratio < lo || p.ratio > hi).length,
      // The band's ends back in the series' own units: its base price scaled by the ratio at each end.
      lowMid: scaleMid(normalised.get(s.key)!.baseMid, lo),
      highMid: scaleMid(normalised.get(s.key)!.baseMid, hi),
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
