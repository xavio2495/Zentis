import { describe, expect, test } from "bun:test";
import { MARKS, midFromUsd, parseMarkResponse } from "../src/mark.js";

describe("the mainnet mark", () => {
  test("two USD prices become a mid in the registry's units, exactly", () => {
    // 1e18 raw USDC (6dp) is 1e12 USDC; at 1.0004 USD each and 2464.64 USD per WETH that buys
    // 1.0004e12 / 2464.64 WETH, which in wei is the mid. Checked against a rational computation:
    // floor(1.0004e12 * 1e18 / 2464.64) = 405,900,000,000,000,000,000,000,000 - (rounding)
    const mid = midFromUsd("1.0004", "2464.64", 6, 18);
    expect(mid).toBe((10004n * 10n ** 30n) / 246464n);
  });

  test("the mid converts back to a price a person recognises", () => {
    const mid = midFromUsd("1", "2464.64", 6, 18);
    // 1 WETH in USDC = 1e30 / mid
    expect(Number(10n ** 30n / mid)).toBeCloseTo(2464.64, 0);
  });

  test("every testnet leg has a mainnet counterpart to be marked at", () => {
    expect(Object.keys(MARKS).map(Number).sort()).toEqual([84532, 421614, 11155111].sort());
    for (const mark of Object.values(MARKS)) expect(mark.chainId).not.toBe(0);
  });

  test("a price response missing a token is no mark, not a zero mark", () => {
    expect(parseMarkResponse({ "0xa": "1" }, "0xa", "0xb", 6, 18)).toBeNull();
    expect(parseMarkResponse({ "0xa": "1", "0xb": "2000" }, "0xa", "0xb", 6, 18)).not.toBeNull();
  });
});
