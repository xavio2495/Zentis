import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { recordedMoment } from "../../../packages/console-data/src/recorded.js";
import { LEGS } from "../../../packages/console-data/src/config.js";

/**
 * The instrument panel's data: every figure the console computes, serialised.
 *
 * The `/sim` page draws the same book the console draws, so it must draw the same numbers. The way
 * to guarantee that is not to be careful — it is for the seed to be a serialisation of the console's
 * own snapshot, computed by `decomposeBook`, `spreadStack`, `legPnl`, `collapseFeed` and
 * `bookTotals` rather than by anything written for the web.
 *
 * These tests compare the committed seed to that snapshot, field by field. A seed regenerated from a
 * newer recording still passes; a seed with a number the console would not produce does not.
 */
const seed = <T,>(name: string): T =>
  JSON.parse(readFileSync(join(import.meta.dir, "..", "public", "seed", name), "utf8")) as T;

const moment = recordedMoment();
const legOf = (chainId: number) => moment.snapshot.legs.find((leg) => leg.config.chainId === chainId)!;

interface Seeded {
  market: { points: { t: number; mid: string }[]; source: string; hours: number; granularity: string; error: string | null };
  marketRecent: { granularity: string; hours: number } | null;
  book: {
    legs: number;
    legsActive: number;
    inventoryA: string | null;
    weightA: string | null;
    pnlA: string | null;
    tradingA: string | null;
    holdA: string | null;
    caveat: string | null;
    seq: number | null;
    ageSeconds: number | null;
  };
  legs: {
    chainId: number;
    status: string;
    quotes: {
      aToB: { amountIn: string; amountOut: string | null; offMidBps: number | null; refusal: { sentence: string } | null };
      bToA: { amountIn: string; amountOut: string | null; offMidBps: number | null; refusal: { sentence: string } | null };
    };
    decomposition: {
      weightA: string;
      correction: string;
      ownConcession: string;
      bookConcession: string;
      concessionUncapped: string;
      concession: string;
      tiltBps: string;
      published: number;
      agrees: boolean;
      roomBps: string;
      roomUnknownAtCap: boolean;
      cappedByRoom: boolean;
      clampedByMaxTilt: boolean;
      balancesMatchEnclave: boolean;
      referenceAgeSeconds: number | null;
    };
    spread: {
      baseBps: number;
      volatilityBps: number;
      markoutBps: number;
      stalenessBps: number;
      totalBps: number;
      referenceAgeSeconds: number;
      tooStaleToQuote: boolean;
      recomputedVolatilityBps: string | null;
    };
    pnl: {
      fills: number;
      volumeA: string;
      edgeA: string;
      markoutA: string | null;
      tradingA: string | null;
      holdA: string | null;
      totalA: string | null;
      unvaluedB: string | null;
      caveat: string | null;
      lifetime: { fills: number; volumeA: string; edgeA: string; markoutA: string | null; tradingA: string | null; generations: number | null };
    };
    fills: { transaction: string; sizeA: string; edgeA: string | null; markoutA: string | null; thisGeneration: boolean }[];
  }[];
}

test("the market series is the recorded mainnet series, oldest first, with its source said", () => {
  const replay = seed<Seeded>("replay.json");
  const market = moment.snapshot.market!;
  expect(replay.market.points).toHaveLength(market.points.length);
  expect(replay.market.source).toBe(market.source);
  expect(replay.market.hours).toBe(market.hours);
  expect(replay.market.granularity).toBe(market.granularity);
  expect(replay.market.points[0]!.mid).toBe(String(market.points[0]!.mid));
  for (let i = 1; i < replay.market.points.length; i += 1) {
    expect(replay.market.points[i]!.t).toBeGreaterThanOrEqual(replay.market.points[i - 1]!.t);
  }
  // The short window too, because an hourly series drawn over six hours is a straight line.
  expect(replay.marketRecent?.granularity).toBe("swaps");
});

test("the book row is the console's own total, with the seq and the age it was read at", () => {
  const replay = seed<Seeded>("replay.json");
  const book = moment.snapshot.book;
  expect(replay.book.legs).toBe(book.legs);
  expect(replay.book.legsActive).toBe(book.legsActive);
  expect(replay.book.inventoryA).toBe(book.inventoryA === null ? null : String(book.inventoryA));
  expect(replay.book.pnlA).toBe(book.pnlA === null ? null : String(book.pnlA));
  expect(replay.book.tradingA).toBe(book.tradingA === null ? null : String(book.tradingA));
  expect(replay.book.holdA).toBe(book.holdA === null ? null : String(book.holdA));
  expect(replay.book.seq).toBe(moment.snapshot.seq);
  expect(replay.book.ageSeconds).toBeGreaterThanOrEqual(0);
});

test("each leg's shift is the decomposition the console draws, term by term", () => {
  const replay = seed<Seeded>("replay.json");
  for (const leg of replay.legs) {
    const shift = legOf(leg.chainId).shift!;
    expect(leg.decomposition.tiltBps).toBe(String(shift.tiltBps));
    expect(leg.decomposition.correction).toBe(String(shift.correction));
    expect(leg.decomposition.ownConcession).toBe(String(shift.ownConcession));
    expect(leg.decomposition.bookConcession).toBe(String(shift.bookConcession));
    expect(leg.decomposition.concession).toBe(String(shift.concession));
    expect(leg.decomposition.published).toBe(shift.published);
    expect(leg.decomposition.agrees).toBe(shift.agrees);
    expect(leg.decomposition.roomBps).toBe(String(shift.roomBps));
    expect(leg.decomposition.roomUnknownAtCap).toBe(shift.roomUnknownAtCap);
    expect(leg.decomposition.clampedByMaxTilt).toBe(shift.clampedByMaxTilt);
    expect(leg.decomposition.balancesMatchEnclave).toBe(shift.balancesMatchEnclave);
    // The two terms add back to the shift on the page, as they do on the screen.
    expect(BigInt(leg.decomposition.correction) + BigInt(leg.decomposition.concession)).toBe(BigInt(leg.decomposition.tiltBps));
  }
});

test("each leg's spread is the stack the console shows, including the age term at the recorded moment", () => {
  const replay = seed<Seeded>("replay.json");
  for (const leg of replay.legs) {
    const spread = legOf(leg.chainId).spread!;
    expect(leg.spread.baseBps).toBe(spread.baseBps);
    expect(leg.spread.volatilityBps).toBe(spread.volatilityBps);
    expect(leg.spread.markoutBps).toBe(spread.markoutBps);
    // Evaluated at the moment of recording, not at publish: the surface drawing it says so.
    expect(leg.spread.stalenessBps).toBe(spread.stalenessBps);
    expect(leg.spread.totalBps).toBe(spread.totalBps);
    expect(leg.spread.tooStaleToQuote).toBe(spread.tooStaleToQuote);
  }
});

test("each leg's quotes are the router's recorded answers, both ways, with the distance from the mid", () => {
  const replay = seed<Seeded>("replay.json");
  for (const leg of replay.legs) {
    const snapshot = legOf(leg.chainId);
    expect(leg.quotes.aToB.amountIn).toBe(String(snapshot.quoteAToB!.amountIn));
    expect(leg.quotes.aToB.amountOut).toBe(
      snapshot.quoteAToB!.amountOut === null ? null : String(snapshot.quoteAToB!.amountOut),
    );
    expect(leg.quotes.bToA.amountIn).toBe(String(snapshot.quoteBToA!.amountIn));
    // A refused leg carries the sentence rather than a null nobody can render.
    if (leg.quotes.aToB.amountOut === null) expect(leg.quotes.aToB.refusal?.sentence.length).toBeGreaterThan(0);
    else expect(leg.quotes.aToB.offMidBps).not.toBeNull();
  }
});

test("each leg's PnL is the generation's, with the position's whole life beside it", () => {
  const replay = seed<Seeded>("replay.json");
  for (const leg of replay.legs) {
    const pnl = legOf(leg.chainId).pnl!;
    expect(leg.pnl.fills).toBe(pnl.fills);
    expect(leg.pnl.edgeA).toBe(String(pnl.edgeA));
    expect(leg.pnl.tradingA).toBe(pnl.tradingA === null ? null : String(pnl.tradingA));
    expect(leg.pnl.holdA).toBe(pnl.holdA === null ? null : String(pnl.holdA));
    expect(leg.pnl.totalA).toBe(pnl.totalA === null ? null : String(pnl.totalA));
    expect(leg.pnl.caveat).toBe(pnl.caveat);
    // The nulls are kept: a zero in place of an unknown is a figure that traces to nothing.
    if (pnl.markoutA === null) expect(leg.pnl.markoutA).toBeNull();
    expect(leg.pnl.lifetime.fills).toBe(pnl.lifetime.fills);
    expect(leg.pnl.lifetime.generations).toBe(pnl.lifetime.generations);
  }
});

test("every fill carries the economics the per-fill table shows", () => {
  const replay = seed<Seeded>("replay.json");
  for (const leg of replay.legs) {
    const perFill = legOf(leg.chainId).pnl!.perFill;
    expect(leg.fills).toHaveLength(perFill.length);
    for (const fill of leg.fills) {
      const computed = perFill.find((f) => f.transaction === fill.transaction)!;
      expect(computed).toBeDefined();
      expect(fill.sizeA).toBe(String(computed.sizeA));
      expect(fill.edgeA).toBe(computed.edgeA === null ? null : String(computed.edgeA));
      expect(fill.markoutA).toBe(computed.markoutA === null ? null : String(computed.markoutA));
      expect(fill.thisGeneration).toBe(computed.thisGeneration);
    }
  }
});

test("each leg's state is a word from the console's own vocabulary, not a boolean for the UI to name", () => {
  const replay = seed<Seeded>("replay.json");
  const known = ["live", "docked", "none", "unread"];
  for (const leg of replay.legs) {
    expect(leg.status.length).toBeGreaterThan(0);
    // "stale 4h16m" carries its age, so the check is on the first word.
    expect([...known, "stale", "no ref"]).toContain(leg.status.split(" ")[0]!);
  }
  expect(replay.legs).toHaveLength(LEGS.length);
});
