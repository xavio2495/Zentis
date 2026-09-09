import { describe, expect, test } from "bun:test";
import { buildQuoteTakerTraits } from "../src/takerTraits.js";
import { explain } from "../src/reason.js";
import type { LegPosition } from "../src/legs.js";

describe("taker traits", () => {
  // The router slices a fixed twenty-two byte header off the front: ten sixteen-bit slice
  // ends followed by the flag word. A quote sets no slices, so the header is the whole thing.
  test("the header is exactly the twenty-two bytes the router parses", () => {
    expect(buildQuoteTakerTraits({ isExactIn: true, isAToB: true }).length).toBe(2 + 44);
  });

  test("exact-in A to B sets both flags and nothing else", () => {
    expect(buildQuoteTakerTraits({ isExactIn: true, isAToB: true })).toBe(
      `0x${"0000".repeat(10)}0081`
    );
  });

  test("exact-in B to A drops the direction flag", () => {
    expect(buildQuoteTakerTraits({ isExactIn: true, isAToB: false })).toBe(
      `0x${"0000".repeat(10)}0001`
    );
  });
});

function leg(overrides: Partial<LegPosition>): LegPosition {
  return {
    id: "0x01",
    chainId: 84532,
    strategyHash: "0x00",
    strategy: "0x00",
    maker: "0x00",
    app: "0x00",
    tokenA: "0x00",
    tokenB: "0x00",
    active: true,
    balanceA: "0",
    balanceB: "0",
    maxTiltBps: 500,
    maxStalenessSeconds: 3600,
    hasReference: true,
    refMid: "1",
    refTiltBps: 0,
    refSeq: 1,
    refUpdatedAt: "0",
    fillCount: 0,
    ...overrides
  } as LegPosition;
}

describe("the reason follows the instruction's own sign convention", () => {
  // A positive tilt means the leg is over-weight tokenA and makes tokenA cheap, so the side
  // that takes tokenA out is the one the maker wants filled.
  test("a leg long tokenA discounts the taker who takes tokenA out", () => {
    expect(explain(leg({ refTiltBps: 25 }), false)).toContain("discounted");
  });

  test("the same leg charges the taker who puts more tokenA in", () => {
    expect(explain(leg({ refTiltBps: 25 }), true)).toContain("premium");
  });

  test("a leg long tokenB mirrors it", () => {
    expect(explain(leg({ refTiltBps: -25 }), true)).toContain("discounted");
    expect(explain(leg({ refTiltBps: -25 }), false)).toContain("premium");
  });

  test("a balanced leg favours neither side", () => {
    expect(explain(leg({ refTiltBps: 0 }), true)).toContain("neither side");
  });

  test("a leg with no reference says so rather than implying a tilt of zero", () => {
    expect(explain(leg({ hasReference: false, refTiltBps: null }), true)).toContain(
      "no reference published yet"
    );
  });
});
