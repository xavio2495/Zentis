import type { Snapshot } from "@zentis/console-data";

/**
 * A leg's own line: the shift it was published at, over time.
 *
 * The cards used to draw their leg's venue price. Two of those venues have been retired and the one
 * that remains is a testnet pool an order of magnitude from the market, so a price line on a card is
 * either impossible or misleading. The shift is neither: every publish sets one per leg, they differ
 * between legs, and it is the number the rest of the card is about.
 *
 * It is signed, which is why this does not use the price chart's plot. That one works in log space —
 * the right scale for comparing proportional moves in a price — and a leg at −349 bps has no
 * logarithm. Here the scale is linear and the line crosses zero.
 */
export interface ShiftPoint {
  readonly timestamp: bigint;
  readonly bps: number;
}

export function shiftSeries(snapshot: Snapshot, chainId: number): ShiftPoint[] {
  return snapshot.feed
    .flatMap((row) =>
      row.kind === "round"
        ? row.legs
            .filter((leg) => leg.chainId === chainId)
            .map((leg) => ({ timestamp: row.timestamp, bps: leg.tiltBps }))
        : [],
    )
    // The feed is newest first, and a line reads left to right as time moving forwards.
    .sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
}

export interface SignedPlot {
  readonly rows: string[];
  readonly low: number;
  readonly high: number;
}

/**
 * The same stepped box-drawing line the price chart uses, on a linear scale that can cross zero.
 *
 * Stepped rather than sloped for the same reason as the price: a shift holds between publishes and
 * jumps at each one, and a diagonal would draw shifts nobody ever quoted at.
 */
export function plotSigned(points: readonly ShiftPoint[], width: number, height: number): SignedPlot {
  const blank = Array.from({ length: Math.max(0, height) }, () => " ".repeat(Math.max(0, width)));
  if (points.length === 0 || width <= 0 || height <= 0) return { rows: blank, low: 0, high: 0 };

  const values = points.map((p) => p.bps);
  const low = Math.min(...values);
  const high = Math.max(...values);
  // A leg that has not moved is a flat line rather than a division by zero.
  const span = high === low ? 1 : high - low;

  const from = points[0]!.timestamp;
  const to = points[points.length - 1]!.timestamp;
  const clock = to === from ? 1n : to - from;

  const column = new Array<number | null>(width).fill(null);
  for (const point of points) {
    const x = Math.min(width - 1, Number(((point.timestamp - from) * BigInt(Math.max(1, width - 1))) / clock));
    const level = height === 1 ? 0 : Math.round(((point.bps - low) / span) * (height - 1));
    column[x] = Math.max(0, Math.min(height - 1, level));
  }
  // Carried forward across columns with no publish in them, which is what a step function is.
  let carried: number | null = null;
  for (let x = 0; x < width; x += 1) {
    if (column[x] === null) column[x] = carried;
    else carried = column[x]!;
  }

  const grid = Array.from({ length: height }, () => new Array<string>(width).fill(" "));
  const put = (x: number, level: number, glyph: string) => {
    const row = height - 1 - level;
    if (row >= 0 && row < height && x >= 0 && x < width) grid[row]![x] = glyph;
  };

  let previous: number | null = null;
  for (let x = 0; x < width; x += 1) {
    const level = column[x];
    if (level === null || level === undefined) continue;
    if (previous === null || level === previous) put(x, level, "─");
    else if (level > previous) {
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

  return { rows: grid.map((row) => row.join("")), low, high };
}
