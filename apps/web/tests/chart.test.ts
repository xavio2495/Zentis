import { expect, test } from "bun:test";
import { plotShift, xOfTime } from "../src/lib/chart";
import type { Round } from "../src/lib/replay";

/**
 * The shift chart's geometry, apart from the pixels that draw it.
 *
 * The line the console route exists to show is a signed one that crosses zero, so it cannot be
 * plotted on the log scale a price uses: zero is the middle of this chart, not its floor. The band
 * edges are drawn with it, because a shift of −251 means nothing without the cap it is measured
 * against.
 *
 * Kept pure so the arithmetic can be checked without a browser. A chart that is wrong by a factor
 * is wrong in a way that looks fine.
 */
const at = 1_789_000_000;
const rounds = (tilts: number[]): Round[] =>
  tilts.map((tiltBps, i) => ({ seq: i + 1, atSeconds: at + i * 60, tiltBps, mid: "1" }));

test("zero is the middle, because the line it draws is signed", () => {
  const plot = plotShift(rounds([0, 0, 0]), { width: 100, height: 50, edgeBps: 500 });
  expect(plot.zeroY).toBeCloseTo(25, 5);
  // A flat line at zero sits on it rather than on the floor.
  for (const point of plot.points) expect(point.y).toBeCloseTo(25, 5);
});

test("a clamped shift sits on the cap line, which is what says it is clamped", () => {
  const plot = plotShift(rounds([-500, 0, 500]), { width: 100, height: 50, edgeBps: 500 });
  expect(plot.edgeVisible).toBe(true);
  expect(plot.points[0]!.y).toBeCloseTo(plot.edge.bottom, 5);
  expect(plot.points[2]!.y).toBeCloseTo(plot.edge.top, 5);
  // With a little air above it, so the line is not drawn along the frame itself.
  expect(plot.edge.top).toBeGreaterThan(0);
  expect(plot.edge.bottom).toBeLessThan(50);
});

test("the scale follows the shift, not the cap, or the line it is drawing is invisible", () => {
  // These legs are capped at ±5,000 bps and quote in the low hundreds. Scaling to the cap drew a
  // flat line through the middle of an empty box: the chart said nothing about the one quantity it
  // exists to show. The cap is still stated — it is off this scale, and the panel says so.
  const plot = plotShift(rounds([-200, -250, -229]), { width: 100, height: 50, edgeBps: 5_000 });
  expect(plot.edgeVisible).toBe(false);
  expect(plot.domainBps).toBeLessThan(500);
  // The deepest shift is near the floor of the frame rather than a hair off its middle.
  expect(plot.points[1]!.y).toBeGreaterThan(40);
});

test("the scale widens past the cap rather than clipping a shift that exceeded it", () => {
  // A published shift outside the band is the one round worth looking at, so it is never clipped.
  const plot = plotShift(rounds([-1000]), { width: 100, height: 50, edgeBps: 500 });
  expect(plot.edgeVisible).toBe(true);
  // Past the cap line, and still inside the frame.
  expect(plot.points[0]!.y).toBeGreaterThan(plot.edge.bottom);
  expect(plot.points[0]!.y).toBeLessThanOrEqual(50);
});

test("time runs left to right, so a fill lands where its own timestamp is", () => {
  const series = rounds([0, 0, 0, 0, 0]);
  expect(xOfTime(series, at, 100)).toBeCloseTo(0, 5);
  expect(xOfTime(series, at + 240, 100)).toBeCloseTo(100, 5);
  expect(xOfTime(series, at + 120, 100)).toBeCloseTo(50, 5);
  // Outside the window is pinned to its edge rather than drawn off-screen.
  expect(xOfTime(series, at - 600, 100)).toBeCloseTo(0, 5);
  expect(xOfTime(series, at + 6_000, 100)).toBeCloseTo(100, 5);
});

test("an empty series draws nothing rather than a line through NaN", () => {
  const plot = plotShift([], { width: 100, height: 50, edgeBps: 500 });
  expect(plot.points).toEqual([]);
  expect(plot.line).toBe("");
  expect(Number.isFinite(plot.zeroY)).toBe(true);
});
