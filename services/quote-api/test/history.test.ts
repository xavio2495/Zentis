import { describe, expect, test } from "bun:test";
import { HISTORY_HOURS, midFromSqrtPrice, parseHourly } from "../src/history.js";

describe("the book's market history", () => {
  test("an hourly point's mid matches the enclave's own conversion of the same sqrt price", () => {
    // Taken from the Uniswap v3 mainnet USDC/WETH pool at 1789110000, the same subgraph and pool
    // the slow workflow measures volatility on. Converting the sqrt price rather than reading the
    // decimal `token0Price` keeps the chart in the registry's units and off floating point.
    const point = midFromSqrtPrice("1594408239025342413178218698734019");
    expect(point).toBe(404985889959499465156171179n);
    // 1e30 / mid is the price a person recognises, about 2,469 USDC per WETH that hour.
    expect(Number(10n ** 30n / point)).toBeGreaterThan(2_400);
    expect(Number(10n ** 30n / point)).toBeLessThan(2_540);
  });

  test("points come back oldest first, because a chart is drawn left to right", () => {
    const parsed = parseHourly([
      { periodStartUnix: 1789110000, sqrtPrice: "1594408239025342413178218698734019" },
      { periodStartUnix: 1789102800, sqrtPrice: "1595446289124404332032362087129441" },
      { periodStartUnix: 1789106400, sqrtPrice: "1595446289124404332032362087129441" },
    ]);
    expect(parsed.map((p) => p.t)).toEqual([1789102800, 1789106400, 1789110000]);
  });

  test("an hour with no price is dropped rather than drawn as zero", () => {
    const parsed = parseHourly([
      { periodStartUnix: 1789110000, sqrtPrice: "0" },
      { periodStartUnix: 1789106400, sqrtPrice: "1595446289124404332032362087129441" },
    ]);
    expect(parsed.length).toBe(1);
    expect(parsed[0]!.t).toBe(1789106400);
  });

  test("a week is what the window asks for, so the series is sized to it", () => {
    expect(HISTORY_HOURS).toBe(168);
  });
});
