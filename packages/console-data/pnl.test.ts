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

test("a top-up is not trading profit, because trading is summed from the fills", () => {
  // The maker tops a leg up with `push()` to put its curve back on the mid, which raises the
  // indexed balance without a trade. Trading measured as the balance delta against what was
  // shipped counts that top-up as profit: on 2026-09-11 the Sepolia leg was pushed 0.005575 WETH,
  // which at the mark would have read as about 13.77 USDC the maker never earned. Summing the
  // fills instead is immune to it, and to withdrawals, and to who did them.
  const mark = (10n ** 30n) / 2_470n;
  const shipped = { balanceA: 15_000_000n, balanceB: 496_902_045_775_143n, mid: mark, markAtShip: mark, seq: 1, block: 1 };
  const before = legPnl(sepolia, shipped, mark, mark);
  const toppedUp = {
    ...sepolia,
    position: { ...sepolia.position!, balanceB: sepolia.position!.balanceB + 5_575_000_000_000_000n },
  };
  expect(legPnl(toppedUp, shipped, mark, mark).tradingA).toBe(before.tradingA);
});

test("trading is the sum of what each fill moved, valued at the mark", () => {
  const mark = (10n ** 30n) / 2_470n;
  const shipped = { balanceA: 15_000_000n, balanceB: 496_902_045_775_143n, mid: mark, markAtShip: mark, seq: 1, block: 1 };
  const pnl = legPnl(sepolia, shipped, mark, mark);
  const byHand = sepolia.fills.reduce((sum, fill) => {
    const deltaA = fill.isAToB ? fill.amountIn : -fill.amountOut;
    const deltaB = fill.isAToB ? -fill.amountOut : fill.amountIn;
    return sum + deltaA + (deltaB * 10n ** 18n) / mark;
  }, 0n);
  expect(pnl.tradingA).toBe(byHand);
});

test("hold is refused when the opening and closing marks come from different sources", () => {
  // The legs are shipped sized to their own pool's mid, and the book is marked at the mainnet
  // price. On a testnet those differ by an order of magnitude, so valuing the opening basket at the
  // pool mid and the closing one at the market reports the gap between two price sources as a loss
  // the maker never took. Hold needs one source at both ends or it needs to say it cannot be had.
  const shipped = { balanceA: 15_000_000n, balanceB: 496_902_045_775_143n, mid: (10n ** 30n) / 30_187n, markAtShip: null, seq: 1, block: 1 };
  const mark = (10n ** 30n) / 2_467n;
  const pnl = legPnl(sepolia, shipped, mark, null);
  expect(pnl.holdA).toBeNull();
  expect(pnl.totalA).toBeNull();
  expect(pnl.tradingA).not.toBeNull();
  expect(pnl.caveat).toContain("no mark was recorded");
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
  const pnl = legPnl(history, { balanceA: 15_000_000n, balanceB: 500_000_000_000_000n, mid: shipMid, markAtShip: null, seq: 1, block: 1 }, mark, shipMid);
  expect(pnl.holdA).toBe(-5_000_000n);
  expect(pnl.tradingA).toBe(0n);
  expect(pnl.totalA).toBe(-5_000_000n);
  expect(pnl.caveat).toBeNull();
});

test("no mark or no recorded opening means no number, with the reason", () => {
  const shipped = { balanceA: 15_000_000n, balanceB: null, mid: null, markAtShip: null, seq: 1, block: 1 };
  expect(legPnl(sepolia, shipped, 1n, 1n).tradingA).toBeNull();
  expect(legPnl(sepolia, shipped, 1n, 1n).caveat).toContain("not recorded");
  expect(legPnl(sepolia, { ...shipped, balanceB: 1n, mid: 1n }, null, 1n).caveat).toContain("no mark");
});

test("every leg's config carries what it was shipped with", () => {
  for (const leg of LEGS) {
    expect(leg.shipped.balanceA).toBeGreaterThan(0n);
    expect(leg.shipped.balanceB).not.toBeNull();
    expect(leg.shipped.mid).not.toBeNull();
  }
});

test("hold says how much inventory it does not cover, rather than leaving the gap silent", () => {
  // Hold values the tokenB the leg was shipped with, against the mark it was shipped at. Anything
  // pushed in afterwards is inventory the leg holds and hold says nothing about — and that gap is
  // derivable from what the console already reads: what the position holds now, less what it was
  // shipped with, less what the fills moved. Valuing it needs a mark from the moment of each push,
  // which no record carries yet; naming it needs nothing.
  const mark = (10n ** 30n) / 2_467n;
  const shippedB = 496_902_045_775_143n;
  const pushed = 5_575_000_000_000_000n;
  const history = {
    position: { balanceA: 15_000_000n, balanceB: shippedB + pushed, active: true },
    fills: [],
    references: [],
    rejections: [],
  } as never;
  const shipped = { balanceA: 15_000_000n, balanceB: shippedB, mid: mark, markAtShip: mark, markAtShipAt: 1, markAtShipSource: "x", seq: 1, block: 1 };
  const pnl = legPnl(history, shipped, mark, mark);
  expect(pnl.holdA).toBe(0n);
  // Named in the leg's own tokenB units, signed, so a withdrawal reads as one too.
  expect(pnl.unvaluedB).toBe(pushed);
});

test("the gap counts only the fills of this generation, since older ones moved another position", () => {
  // A leg is re-shipped: the subgraph keeps every fill the position ever took, including the ones
  // that moved the balance of the generation before this one. Counting those made the gap read
  // half a milli-WETH too large on two legs — a number that looked plausible and was wrong, which
  // is the only kind worth catching.
  const mark = (10n ** 30n) / 2_467n;
  const shippedB = 3_609_187_305_665_584n;
  const pushed = 2_462_000_000_000_000n;
  const soldNow = 57_941_952_335_277n;
  const fill = (timestamp: bigint, amountOut: bigint) => ({
    transaction: `0x${timestamp}`,
    timestamp,
    isAToB: true,
    amountIn: 150_000n,
    amountOut,
    hasReference: true,
    refMid: mark,
    refTiltBps: 0,
    refSeq: 1,
    refAgeSeconds: 0n,
    chainId: 84532,
    kind: "fill",
  });
  const shipAt = 1_789_100_906;
  const history = {
    position: { balanceA: 15_000_000n, balanceB: shippedB + pushed - soldNow, active: true },
    // One before the ship and one after: only the second moved this generation's balance.
    fills: [fill(BigInt(shipAt) + 100n, soldNow), fill(BigInt(shipAt) - 100_000n, 543_830_902_874_131n)],
    references: [],
    rejections: [],
  } as never;
  const shipped = {
    balanceA: 15_000_000n,
    balanceB: shippedB,
    mid: mark,
    markAtShip: mark,
    markAtShipAt: shipAt,
    markAtShipSource: "x",
    seq: 1,
    block: 1,
  };
  expect(legPnl(history, shipped, mark, mark).unvaluedB).toBe(pushed);
});

test("without a ship time the gap is unknown rather than a number nobody can stand behind", () => {
  const mark = (10n ** 30n) / 2_467n;
  const history = {
    position: { balanceA: 15_000_000n, balanceB: 496_902_045_775_143n, active: true },
    fills: [],
    references: [],
    rejections: [],
  } as never;
  const shipped = { balanceA: 15_000_000n, balanceB: 496_902_045_775_143n, mid: mark, markAtShip: mark, markAtShipAt: null, markAtShipSource: null, seq: 1, block: 1 };
  expect(legPnl(history, shipped, mark, mark).unvaluedB).toBeNull();
});

test("a leg holding exactly what it was shipped with, less its fills, has no gap to report", () => {
  const mark = (10n ** 30n) / 2_467n;
  const shippedB = 496_902_045_775_143n;
  const soldB = 57_941_952_335_277n;
  const history = {
    position: { balanceA: 15_150_000n, balanceB: shippedB - soldB, active: true },
    fills: [
      {
        transaction: "0x1",
        timestamp: 1n,
        isAToB: true,
        amountIn: 150_000n,
        amountOut: soldB,
        hasReference: true,
        refMid: mark,
        refTiltBps: 0,
        refSeq: 1,
        refAgeSeconds: 0n,
        chainId: 11155111,
        kind: "fill",
      },
    ],
    references: [],
    rejections: [],
  } as never;
  const shipped = { balanceA: 15_000_000n, balanceB: shippedB, mid: mark, markAtShip: mark, markAtShipAt: 1, markAtShipSource: "x", seq: 1, block: 1 };
  expect(legPnl(history, shipped, mark, mark).unvaluedB).toBe(0n);
});

test("trading is this generation's, and the position's whole life is a separate figure", () => {
  // One total, one question. Hold is already this generation's — it values what the leg was shipped
  // with — so trading summed over the position's whole life made the total the sum of two different
  // spans. The lifetime figure is not thrown away; it is reported beside it, labelled as what it is.
  const mark = (10n ** 30n) / 2_467n;
  const shipAt = 1_789_100_856;
  const fill = (timestamp: bigint, amountIn: bigint, amountOut: bigint) => ({
    transaction: `0x${timestamp}`,
    timestamp,
    isAToB: true,
    amountIn,
    amountOut,
    hasReference: true,
    refMid: mark,
    refTiltBps: 0,
    refSeq: 1,
    refAgeSeconds: 0n,
    chainId: 11155111,
    kind: "fill",
  });
  const history = {
    position: { balanceA: 15_450_000n, balanceB: 496_902_045_775_143n, active: true },
    fills: [
      fill(BigInt(shipAt) + 500n, 150_000n, 57_941_952_335_277n),
      // Before the ship: a fill of the generation this one superseded.
      fill(BigInt(shipAt) - 50_000n, 300_000n, 115_000_000_000_000n),
    ],
    references: [],
    rejections: [],
  } as never;
  const shipped = {
    balanceA: 15_000_000n,
    balanceB: 496_902_045_775_143n,
    mid: mark,
    markAtShip: mark,
    markAtShipAt: shipAt,
    markAtShipSource: "x",
    seq: 1,
    block: 1,
  };
  const pnl = legPnl(history, shipped, mark, mark);

  expect(pnl.fills).toBe(1);
  expect(pnl.volumeA).toBe(150_000n);
  expect(pnl.lifetime.fills).toBe(2);
  expect(pnl.lifetime.volumeA).toBe(450_000n);
  // The two spans genuinely differ, which is the whole reason for keeping them apart.
  expect(pnl.lifetime.tradingA).not.toBe(pnl.tradingA);
  // Every fill is still evidence and stays on the list, each saying which span it belongs to.
  expect(pnl.perFill).toHaveLength(2);
  expect(pnl.perFill.filter((f) => f.thisGeneration)).toHaveLength(1);
});

test("without a ship timestamp the generation's figures are unknown, not the position's lifetime", () => {
  const mark = (10n ** 30n) / 2_467n;
  const history = {
    position: { balanceA: 15_000_000n, balanceB: 496_902_045_775_143n, active: true },
    fills: [
      {
        transaction: "0x1",
        timestamp: 1_789_000_000n,
        isAToB: true,
        amountIn: 150_000n,
        amountOut: 57_941_952_335_277n,
        hasReference: true,
        refMid: mark,
        refTiltBps: 0,
        refSeq: 1,
        refAgeSeconds: 0n,
        chainId: 11155111,
        kind: "fill",
      },
    ],
    references: [],
    rejections: [],
  } as never;
  const shipped = { balanceA: 15_000_000n, balanceB: 496_902_045_775_143n, mid: mark, markAtShip: mark, markAtShipAt: null, markAtShipSource: null, seq: 1, block: 1 };
  const pnl = legPnl(history, shipped, mark, mark);

  expect(pnl.tradingA).toBeNull();
  expect(pnl.holdA).toBeNull();
  expect(pnl.totalA).toBeNull();
  expect(pnl.caveat).toMatch(/ship/i);
  // The lifetime figures are still real, and still shown.
  expect(pnl.lifetime.fills).toBe(1);
  expect(pnl.lifetime.tradingA).not.toBeNull();
});

