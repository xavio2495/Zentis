import type { Round } from "./replay";

/**
 * Where the shift chart's line goes, apart from the pixels that draw it.
 *
 * The quantity this route exists to show is signed and crosses zero, so it cannot use the log scale
 * a price does: zero is the middle of this chart, not its floor. The band edges are drawn with the
 * line because a shift of −251 means nothing without the cap it is measured against — and the scale
 * widens past that cap rather than clipping, because a published shift outside the band is the one
 * round worth looking at.
 *
 * Pure, and tested without a browser. A chart that is wrong by a factor is wrong in a way that
 * looks entirely fine.
 */
export interface Point {
  readonly x: number;
  readonly y: number;
  readonly round: Round;
}

export interface Plot {
  /** an SVG polyline `points` string, empty when there is nothing to draw */
  readonly line: string;
  readonly points: Point[];
  readonly zeroY: number;
  /** where the leg's own cap sits, in the same coordinates */
  readonly edge: { top: number; bottom: number };
  /** the widest shift the scale covers, in basis points either side of zero */
  readonly domainBps: number;
  /** whether the leg's cap falls inside the frame; when it does not, the panel says so instead */
  readonly edgeVisible: boolean;
}

/** The x of a moment in the series' own window, pinned to the frame at either end. */
export function xOfTime(rounds: readonly Round[], atSeconds: number, width: number): number {
  if (rounds.length === 0) return 0;
  const first = rounds[0]!.atSeconds;
  const last = rounds[rounds.length - 1]!.atSeconds;
  if (last <= first) return width;
  const t = (atSeconds - first) / (last - first);
  return Math.max(0, Math.min(1, t)) * width;
}

export function plotShift(
  rounds: readonly Round[],
  { width, height, edgeBps }: { width: number; height: number; edgeBps: number },
): Plot {
  // Symmetric about zero and scaled to the shift, not to the cap. These legs are capped at ±5,000
  // basis points and quote in the low hundreds: scaling to the cap drew a flat line through the
  // middle of an empty box, which is a chart that says nothing about the quantity it exists for.
  // The cap is drawn when it falls inside the frame and stated in the panel's header when it does
  // not — and a shift that went past it widens the scale rather than being clipped.
  const deepest = Math.max(0, ...rounds.map((round) => Math.abs(round.tiltBps)));
  const domainBps = deepest === 0 ? Math.max(1, Math.min(edgeBps, 100)) : deepest * 1.15;
  const yOf = (bps: number) => height / 2 - (bps / domainBps) * (height / 2);

  const points = rounds.map((round) => ({
    x: xOfTime(rounds, round.atSeconds, width),
    y: yOf(round.tiltBps),
    round,
  }));

  return {
    line: points.map((point) => `${point.x},${point.y}`).join(" "),
    points,
    zeroY: yOf(0),
    edge: { top: yOf(edgeBps), bottom: yOf(-edgeBps) },
    domainBps,
    edgeVisible: edgeBps <= domainBps,
  };
}
