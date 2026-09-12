import { expect, test } from "bun:test";
import { ASSUMED_GAINS, BOOK, LEGS } from "./src/config.js";
import { decomposeBook } from "./src/decompose.js";
import { parseHistory } from "./src/fills.js";
import type { StoredRef } from "./src/registry.js";

import historySepolia from "./fixtures/history-sepolia.json" with { type: "json" };
import historyArbitrum from "./fixtures/history-arbitrum-sepolia.json" with { type: "json" };
import historyBase from "./fixtures/history-base-sepolia.json" with { type: "json" };
import refSepolia from "./fixtures/ref-sepolia.json" with { type: "json" };
import refArbitrum from "./fixtures/ref-arbitrum-sepolia.json" with { type: "json" };
import refBase from "./fixtures/ref-base-sepolia.json" with { type: "json" };

const bigints = (raw: typeof refSepolia): StoredRef => ({
  ...raw,
  mid: BigInt(raw.mid),
  updatedAt: BigInt(raw.updatedAt),
  refBalanceA: BigInt(raw.refBalanceA),
  dTiltPerA: BigInt(raw.dTiltPerA),
});

// Recorded a few minutes after the three legs were re-shipped and republished under one seq, so
// every leg's reference is fresh and its balances are the ones the enclave priced from. That is the
// only state in which the console's recomputation is expected to reproduce the enclave's number.
const inputs = [
  { leg: LEGS[0]!, history: parseHistory(LEGS[0]!.chainId, historySepolia as never), ref: bigints(refSepolia) },
  { leg: LEGS[1]!, history: parseHistory(LEGS[1]!.chainId, historyArbitrum as never), ref: bigints(refArbitrum) },
  { leg: LEGS[2]!, history: parseHistory(LEGS[2]!.chainId, historyBase as never), ref: bigints(refBase) },
];

test("the fixtures are one book: three legs under a single seq", () => {
  const seqs = new Set(inputs.map((i) => i.ref.seq));
  expect(seqs.size).toBe(1);
  expect(inputs.map((i) => i.leg.label)).toEqual(["Sepolia", "Arbitrum Sepolia", "Base Sepolia"]);
});

test("the recomputed shift reproduces the enclave's published shift, except where the tilt was carried", () => {
  // The claim this whole project rests on: the console recomputes the enclave's number from the
  // same inputs and gets the same answer. There is one state in which it cannot, and it is not a
  // disagreement — the slow workflow republishes the last fast round's tilt against a *new* boundary
  // budget, so the slot holds a tilt priced with one room beside a boundary that recovers a
  // different one. Recomputing against the recovered room then caps the concession differently and
  // lands a few basis points away, in the tilt's own direction, on every leg at once.
  //
  // So a carried round is named rather than tolerated: no threshold is widened, and a leg that is
  // not carried must still reproduce the published number exactly.
  const book = decomposeBook(inputs, ASSUMED_GAINS, BOOK.maxTiltBps);
  for (const leg of book.legs) {
    if (leg.carried) {
      expect(leg.carriedFromSeq).toBe(inputs[0]!.ref.seq - 1);
      continue;
    }
    expect({ leg: leg.label, tilt: leg.tiltBps, agrees: leg.agrees }).toEqual({
      leg: leg.label,
      tilt: BigInt(leg.published),
      agrees: true,
    });
  }
});

test("a carried round is recognised by what makes it one: the seq before it, publishing the same tilt", () => {
  // Constructed, because whether the recorder happened to catch a slow round is a fact about the
  // minute it ran. What is asserted is the recognition rule: the previous reference is this seq
  // less one, and it published the same tilt this one does. A fast round recomputes, so its tilt
  // moves; a slow round carries, so it does not.
  const book = decomposeBook(inputs, ASSUMED_GAINS, BOOK.maxTiltBps);
  for (const [i, leg] of book.legs.entries()) {
    const references = inputs[i]!.history.references;
    const previous = references.find((r) => r.seq === inputs[i]!.ref.seq - 1) ?? null;
    const carried = previous !== null && previous.tiltBps === inputs[i]!.ref.tiltBps;
    expect(leg.carried).toBe(carried);
    expect(leg.carriedFromSeq).toBe(carried ? previous!.seq : null);
  }
});

test("the shift splits into a correction and a concession that add back up to it", () => {
  const book = decomposeBook(inputs, ASSUMED_GAINS, BOOK.maxTiltBps);
  for (const leg of book.legs) {
    expect(leg.correction + leg.concession).toBe(leg.tiltBps);
    expect(leg.ownConcession + leg.bookConcession).toBe(leg.concessionUncapped);
  }
});

/**
 * The same book with one leg's boundary spent: its inventory skewed enough to want a concession,
 * and a published boundary equal to its published shift, so the recovered room is exactly zero.
 *
 * Constructed rather than recorded. Whether any leg is in this state on the day the fixtures are
 * taken is a fact about the testnet pools, not about the policy: the first recording had Base here
 * and a later one, taken minutes after a re-ship, had all three legs evenly split with nothing
 * capped. The edge is worth a test either way, so the test makes the edge.
 */
const ONE = 10n ** 18n;

const boundarySpent = () =>
  inputs.map((input) =>
    input.leg.label === "Base Sepolia"
      ? {
          ...input,
          history: {
            ...input.history,
            position: { ...input.history.position!, balanceA: (input.history.position!.balanceA * 14n) / 10n },
          },
          ref: { ...input.ref, tiltBps: -300, bandEdgeBps: 300 },
        }
      : {
          // The other two are put *exactly* on the mid, rather than assumed to be there: whether a
          // recorded leg happens to sit at the even split is a fact about the testnet that morning,
          // and the claim being tested is what a leg on the mid decomposes to.
          ...input,
          history: {
            ...input.history,
            position: {
              ...input.history.position!,
              balanceB: (input.history.position!.balanceA * input.ref.mid) / ONE,
            },
          },
        },
  );

test("a leg whose boundary equals its shift has no room left, so it concedes nothing", () => {
  const book = decomposeBook(boundarySpent(), ASSUMED_GAINS, BOOK.maxTiltBps);
  const base = book.legs.find((l) => l.label === "Base Sepolia")!;

  expect(base.roomBps).toBe(0n);
  expect(base.concession).toBe(0n);
  expect(base.correction).toBe(base.tiltBps);
  expect(base.cappedByRoom).toBe(true);

  // Sepolia and Arbitrum sit at an even split, so theirs is all concession and no correction.
  for (const label of ["Sepolia", "Arbitrum Sepolia"]) {
    const leg = book.legs.find((l) => l.label === label)!;
    expect(leg.correction).toBe(0n);
    expect(leg.concession).toBe(leg.tiltBps);
    expect(leg.roomBps).toBeGreaterThan(0n);
  }
});

test("the decomposition says out loud that it assumed the gains", () => {
  const book = decomposeBook(inputs, ASSUMED_GAINS, BOOK.maxTiltBps);
  expect(book.gains.kappaOwnBps).toBe(10_000n);
  expect(book.gains.kappaBookBps).toBe(5_000n);
  expect(book.gains.source).toContain("not read from the enclave");
});

test("the book weight is the book's, not any one leg's", () => {
  const book = decomposeBook(inputs, ASSUMED_GAINS, BOOK.maxTiltBps);
  const mean = book.legs.reduce((sum, l) => sum + l.weightA, 0n) / BigInt(book.legs.length);
  expect(book.weightA).toBe(mean);
});

test("a leg the enclave priced from different balances is flagged, not silently redrawn", () => {
  const stale = inputs.map((i, index) =>
    index === 0 ? { ...i, ref: { ...i.ref, refBalanceA: i.ref.refBalanceA + 1n } } : i,
  );
  const book = decomposeBook(stale, ASSUMED_GAINS, BOOK.maxTiltBps);
  expect(book.legs[0]!.balancesMatchEnclave).toBe(false);
  expect(book.legs[1]!.balancesMatchEnclave).toBe(true);
});

test("a leg whose shift sits at the signed cap reports its room as unknown, not as zero", () => {
  // `boundary = |shift| + room`, and the boundary is itself clamped, so a leg quoting at the cap
  // publishes a boundary equal to the cap and the recovered room comes back zero whatever room the
  // enclave actually allowed. That is the invariant behaving at its edge, and it is a different
  // fact from Base's genuine zero, where the boundary sits below the cap.
  const atCap = inputs.map((input, i) =>
    i === 0
      ? { ...input, ref: { ...input.ref, tiltBps: -BOOK.maxTiltBps, bandEdgeBps: BOOK.maxTiltBps } }
      : input,
  );
  const book = decomposeBook(atCap, ASSUMED_GAINS, BOOK.maxTiltBps);

  expect(book.legs[0]!.roomBps).toBe(0n);
  expect(book.legs[0]!.roomUnknownAtCap).toBe(true);

  // A zero that is real: the boundary sits below the cap and equals the shift, so the zero is a
  // budget the enclave set and not an artefact of the clamp. That distinction is the point of the
  // test, and it needs a leg in each state at once.
  const spent = decomposeBook(boundarySpent(), ASSUMED_GAINS, BOOK.maxTiltBps);
  const base = spent.legs.find((l) => l.label === "Base Sepolia")!;
  expect(base.roomBps).toBe(0n);
  expect(base.roomUnknownAtCap).toBe(false);
});

test("a boundary on the cap is unrecoverable even when the shift is below it", () => {
  // The case that makes the boundary, not the shift, the thing to test: a shift of 480 with 55 bps
  // of room publishes a boundary of 535, which clamps to 500 and loses the room. Keying off the
  // shift would read 20 bps of budget out of a number that carries none.
  const clamped = inputs.map((input, i) =>
    i === 0
      ? { ...input, ref: { ...input.ref, tiltBps: -480, bandEdgeBps: BOOK.maxTiltBps } }
      : input,
  );
  const leg = decomposeBook(clamped, ASSUMED_GAINS, BOOK.maxTiltBps).legs[0]!;
  expect(leg.roomUnknownAtCap).toBe(true);
  expect(leg.roomBps).toBe(0n);
});

test("a boundary below the cap still yields the room it carries", () => {
  const room = decomposeBook(inputs, ASSUMED_GAINS, BOOK.maxTiltBps).legs;
  const arbitrum = room.find((l) => l.label === "Arbitrum Sepolia")!;
  expect(arbitrum.roomUnknownAtCap).toBe(false);
  expect(arbitrum.roomBps).toBeGreaterThan(0n);
});

test("a stale boundary sitting below the shift is no room, not negative room", () => {
  const stale = inputs.map((input, i) =>
    i === 0 ? { ...input, ref: { ...input.ref, tiltBps: -300, bandEdgeBps: 100 } } : input,
  );
  const leg = decomposeBook(stale, ASSUMED_GAINS, BOOK.maxTiltBps).legs[0]!;
  expect(leg.roomBps).toBe(0n);
  expect(leg.roomUnknownAtCap).toBe(false);
});
