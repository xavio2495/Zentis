import { expect, test } from "bun:test";
import { LEGS } from "./src/config.js";
import { parseHistory } from "./src/fills.js";
import { bInA, edgeAgainst, fillEconomics, legPnl } from "./src/pnl.js";
import historySepolia from "./fixtures/history-sepolia.json" with { type: "json" };

const sepolia = parseHistory(LEGS[0]!.chainId, historySepolia as never);
const ONE = 10n ** 18n;

test("a recorded Sepolia fill's edge against its reference checks by hand", () => {
  // The first recorded fill: the taker paid 150000 raw USDC and took 3880954858173 wei at a
  // reference mid of 27576751429833338625311660 wei per 1e18 raw USDC. At that mid the WETH given
  // was worth 3880954858173e18 / mid = 140732 raw USDC (truncated), so the maker kept 9268.
  const fill = sepolia.fills.find((f) => f.transaction.startsWith("0x0baaf2c1"))!;
  expect(fill.amountIn).toBe(150000n);
  const worth = (fill.amountOut * ONE) / fill.refMid!;
  expect(worth).toBe(140732n);
  expect(edgeAgainst(fill, fill.refMid!)).toBe(150000n - worth);
  expect(fillEconomics(fill, sepolia.references).edgeA).toBe(9268n);
});

test("a B-in fill's edge is what the maker received in A terms minus what it gave", () => {
  // 0.001 WETH in at a mid of 20,000 USDC per WETH is worth 20 USDC, which is 20,000,000 raw.
  const fill = { ...sepolia.fills[0]!, isAToB: false, amountIn: 1_000_000_000_000_000n, amountOut: 20_000_000n };
  const mid = 50_000_000_000_000_000_000_000_000n;
  expect(bInA(fill.amountIn, mid)).toBe(20_000_000n);
  expect(edgeAgainst(fill, mid)).toBe(0n);
});

test("trading and hold split the way the harness does, at the mark that is passed in", () => {
  // Shipped 15 USDC and 0.0005 WETH at a mid of 30,000 USDC per WETH; now holds 16 USDC and
  // 0.00045 WETH; marked at 20,000. Opening value 15 + 15 = 30 USDC; closing 16 + 9 = 25 USDC.
  // Hold: 0.0005 WETH lost a third of its value, −5 USDC. Trading: 25 − 30 − (−5) = 0.
  const shipMid = (10n ** 30n) / 30_000n;
  const mark = (10n ** 30n) / 20_000n;
  const history = {
    ...sepolia,
    fills: [],
    position: { ...sepolia.position!, balanceA: 16_000_000n, balanceB: 450_000_000_000_000n },
  };
  const pnl = legPnl(history, { balanceA: 15_000_000n, balanceB: 500_000_000_000_000n, mid: shipMid, seq: 1, block: 1 }, mark);
  expect(pnl.holdA).toBe(-5_000_000n);
  expect(pnl.tradingA).toBe(0n);
  expect(pnl.totalA).toBe(-5_000_000n);
  expect(pnl.caveat).toBeNull();
});

test("no mark or no recorded opening means no number, with the reason", () => {
  const shipped = { balanceA: 15_000_000n, balanceB: null, mid: null, seq: 1, block: 1 };
  expect(legPnl(sepolia, shipped, 1n).tradingA).toBeNull();
  expect(legPnl(sepolia, shipped, 1n).caveat).toContain("not recorded");
  expect(legPnl(sepolia, { ...shipped, balanceB: 1n, mid: 1n }, null).caveat).toContain("no mark");
});

test("every leg's config carries what it was shipped with", () => {
  for (const leg of LEGS) {
    expect(leg.shipped.balanceA).toBeGreaterThan(0n);
    expect(leg.shipped.balanceB).not.toBeNull();
    expect(leg.shipped.mid).not.toBeNull();
  }
});
