import { expect, test } from "bun:test";
import { LEGS } from "./src/config.js";

import sepolia from "../../contracts/deployments/sepolia.json" with { type: "json" };

/**
 * The bytes that let the console fill without a checkout.
 *
 * They are produced by the Solidity builders themselves and written only once the router's hash of
 * the rebuilt order matched the shipped strategy on chain, so they are the live position by
 * construction. The console passes them through; it never re-implements the builder.
 */
test("a leg carries the order and taker data the router expects, or says it has none", () => {
  for (const leg of LEGS) {
    if (leg.fill === null) continue;
    expect(leg.fill.router).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(leg.fill.swapSignature).toContain("swap(");
    expect(leg.fill.orderTuple.startsWith("(")).toBe(true);
    expect(leg.fill.takerDataAToB).toMatch(/^0x[0-9a-fA-F]+$/);
    expect(leg.fill.takerDataBToA).toMatch(/^0x[0-9a-fA-F]+$/);
  }
  expect(LEGS.some((l) => l.fill !== null)).toBe(true);
});

test("the recorded order is this generation's, not a superseded one", () => {
  // The hash the record carries is the strategy the leg is shipped as: bytes from an older
  // generation would quote against a position that no longer exists.
  const leg = LEGS.find((l) => l.name === "sepolia")!;
  expect(leg.fill!.orderHash).toBe(leg.strategyHash);
  expect(leg.fill!.orderHash).toBe((sepolia as { position: { strategyHash: string } }).position.strategyHash);
});

test("the taker the traits embed is carried with them, since it is who the fill is for", () => {
  const leg = LEGS.find((l) => l.name === "sepolia")!;
  expect(leg.fill!.taker).toMatch(/^0x[0-9a-fA-F]{40}$/);
});
