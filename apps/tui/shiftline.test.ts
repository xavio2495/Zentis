import { expect, test } from "bun:test";
import { plotSigned, shiftSeries } from "./src/shift-line.js";
import { fakeSnapshot } from "./sandbox/world.js";

/**
 * A leg's own line.
 *
 * The cards cannot draw a price: two of the three venues were retired, and the one that remains
 * quotes a testnet pool an order of magnitude from the market. What every leg does have is the
 * shift it was published at, which is what the card is about and differs between them.
 *
 * The shift is a signed number of basis points, so it needs a plot that can cross zero — the price
 * chart's log scale cannot, and a leg at -349 has no logarithm.
 */
test("a leg's shifts come out of the publishes, oldest first", () => {
  const snapshot = fakeSnapshot("fresh");
  const leg = snapshot.legs[0]!;
  const series = shiftSeries(snapshot, leg.config.chainId);
  expect(series.length).toBeGreaterThan(5);
  for (let i = 1; i < series.length; i += 1) {
    expect(series[i]!.timestamp).toBeGreaterThanOrEqual(series[i - 1]!.timestamp);
  }
  // Every point is that leg's own, and a shift is a whole number of basis points.
  expect(series.every((p) => Number.isInteger(p.bps))).toBe(true);
});

test("a leg the publishes do not mention has no line rather than a flat zero", () => {
  const snapshot = fakeSnapshot("fresh");
  expect(shiftSeries(snapshot, 999_999)).toHaveLength(0);
});

test("the plot crosses zero, which is the whole reason it is not the price chart's", () => {
  const rows = plotSigned(
    [
      { timestamp: 1n, bps: -300 },
      { timestamp: 2n, bps: 0 },
      { timestamp: 3n, bps: 300 },
    ],
    20,
    5,
  );
  expect(rows.rows).toHaveLength(5);
  expect(rows.rows.every((row) => [...row].length === 20)).toBe(true);
  expect(rows.low).toBe(-300);
  expect(rows.high).toBe(300);
  // It rises left to right, so the drawn cells end higher than they start.
  const rowOf = (column: number) => rows.rows.findIndex((row) => [...row][column] !== " ");
  expect(rowOf(19)).toBeLessThan(rowOf(0));
});

test("a leg that has not moved draws a line, not a blank", () => {
  const flat = plotSigned([{ timestamp: 1n, bps: -10 }, { timestamp: 2n, bps: -10 }], 10, 3);
  expect(flat.rows.join("")).toMatch(/[─╭╮╰╯│]/);
  expect(flat.low).toBe(-10);
  expect(flat.high).toBe(-10);
});

test("nothing to draw is empty rows of the right shape, never a crash", () => {
  const none = plotSigned([], 8, 2);
  expect(none.rows).toEqual(["        ", "        "]);
});
