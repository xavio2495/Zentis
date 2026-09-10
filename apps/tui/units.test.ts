import { expect, test } from "bun:test";
import { duration, tokenAmount } from "./src/format.js";

test("a token amount reads as the token, not as raw units in scientific notation", () => {
  // 4.13e14 wei told a reader nothing: it is neither the unit they hold nor a number they can size.
  // Truncated, not rounded: a balance that reads higher than it is would flatter the position, and
  // the same convention already governs `amount`.
  expect(tokenAmount(413651370602035n, 18)).toBe("0.000413");
  expect(tokenAmount(15_000_000n, 6)).toBe("15");
  expect(tokenAmount(15_300_000n, 6)).toBe("15.3");
});

test("small amounts keep their significant digits instead of rounding to nothing", () => {
  // A fixed number of decimal places turns a real fill into "0.000000".
  expect(tokenAmount(3_882_474_794_738n, 18)).toBe("0.00000388");
  expect(tokenAmount(1n, 18)).toBe("0.000000000000000001");
  expect(tokenAmount(0n, 18)).toBe("0");
});

test("large amounts are grouped and do not sprout false precision", () => {
  expect(tokenAmount(1_234_567_890_123n, 6)).toBe("1,234,567");
  expect(tokenAmount(1_000_000n, 6)).toBe("1");
});

test("a duration reads the way an operator says it, at every scale", () => {
  expect(duration(45)).toBe("45s");
  expect(duration(1466)).toBe("24m");
  expect(duration(15238)).toBe("4h13m"); // floored: "4h13m old" is true at every instant it is shown
  expect(duration(3600)).toBe("1h");
  expect(duration(0)).toBe("0s");
});

test("a week-long window reads in days, not in hundreds of hours", () => {
  // The chart's axis said "166h40m ago", which nobody converts in their head.
  expect(duration(604800)).toBe("7d");
  expect(duration(600000)).toBe("6d22h");
  expect(duration(86400)).toBe("1d");
});

import { pairPrice } from "./src/format.js";

test("a pool's mid reads as a price a person would quote: one unit of the dearer token in the other", () => {
  // mid is raw tokenB per 1e18 raw tokenA. For USDC(6)/WETH(18), a WETH at 2,500 USDC is
  // 1e18 raw WETH for 2.5e9 raw USDC, so 1e18 raw USDC buys 4e26 raw WETH.
  const usdc = { symbol: "USDC", decimals: 6 };
  const weth = { symbol: "WETH", decimals: 18 };
  expect(pairPrice(4n * 10n ** 26n, usdc, weth)).toBe("1 WETH = 2,500 USDC");
  // The Sepolia reference pool's own mid, which really does sit far from the feed.
  expect(pairPrice(27576758040135728918671112n, usdc, weth)).toBe("1 WETH = 36,262 USDC");
  expect(pairPrice(0n, usdc, weth)).toBe("no price");
});
