import { expect, test } from "bun:test";
import { BOOK, LEGS } from "./src/config.js";
import { type IndexedFill, mergeFeed, parseHistory } from "./src/fills.js";
import { parseSeries } from "./src/pool.js";
import { offMidBps } from "./src/quotes.js";
import { headline, loadSimReport } from "./src/sim.js";
import { midOf, recomputeVolatility, spreadStack, stalenessWidening } from "./src/spread.js";
import type { StoredRef } from "./src/registry.js";

import slowConfig from "../../cre/slow/config.staging.json" with { type: "json" };
import historySepolia from "./fixtures/history-sepolia.json" with { type: "json" };
import historyArbitrum from "./fixtures/history-arbitrum-sepolia.json" with { type: "json" };
import historyBase from "./fixtures/history-base-sepolia.json" with { type: "json" };
import poolSepolia from "./fixtures/pool-sepolia.json" with { type: "json" };
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

/** Every event the recording holds; the merge takes a limit and these tests want no limit. */
const EVERYTHING = 100_000;

test("the feed carries the rejections, with the registry's own reason string", () => {
  // The whole recording, not its first two hundred entries: a deeper recording is mostly publishes,
  // so a fixed slice of the newest stopped containing the rare events these tests are about.
  const rejections = mergeFeed(histories, EVERYTHING).filter((e) => e.kind === "rejection");
  expect(rejections.length).toBeGreaterThan(0);
  // The reasons are the contract's words. Paraphrasing them here would be inventing evidence.
  expect(rejections.every((r) => r.reason.length > 0)).toBe(true);
  expect(rejections.some((r) => r.reason === "stale seq")).toBe(true);
});

test("the Sepolia fill is in the feed with the reference that priced it", () => {
  const fills = mergeFeed(histories, EVERYTHING).filter(
    (e): e is IndexedFill => e.kind === "fill" && e.chainId === 11155111,
  );
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

test("the volatility term recomputes inside its cap, at whatever multiplier the workflow is set to", () => {
  // Only Sepolia still has a recorded series: the other two reference pools were retired when the
  // book moved to one mainnet mid, so there is nothing left to recompute a per-leg term from. The
  // multiplier is still asserted for a retired leg, because the term is computed with it wherever
  // a series comes from.
  const sepolia = recomputeVolatility(parseSeries(poolSepolia as never, midOf)!, LEGS[0]!, BOOK)!;
  expect(sepolia).toBeGreaterThanOrEqual(0n);
  expect(sepolia).toBeLessThanOrEqual(BigInt(BOOK.volatilityCapBps));
  // Read from the workflow's own config rather than written down: the multiplier is the slow
  // workflow's to set, a leg may override it, and a number pinned here turns an ordinary change to
  // that config into a failing console test about nothing.
  const configured = (slowConfig.legs as { registry: string; volatilityMultiplierBps?: number }[]).find(
    (l) => l.registry.toLowerCase() === LEGS[2]!.registry.toLowerCase(),
  );
  expect(LEGS[2]!.volatilityMultiplierBps).toBe(
    configured?.volatilityMultiplierBps ?? slowConfig.volatilityMultiplierBps,
  );
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
    refusal: null,
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
  // Basis points of the book, never the raw tokenA amount, which reads as dollars and is not.
  expect(report.bookInA).toBeGreaterThan(0);
  for (const regime of report.regimes) {
    expect(Number.isFinite(regime.meanBpsOfBook)).toBe(true);
    expect(Number.isFinite(regime.worstBpsOfBook)).toBe(true);
  }
});

test("the fixtures were recorded, not written", () => {
  expect(recordedAt.seconds).toBeGreaterThan(Number(ref.updatedAt));
});
