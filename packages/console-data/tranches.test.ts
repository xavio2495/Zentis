import { expect, test } from "bun:test";
import { type Tranche, legPnl, markAt } from "./src/pnl.js";

/**
 * Hold, over what the leg actually holds.
 *
 * It used to value one tranche: the tokenB the leg was shipped with, against the mark it was shipped
 * at. Everything pushed in afterwards was named and left unvalued, which was tolerable while a push
 * was a top-up of half a milli-WETH against a shipped five.
 *
 * It stopped being tolerable the moment the legs were grown: each was pushed about 0.0117 WETH onto
 * a shipped 0.0059, so most of the inventory arrived by push and hold would have spoken for under
 * half the book while presenting itself as the book's hold. Inventory enters in tranches, each at
 * the price of the day it entered, and that is how it has to be valued — the shipped one at the
 * ship's mark, each push at the mark when that push landed.
 */
const ONE = 10n ** 18n;
/** A mark is raw tokenB per 1e18 raw tokenA, so a price in USDC per WETH inverts into one. */
const at = (usdcPerWeth: number) => (ONE * 10n ** 6n) / BigInt(Math.round(usdcPerWeth * 1e12));

const history = (heldB: bigint) =>
  ({ position: { balanceA: 45_000_000n, balanceB: heldB, active: true }, fills: [], references: [], rejections: [] }) as never;

const shipped = (balanceB: bigint, mark: bigint) => ({
  balanceA: 15_000_000n,
  balanceB,
  mid: mark,
  markAtShip: mark,
  markAtShipAt: 1_789_000_000,
  markAtShipSource: "1inch spot",
  seq: 1,
  block: 1,
});

test("the mark at a moment is the last one struck at or before it, never one from the future", () => {
  const series = [
    { timestamp: 100n, mid: at(2_400) },
    { timestamp: 200n, mid: at(2_500) },
    { timestamp: 300n, mid: at(2_600) },
  ];
  expect(markAt(series, 250)).toBe(at(2_500));
  expect(markAt(series, 200)).toBe(at(2_500));
  // Before the series begins there is nothing to say, and the nearest later point is a price that
  // had not been struck yet: valuing a tranche at it would be valuing it at hindsight.
  expect(markAt(series, 50)).toBeNull();
  expect(markAt([], 250)).toBeNull();
});

test("each tranche is valued from its own entry, and hold is what they add up to", () => {
  // Shipped 0.006 WETH at 2,400 and pushed 0.012 at 2,500; the mark is 2,600 now. The shipped
  // tranche gained 200 USDC/WETH and the pushed one 100, on twice the size.
  const shippedB = 6_000_000_000_000_000n;
  const pushedB = 12_000_000_000_000_000n;
  const mark = at(2_600);
  const tranches: Tranche[] = [{ amountB: pushedB, mark: at(2_500), source: "push", atSeconds: 1_789_300_000 }];
  const pnl = legPnl(history(shippedB + pushedB), shipped(shippedB, at(2_400)), mark, at(2_400), null, tranches);

  // 0.006 × (2600 − 2400) = 1.2 USDC, 0.012 × (2600 − 2500) = 1.2 USDC.
  expect(pnl.holdA).not.toBeNull();
  expect(Number(pnl.holdA) / 1e6).toBeCloseTo(2.4, 2);
  // And nothing is left over: every unit the leg holds belongs to a tranche.
  expect(pnl.unvaluedB).toBe(0n);
});

test("a tranche whose entry price is unknown is left out of hold and named instead", () => {
  // An older push, from before the transaction log existed. Valuing it at today's mark would report
  // a gain of exactly zero on it, which is a claim; leaving it out and saying how much is a fact.
  const shippedB = 6_000_000_000_000_000n;
  const strayB = 5_575_000_000_000_000n;
  const mark = at(2_600);
  const pnl = legPnl(history(shippedB + strayB), shipped(shippedB, at(2_400)), mark, at(2_400), null, []);
  expect(pnl.unvaluedB).toBe(strayB);
  expect(pnl.caveat).toMatch(/valued|tranche|entered/i);
});

test("the caveat says what each tranche was valued from, so hold can be checked", () => {
  const shippedB = 6_000_000_000_000_000n;
  const pushedB = 12_000_000_000_000_000n;
  const tranches: Tranche[] = [{ amountB: pushedB, mark: at(2_500), source: "push", atSeconds: 1_789_300_000 }];
  const pnl = legPnl(history(shippedB + pushedB), shipped(shippedB, at(2_400)), at(2_600), at(2_400), null, tranches);
  expect(pnl.holdFrom).toHaveLength(2);
  expect(pnl.holdFrom[0]!.source).toBe("ship");
  expect(pnl.holdFrom[1]!.source).toBe("push");
  for (const entry of pnl.holdFrom) expect(entry.mark).not.toBeNull();
});

test("with no tranches given, hold is the shipped side alone, as it always was", () => {
  // The old behaviour is the special case rather than a separate path: a leg nobody has pushed to
  // has one tranche, and it is the ship.
  const shippedB = 6_000_000_000_000_000n;
  const pnl = legPnl(history(shippedB), shipped(shippedB, at(2_400)), at(2_600), at(2_400));
  expect(Number(pnl.holdA) / 1e6).toBeCloseTo(0.6, 2);
  expect(pnl.unvaluedB).toBe(0n);
});
