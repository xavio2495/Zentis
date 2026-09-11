import { expect, test } from "bun:test";
import { rebalanceOf } from "./src/rebalance.js";

const ONE = 10n ** 18n;
// A mid of 2,470 USDC per WETH in the book's units: raw tokenB per 1e18 raw tokenA, six-decimal
// tokenA against an eighteen-decimal tokenB.
const MID = (ONE * 10n ** 18n) / (2470n * 10n ** 6n);

test("a leg short of tokenB is topped up to what its own tokenA is worth at the mid", () => {
  // wantedB = balanceA × mid / 1e18, the same arithmetic the script does against the chain.
  const balanceA = 15n * 10n ** 6n;
  const wantedB = (balanceA * MID) / ONE;
  const plan = rebalanceOf({ balanceA, balanceB: wantedB / 2n, mid: MID });
  expect(plan.wantedB).toBe(wantedB);
  expect(plan.topUpB).toBe(wantedB - wantedB / 2n);
  expect(plan.canFix).toBe(true);
});

test("a leg already on the mid needs nothing, and says so rather than offering a zero push", () => {
  const balanceA = 15n * 10n ** 6n;
  const plan = rebalanceOf({ balanceA, balanceB: (balanceA * MID) / ONE, mid: MID });
  expect(plan.topUpB).toBe(0n);
  expect(plan.canFix).toBe(false);
  expect(plan.reason).toContain("already");
});

test("a leg holding too much tokenB cannot be fixed by a top-up, and the reason says why", () => {
  // push() only adds. The script refuses this case rather than doing half of it, so the panel has to
  // say so instead of printing a command that would decline.
  const balanceA = 15n * 10n ** 6n;
  const plan = rebalanceOf({ balanceA, balanceB: (balanceA * MID * 2n) / ONE, mid: MID });
  expect(plan.canFix).toBe(false);
  expect(plan.topUpB).toBe(0n);
  expect(plan.reason).toMatch(/only adds|cannot/);
});

test("without a mid there is no plan at all, rather than a plan against zero", () => {
  const plan = rebalanceOf({ balanceA: 1n, balanceB: 1n, mid: 0n });
  expect(plan.canFix).toBe(false);
  expect(plan.wantedB).toBeNull();
  expect(plan.reason).toContain("mid");
});

test("how far the curve sits from the mid is reported in basis points, signed", () => {
  const balanceA = 15n * 10n ** 6n;
  const wantedB = (balanceA * MID) / ONE;
  // Holding half the tokenB it should: the leg's own curve prices tokenA well above the mid.
  const short = rebalanceOf({ balanceA, balanceB: wantedB / 2n, mid: MID });
  expect(short.offMidBps).not.toBeNull();
  expect(short.offMidBps!).toBeGreaterThan(0);
  const long = rebalanceOf({ balanceA, balanceB: wantedB * 2n, mid: MID });
  expect(long.offMidBps!).toBeLessThan(0);
});
