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

test("the recomputed shift reproduces the enclave's published shift on every leg", () => {
  const book = decomposeBook(inputs, ASSUMED_GAINS, BOOK.maxTiltBps);
  for (const leg of book.legs) {
    expect({ leg: leg.label, tilt: leg.tiltBps, agrees: leg.agrees }).toEqual({
      leg: leg.label,
      tilt: BigInt(leg.published),
      agrees: true,
    });
  }
});

test("the shift splits into a correction and a concession that add back up to it", () => {
  const book = decomposeBook(inputs, ASSUMED_GAINS, BOOK.maxTiltBps);
  for (const leg of book.legs) {
    expect(leg.correction + leg.concession).toBe(leg.tiltBps);
    expect(leg.ownConcession + leg.bookConcession).toBe(leg.concessionUncapped);
  }
});

test("a leg whose boundary equals its shift has no room left, so it concedes nothing", () => {
  const book = decomposeBook(inputs, ASSUMED_GAINS, BOOK.maxTiltBps);
  const base = book.legs.find((l) => l.label === "Base Sepolia")!;

  // Base's pool moved after the leg was shipped, so its correction ran the boundary out: room is
  // zero and the whole published shift is correction. This is the case that makes the split worth
  // drawing — a shift of this size that is all correction means something else entirely.
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

  // Base's zero is real: its boundary is below the cap, so the zero is a budget and not an artefact.
  const base = book.legs.find((l) => l.label === "Base Sepolia")!;
  expect(base.roomBps).toBe(0n);
  expect(base.roomUnknownAtCap).toBe(false);
});
