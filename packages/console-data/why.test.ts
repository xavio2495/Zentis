import { expect, test } from "bun:test";
import type { LegSnapshot } from "./src/snapshot.js";
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
    sources: { fills: null, registry: null, pool: null },
    ...over,
  }) as unknown as LegSnapshot;

test("the why line does not call an unread leg a leg with no position", () => {
  // Base's card said "could not be read" while its detail, one keypress away, said "this leg has no
  // indexed position": the same null read two ways on one screen. The detail is where a viewer goes
  // to find out what is wrong, so it is the worse place to be told the position is gone.
  const sentence = why(leg({ sources: { fills: "subgraph HTTP 429, resets 21:52Z", registry: null, pool: null } }));
  expect(sentence).not.toContain("no indexed position");
  expect(sentence).toContain("could not be read");
  expect(sentence).toContain("429");
});

test("a leg that really has no position still says so", () => {
  expect(why(leg({}))).toContain("no indexed position");
});
