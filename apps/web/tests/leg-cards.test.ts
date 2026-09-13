import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { inventorySplit, shiftStack, spreadBars } from "@/lib/leg-cards";
import type { Decomposition, SpreadStack } from "@/lib/replay";

/**
 * The per-leg card's arithmetic.
 *
 * The trap that makes this a test file rather than a component: the decomposition's terms do not
 * add up to the shift the way a stacked bar assumes. `ownConcession + bookConcession` is the
 * *uncapped* concession, and what the leg actually conceded is `concession`, which the boundary can
 * cut. Drawing own and book as segments of a stack produces a bar that sums to a shift the enclave
 * never published — and it looks like a perfectly ordinary chart.
 */
const seed = JSON.parse(readFileSync(join(import.meta.dir, "..", "public", "seed", "replay.json"), "utf8"));
const legs = seed.legs as { label: string; decomposition: Decomposition; spread: SpreadStack; maxTiltBps: number }[];

describe("the shift is correction plus what survived the boundary", () => {
  for (const leg of legs) {
    test(`${leg.label}: the stack sums to the published shift`, () => {
      const stack = shiftStack(leg.decomposition);
      expect(stack.total).toBe(Number(leg.decomposition.tiltBps));
      expect(stack.terms.reduce((sum, term) => sum + term.bps, 0)).toBe(stack.total);
    });

    test(`${leg.label}: the uncapped terms are reported apart from the stack, not inside it`, () => {
      const stack = shiftStack(leg.decomposition);
      const uncapped = Number(leg.decomposition.ownConcession) + Number(leg.decomposition.bookConcession);
      expect(uncapped).toBe(Number(leg.decomposition.concessionUncapped));
      // The whole point: where the boundary cut, the stack must not carry the uncut number.
      if (uncapped !== Number(leg.decomposition.concession)) {
        expect(stack.terms.some((t) => t.bps === uncapped)).toBe(false);
        expect(stack.cutByBoundary).toBe(uncapped - Number(leg.decomposition.concession));
      }
    });
  }

  test("a cap that removes nothing is reported as nothing, not as zero bps of cut", () => {
    const stack = shiftStack({
      ...legs[0]!.decomposition,
      correction: "-100",
      ownConcession: "30",
      bookConcession: "0",
      concessionUncapped: "30",
      concession: "30",
      tiltBps: "-70",
    });
    expect(stack.cutByBoundary).toBeNull();
    expect(stack.total).toBe(-70);
  });

  test("the published number is carried beside the recomputation, never substituted for it", () => {
    const stack = shiftStack({ ...legs[0]!.decomposition, tiltBps: "-272", published: -270, agrees: false });
    expect(stack.total).toBe(-272);
    expect(stack.published).toBe(-270);
    expect(stack.agrees).toBe(false);
  });

  test("a carried round is named as carried rather than read as a disagreement", () => {
    // A slow round republishes the last fast round's tilt against a re-budgeted boundary, so the
    // console lands a few bps short in the tilt's own direction. That is a carry, not a dispute.
    const stack = shiftStack({ ...legs[0]!.decomposition, agrees: false, carried: true, carriedFromSeq: 1789227919 });
    expect(stack.carriedFromSeq).toBe(1789227919);
    expect(stack.disputed).toBe(false);
  });

  test("a genuine disagreement on a fast round is a dispute", () => {
    // Same balances as the enclave priced from, a recomputed round, and two different answers:
    // that is the only state worth drawing in red. A leg the enclave priced before a fill landed is
    // a different thing and has its own line.
    const stack = shiftStack({
      ...legs[0]!.decomposition,
      agrees: false,
      carried: false,
      carriedFromSeq: null,
      balancesMatchEnclave: true,
    });
    expect(stack.disputed).toBe(true);
  });

  test("the scale covers the widest term, so no segment is drawn off the end", () => {
    const stack = shiftStack(legs[0]!.decomposition);
    for (const term of stack.terms) expect(Math.abs(term.bps)).toBeLessThanOrEqual(stack.domainBps);
    expect(Math.abs(stack.total)).toBeLessThanOrEqual(stack.domainBps);
  });
});

describe("the spread stack", () => {
  for (const leg of legs) {
    test(`${leg.label}: the four terms sum to the total the router quotes`, () => {
      const bars = spreadBars(leg.spread);
      expect(bars.reduce((sum, bar) => sum + bar.bps, 0)).toBe(leg.spread.totalBps);
    });
  }

  test("every term carries its share of the total, and a zero term still carries its name", () => {
    const bars = spreadBars(legs.find((l) => l.spread.markoutBps === 0)!.spread);
    expect(bars.map((b) => b.key)).toEqual(["base", "volatility", "markout", "staleness"]);
    const markout = bars.find((b) => b.key === "markout")!;
    expect(markout.bps).toBe(0);
    expect(markout.share).toBe(0);
  });

  test("a total of zero shares out as zero rather than as a division by it", () => {
    const bars = spreadBars({ ...legs[0]!.spread, baseBps: 0, volatilityBps: 0, markoutBps: 0, stalenessBps: 0, totalBps: 0 });
    for (const bar of bars) expect(Number.isFinite(bar.share)).toBe(true);
  });
});

describe("the inventory split", () => {
  test("the even split is the mark the bar is read against", () => {
    const even = inventorySplit("500000000000000000")!;
    expect(even.shareA).toBeCloseTo(0.5, 6);
    expect(even.evenAt).toBe(0.5);
  });

  test("a leg leaning to tokenA reads above the even mark", () => {
    const split = inventorySplit(legs[0]!.decomposition.weightA)!;
    expect(split.shareA).toBeGreaterThan(0);
    expect(split.shareA).toBeLessThan(1);
    expect(split.leansTo).toBe(split.shareA > 0.5 ? "A" : "B");
  });

  test("an unknown weight is unknown, not an even split", () => {
    expect(inventorySplit(null)).toBeNull();
  });
});
