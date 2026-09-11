import { expect, test } from "bun:test";
import { LEGS, POOL_RETIRED } from "./src/config.js";

test("a leg carries a reference pool or says it has none, never an undefined address", () => {
  // The book prices off one mainnet mid now, and two of the three testnet reference pools were
  // retired with that change. An address read off a config that no longer has the field arrives as
  // undefined, which every reader downstream would send to an RPC as the string "undefined".
  for (const leg of LEGS) {
    if (leg.referencePool === null) {
      expect(leg.referencePoolSubgraphUrl).toBeNull();
      continue;
    }
    expect(leg.referencePool).toMatch(/^0x[0-9a-fA-F]{40}$/);
  }
  expect(LEGS.some((l) => l.referencePool === null)).toBe(true);
});

test("the reason a leg has no pool is one sentence, said the same way everywhere", () => {
  expect(POOL_RETIRED).toContain("retired");
  expect(POOL_RETIRED.length).toBeGreaterThan(20);
});
