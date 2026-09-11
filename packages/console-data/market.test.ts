import { expect, test } from "bun:test";
import { parseMarkHistory } from "./src/market.js";

const raw = {
  points: [
    { t: 1789000000, mid: "404858299595141700000000000" },
    { t: 1789003600, mid: "409000000000000000000000000" },
  ],
  source: "Uniswap v3 mainnet USDC/WETH, via The Graph",
  hours: 168,
  error: null,
};

test("the market series arrives oldest first, in the registry's own units", () => {
  const history = parseMarkHistory(raw)!;
  expect(history.points).toHaveLength(2);
  expect(history.points[0]!.timestamp).toBe(1789000000n);
  // A decimal string, not a number: an eighteen-decimal mid does not survive a float.
  expect(history.points[0]!.mid).toBe(404_858_299_595_141_700_000_000_000n);
  expect(history.points[0]!.timestamp).toBeLessThan(history.points[1]!.timestamp);
  expect(history.source).toContain("Uniswap");
  expect(history.error).toBeNull();
});

test("a stale series keeps its points and its reason, rather than coming back blank", () => {
  const history = parseMarkHistory({ ...raw, error: "the series is 3h old" })!;
  expect(history.points).toHaveLength(2);
  expect(history.error).toContain("3h old");
});

test("a series with no points at all is no series, so the screen says so rather than drawing one", () => {
  expect(parseMarkHistory({ ...raw, points: [] })).toBeNull();
  expect(parseMarkHistory({ points: null } as never)).toBeNull();
});

test("a point missing its mid is dropped rather than read as zero", () => {
  const history = parseMarkHistory({ ...raw, points: [...raw.points, { t: 1789007200, mid: null }] } as never)!;
  expect(history.points).toHaveLength(2);
});
