import { expect, test } from "bun:test";
import { bookTotals } from "./src/book.js";
import type { LegSnapshot } from "./src/snapshot.js";

const ONE = 10n ** 18n;
// 1 WETH = 2,500 USDC, in raw units: raw B per 1e18 raw A.
const mark = (10n ** 30n) / 2_500n;

const leg = (over: Partial<LegSnapshot>): LegSnapshot =>
  ({
    config: { chainId: 1, label: "Sepolia", tokenA: { symbol: "USDC", decimals: 6 } },
    position: { active: true, balanceA: 15_000_000n, balanceB: 6_000_000_000_000_000n },
    mark: { mid: mark, source: "1inch spot", error: null },
    pnl: { totalA: 1_000_000n, tradingA: 400_000n, holdA: 600_000n, caveat: null },
    ...over,
  }) as unknown as LegSnapshot;

test("the book's inventory is every leg valued at its own mark, in tokenA", () => {
  // 15 USDC plus 0.006 WETH at 2,500 is 15 + 15 = 30 USDC a leg, so two legs are 60.
  const totals = bookTotals([leg({}), leg({})]);
  expect(totals.inventoryA).toBe(60_000_000n);
  expect(totals.weightA).toBe(ONE / 2n);
  expect(totals.legsActive).toBe(2);
  expect(totals.legs).toBe(2);
});

test("the book total is the sum of the legs that have one, and says when one is missing", () => {
  const totals = bookTotals([leg({}), leg({ pnl: { totalA: null, caveat: "no mark" } as never })]);
  expect(totals.pnlA).toBe(null);
  expect(totals.caveat).toContain("1 of 2");
});

test("a leg with no mark is left out of the inventory rather than counted as zero", () => {
  const totals = bookTotals([leg({}), leg({ mark: null })]);
  expect(totals.inventoryA).toBe(30_000_000n);
  expect(totals.caveat).toContain("could not be valued");
});

test("a docked leg is not active but still counts its inventory", () => {
  const totals = bookTotals([leg({}), leg({ position: { active: false, balanceA: 0n, balanceB: 0n } as never })]);
  expect(totals.legsActive).toBe(1);
  expect(totals.legs).toBe(2);
  expect(totals.inventoryA).toBe(30_000_000n);
});
