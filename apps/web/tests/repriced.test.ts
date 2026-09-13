import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { shiftStack } from "@/lib/leg-cards";

/**
 * The third reason the two numbers differ, which is neither a disagreement nor a carry.
 *
 * The enclave prices from balances at a finalized block; the subgraph answers at the head. A fill
 * landing between the two leaves the console recomputing from a position the enclave never saw — and
 * with a taker filling every leg on a timer, that is the ordinary state rather than a rare one. On
 * the legs as they now stand, one 0.45 USDC fill moves the recomputed shift by about two hundred
 * basis points, because a leg is forty-five USDC and the anchor is steep.
 *
 * The card had two branches and called everything else a disagreement, in red: "the console and the
 * enclave do not agree here, and no carry explains it". That is the strongest claim the screen can
 * make about its own correctness, and it would have been making it about a fill.
 */
const card = readFileSync(join(import.meta.dir, "..", "src", "components", "console", "LegCard.tsx"), "utf8");

const decomposition = (over: Record<string, unknown>) => ({
  weightA: "500000000000000000",
  correction: "-319",
  ownConcession: "47",
  bookConcession: "0",
  concessionUncapped: "47",
  concession: "47",
  tiltBps: "-126",
  published: 11,
  agrees: false,
  roomBps: "47",
  roomUnknownAtCap: false,
  cappedByRoom: false,
  clampedByMaxTilt: false,
  balancesMatchEnclave: true,
  referenceAgeSeconds: 100,
  carried: false,
  carriedFromSeq: null,
  ...over,
});

test("a leg repriced under is not a leg that disagrees", () => {
  const repriced = shiftStack(decomposition({ balancesMatchEnclave: false }) as never, 5_000);
  expect(repriced.disputed).toBe(false);
  expect(repriced.balancesMatchEnclave).toBe(false);

  // With the same balances and no carry, a difference is exactly what it looks like.
  const real = shiftStack(decomposition({}) as never, 5_000);
  expect(real.disputed).toBe(true);
});

test("the card says a fill landed, rather than accusing the two models of disagreeing", () => {
  expect(card).toMatch(/balancesMatchEnclave/);
  expect(card).toMatch(/fill has landed|filled since|since the enclave priced/i);
  // And the red is kept for the case that deserves it.
  expect(card).toMatch(/text-bad/);
});
