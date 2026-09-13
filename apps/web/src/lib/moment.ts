import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The twenty-odd numbers the landing page's diagrams draw, out of the committed recording.
 *
 * Read on the server at build time and handed to the drawings as props. Two reasons, and the second
 * is the one that matters. The recording is 348K of publish rounds and the landing needs a handful
 * of values out of it, so importing the whole thing into the bundle would be absurd. And a diagram
 * is the easiest surface in the world on which to break this project's one rule — that every figure
 * traces to a committed run or a real fill — because a bar drawn to look about right is a number
 * nobody typed and nobody can check. Nothing here is typed; it is all read.
 */
export interface LegMoment {
  readonly label: string;
  readonly chainId: number;
  /** raw balances, as committed */
  readonly balanceA: string;
  readonly balanceB: string;
  /** the tokenA share of this leg at the reference's mid, 0..1 */
  readonly shareA: number;
  /** the shift the enclave published, signed basis points */
  readonly shiftBps: number;
  /**
   * The same shift recomputed here from the same inputs, which is what the terms below add up to.
   *
   * Usually the published number to the basis point, and that agreement is the claim. Not always:
   * the enclave prices from a finalized block and this is recomputed from the head, so a fill
   * landing between the two moves it — on a forty-five USDC leg, one 0.45 USDC fill moves it about
   * two hundred basis points. Adding the terms to the *published* number was an invariant that held
   * only while the two agreed.
   */
  readonly recomputedBps: number;
  readonly correctionBps: number;
  readonly ownBps: number;
  readonly bookBps: number;
  /** what survived the boundary; correction + this is the recomputed shift */
  readonly concessionBps: number;
  /** what the boundary removed, or null where it removed nothing */
  readonly cutByBoundaryBps: number | null;
  readonly roomBps: number;
  /** |shift| + room, which is the boundary the workflow published */
  readonly boundaryBps: number;
  readonly spread: {
    readonly baseBps: number;
    readonly volatilityBps: number;
    readonly markoutBps: number;
    readonly stalenessBps: number;
    readonly totalBps: number;
  };
}

export interface Moment {
  readonly seq: number;
  readonly recordedAtSeconds: number;
  /** the one mainnet mid every leg anchors to, raw tokenB per 1e18 raw tokenA */
  readonly mid: string;
  readonly midSource: string;
  readonly bookShareA: number;
  /** the one signed number that crosses between the chains: the book concession */
  readonly crossChainBps: number;
  readonly legs: LegMoment[];
}

const share = (weightA: string): number => Number(BigInt(weightA)) / 1e18;

export function readMoment(): Moment {
  const raw = JSON.parse(
    readFileSync(join(process.cwd(), "public", "seed", "replay.json"), "utf8"),
  );

  const legs: LegMoment[] = raw.legs.map((leg: any) => {
    const d = leg.decomposition;
    const own = Number(d.ownConcession);
    const book = Number(d.bookConcession);
    const concession = Number(d.concession);
    return {
      label: leg.label,
      chainId: leg.chainId,
      balanceA: leg.balanceA,
      balanceB: leg.balanceB,
      shareA: share(d.weightA),
      shiftBps: d.published,
      recomputedBps: Number(d.tiltBps),
      correctionBps: Number(d.correction),
      ownBps: own,
      bookBps: book,
      concessionBps: concession,
      // own + book is the concession *before* the boundary. A stack built from those two sums to a
      // shift the enclave never published, which is the same trap the console's leg cards had.
      cutByBoundaryBps: own + book === concession ? null : own + book - concession,
      roomBps: Number(d.roomBps),
      boundaryBps: Math.abs(d.published) + Number(d.roomBps),
      spread: {
        baseBps: leg.spread.baseBps,
        volatilityBps: leg.spread.volatilityBps,
        markoutBps: leg.spread.markoutBps,
        stalenessBps: leg.spread.stalenessBps,
        totalBps: leg.spread.totalBps,
      },
    };
  });

  return {
    seq: raw.book.seq,
    recordedAtSeconds: raw.provenance.recordedAtSeconds,
    mid: raw.legs[0].rounds[raw.legs[0].rounds.length - 1].mid,
    midSource: raw.market.source,
    bookShareA: share(raw.book.weightA),
    crossChainBps: legs[0]!.bookBps,
    legs,
  };
}
