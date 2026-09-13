import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readMoment } from "@/lib/moment";

/**
 * The numbers the landing page's diagrams draw.
 *
 * Every one of them comes out of the committed recording, because the rule the whole project runs
 * on is that a figure on a surface traces to a run or a fill. A diagram is the easiest place in the
 * world to break that — a bar drawn to look right is a number nobody typed and nobody can check —
 * so the drawing gets its values from here and here reads the seed.
 *
 * Extracted rather than imported whole: the recording is 348K of rounds, and the landing needs
 * about twenty numbers out of it.
 */
const seed = JSON.parse(readFileSync(join(import.meta.dir, "..", "public", "seed", "replay.json"), "utf8"));
const moment = readMoment();

describe("the moment is the recorded one", () => {
  test("it is the seq the seed was stamped at", () => {
    expect(moment.seq).toBe(seed.book.seq);
  });

  test("it carries the three legs, in the seed's own order", () => {
    expect(moment.legs.map((l) => l.label)).toEqual(seed.legs.map((l: { label: string }) => l.label));
  });

  test("nothing on it is hand-written", () => {
    for (const leg of moment.legs) {
      const source = seed.legs.find((l: { label: string }) => l.label === leg.label);
      expect(leg.shiftBps).toBe(source.decomposition.published);
      expect(leg.correctionBps).toBe(Number(source.decomposition.correction));
      expect(leg.ownBps).toBe(Number(source.decomposition.ownConcession));
      expect(leg.bookBps).toBe(Number(source.decomposition.bookConcession));
      expect(leg.roomBps).toBe(Number(source.decomposition.roomBps));
      expect(leg.spread.totalBps).toBe(source.spread.totalBps);
    }
  });
});

describe("the shares are shares", () => {
  test("each leg's tokenA share is between nothing and everything", () => {
    for (const leg of moment.legs) {
      expect(leg.shareA).toBeGreaterThan(0);
      expect(leg.shareA).toBeLessThan(1);
    }
  });

  test("the book's share is the book's own, not an average drawn on screen", () => {
    expect(moment.bookShareA).toBeCloseTo(Number(BigInt(seed.book.weightA)) / 1e18, 12);
  });
});

describe("the boundary is what bounds the concession", () => {
  test("it is the shift plus the room still available, as the workflow publishes it", () => {
    for (const leg of moment.legs) {
      expect(leg.boundaryBps).toBe(Math.abs(leg.shiftBps) + leg.roomBps);
    }
  });

  test("the shift is the correction plus what survived the boundary", () => {
    // The trap from the console's leg cards, and the same one here: own + book is the concession
    // *before* the boundary cuts it, so a bar built from those two sums to a shift never published.
    for (const leg of moment.legs) {
      // Against the recomputed shift, which is what these terms are the parts of. The published one
      // is the enclave's, struck from balances at a finalized block: where a fill has landed since,
      // the two differ by design and the screen says which.
      expect(leg.correctionBps + leg.concessionBps).toBe(leg.recomputedBps);
      if (leg.ownBps + leg.bookBps !== leg.concessionBps) {
        expect(leg.cutByBoundaryBps).toBe(leg.ownBps + leg.bookBps - leg.concessionBps);
      }
    }
  });
});

describe("the spread is the four terms", () => {
  test("they sum to what the router quotes", () => {
    for (const leg of moment.legs) {
      const { baseBps, volatilityBps, markoutBps, stalenessBps, totalBps } = leg.spread;
      expect(baseBps + volatilityBps + markoutBps + stalenessBps).toBe(totalBps);
    }
  });
});

describe("the cross-chain number", () => {
  test("is the book concession, and it is the same on every leg", () => {
    // The "no bridge" diagram draws one signed number crossing between the chains. It has to be
    // the one number that actually crosses, and it has to be one number.
    const distinct = new Set(moment.legs.map((l) => l.bookBps));
    expect(distinct.size).toBe(1);
    expect(moment.crossChainBps).toBe(moment.legs[0]!.bookBps);
  });
});
