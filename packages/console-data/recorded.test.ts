import { expect, test } from "bun:test";
import { LEGS } from "./src/config.js";
import { recordedMoment } from "./src/recorded.js";
import { parseQuote } from "./src/quotes.js";
import { parseMarkHistory } from "./src/market.js";
import quotesAtoB from "./fixtures/quotes-atob.json" with { type: "json" };
import market168 from "./fixtures/market-168h.json" with { type: "json" };
import market6 from "./fixtures/market-6h.json" with { type: "json" };
import recordedAt from "./fixtures/recorded-at.json" with { type: "json" };

/**
 * The recorded moment, assembled by the functions the live console assembles it with.
 *
 * Two surfaces draw this moment — the console under `ZENTIS_FIXTURES` and the web replay — and if
 * either derived its own numbers from the same fixtures the two would drift the first time one of
 * them was edited. So the moment is built once, here, out of `takeSnapshot`'s own parts: the shift
 * from `decomposeBook`, the spread from `spreadStack`, the PnL from `legPnl`, the feed from
 * `collapseFeed`. Nothing in it is constructed for the look of it.
 */
test("the moment is the fixtures' own, at the second they were recorded", () => {
  const moment = recordedMoment();
  expect(moment.snapshot.takenAtSeconds).toBe(recordedAt.seconds);
  expect(moment.snapshot.legs).toHaveLength(LEGS.length);
  // One seq across the legs, which is what the recorder refuses to write a moment without.
  expect(moment.snapshot.seq).not.toBeNull();
});

test("every leg carries the shift, the spread and the PnL the console computes", () => {
  const moment = recordedMoment();
  for (const leg of moment.snapshot.legs) {
    expect(leg.position).not.toBeNull();
    expect(leg.ref).not.toBeNull();
    expect(leg.shift).not.toBeNull();
    expect(leg.spread).not.toBeNull();
    expect(leg.pnl).not.toBeNull();
    // The shift the console shows and the one the enclave published, side by side: the pair is the
    // claim this project makes, and a moment missing either half cannot make it.
    expect(typeof leg.shift!.tiltBps).toBe("bigint");
    expect(typeof leg.shift!.published).toBe("number");
    // Valued at the mainnet mark, never at the leg's own testnet pool.
    expect(leg.mark?.mid ?? 0n).toBeGreaterThan(0n);
    expect(leg.mark?.source).toMatch(/spot/i);
  }
});

test("the quotes are the router's recorded answers, parsed by the reader that parses the live ones", () => {
  const moment = recordedMoment();
  const raw = (quotesAtoB as { quotes: Parameters<typeof parseQuote>[0][] }).quotes;
  for (const leg of moment.snapshot.legs) {
    const mine = raw.find((q) => q.chainId === leg.config.chainId);
    expect(mine).toBeDefined();
    expect(leg.quoteAToB?.amountOut ?? null).toEqual(parseQuote(mine!).amountOut);
    // Both directions, because a maker that only quotes one way is not a maker.
    expect(leg.quoteBToA).not.toBeNull();
  }
  // The sizes are the same trade in opposite directions, derived from the mark at recording.
  expect(moment.quoteSizes.amountInA).toBeGreaterThan(0n);
  expect(moment.quoteSizes.amountInB).toBeGreaterThan(0n);
});

test("the market series is the one mainnet series, in both the windows that were recorded", () => {
  const moment = recordedMoment();
  expect(moment.snapshot.market).toEqual(parseMarkHistory(market168 as never));
  expect(moment.snapshot.market?.granularity).toBe("hours");
  // The short window comes back per swap: an hourly series drawn over six hours is a straight line
  // between a handful of points, which is not what the market did.
  expect(moment.recentMarket).toEqual(parseMarkHistory(market6 as never));
  expect(moment.recentMarket?.granularity).toBe("swaps");
});

test("nothing in the moment is constructed: no beat, no sine wave, no placeholder hash", () => {
  // The sandbox's world adds a fill and a refusal so the layout can be tested against them, and
  // draws a market series as a sine wave. Those are fine for a test of a rendering and are not fine
  // for a public surface that says the numbers are real.
  const moment = recordedMoment();
  const text = JSON.stringify(moment.snapshot, (_, v) => (typeof v === "bigint" ? String(v) : v));
  expect(text).not.toContain("beat");
  for (const leg of moment.snapshot.legs) {
    for (const fill of leg.pnl!.perFill) expect(fill.transaction).toMatch(/^0x[0-9a-f]{64}$/);
  }
});

test("the feed is the collapsed one the console draws, over every leg", () => {
  const moment = recordedMoment();
  expect(moment.snapshot.feed.length).toBeGreaterThan(0);
  const chains = new Set(moment.snapshot.feed.flatMap((row) => ("chainId" in row ? [row.chainId] : [])));
  expect(chains.size).toBeGreaterThan(0);
});

test("the book totals are the sum the console shows, not a second addition", () => {
  const moment = recordedMoment();
  expect(moment.snapshot.book.legs).toBe(LEGS.length);
  expect(moment.snapshot.book.inventoryA).not.toBeNull();
  expect(moment.snapshot.book.pnlA).not.toBeNull();
});
