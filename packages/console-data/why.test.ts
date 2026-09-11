import { expect, test } from "bun:test";
import type { LegSnapshot } from "./src/snapshot.js";
import { LEGS } from "./src/config.js";
import { why } from "./src/why.js";

const leg = (over: Partial<LegSnapshot>): LegSnapshot =>
  ({
    config: { chainId: 84532, label: "Base Sepolia", tokenA: { symbol: "USDC" } },
    position: null,
    ref: null,
    series: null,
    spread: null,
    shift: null,
    quoteAToB: null,
    quoteBToA: null,
    finality: null,
    caveats: [],
    sources: { fills: null, registry: null, pool: null, fillsQuota: null },
    ...over,
  }) as unknown as LegSnapshot;

test("the why line does not call an unread leg a leg with no position", () => {
  // Base's card said "could not be read" while its detail, one keypress away, said "this leg has no
  // indexed position": the same null read two ways on one screen. The detail is where a viewer goes
  // to find out what is wrong, so it is the worse place to be told the position is gone.
  const sentence = why(leg({ sources: { fills: "subgraph HTTP 429, resets 21:52Z", registry: null, pool: null, fillsQuota: null } }));
  expect(sentence).not.toContain("no indexed position");
  expect(sentence).toContain("could not be read");
  expect(sentence).toContain("429");
});

test("a leg that really has no position still says so", () => {
  expect(why(leg({}))).toContain("no indexed position");
});

test("the volatility sentence names the market the book prices from, not a pool of its own", () => {
  // The slow workflow measures volatility on the one mainnet series the mid comes from. Saying "the
  // pool this leg prices from" claimed a per-leg price source that was retired with that change.
  // Volatility is the largest term, so it is the one the sentence picks; the shift's own terms are
  // zero here, in the units each of them really carries.
  const shift = {
    correction: 0n,
    ownConcession: 0n,
    bookConcession: 0n,
    tiltBps: 0,
    weightA: 5n * 10n ** 17n,
  } as never;
  const spread = {
    baseBps: 10,
    volatilityBps: 98,
    markoutBps: 0,
    stalenessBps: 0,
    totalBps: 108,
    referenceAgeSeconds: 60,
    tooStaleToQuote: false,
  } as never;
  const sentence = why({
    config: LEGS[0]!,
    position: { active: true, balanceA: 1n, balanceB: 1n } as never,
    shift,
    spread,
    caveats: [],
    sources: { fills: null, registry: null, pool: null, fillsQuota: null },
  } as never);
  expect(sentence).toContain("98 bps");
  expect(sentence).not.toContain("the pool this leg prices from");
  expect(sentence).toMatch(/market/);
});
