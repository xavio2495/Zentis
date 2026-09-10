import { expect, test } from "bun:test";
import { BOOK, LEGS } from "./src/config.js";
import { mergeFeed, parseHistory } from "./src/fills.js";
import { parseSeries } from "./src/pool.js";
import { offMidBps } from "./src/quotes.js";
import { headline, loadSimReport } from "./src/sim.js";
import { midOf, recomputeVolatility, spreadStack, stalenessWidening } from "./src/spread.js";
import type { StoredRef } from "./src/registry.js";

import historySepolia from "./fixtures/history-sepolia.json" with { type: "json" };
import historyArbitrum from "./fixtures/history-arbitrum-sepolia.json" with { type: "json" };
import historyBase from "./fixtures/history-base-sepolia.json" with { type: "json" };
import poolSepolia from "./fixtures/pool-sepolia.json" with { type: "json" };
import poolBase from "./fixtures/pool-base-sepolia.json" with { type: "json" };
import refSepolia from "./fixtures/ref-sepolia.json" with { type: "json" };
import recordedAt from "./fixtures/recorded-at.json" with { type: "json" };

const histories = [
  parseHistory(LEGS[0]!.chainId, historySepolia as never),
  parseHistory(LEGS[1]!.chainId, historyArbitrum as never),
  parseHistory(LEGS[2]!.chainId, historyBase as never),
];

const ref: StoredRef = {
  ...refSepolia,
  mid: BigInt(refSepolia.mid),
  updatedAt: BigInt(refSepolia.updatedAt),
  refBalanceA: BigInt(refSepolia.refBalanceA),
  dTiltPerA: BigInt(refSepolia.dTiltPerA),
};

test("a position parses out of the shape the subgraph really answers with", () => {
  const position = histories[0]!.position!;
  expect(position.active).toBe(true);
  expect(position.balanceA).toBeGreaterThan(0n);
  expect(position.strategyHash).toBe(LEGS[0]!.strategyHash.toLowerCase());
  expect(position.hasReference).toBe(true);
  expect(position.refSeq).toBe(ref.seq);
});

test("ref fields stay null when no reference existed, rather than reading back as a tilt of zero", () => {
  const unpriced = parseHistory(LEGS[0]!.chainId, {
    ...(historySepolia as never as { position: object; fills: object[]; references: []; rejections: [] }),
    position: { ...(historySepolia as never as { position: object }).position, hasReference: false },
  } as never);
  const position = unpriced.position!;
  expect(position.refTiltBps).toBeNull();
  expect(position.refSeq).toBeNull();
  expect(position.refMid).toBeNull();
});

test("the feed merges three chains onto the one clock they share, newest first", () => {
  const feed = mergeFeed(histories, 40);
  expect(feed.length).toBeGreaterThan(0);
  for (let i = 1; i < feed.length; i += 1) {
    expect(feed[i - 1]!.timestamp >= feed[i]!.timestamp).toBe(true);
  }
  expect(new Set(feed.map((e) => e.chainId)).size).toBe(3);
});

test("the feed carries the rejections, with the registry's own reason string", () => {
  const rejections = mergeFeed(histories, 200).filter((e) => e.kind === "rejection");
  expect(rejections.length).toBeGreaterThan(0);
  // The reasons are the contract's words. Paraphrasing them here would be inventing evidence.
  expect(rejections.every((r) => r.reason.length > 0)).toBe(true);
  expect(rejections.some((r) => r.reason === "stale seq")).toBe(true);
});

test("the Sepolia fill is in the feed with the reference that priced it", () => {
  const fills = mergeFeed(histories, 200).filter((e) => e.kind === "fill" && e.chainId === 11155111);
  expect(fills.length).toBeGreaterThan(0);
  const latest = fills[0]!;
  expect(latest.amountIn).toBeGreaterThan(0n);
  expect(latest.amountOut).toBeGreaterThan(0n);
  expect(latest.hasReference).toBe(true);
  expect(latest.refSeq).not.toBeNull();
});

test("the staleness ramp is a rate a minute and stops at the leg's cap", () => {
  const position = histories[0]!.position!;
  expect(stalenessWidening(position, 0)).toBe(0);
  expect(stalenessWidening(position, 59)).toBe(0);
  expect(stalenessWidening(position, 60)).toBe(position.widenBpsPerMinute);
  expect(stalenessWidening(position, 16 * 60)).toBe(16 * position.widenBpsPerMinute);
  expect(stalenessWidening(position, 10_000 * 60)).toBe(position.maxWidenBps);
});

test("the spread splits into the base the workflow was configured with and the rest", () => {
  const stack = spreadStack(ref, histories[0]!.position!, BOOK, Number(ref.updatedAt) + 16 * 60, null);
  expect(stack.baseBps).toBe(BOOK.baseSpreadBps);
  expect(stack.baseBps + stack.volatilityBps).toBe(ref.spreadBps);
  expect(stack.stalenessBps).toBe(16 * histories[0]!.position!.widenBpsPerMinute);
  expect(stack.totalBps).toBe(ref.spreadBps + ref.markoutBps + stack.stalenessBps);
  expect(stack.tooStaleToQuote).toBe(false);
});

test("past its staleness limit a leg does not quote wide, it stops quoting", () => {
  const position = histories[0]!.position!;
  const past = Number(ref.updatedAt) + position.maxStalenessSeconds + 1;
  expect(spreadStack(ref, position, BOOK, past, null).tooStaleToQuote).toBe(true);
});

test("the volatility term recomputes inside its cap, and Base's own multiplier is used", () => {
  const sepolia = recomputeVolatility(parseSeries(poolSepolia as never, midOf)!, LEGS[0]!, BOOK)!;
  const base = recomputeVolatility(parseSeries(poolBase as never, midOf)!, LEGS[2]!, BOOK)!;
  for (const term of [sepolia, base]) {
    expect(term).toBeGreaterThanOrEqual(0n);
    expect(term).toBeLessThanOrEqual(BigInt(BOOK.volatilityCapBps));
  }
  expect(LEGS[2]!.volatilityMultiplierBps).toBe(3000);
});

test("off-mid is signed against the reference's own mid and absent when a leg did not price", () => {
  const quote = {
    chainId: 11155111,
    chain: "sepolia",
    amountIn: 150_000n,
    amountOut: (150_000n * ref.mid) / 10n ** 18n,
    tokenIn: null,
    tokenOut: null,
    reason: null,
    refMid: ref.mid,
    tiltBps: ref.tiltBps,
    seq: ref.seq,
    refAgeSeconds: 0,
    caveats: [],
  };
  expect(offMidBps(quote, true)).toBe(0);
  expect(offMidBps({ ...quote, amountOut: null }, true)).toBeNull();
  expect(offMidBps({ ...quote, refMid: null }, true)).toBeNull();
  const worse = (quote.amountOut! * 9_900n) / 10_000n;
  expect(offMidBps({ ...quote, amountOut: worse }, true)).toBeLessThan(0);
});

test("the simulation card reads a committed run and carries the commit it came from", () => {
  const report = loadSimReport();
  expect(report.modelCommit).toMatch(/^[0-9a-f]{40}$/);
  expect(report.regimes.length).toBeGreaterThan(0);
  expect(report.kappaBps).toBe(10_000);
  expect(report.kappaBookBps).toBe(5_000);
  // No "bps saved": the harness is uncalibrated, so it ranks policies and does not price them.
  expect(headline(report)).not.toContain("saved");
  expect(headline(report)).toContain("regimes");
});

test("the fixtures were recorded, not written", () => {
  expect(recordedAt.seconds).toBeGreaterThan(Number(ref.updatedAt));
});
