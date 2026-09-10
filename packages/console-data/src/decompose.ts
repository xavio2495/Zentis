import { type LegWeight, ONE, anchorTiltBps, legWeight, recoverRoom, reservation } from "@zentis/strategy-sdk";
import type { LegConfig } from "./config.js";
import type { LegHistory } from "./fills.js";
import type { StoredRef } from "./registry.js";

/**
 * `tiltBps` is one signed number on-chain, and a shift of −500 that is mostly correction means the
 * opposite of a shift of −500 that is mostly concession. Nothing on-chain records which it was, so
 * the console recomputes the split from the indexed balances and the reference's own mid, with the
 * same `reservation()` the enclave ran, and shows the enclave's number beside its own.
 *
 * The three terms are separated by re-running that policy rather than by restating it: the whole
 * shift, then the same shift with the book gain set to zero, and the correction on its own. What is
 * left over is each concession. A copy of the arithmetic here could drift from the workflows; a
 * difference of two runs of theirs cannot.
 */
export interface Gains {
  readonly kappaOwnBps: bigint;
  readonly kappaBookBps: bigint;
  readonly source: string;
}

export interface LegInput {
  readonly leg: LegConfig;
  readonly history: LegHistory;
  readonly ref: StoredRef;
}

export interface LegDecomposition {
  readonly chainId: number;
  readonly label: string;
  /** 1e18-scaled tokenA share of this leg at the reference's mid */
  readonly weightA: bigint;
  /** the anchor: what it costs to put this curve back on the mid */
  readonly correction: bigint;
  readonly ownConcession: bigint;
  readonly bookConcession: bigint;
  /** own + book, before the boundary caps them */
  readonly concessionUncapped: bigint;
  /** what survives the boundary */
  readonly concession: bigint;
  /** the console's shift: correction + concession, clamped */
  readonly tiltBps: bigint;
  /** the enclave's, straight off the registry */
  readonly published: number;
  readonly agrees: boolean;
  /** the boundary less the shift already quoted: how much this leg may still concede */
  readonly roomBps: bigint;
  /**
   * True when `roomBps` is zero only because the shift is at the signed cap.
   *
   * The workflow publishes `boundary = |shift| + room` and clamps the boundary at the maker's signed
   * cap, so a boundary sitting on that cap could be any shift plus any room. It is the *boundary*
   * that has to be on the cap, not the shift: a shift of 480 with 55 bps of room publishes 535,
   * which clamps to 500 and loses the room just as completely. Different from a leg whose boundary
   * sits below the cap and genuinely has nothing left to concede.
   */
  readonly roomUnknownAtCap: boolean;
  readonly cappedByRoom: boolean;
  readonly clampedByMaxTilt: boolean;
  /**
   * The enclave priced from balances at a finalized block; the subgraph answers at the head. When
   * these differ the two numbers are allowed to differ, and the screen says which reason applies.
   */
  readonly balancesMatchEnclave: boolean;
  readonly referenceAgeSeconds: number | null;
}

export interface BookDecomposition {
  /** the book's tokenA share: the mean of the legs', which is what the book term reads */
  readonly weightA: bigint;
  readonly seq: number | null;
  readonly gains: Gains;
  readonly legs: LegDecomposition[];
}

/**
 * A ceiling no policy reaches, used to run `reservation` with its clamp switched off so that the
 * three terms can be read before the caps hide them. The screen still shows the clamped shift.
 */
const UNCLAMPED = 1n << 40n;

const abs = (v: bigint): bigint => (v < 0n ? -v : v);

export function decomposeBook(inputs: LegInput[], gains: Gains, maxTiltBps: number): BookDecomposition {
  if (inputs.length === 0) throw new Error("a book needs at least one leg");

  // The mid is the reference's own, not the pool's: the enclave priced the weights at the number it
  // published, so recomputing against a fresher mid would compare two different questions.
  const weights: LegWeight[] = inputs.map(({ history, ref }) => {
    const position = history.position;
    if (position === null) throw new Error("a leg with no indexed position cannot be decomposed");
    return legWeight({ balanceA: position.balanceA, balanceB: position.balanceB, mid: ref.mid });
  });

  // The room is read back through the shared package, so the console and the fast workflow recover
  // the same number from the same boundary. Null is "unknowable", not "none": a boundary sitting on
  // the maker's signed cap could be any shift plus any room, so the concession runs uncapped and the
  // total still clamps at the cap. Keying this off the *boundary* rather than the shift is what
  // catches a shift of 480 with 55 bps of room, whose boundary of 535 clamps and loses the room.
  const rooms = inputs.map(({ ref }) =>
    recoverRoom(BigInt(ref.bandEdgeBps), BigInt(ref.tiltBps), BigInt(maxTiltBps)),
  );

  const applied = reservation(weights, gains.kappaOwnBps, gains.kappaBookBps, BigInt(maxTiltBps), rooms);
  const uncapped = reservation(weights, gains.kappaOwnBps, gains.kappaBookBps, UNCLAMPED);
  const ownOnly = reservation(weights, gains.kappaOwnBps, 0n, UNCLAMPED);

  const legs = inputs.map((input, i) => {
    const w = weights[i]!.weightA;
    const correction = anchorTiltBps(w);
    const concessionUncapped = uncapped[i]!.tiltBps - correction;
    const ownConcession = ownOnly[i]!.tiltBps - correction;
    const tiltBps = applied[i]!.tiltBps;
    const published = input.ref.tiltBps;
    const referenceAge = input.history.position?.refUpdatedAt ?? null;

    return {
      chainId: input.leg.chainId,
      label: input.leg.label,
      weightA: w,
      correction,
      ownConcession,
      bookConcession: concessionUncapped - ownConcession,
      concessionUncapped,
      concession: tiltBps - correction,
      tiltBps,
      published,
      agrees: tiltBps === BigInt(published),
      roomBps: rooms[i] ?? 0n,
      roomUnknownAtCap: rooms[i] === null,
      cappedByRoom: rooms[i] !== null && abs(concessionUncapped) > rooms[i]!,
      clampedByMaxTilt: abs(correction + concessionUncapped) > BigInt(maxTiltBps),
      balancesMatchEnclave: input.history.position!.balanceA === input.ref.refBalanceA,
      referenceAgeSeconds:
        referenceAge === null ? null : Math.floor(Date.now() / 1000) - Number(referenceAge),
    } satisfies LegDecomposition;
  });

  const seqs = new Set(inputs.map((i) => i.ref.seq));
  return {
    weightA: weights.reduce((sum, leg) => sum + leg.weightA, 0n) / BigInt(weights.length),
    seq: seqs.size === 1 ? inputs[0]!.ref.seq : null,
    gains,
    legs,
  };
}

/** 1e18-scaled fraction as a percentage with one decimal, for a screen that has no room for more. */
export const weightPercent = (weightA: bigint): number => Number((weightA * 1000n) / ONE) / 10;
