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

test("the band edges are the extremes of the scale, so a clamp touches the frame", () => {
  const plot = plotShift(rounds([-500, 0, 500]), { width: 100, height: 50, edgeBps: 500 });
  expect(plot.edge.top).toBeCloseTo(0, 5);
  expect(plot.edge.bottom).toBeCloseTo(50, 5);
  expect(plot.points[0]!.y).toBeCloseTo(50, 5);
  expect(plot.points[2]!.y).toBeCloseTo(0, 5);
});

test("a shift inside the band stays inside the frame, in proportion", () => {
  const plot = plotShift(rounds([250]), { width: 100, height: 50, edgeBps: 500 });
  // Half the cap, so a quarter of the height above the middle.
  expect(plot.points[0]!.y).toBeCloseTo(12.5, 5);
});

test("the scale widens past the cap rather than clipping a shift that exceeded it", () => {
  // The cap is the band the workflow configured; a published shift can still arrive outside it, and
  // a chart that clipped it would hide the one round worth looking at.
  const plot = plotShift(rounds([-1000]), { width: 100, height: 50, edgeBps: 500 });
  expect(plot.points[0]!.y).toBeCloseTo(50, 5);
  expect(plot.edge.bottom).toBeCloseTo(37.5, 5);
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
